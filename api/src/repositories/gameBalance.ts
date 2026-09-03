import fs from "fs";
import path from "path";
import type { PoolClient } from "pg";
import { z } from "zod";

import pool from "../db";
import { computeChecksum } from "../lib/gameData";

type NumericMap = Record<string, number>;
type NestedNumericMap = Record<string, Record<string, number>>;
type RaceBalanceRecord = {
    fuerza: number;
    agilidad: number;
    inteligencia: number;
    constitucion: number;
    carisma?: number;
};
type ClassProgressRecord = {
    vida: number;
    manaInicial: number;
    multMana: number;
    hitPre36: number;
    hitPost36: number;
};

export type GameBalanceRecordData = {
    balanceRazas: Record<string, RaceBalanceRecord>;
    classProgress: Record<string, ClassProgressRecord>;
    modEscudo: NumericMap;
    modDmgMagia: NumericMap;
    modResistenciaMagica: NumericMap;
    modDmgWrestling: NumericMap;
    modDmgProyectiles: NumericMap;
    modDmgArmas: NumericMap;
    modAtaqueWrestling: NumericMap;
    modAtaqueProyectiles: NumericMap;
    modAtaqueArmas: NumericMap;
    modEvasion: NumericMap;
};

type GameBalanceInputData = Omit<
    GameBalanceRecordData,
    "modDmgMagia" | "modResistenciaMagica"
> & {
    modDmgMagia?: NumericMap;
    modResistenciaMagica?: NumericMap;
};

type GameBalanceRow = {
    id: number;
    data: GameBalanceRecordData;
    checksum: string;
    version: string;
    updated_at: Date;
};

const BALANCE_SEED_JSON_PATH = path.resolve(__dirname, "../jsons/balance.json");
const BALANCE_ENTITY_ID = 1;

const numericMapSchema = z.record(z.string(), z.coerce.number());
const raceBalanceSchema = z.object({
    fuerza: z.coerce.number(),
    agilidad: z.coerce.number(),
    inteligencia: z.coerce.number(),
    constitucion: z.coerce.number(),
    carisma: z.coerce.number().optional(),
});
const classProgressSchema = z.object({
    vida: z.coerce.number(),
    manaInicial: z.coerce.number(),
    multMana: z.coerce.number(),
    hitPre36: z.coerce.number(),
    hitPost36: z.coerce.number(),
});
const raceBalanceMapSchema = z.record(z.string(), raceBalanceSchema);
const classProgressMapSchema = z.record(z.string(), classProgressSchema);

const gameBalanceSchema = z.object({
    balanceRazas: raceBalanceMapSchema,
    classProgress: classProgressMapSchema,
    modEscudo: numericMapSchema,
    modDmgMagia: numericMapSchema.optional(),
    modResistenciaMagica: numericMapSchema.optional(),
    modDmgWrestling: numericMapSchema,
    modDmgProyectiles: numericMapSchema,
    modDmgArmas: numericMapSchema,
    modAtaqueWrestling: numericMapSchema,
    modAtaqueProyectiles: numericMapSchema,
    modAtaqueArmas: numericMapSchema,
    modEvasion: numericMapSchema,
});

let seedPromise: Promise<void> | null = null;

function loadSeedBalanceJson(): GameBalanceRecordData {
    return normalizeGameBalanceData(
        JSON.parse(
            fs.readFileSync(BALANCE_SEED_JSON_PATH, "utf8"),
        ) as GameBalanceRecordData,
    );
}

function normalizeNumberMap(input: NumericMap): NumericMap {
    return Object.fromEntries(
        Object.entries(input ?? {}).map(([key, value]) => [
            String(Number(key)),
            Number(value),
        ]),
    );
}

function normalizeOuterNumericKeys<T extends Record<string, unknown>>(
    input: Record<string, T>,
): Record<string, T> {
    return Object.fromEntries(
        Object.entries(input ?? {}).map(([key, value]) => [
            String(Number(key)),
            value,
        ]),
    );
}

function normalizeGameBalanceData(
    data: GameBalanceInputData,
): GameBalanceRecordData {
    const parsed = gameBalanceSchema.parse(data);

    return {
        balanceRazas: normalizeOuterNumericKeys(parsed.balanceRazas),
        classProgress: normalizeOuterNumericKeys(parsed.classProgress),
        modEscudo: normalizeNumberMap(parsed.modEscudo),
        modDmgMagia: normalizeNumberMap(
            parsed.modDmgMagia ?? loadSeedBalanceJson().modDmgMagia,
        ),
        modResistenciaMagica: normalizeNumberMap(
            parsed.modResistenciaMagica ??
                loadSeedBalanceJson().modResistenciaMagica,
        ),
        modDmgWrestling: normalizeNumberMap(parsed.modDmgWrestling),
        modDmgProyectiles: normalizeNumberMap(parsed.modDmgProyectiles),
        modDmgArmas: normalizeNumberMap(parsed.modDmgArmas),
        modAtaqueWrestling: normalizeNumberMap(parsed.modAtaqueWrestling),
        modAtaqueProyectiles: normalizeNumberMap(parsed.modAtaqueProyectiles),
        modAtaqueArmas: normalizeNumberMap(parsed.modAtaqueArmas),
        modEvasion: normalizeNumberMap(parsed.modEvasion),
    };
}

async function insertRevision(
    client: PoolClient,
    entityId: number,
    checksum: string,
): Promise<number> {
    const result = await client.query<{ id: string }>(
        `
      INSERT INTO game_data_revisions (kind, entity_id, action, checksum)
      VALUES ('balance', $1, 'upsert', $2)
      RETURNING id
    `,
        [entityId, checksum],
    );

    return Number(result.rows[0]?.id ?? 0);
}

async function ensureSeededInternal(): Promise<void> {
    const countResult = await pool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM game_balance",
    );
    if (Number(countResult.rows[0]?.count ?? 0) > 0) {
        return;
    }

    const data = loadSeedBalanceJson();
    const checksum = computeChecksum(data);
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query(
            `
        INSERT INTO game_balance (id, data, checksum, version, updated_at)
        VALUES ($1, $2::jsonb, $3, 0, NOW())
        ON CONFLICT (id) DO NOTHING
      `,
            [BALANCE_ENTITY_ID, JSON.stringify(data), checksum],
        );
        const version = await insertRevision(
            client,
            BALANCE_ENTITY_ID,
            checksum,
        );
        await client.query(
            "UPDATE game_balance SET version = $2 WHERE id = $1",
            [BALANCE_ENTITY_ID, version],
        );
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

async function ensureSeeded(): Promise<void> {
    if (!seedPromise) {
        seedPromise = ensureSeededInternal().finally(() => {
            seedPromise = null;
        });
    }

    await seedPromise;
}

function toGameBalanceSummary(row: GameBalanceRow) {
    return {
        id: row.id,
        version: Number(row.version),
        updatedAt: row.updated_at.toISOString(),
    };
}

export async function getGameBalance() {
    await ensureSeeded();
    const result = await pool.query<GameBalanceRow>(
        `SELECT id, data, checksum, version::text AS version, updated_at FROM game_balance WHERE id = $1 LIMIT 1`,
        [BALANCE_ENTITY_ID],
    );

    const row = result.rows[0];
    if (!row) {
        throw new Error("Game balance not found");
    }

    return {
        ...toGameBalanceSummary(row),
        checksum: row.checksum,
        data: normalizeGameBalanceData(row.data),
    };
}

export async function upsertGameBalance(
    input: unknown,
    updatedByAccountId?: string | null,
) {
    await ensureSeeded();
    const data = normalizeGameBalanceData(gameBalanceSchema.parse(input));
    const checksum = computeChecksum(data);
    const current = await pool.query<{ checksum: string }>(
        "SELECT checksum FROM game_balance WHERE id = $1 LIMIT 1",
        [BALANCE_ENTITY_ID],
    );
    const currentChecksum = current.rows[0]?.checksum ?? null;

    if (currentChecksum === checksum) {
        const unchanged = await getGameBalance();
        return { unchanged: true, balance: unchanged };
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query(
            `
        INSERT INTO game_balance (id, data, checksum, version, updated_by_account_id, updated_at)
        VALUES ($1, $2::jsonb, $3, 0, $4, NOW())
        ON CONFLICT (id)
        DO UPDATE SET data = EXCLUDED.data,
                      checksum = EXCLUDED.checksum,
                      updated_by_account_id = EXCLUDED.updated_by_account_id,
                      updated_at = NOW()
      `,
            [
                BALANCE_ENTITY_ID,
                JSON.stringify(data),
                checksum,
                updatedByAccountId ?? null,
            ],
        );
        const version = await insertRevision(
            client,
            BALANCE_ENTITY_ID,
            checksum,
        );
        await client.query(
            "UPDATE game_balance SET version = $2 WHERE id = $1",
            [BALANCE_ENTITY_ID, version],
        );
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }

    const next = await getGameBalance();
    return { unchanged: false, balance: next };
}

export async function listGameBalanceChangesSince(sinceVersion: number) {
    await ensureSeeded();
    const result = await pool.query<GameBalanceRow>(
        `
      SELECT id, data, checksum, version::text AS version, updated_at
      FROM game_balance
      WHERE version > $1
      ORDER BY version ASC
    `,
        [sinceVersion],
    );

    const currentVersion = result.rows.reduce(
        (max, row) => Math.max(max, Number(row.version)),
        sinceVersion,
    );

    return {
        currentVersion,
        changes: result.rows.map((row) => ({
            id: row.id,
            version: Number(row.version),
            data: normalizeGameBalanceData(row.data),
        })),
    };
}
