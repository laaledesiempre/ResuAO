import fs from "fs";
import path from "path";
import pool, { dbDialect } from "./db";

async function migrate(): Promise<void> {
    if (dbDialect === "sqlite") {
        // Importing ./db already applied schema.sqlite.sql idempotently when
        // the SQLite adapter was created.
        console.log("SQLite schema applied successfully");
        return;
    }

    const schemaPath = path.resolve(__dirname, "..", "schema.sql");
    const schemaSql = fs.readFileSync(schemaPath, "utf8");

    await pool.query(schemaSql);
    await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_market_listings_active_price_created
      ON market_listings(price ASC, created_at ASC)
      WHERE status = 'active'
  `);
    await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_market_listings_seller_active_created
      ON market_listings(seller_character_id, created_at DESC)
      WHERE status = 'active'
  `);
    console.log("Database schema applied successfully");
}

void migrate()
    .catch((error) => {
        console.error("Failed to apply database schema", error);
        process.exit(1);
    })
    .finally(async () => {
        await pool.end();
    });
