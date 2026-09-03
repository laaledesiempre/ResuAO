import type { PoolClient } from "pg";
import { z } from "zod";
import pool from "../db";
import {
  computeChecksum,
  loadSeedCraftingRecipesJson,
  normalizeCraftingRecipeData,
  type GameCraftingRecipeRecordData,
} from "../lib/gameData";

type GameCraftingRecipeRow = {
  id: number;
  profession: string;
  category: string;
  item_id: number;
  skill: number;
  data: GameCraftingRecipeRecordData;
  checksum: string;
  version: string;
  updated_at: Date;
};

const materialSchema = z.object({ itemId: z.coerce.number().int().positive(), amount: z.coerce.number().int().positive() });

const gameCraftingRecipeSchema = z.object({
  id: z.coerce.number().int().positive(),
  profession: z.enum(["carpentry", "blacksmith", "tailoring"]),
  category: z.string().trim().min(1),
  sortOrder: z.coerce.number().int().positive().optional(),
  itemId: z.coerce.number().int().positive(),
  skill: z.coerce.number().int().min(0).max(100),
  materials: z.array(materialSchema),
});

const listFiltersSchema = z.object({
  profession: z.enum(["carpentry", "blacksmith", "tailoring"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

let seedPromise: Promise<void> | null = null;

async function insertRevision(client: PoolClient, entityId: number, checksum: string): Promise<number> {
  const revisionResult = await client.query<{ id: string }>(
    `
      INSERT INTO game_data_revisions (kind, entity_id, action, checksum)
      VALUES ('crafting_recipes', $1, 'upsert', $2)
      RETURNING id
    `,
    [entityId, checksum],
  );

  return Number(revisionResult.rows[0]?.id ?? 0);
}

async function ensureSeededInternal(): Promise<void> {
  const countResult = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM game_crafting_recipes");
  if (Number(countResult.rows[0]?.count ?? 0) > 0) {
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows = loadSeedCraftingRecipesJson();
    for (const row of rows) {
      const checksum = computeChecksum(row.data);
      await client.query(
        `
          INSERT INTO game_crafting_recipes (id, profession, category, item_id, skill, data, checksum, version, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 0, NOW())
          ON CONFLICT (id) DO NOTHING
        `,
        [row.id, row.data.profession, row.data.category, row.data.itemId, row.data.skill, JSON.stringify(row.data), checksum],
      );
      const version = await insertRevision(client, row.id, checksum);
      await client.query("UPDATE game_crafting_recipes SET version = $2 WHERE id = $1", [row.id, version]);
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

export async function getCurrentGameCraftingRecipeVersion(): Promise<number> {
  await ensureSeeded();
  const result = await pool.query<{ version: string }>(
    "SELECT COALESCE(MAX(version), 0)::text AS version FROM game_crafting_recipes",
  );
  return Number(result.rows[0]?.version ?? 0);
}

function toSummary(row: GameCraftingRecipeRow) {
  return {
    id: row.id,
    profession: row.profession,
    category: row.category,
    sortOrder: Number(row.data?.sortOrder ?? row.id),
    itemId: row.item_id,
    skill: row.skill,
    materials: normalizeCraftingRecipeData(row.data).materials,
    version: Number(row.version),
    updatedAt: row.updated_at.toISOString(),
  };
}

function isDeletedRecipe(row: GameCraftingRecipeRow): boolean {
  return Boolean(row.data?.deleted);
}

export async function listGameCraftingRecipes(filters: unknown) {
  await ensureSeeded();
  const parsed = listFiltersSchema.parse(filters ?? {});
  const values: Array<string | number> = [];
  const conditions: string[] = [
    `COALESCE((data->>'deleted')::boolean, false) = false`,
  ];
  const pageSize = parsed.limit ?? 200;
  const page = parsed.page ?? 1;
  const offset = (page - 1) * pageSize;

  if (parsed.profession) {
    values.push(parsed.profession);
    conditions.push(`profession = $${values.length}`);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;
  const countResult = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM game_crafting_recipes ${whereClause}`, values);
  values.push(pageSize, offset);
  const result = await pool.query<GameCraftingRecipeRow>(
    `
      SELECT id, profession, category, item_id, skill, data, checksum, version::text AS version, updated_at
      FROM game_crafting_recipes
      ${whereClause}
      ORDER BY COALESCE(NULLIF((data->>'sortOrder'), '')::int, id) ASC, id ASC
      LIMIT $${values.length - 1}
      OFFSET $${values.length}
    `,
    values,
  );

  const total = Number(countResult.rows[0]?.count ?? 0);
  return {
    recipes: result.rows.map(toSummary),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function getGameCraftingRecipeById(id: number) {
  await ensureSeeded();
  const result = await pool.query<GameCraftingRecipeRow>(
    `SELECT id, profession, category, item_id, skill, data, checksum, version::text AS version, updated_at FROM game_crafting_recipes WHERE id = $1 LIMIT 1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Game crafting recipe not found");
  if (isDeletedRecipe(row)) throw new Error("Game crafting recipe not found");
  return { ...toSummary(row), checksum: row.checksum, data: normalizeCraftingRecipeData(row.data) };
}

export async function upsertGameCraftingRecipe(id: number, input: unknown, updatedByAccountId?: string | null) {
  await ensureSeeded();
  const parsed = gameCraftingRecipeSchema.parse({ ...((input as Record<string, unknown>) ?? {}), id });
  const data = normalizeCraftingRecipeData(parsed as GameCraftingRecipeRecordData);
  const checksum = computeChecksum(data);
  const current = await pool.query<{ checksum: string }>("SELECT checksum FROM game_crafting_recipes WHERE id = $1 LIMIT 1", [id]);
  const currentChecksum = current.rows[0]?.checksum ?? null;
  if (currentChecksum === checksum) {
    return { unchanged: true, recipe: await getGameCraftingRecipeById(id) };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO game_crafting_recipes (id, profession, category, item_id, skill, data, checksum, version, updated_by_account_id, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 0, $8, NOW())
        ON CONFLICT (id)
        DO UPDATE SET profession = EXCLUDED.profession,
                      category = EXCLUDED.category,
                      item_id = EXCLUDED.item_id,
                      skill = EXCLUDED.skill,
                      data = EXCLUDED.data,
                      checksum = EXCLUDED.checksum,
                      updated_by_account_id = EXCLUDED.updated_by_account_id,
                      updated_at = NOW()
      `,
      [id, data.profession, data.category, data.itemId, data.skill, JSON.stringify(data), checksum, updatedByAccountId ?? null],
    );
    const version = await insertRevision(client, id, checksum);
    await client.query("UPDATE game_crafting_recipes SET version = $2 WHERE id = $1", [id, version]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return { unchanged: false, recipe: await getGameCraftingRecipeById(id) };
}

export async function deleteGameCraftingRecipe(id: number, updatedByAccountId?: string | null) {
  await ensureSeeded();
  const current = await pool.query<GameCraftingRecipeRow>(
    `SELECT id, profession, category, item_id, skill, data, checksum, version::text AS version, updated_at FROM game_crafting_recipes WHERE id = $1 LIMIT 1`,
    [id],
  );
  const row = current.rows[0];
  if (!row || isDeletedRecipe(row)) {
    throw new Error("Game crafting recipe not found");
  }

  const data = normalizeCraftingRecipeData({
    ...row.data,
    id,
    deleted: true,
  });
  const checksum = computeChecksum(data);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        UPDATE game_crafting_recipes
        SET profession = $2,
            category = $3,
            item_id = $4,
            skill = $5,
            data = $6::jsonb,
            checksum = $7,
            updated_by_account_id = $8,
            updated_at = NOW()
        WHERE id = $1
      `,
      [id, data.profession, data.category, data.itemId, data.skill, JSON.stringify(data), checksum, updatedByAccountId ?? null],
    );
    const version = await insertRevision(client, id, checksum);
    await client.query("UPDATE game_crafting_recipes SET version = $2 WHERE id = $1", [id, version]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return { deleted: true, id };
}

export async function listGameCraftingRecipeChangesSince(sinceVersion: number) {
  await ensureSeeded();
  const result = await pool.query<GameCraftingRecipeRow>(
    `SELECT id, profession, category, item_id, skill, data, checksum, version::text AS version, updated_at FROM game_crafting_recipes WHERE version > $1 ORDER BY version ASC`,
    [sinceVersion],
  );
  const currentVersion = result.rows.reduce((max, row) => Math.max(max, Number(row.version)), sinceVersion);
  return {
    currentVersion,
    changes: result.rows.map((row) => ({ id: row.id, version: Number(row.version), data: normalizeCraftingRecipeData(row.data) })),
  };
}
