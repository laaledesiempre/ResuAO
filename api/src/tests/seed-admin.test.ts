import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, test } from "vitest";

// Self-contained seed test: spins up its own SQLite database in a temp dir.
// Env must be set before importing config-dependent modules, so db/seedAdmin
// are imported dynamically inside beforeAll (vitest isolates module graphs
// per test file, so this does not affect other tests).
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "resu-seed-test-"));

process.env.DB_BACKEND = "sqlite";
process.env.DATA_DIR = dataDir;
process.env.TOKEN_AUTH = "seed-test-token";
process.env.SEED_ADMIN_NAME = "admin";
process.env.SEED_ADMIN_PASSWORD = "admin";

type Pool = {
    query: <T>(text: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }>;
    end: () => Promise<void>;
};

let pool: Pool;
let seedAdminAccount: () => Promise<void>;
let loginAccount: (payload: unknown) => Promise<{
    account: { name: string; must_change_password: boolean };
}>;
let changePasswordForSession: (
    token: string,
    payload: unknown,
) => Promise<{ account: { must_change_password: boolean } } | null>;

beforeAll(async () => {
    pool = (await import("../db.js")).default as unknown as Pool;
    ({ seedAdminAccount } = await import("../seedAdmin.js"));
    ({ loginAccount, changePasswordForSession } = await import(
        "../repositories/auth.js"
    ));
});

afterAll(async () => {
    await pool.end();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test("seed creates a single admin requiring a password change, idempotently", async () => {
    await seedAdminAccount();
    await seedAdminAccount();

    const admins = (
        await pool.query<{
            name: string;
            is_admin: boolean;
            must_change_password: boolean;
            email: string;
        }>("SELECT name, is_admin, must_change_password, email FROM accounts")
    ).rows;

    assert.equal(admins.length, 1);
    assert.equal(admins[0].name, "admin");
    assert.equal(admins[0].is_admin, true);
    assert.equal(admins[0].must_change_password, true);
    assert.ok(admins[0].email.endsWith("@placeholder.local"));

    // Deterministic email: a different name seeds a different address.
    const expectedEmail = `noemail-${crypto
        .createHash("sha256")
        .update("seed-admin:admin")
        .digest("hex")}@placeholder.local`;
    assert.equal(admins[0].email, expectedEmail);

    // Login exposes the flag; changing the password clears it.
    const login = await loginAccount({ identifier: "admin", password: "admin" });
    assert.equal(login.account.must_change_password, true);

    const sessionToken = (
        await pool.query<{ token: string }>(
            "SELECT token FROM auth_sessions LIMIT 1",
        )
    ).rows[0].token;

    const updated = await changePasswordForSession(sessionToken, {
        currentPassword: "admin",
        newPassword: "nueva-password-123",
    });
    assert.equal(updated?.account.must_change_password, false);

    const relogin = await loginAccount({
        identifier: "admin",
        password: "nueva-password-123",
    });
    assert.equal(relogin.account.must_change_password, false);

    // Seed still no-ops once an admin exists.
    await seedAdminAccount();
    const count = (
        await pool.query<{ n: number }>(
            "SELECT COUNT(*) AS n FROM accounts",
        )
    ).rows[0].n;
    assert.equal(Number(count), 1);
});
