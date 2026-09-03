import { z } from "zod";
import pool from "../db";

// VB6 ModCorreo.bas (Declares.bas): tope de mensajes por personaje.
export const MAX_CORREOS_SLOTS = 60;

export type CorreoMessageRecord = {
    id: string;
    character_id: string;
    remitente: string;
    mensaje: string;
    item: string;
    item_count: number;
    leido: boolean | number;
    fecha: string;
    created_at: string;
};

const sendCorreoSchema = z.object({
    recipientName: z.string().trim().min(1).max(50),
    remitente: z.string().trim().min(1).max(50),
    mensaje: z.string().trim().min(1).max(600),
    item: z.string().trim().max(600).optional().default(""),
    itemCount: z.coerce.number().int().min(0).max(255).optional().default(0),
    fecha: z.string().trim().max(60).optional().default(""),
});

export type SendCorreoPayload = z.infer<typeof sendCorreoSchema>;

export type SendCorreoResult =
    | { status: "sent"; characterId: string }
    | { status: "full" }
    | { status: "not_found" };

async function findCharacterIdByName(name: string): Promise<string | null> {
    const result = await pool.query<{ id: string }>(
        `
      SELECT c.id
      FROM characters c
      WHERE LOWER(TRIM(c.name)) = LOWER(TRIM($1))
        AND c.deleted_at IS NULL
      ORDER BY c.updated_at DESC, c.created_at DESC
      LIMIT 1
    `,
        [name],
    );

    return result.rows[0]?.id ?? null;
}

export async function listCorreo(characterId: string) {
    const result = await pool.query<CorreoMessageRecord>(
        `
      SELECT id, character_id, remitente, mensaje, item, item_count, leido, fecha, created_at
      FROM character_correo
      WHERE character_id = $1
      ORDER BY created_at ASC, id ASC
      LIMIT $2
    `,
        [characterId, MAX_CORREOS_SLOTS],
    );

    return {
        mensajes: result.rows.map((row) => ({
            id: row.id,
            remitente: row.remitente,
            mensaje: row.mensaje,
            item: row.item,
            itemCount: Number(row.item_count ?? 0),
            leido: Boolean(row.leido),
            fecha: row.fecha,
        })),
    };
}

export async function countUnreadCorreo(characterId: string): Promise<number> {
    const result = await pool.query<{ count: string | number }>(
        `
      SELECT COUNT(*) AS count
      FROM character_correo
      WHERE character_id = $1
        AND leido = FALSE
    `,
        [characterId],
    );

    return Number(result.rows[0]?.count ?? 0);
}

// VB6 PrepareMessageListaCorreo: al listar se apaga el aviso de mensajes
// nuevos (Correo.NoLeidos = 0).
export async function markCorreoRead(characterId: string): Promise<void> {
    await pool.query(
        `
      UPDATE character_correo
      SET leido = TRUE
      WHERE character_id = $1
        AND leido = FALSE
    `,
        [characterId],
    );
}

export async function sendCorreo(payload: SendCorreoPayload): Promise<SendCorreoResult> {
    const parsed = sendCorreoSchema.parse(payload);
    const characterId = await findCharacterIdByName(parsed.recipientName);

    if (!characterId) {
        return { status: "not_found" };
    }

    const countResult = await pool.query<{ count: string | number }>(
        `
      SELECT COUNT(*) AS count
      FROM character_correo
      WHERE character_id = $1
    `,
        [characterId],
    );

    // VB6 AddCorreo: con el charfile offline, CantCorreo = 60 -> correo lleno.
    if (Number(countResult.rows[0]?.count ?? 0) >= MAX_CORREOS_SLOTS) {
        return { status: "full" };
    }

    await pool.query(
        `
      INSERT INTO character_correo (character_id, remitente, mensaje, item, item_count, leido, fecha)
      VALUES ($1, $2, $3, $4, $5, FALSE, $6)
    `,
        [
            characterId,
            parsed.remitente,
            parsed.mensaje,
            parsed.item,
            parsed.itemCount,
            parsed.fecha,
        ],
    );

    return { status: "sent", characterId };
}

export async function deleteCorreo(characterId: string, messageId: string): Promise<boolean> {
    const result = await pool.query(
        `
      DELETE FROM character_correo
      WHERE id = $1
        AND character_id = $2
    `,
        [messageId, characterId],
    );

    return Number(result.rowCount ?? 0) > 0;
}
