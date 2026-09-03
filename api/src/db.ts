import { Pool, type PoolClient, type QueryResultRow } from "pg";
import config from "./config";
import { createSqlitePool } from "./sqliteDb";

export type DbBackend = "postgres" | "sqlite";

export const dbDialect: DbBackend = config.dbBackend;

export type DbQueryResult<T> = {
    rows: T[];
    rowCount: number | null;
};

/**
 * The subset of the pg Pool surface used by repositories, server and tests.
 * Both backends expose this shape so callers stay backend-agnostic.
 */
export interface DbPoolLike {
    query<T extends QueryResultRow = any>(
        text: string,
        params?: unknown[],
    ): Promise<DbQueryResult<T>>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
    on(event: string, listener: (error: Error) => void): unknown;
    readonly totalCount: number;
    readonly idleCount: number;
    readonly waitingCount: number;
}

function createPgPool(): DbPoolLike {
    const pool = new Pool({
        connectionString: config.databaseUrl,
        max: config.databasePoolMax,
        connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
        idleTimeoutMillis: config.databaseIdleTimeoutMs,
        statement_timeout: config.databaseStatementTimeoutMs,
        query_timeout: config.databaseStatementTimeoutMs,
        idle_in_transaction_session_timeout: config.databaseIdleInTransactionTimeoutMs,
    });

    pool.on("error", (error) => {
        console.error("Unexpected PostgreSQL pool error", error);
    });

    return pool;
}

const pool: DbPoolLike =
    dbDialect === "sqlite" ? createSqlitePool() : createPgPool();

export default pool;
