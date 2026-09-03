import fs from "fs";
import path from "path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { PoolClient } from "pg";
import config from "./config";
import type { DbPoolLike, DbQueryResult } from "./db";

/**
 * SQLite backend for the API data layer, built on node:sqlite (DatabaseSync).
 *
 * The adapter emulates the subset of the `pg` Pool/PoolClient surface that the
 * repositories use:
 *   - pool.query(text, params) with $n placeholders and PG-flavoured SQL
 *   - pool.connect() -> client with query()/release() and BEGIN/COMMIT/ROLLBACK
 *
 * SQL is translated from the PostgreSQL dialect to SQLite on the fly (see
 * translateSql). Repository code keeps a single SQL text for both backends;
 * only constructs that cannot be translated mechanically (data-modifying CTEs,
 * EXTRACT(EPOCH ...)/to_timestamp) are branch-selected in the repositories via
 * the exported `dbDialect`.
 *
 * Row values are normalized to match the `pg` driver's output using the
 * declared column types reported by SQLite (the SQLite schema keeps the PG
 * type names BOOLEAN / TIMESTAMPTZ / JSONB / BIGINT on purpose):
 *   - BOOLEAN     0/1   -> false/true
 *   - TIMESTAMPTZ TEXT  -> Date (pg returns Date objects)
 *   - JSONB       TEXT  -> JSON.parse (pg auto-parses jsonb)
 *   - BIGINT      int   -> string (pg returns int8 as string)
 */

const ISO_TS_EXPRESSION = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now'";

const INTERVAL_UNIT_SECONDS: Record<string, number> = {
    millisecond: 0.001,
    second: 1,
    minute: 60,
    hour: 3600,
    day: 86400,
};

// Casts that can be dropped because SQLite is dynamically typed and the bound
// parameter / expression is already in the right representation.
const DROPPED_CASTS = new Set([
    "jsonb",
    "json",
    "uuid",
    "timestamptz",
    "timestamp",
    "text",
]);

const CAST_TYPE_MAP: Record<string, string | null> = {
    text: "TEXT",
    int: "INTEGER",
    integer: "INTEGER",
    bigint: "INTEGER",
    smallint: "INTEGER",
    numeric: "REAL",
    real: "REAL",
    "double precision": "REAL",
    boolean: "INTEGER",
    jsonb: null,
    json: null,
    uuid: null,
    timestamptz: null,
    timestamp: null,
};

type TranslatedQuery = {
    text: string;
    // Placeholder order: entry i is the 1-based $n index bound to the i-th '?'.
    order: number[];
};

function translateIntervalExpressions(sql: string): string {
    let text = sql;

    // NOW() + ($n::text || ' hours')::interval
    text = text.replace(
        /NOW\s*\(\s*\)\s*([+-])\s*\(\s*\$(\d+)\s*::\s*\w+\s*\|\|\s*'\s*(millisecond|second|minute|hour|day)s?'\s*\)\s*::\s*interval/gi,
        (_match, sign: string, num: string, unit: string) =>
            `${ISO_TS_EXPRESSION}, '${sign}' || (($${num}) * ${INTERVAL_UNIT_SECONDS[unit.toLowerCase()]}) || ' seconds')`,
    );

    // NOW() ± ($n[::cast] * INTERVAL '1 unit')
    text = text.replace(
        /NOW\s*\(\s*\)\s*([+-])\s*\(\s*\$(\d+)\s*(?:::[\w ]+?)?\s*\*\s*INTERVAL\s*'1\s*(millisecond|second|minute|hour|day)'\s*\)/gi,
        (_match, sign: string, num: string, unit: string) =>
            `${ISO_TS_EXPRESSION}, '${sign}' || (($${num}) * ${INTERVAL_UNIT_SECONDS[unit.toLowerCase()]}) || ' seconds')`,
    );

    // NOW() ± INTERVAL 'n unit'
    text = text.replace(
        /NOW\s*\(\s*\)\s*([+-])\s*INTERVAL\s*'(\d+)\s*(millisecond|second|minute|hour|day)s?'/gi,
        (_match, sign: string, amount: string, unit: string) =>
            `${ISO_TS_EXPRESSION}, '${sign}${Number(amount) * INTERVAL_UNIT_SECONDS[unit.toLowerCase()]} seconds')`,
    );

    return text;
}

/**
 * Rewrites `expr::type` casts to CAST(expr AS type). Cast removal/rewriting is
 * limited to the audited set in CAST_TYPE_MAP; anything else is left in place
 * so SQLite fails loudly instead of silently mis-translating.
 */
function rewriteExpressionCasts(sql: string): string {
    let out = "";
    let index = 0;
    let inString = false;
    const parenStack: number[] = [];
    let lastCloseParenOpen = -1;

    while (index < sql.length) {
        const ch = sql[index];

        if (inString) {
            out += ch;
            if (ch === "'") {
                if (sql[index + 1] === "'") {
                    out += "'";
                    index += 2;
                    continue;
                }
                inString = false;
            }
            index += 1;
            continue;
        }

        if (ch === "'") {
            inString = true;
            out += ch;
            index += 1;
            continue;
        }

        if (ch === "(") {
            parenStack.push(out.length);
            out += ch;
            index += 1;
            continue;
        }

        if (ch === ")") {
            lastCloseParenOpen = parenStack.pop() ?? -1;
            out += ch;
            index += 1;
            continue;
        }

        if (ch === ":" && sql[index + 1] === ":") {
            const match = /^::\s*(double precision|[A-Za-z]+)\s*(\[\s*\])?/.exec(
                sql.slice(index),
            );

            if (match) {
                const type = match[1].toLowerCase();
                const mapped = CAST_TYPE_MAP[type];

                if (mapped !== undefined) {
                    const operandStart = findOperandStart(
                        out,
                        lastCloseParenOpen,
                    );
                    const operand = out.slice(operandStart);
                    out = out.slice(0, operandStart);
                    out += mapped === null ? operand : `CAST(${operand} AS ${mapped})`;
                    index += match[0].length;
                    continue;
                }
            }

            out += ch;
            index += 1;
            continue;
        }

        out += ch;
        index += 1;
    }

    return out;
}

function findOperandStart(text: string, lastCloseParenOpen: number): number {
    let k = text.length - 1;

    while (k >= 0 && /\s/.test(text[k])) {
        k -= 1;
    }

    if (k < 0) {
        return 0;
    }

    if (text[k] === ")") {
        // Operand is a parenthesized group, optionally preceded by a function
        // name (COUNT(...), COALESCE(...), ROUND(...), NULLIF(...)).
        if (lastCloseParenOpen < 0) {
            return k;
        }

        let j = lastCloseParenOpen - 1;

        while (j >= 0 && /\s/.test(text[j])) {
            j -= 1;
        }

        const identEnd = j;

        while (j >= 0 && /[A-Za-z0-9_]/.test(text[j])) {
            j -= 1;
        }

        return identEnd > j ? j + 1 : lastCloseParenOpen;
    }

    if (text[k] === "'") {
        // Operand is a string literal.
        let j = k - 1;

        while (j >= 0 && text[j] !== "'") {
            j -= 1;
        }

        return Math.max(j, 0);
    }

    // Operand is an identifier chain (version, alias.column, ...).
    let j = k;

    while (j >= 0 && /[\w$.]/.test(text[j])) {
        j -= 1;
    }

    return j + 1;
}

function replacePlaceholders(sql: string, order: number[]): string {
    let out = "";
    let index = 0;
    let inString = false;

    while (index < sql.length) {
        const ch = sql[index];

        if (inString) {
            out += ch;
            if (ch === "'") {
                if (sql[index + 1] === "'") {
                    out += "'";
                    index += 2;
                    continue;
                }
                inString = false;
            }
            index += 1;
            continue;
        }

        if (ch === "'") {
            inString = true;
            out += ch;
            index += 1;
            continue;
        }

        if (ch === "$" && /\d/.test(sql[index + 1] ?? "")) {
            const match = /^\$(\d+)/.exec(sql.slice(index));

            if (match) {
                order.push(Number(match[1]));
                out += "?";
                index += match[0].length;
                continue;
            }
        }

        out += ch;
        index += 1;
    }

    return out;
}

function translateSql(sql: string): TranslatedQuery {
    let text = translateIntervalExpressions(sql);

    if (/INTERVAL/i.test(text)) {
        throw new Error(
            `Unsupported INTERVAL expression for SQLite backend: ${sql}`,
        );
    }

    // col = ANY($n::type[]) -> col IN (SELECT value FROM json_each($n))
    text = text.replace(
        /([A-Za-z_][\w.]*)\s*=\s*ANY\s*\(\s*\$(\d+)\s*::\s*[A-Za-z][\w ]*?\[\s*\]\s*\)/g,
        (_match, column: string, num: string) =>
            `${column} IN (SELECT value FROM json_each($${num}))`,
    );

    if (/\bANY\s*\(/i.test(text)) {
        throw new Error(`Unsupported ANY expression for SQLite backend: ${sql}`);
    }

    // Casts on bound parameters ($1::jsonb, $1::timestamptz, ...) are dropped:
    // parameters are already normalized to SQLite representations.
    text = text.replace(
        /\$(\d+)\s*::\s*(double precision|[A-Za-z]+)\s*(\[\s*\])?/g,
        (_match, num: string, type: string) => {
            const normalized = type.toLowerCase();

            if (DROPPED_CASTS.has(normalized) || normalized === "double precision") {
                return `$${num}`;
            }

            if (CAST_TYPE_MAP[normalized] !== undefined) {
                return `$${num}`;
            }

            throw new Error(
                `Unsupported parameter cast ::${type} for SQLite backend: ${sql}`,
            );
        },
    );

    text = rewriteExpressionCasts(text);

    // Row locks do not exist in SQLite; mutual exclusion is provided by
    // BEGIN IMMEDIATE transactions at the client level.
    text = text.replace(
        /\s+FOR\s+UPDATE(\s+OF\s+[A-Za-z_]\w*(\s*,\s*[A-Za-z_]\w*)*)?\s*$/i,
        "",
    );

    if (/\bFOR\s+UPDATE\b/i.test(text)) {
        throw new Error(
            `Unsupported FOR UPDATE expression for SQLite backend: ${sql}`,
        );
    }

    const order: number[] = [];
    text = replacePlaceholders(text, order);

    return { text, order };
}

function normalizeParam(value: unknown): string | number | null {
    if (value === undefined || value === null) {
        return null;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (typeof value === "boolean") {
        return value ? 1 : 0;
    }

    if (typeof value === "number" || typeof value === "string") {
        return value;
    }

    if (typeof value === "bigint") {
        return Number(value);
    }

    if (Array.isArray(value) || typeof value === "object") {
        // Arrays feed json_each(...) (translated ANY) and objects/arrays feed
        // JSONB columns; both want a JSON text representation.
        return JSON.stringify(value);
    }

    return String(value);
}

function convertColumnValue(declaredType: string | null, value: unknown): unknown {
    if (value === null || value === undefined || !declaredType) {
        return value ?? null;
    }

    switch (declaredType.toUpperCase()) {
        case "BOOLEAN":
            return value !== 0 && value !== "0";
        case "TIMESTAMPTZ":
        case "TIMESTAMP": {
            const parsed = new Date(value as string);
            return Number.isNaN(parsed.getTime()) ? value : parsed;
        }
        case "JSONB":
        case "JSON":
            return typeof value === "string" ? JSON.parse(value) : value;
        case "BIGINT":
            return String(value);
        default:
            return value;
    }
}

class Mutex {
    private tail: Promise<void> = Promise.resolve();

    acquire(): Promise<() => void> {
        let release!: () => void;
        const next = new Promise<void>((resolve) => {
            release = resolve;
        });
        const previous = this.tail;
        this.tail = this.tail.then(() => next);
        return previous.then(() => release);
    }
}

class SqliteClientAdapter {
    private txRelease: (() => void) | null = null;
    private inTransaction = false;

    constructor(private readonly owner: SqlitePoolAdapter) {}

    async query<T = unknown>(
        text: string,
        params?: unknown[],
    ): Promise<DbQueryResult<T>> {
        const command = text.trim().toUpperCase();

        if (command === "BEGIN") {
            // BEGIN IMMEDIATE grabs the SQLite write lock up front, which is
            // the semantic repositories relied on with SELECT ... FOR UPDATE.
            this.txRelease = await this.owner.mutex.acquire();

            try {
                this.owner.db.exec("BEGIN IMMEDIATE");
                this.inTransaction = true;
            } catch (error) {
                this.txRelease();
                this.txRelease = null;
                throw error;
            }

            return { rows: [], rowCount: 0 };
        }

        if (command === "COMMIT" || command === "ROLLBACK") {
            // pg tolerates COMMIT/ROLLBACK outside a transaction (warning
            // only); mirror that so repo error paths can always roll back.
            if (this.inTransaction) {
                try {
                    this.owner.db.exec(command);
                } finally {
                    this.inTransaction = false;
                    this.txRelease?.();
                    this.txRelease = null;
                }
            } else if (this.txRelease) {
                this.txRelease();
                this.txRelease = null;
            }

            return { rows: [], rowCount: 0 };
        }

        if (this.txRelease) {
            // This client owns the write lock: run directly.
            return this.owner.runQuery<T>(text, params);
        }

        const release = await this.owner.mutex.acquire();

        try {
            return this.owner.runQuery<T>(text, params);
        } finally {
            release();
        }
    }

    release(): void {
        if (this.inTransaction) {
            // Match pg: releasing a client mid-transaction rolls back.
            try {
                this.owner.db.exec("ROLLBACK");
            } catch {
                // ignore
            }
            this.inTransaction = false;
        }

        if (this.txRelease) {
            this.txRelease();
            this.txRelease = null;
        }
    }
}

export class SqlitePoolAdapter {
    readonly db: DatabaseSync;
    readonly mutex = new Mutex();
    private readonly statements = new Map<string, StatementSync>();

    constructor(databasePath: string) {
        if (databasePath !== ":memory:") {
            fs.mkdirSync(path.dirname(databasePath), { recursive: true });
        }

        this.db = new DatabaseSync(databasePath);
        this.db.exec("PRAGMA journal_mode = WAL");
        this.db.exec("PRAGMA busy_timeout = 5000");
        this.db.exec("PRAGMA foreign_keys = ON");
        // PG LIKE is case-sensitive; keep the same semantics.
        this.db.exec("PRAGMA case_sensitive_like = ON");

        // PG SQL functions used by repository queries. Timestamps are stored
        // as ISO-8601 UTC text so lexicographic comparison matches chronological
        // order.
        this.db.function("now", () => new Date().toISOString());
        this.db.function("date_trunc", (precision: unknown, value: unknown) => {
            if (String(precision).toLowerCase() !== "minute") {
                throw new Error(
                    `Unsupported date_trunc precision: ${String(precision)}`,
                );
            }
            const parsed = new Date(String(value));

            if (Number.isNaN(parsed.getTime())) {
                return null;
            }

            parsed.setUTCSeconds(0, 0);
            return parsed.toISOString();
        });

        this.applySchema();
    }

    get totalCount(): number {
        return 1;
    }

    get idleCount(): number {
        return 0;
    }

    get waitingCount(): number {
        return 0;
    }

    on(): this {
        return this;
    }

    async query<T = unknown>(
        text: string,
        params?: unknown[],
    ): Promise<DbQueryResult<T>> {
        const release = await this.mutex.acquire();

        try {
            return this.runQuery<T>(text, params);
        } finally {
            release();
        }
    }

    async connect(): Promise<PoolClient> {
        return new SqliteClientAdapter(this) as unknown as PoolClient;
    }

    async end(): Promise<void> {
        this.db.close();
    }

    runQuery<T>(text: string, params?: unknown[]): DbQueryResult<T> {
        const translated = translateSql(text);
        const statement = this.getStatement(translated.text);
        const bound = translated.order.map((position) =>
            normalizeParam(params?.[position - 1]),
        );
        const columns = statement.columns();

        if (columns.length > 0) {
            const rawRows = statement.all(...bound) as Record<
                string,
                unknown
            >[];
            const rows = rawRows.map((rawRow) => {
                const row: Record<string, unknown> = {};

                for (const column of columns) {
                    row[column.name] = convertColumnValue(
                        column.type,
                        rawRow[column.name],
                    );
                }

                return row as T;
            });

            return { rows, rowCount: rows.length };
        }

        const info = statement.run(...bound);
        return { rows: [], rowCount: Number(info.changes) };
    }

    private getStatement(sql: string): StatementSync {
        let statement = this.statements.get(sql);

        if (!statement) {
            statement = this.db.prepare(sql);
            this.statements.set(sql, statement);
        }

        return statement;
    }

    private applySchema(): void {
        const schemaPath = path.resolve(__dirname, "..", "schema.sqlite.sql");
        const schemaSql = fs.readFileSync(schemaPath, "utf8");
        this.db.exec(schemaSql);
        this.applyIncrementalMigrations();
    }

    /**
     * Column additions for databases created before the column existed in the
     * schema file. SQLite has no ADD COLUMN IF NOT EXISTS, so each addition is
     * guarded by a PRAGMA table_info check. Keep in sync with schema.sqlite.sql.
     */
    private applyIncrementalMigrations(): void {
        const accountColumns = this.db
            .prepare("PRAGMA table_info(accounts)")
            .all() as { name: string; notnull: number }[];

        if (!accountColumns.some((column) => column.name === "is_admin")) {
            this.db.exec(
                "ALTER TABLE accounts ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE",
            );
        }

        if (!accountColumns.some((column) => column.name === "disabled_at")) {
            this.db.exec(
                "ALTER TABLE accounts ADD COLUMN disabled_at TIMESTAMPTZ",
            );
        }

        // SQLite cannot DROP NOT NULL via ALTER COLUMN, so making email
        // optional on databases created with the old schema requires a table
        // rebuild (the standard create/copy/drop/rename dance).
        const emailColumn = accountColumns.find(
            (column) => column.name === "email",
        );

        if (emailColumn?.notnull) {
            this.db.exec("PRAGMA foreign_keys = OFF");

            try {
                this.db.exec(`
                    BEGIN;
                    CREATE TABLE accounts_email_nullable (
                        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-8' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
                        name TEXT NOT NULL,
                        name_sanitized TEXT,
                        password TEXT,
                        email TEXT UNIQUE,
                        is_admin BOOLEAN NOT NULL DEFAULT FALSE,
                        disabled_at TIMESTAMPTZ,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                    );
                    INSERT INTO accounts_email_nullable (id, name, name_sanitized, password, email, is_admin, disabled_at, created_at, updated_at)
                        SELECT id, name, name_sanitized, password, email, is_admin, disabled_at, created_at, updated_at
                        FROM accounts;
                    DROP TABLE accounts;
                    ALTER TABLE accounts_email_nullable RENAME TO accounts;
                    CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
                    COMMIT;
                `);
            } catch (error) {
                this.db.exec("ROLLBACK");
                throw error;
            } finally {
                this.db.exec("PRAGMA foreign_keys = ON");
            }
        }

        // Checked after the email rebuild above: that rebuild recreates the
        // table from an older column list, so it must run first.
        const finalAccountColumns = this.db
            .prepare("PRAGMA table_info(accounts)")
            .all() as { name: string }[];

        if (
            !finalAccountColumns.some(
                (column) => column.name === "must_change_password",
            )
        ) {
            this.db.exec(
                "ALTER TABLE accounts ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE",
            );
        }

        const characterColumns = this.db
            .prepare("PRAGMA table_info(characters)")
            .all() as { name: string }[];

        if (!characterColumns.some((column) => column.name === "hunger")) {
            this.db.exec(
                "ALTER TABLE characters ADD COLUMN hunger INTEGER NOT NULL DEFAULT 100",
            );
        }

        if (!characterColumns.some((column) => column.name === "thirst")) {
            this.db.exec(
                "ALTER TABLE characters ADD COLUMN thirst INTEGER NOT NULL DEFAULT 100",
            );
        }

        if (!characterColumns.some((column) => column.name === "stamina")) {
            this.db.exec(
                "ALTER TABLE characters ADD COLUMN stamina INTEGER NOT NULL DEFAULT 100",
            );
        }

        if (!characterColumns.some((column) => column.name === "max_stamina")) {
            this.db.exec(
                "ALTER TABLE characters ADD COLUMN max_stamina INTEGER NOT NULL DEFAULT 100",
            );
        }

        if (!characterColumns.some((column) => column.name === "envenenado")) {
            this.db.exec(
                "ALTER TABLE characters ADD COLUMN envenenado INTEGER NOT NULL DEFAULT 0",
            );
        }
    }
}

export function createSqlitePool(): DbPoolLike {
    return new SqlitePoolAdapter(config.sqlitePath) as unknown as DbPoolLike;
}
