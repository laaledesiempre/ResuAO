import type { PoolClient } from "pg";
import { z } from "zod";
import pool from "../db";
import {
  computeChecksum,
  loadSeedSmeltingRecipesJson,
  normalizeSmeltingRecipeData,
  type GameSmeltingRecipeRecordData,
} from "../lib/gameData";

type GameSmeltingRecipeRow = {
  id: number;
  mineral_item_id: number;
  ingot_item_id: number;
  required_skill: number;
  minerals_per_ingot: number;
  data: GameSmeltingRecipeRecordData;
  checksum: string;
  version: string;
  updated_at: Date;
};

const gameSmeltingRecipeSchema = z.object({
  id: z.coerce.number().int().positive(),
  mineralItemId: z.coerce.number().int().positive(),
  ingotItemId: z.coerce.number().int().positive(),
  requiredSkill: z.coerce.number().int().min(0).max(100),
  mineralsPerIngot: z.coerce.number().int().positive(),
});

let seedPromise: Promise<void> | null = null;

async function insertRevision(client: PoolClient, entityId: number, checksum: string): Promise<number> {
  const revisionResult = await client.query<{ id: string }>(
    `
      INSERT INTO game_data_revisions (kind, entity_id, action, checksum)
      VALUES ('smelting_recipes', $1, 'upsert', $2)
      RETURNING id
    `,
    [entityId, checksum],
  );

  return Number(revisionResult.rows[0]?.id ?? 0);
}

async function ensureSeededInternal(): Promise<void> {
  const countResult = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM game_smelting_recipes");
  if (Number(countResult.rows[0]?.count ?? 0) > 0) {
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows = loadSeedSmeltingRecipesJson();
    for (const row of rows) {
      const checksum = computeChecksum(row.data);
      await client.query(
        `
          INSERT INTO game_smelting_recipes (id, mineral_item_id, ingot_item_id, required_skill, minerals_per_ingot, data, checksum, version, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 0, NOW())
          ON CONFLICT (id) DO NOTHING
        `,
        [row.id, row.data.mineralItemId, row.data.ingotItemId, row.data.requiredSkill, row.data.mineralsPerIngot, JSON.stringify(row.data), checksum],
      );
      const version = await insertRevision(client, row.id, checksum);
      await client.query("UPDATE game_smelting_recipes SET version = $2 WHERE id = $1", [row.id, version]);
    }
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

export async function getCurrentGameSmeltingRecipeVersion(): Promise<number> {
  await ensureSeeded();
  const result = await pool.query<{ version: string }>(
    "SELECT COALESCE(MAX(version), 0)::text AS version FROM game_smelting_recipes",
  );
  return Number(result.rows[0]?.version ?? 0);
}

function toSummary(row: GameSmeltingRecipeRow) {
  return {
    id: row.id,
    mineralItemId: row.mineral_item_id,
    ingotItemId: row.ingot_item_id,
    requiredSkill: row.required_skill,
    mineralsPerIngot: row.minerals_per_ingot,
    version: Number(row.version),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listGameSmeltingRecipes() {
  await ensureSeeded();
  const result = await pool.query<GameSmeltingRecipeRow>(
    `SELECT id, mineral_item_id, ingot_item_id, required_skill, minerals_per_ingot, data, checksum, version::text AS version, updated_at FROM game_smelting_recipes ORDER BY id ASC`,
  );
  return { recipes: result.rows.map(toSummary) };
}

export async function getGameSmeltingRecipeById(id: number) {
  await ensureSeeded();
  const result = await pool.query<GameSmeltingRecipeRow>(
    `SELECT id, mineral_item_id, ingot_item_id, required_skill, minerals_per_ingot, data, checksum, version::text AS version, updated_at FROM game_smelting_recipes WHERE id = $1 LIMIT 1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Game smelting recipe not found");
  return { ...toSummary(row), checksum: row.checksum, data: normalizeSmeltingRecipeData(row.data) };
}

export async function upsertGameSmeltingRecipe(id: number, input: unknown, updatedByAccountId?: string | null) {
  await ensureSeeded();
  const parsed = gameSmeltingRecipeSchema.parse({ ...((input as Record<string, unknown>) ?? {}), id });
  const data = normalizeSmeltingRecipeData(parsed as GameSmeltingRecipeRecordData);
  const checksum = computeChecksum(data);
  const current = await pool.query<{ checksum: string }>("SELECT checksum FROM game_smelting_recipes WHERE id = $1 LIMIT 1", [id]);
  const currentChecksum = current.rows[0]?.checksum ?? null;
  if (currentChecksum === checksum) {
    return { unchanged: true, recipe: await getGameSmeltingRecipeById(id) };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO game_smelting_recipes (id, mineral_item_id, ingot_item_id, required_skill, minerals_per_ingot, data, checksum, version, updated_by_account_id, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 0, $8, NOW())
        ON CONFLICT (id)
        DO UPDATE SET mineral_item_id = EXCLUDED.mineral_item_id,
                      ingot_item_id = EXCLUDED.ingot_item_id,
                      required_skill = EXCLUDED.required_skill,
                      minerals_per_ingot = EXCLUDED.minerals_per_ingot,
                      data = EXCLUDED.data,
                      checksum = EXCLUDED.checksum,
                      updated_by_account_id = EXCLUDED.updated_by_account_id,
                      updated_at = NOW()
      `,
      [id, data.mineralItemId, data.ingotItemId, data.requiredSkill, data.mineralsPerIngot, JSON.stringify(data), checksum, updatedByAccountId ?? null],
    );
    const version = await insertRevision(client, id, checksum);
    await client.query("UPDATE game_smelting_recipes SET version = $2 WHERE id = $1", [id, version]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return { unchanged: false, recipe: await getGameSmeltingRecipeById(id) };
}

export async function listGameSmeltingRecipeChangesSince(sinceVersion: number) {
  await ensureSeeded();
  const result = await pool.query<GameSmeltingRecipeRow>(
    `SELECT id, mineral_item_id, ingot_item_id, required_skill, minerals_per_ingot, data, checksum, version::text AS version, updated_at FROM game_smelting_recipes WHERE version > $1 ORDER BY version ASC`,
    [sinceVersion],
  );
  const currentVersion = result.rows.reduce((max, row) => Math.max(max, Number(row.version)), sinceVersion);
  return {
    currentVersion,
    changes: result.rows.map((row) => ({ id: row.id, version: Number(row.version), data: normalizeSmeltingRecipeData(row.data) })),
  };
}
