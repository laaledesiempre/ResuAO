import crypto from "crypto";
import pool from "./db";
import { hashPassword } from "./lib/passwords";
import { sanitizeName } from "./lib/text";

/**
 * Seeds an initial admin account when the instance has none, so a fresh
 * self-hosted deployment (e.g. the all-in-one Docker image) is usable out of
 * the box. Idempotent: does nothing if any admin account already exists.
 *
 * The seeded account is created with must_change_password = TRUE; the client
 * forces a password change on first login before allowing navigation.
 */
export async function seedAdminAccount(): Promise<void> {
    const existingAdmin = await pool.query<{ id: string }>(
        `
      SELECT id
      FROM accounts
      WHERE is_admin = TRUE
      LIMIT 1
    `,
    );

    if (existingAdmin.rowCount) {
        return;
    }

    const name = process.env.SEED_ADMIN_NAME?.trim() || "admin";
    const password = process.env.SEED_ADMIN_PASSWORD || "admin";
    // Deterministic placeholder email (accounts.email is UNIQUE). The
    // @placeholder.local suffix keeps it hidden from API responses.
    const email = `noemail-${crypto
        .createHash("sha256")
        .update(`seed-admin:${name}`)
        .digest("hex")}@placeholder.local`;
    const hashedPassword = await hashPassword(password);

    await pool.query(
        `
      INSERT INTO accounts (name, name_sanitized, email, password, is_admin, must_change_password)
      VALUES ($1, $2, $3, $4, TRUE, TRUE)
    `,
        [name, sanitizeName(name), email, hashedPassword],
    );

    console.log(
        `seeded admin account '${name}' (password change required on first login)`,
    );
}
