import { z } from "zod";
import pool from "../db";
import { hashPassword } from "../lib/passwords";
import {
    DISPLAY_NAME_MAX_LENGTH,
    isValidDisplayName,
    sanitizeName,
} from "../lib/text";

export type AdminAccountSummary = {
    id: string;
    name: string;
    email: string | null;
    is_admin: boolean;
    disabled_at: Date | null;
    created_at: Date;
};

export const ADMIN_ACCOUNTS_LIMIT = 50;

export async function listAdminAccounts(query?: string): Promise<AdminAccountSummary[]> {
    const trimmed = query?.trim() ?? "";

    if (trimmed) {
        const like = `%${trimmed.toLowerCase()}%`;
        const result = await pool.query<AdminAccountSummary>(
            `
          SELECT id, name, email, is_admin, disabled_at, created_at
          FROM accounts
          WHERE LOWER(name) LIKE $1
             OR LOWER(COALESCE(email, '')) LIKE $1
          ORDER BY created_at DESC
          LIMIT $2
        `,
            [like, ADMIN_ACCOUNTS_LIMIT],
        );

        return result.rows;
    }

    const result = await pool.query<AdminAccountSummary>(
        `
      SELECT id, name, email, is_admin, disabled_at, created_at
      FROM accounts
      ORDER BY created_at DESC
      LIMIT $1
    `,
        [ADMIN_ACCOUNTS_LIMIT],
    );

    return result.rows;
}

const updateAccountAdminSchema = z
    .object({
        disabled: z.boolean().optional(),
        is_admin: z.boolean().optional(),
    })
    .strict();

export async function updateAccountAdmin(
    accountId: string,
    payload: unknown,
): Promise<AdminAccountSummary> {
    const parsed = updateAccountAdminSchema.parse(payload);

    if (parsed.disabled === undefined && parsed.is_admin === undefined) {
        throw new Error("Nada para actualizar");
    }

    const updates: string[] = [];
    const params: Array<string | boolean | null> = [accountId];

    if (parsed.disabled !== undefined) {
        params.push(parsed.disabled ? "now" : null);
        updates.push(
            `disabled_at = CASE WHEN $${params.length} IS NULL THEN NULL ELSE NOW() END`,
        );
    }

    if (parsed.is_admin !== undefined) {
        params.push(parsed.is_admin);
        updates.push(`is_admin = $${params.length}`);
    }

    updates.push("updated_at = NOW()");

    const result = await pool.query<AdminAccountSummary>(
        `
      UPDATE accounts
      SET ${updates.join(", ")}
      WHERE id = $1
      RETURNING id, name, email, is_admin, disabled_at, created_at
    `,
        params,
    );

    const account = result.rows[0];

    if (!account) {
        throw new Error("Cuenta no encontrada");
    }

    return account;
}

const resetPasswordAdminSchema = z
    .object({
        newPassword: z.string().min(8).max(100),
    })
    .strict();

export async function resetAccountPasswordAdmin(
    accountId: string,
    payload: unknown,
): Promise<AdminAccountSummary> {
    const parsed = resetPasswordAdminSchema.parse(payload);
    const hashedPassword = await hashPassword(parsed.newPassword);

    const result = await pool.query<AdminAccountSummary>(
        `
      UPDATE accounts
      SET password = $2,
          must_change_password = TRUE,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, name, email, is_admin, disabled_at, created_at
    `,
        [accountId, hashedPassword],
    );

    const account = result.rows[0];

    if (!account) {
        throw new Error("Cuenta no encontrada");
    }

    return account;
}

const createAccountAdminSchema = z
    .object({
        name: z
            .string()
            .trim()
            .min(3)
            .max(DISPLAY_NAME_MAX_LENGTH)
            .refine(isValidDisplayName, {
                message:
                    "El nombre solo puede contener letras de la A a la Z y espacios",
            }),
        email: z.string().trim().email(),
        password: z.string().min(8).max(100),
        is_admin: z.boolean().optional(),
    })
    .strict();

export async function createAccountAdmin(
    payload: unknown,
): Promise<AdminAccountSummary> {
    const parsed = createAccountAdminSchema.parse(payload);
    const nameSanitized = sanitizeName(parsed.name);
    const normalizedEmail = parsed.email.trim().toLowerCase();

    const existingAccount = await pool.query<{ id: string }>(
        `
          SELECT id
          FROM accounts
          WHERE LOWER(email) = $1
             OR name_sanitized = $2
          LIMIT 1
        `,
        [normalizedEmail, nameSanitized],
    );

    if (existingAccount.rowCount) {
        throw new Error("Ya existe una cuenta con ese email o nombre");
    }

    const hashedPassword = await hashPassword(parsed.password);

    const result = await pool.query<AdminAccountSummary>(
        `
      INSERT INTO accounts (name, name_sanitized, email, password, is_admin, must_change_password)
      VALUES ($1, $2, $3, $4, $5, TRUE)
      RETURNING id, name, email, is_admin, disabled_at, created_at
    `,
        [
            parsed.name.trim(),
            nameSanitized,
            normalizedEmail,
            hashedPassword,
            parsed.is_admin === true,
        ],
    );

    return result.rows[0];
}

export async function deleteAccountAdmin(accountId: string): Promise<void> {
    const target = await pool.query<{ is_admin: boolean }>(
        `SELECT is_admin FROM accounts WHERE id = $1`,
        [accountId],
    );

    if (!target.rows[0]) {
        throw new Error("Cuenta no encontrada");
    }

    if (target.rows[0].is_admin) {
        const otherAdmins = await pool.query<{ count: number | string }>(
            `SELECT COUNT(*) AS count FROM accounts WHERE is_admin AND id <> $1`,
            [accountId],
        );
        if (Number(otherAdmins.rows[0]?.count ?? 0) === 0) {
            throw new Error("No podes eliminar la ultima cuenta admin.");
        }
    }

    await pool.query(`DELETE FROM accounts WHERE id = $1`, [accountId]);
}
