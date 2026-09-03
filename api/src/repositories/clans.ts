import { z } from "zod";
import type { PoolClient } from "pg";
import pool from "../db";
import type {
    ClanAlignment,
    ClanDetailsResponse,
    ClanRole,
    CharacterFaction,
    ClanMemberRecord,
    ClanMemberResponse,
    ClanOverviewResponse,
    ClanRequestRecord,
    ClanRequestResponse,
    ClanSummaryResponse,
} from "../types";
import {
    DISPLAY_NAME_MAX_LENGTH,
    isValidDisplayName,
    sanitizeName,
} from "../lib/text";

const CLAN_CREATION_COST = 1_500_000;
const CLAN_CREATION_LEVEL_REQUIRED = 30;
const CLAN_NAME_MAX_LENGTH = 18;
const CLAN_MAX_MEMBERS = 50;

const createClanSchema = z.object({
    characterId: z.string().uuid(),
    name: z.string().trim().min(3).max(CLAN_NAME_MAX_LENGTH),
    minJoinLevel: z.coerce.number().int().min(1).max(45),
});

const createClanRequestSchema = z.object({
    characterId: z.string().uuid(),
    clanId: z.string().uuid(),
    message: z.string().max(240).optional(),
});

const reviewClanRequestSchema = z.object({
    reviewerCharacterId: z.string().uuid(),
    requestId: z.string().uuid(),
});

const leaveClanSchema = z.object({
    characterId: z.string().uuid(),
});

const kickClanMemberSchema = z
    .object({
        leaderCharacterId: z.string().uuid(),
        targetCharacterId: z.string().uuid().optional(),
        targetName: z
            .string()
            .trim()
            .min(1)
            .max(DISPLAY_NAME_MAX_LENGTH)
            .optional(),
    })
    .refine(
        (payload) => Boolean(payload.targetCharacterId || payload.targetName),
        {
            message: "Debes indicar un miembro a expulsar",
        },
    );

const deleteClanSchema = z.object({
    leaderCharacterId: z.string().uuid(),
});

const setClanMemberRoleSchema = z.object({
    leaderCharacterId: z.string().uuid(),
    targetCharacterId: z.string().uuid(),
    role: z.enum(["co_leader", "member"]),
});

const transferClanLeadershipSchema = z.object({
    leaderCharacterId: z.string().uuid(),
    targetCharacterId: z.string().uuid(),
});

type CharacterState = {
    id: string;
    account_id: string;
    name: string;
    level: number;
    gold: number;
    criminal: boolean;
    faction: CharacterFaction;
    clan_id: string | null;
    connected: boolean;
};

type ClanRow = {
    id: string;
    name: string;
    alignment: ClanAlignment;
    min_join_level: number;
    leader_character_id: string;
    leader_name: string;
    member_count: string;
};

export type CharacterClanSummary = {
    clanId: string | null;
    clanName: string | null;
    clanTag: string | null;
    clanAlignment: ClanAlignment | null;
    clanMinJoinLevel: number | null;
    clanRole: ClanRole | null;
};

function normalizeClanName(name: string): string {
    return sanitizeName(name.replace(/\s+/g, " ").trim());
}

function validateClanName(name: string): string {
    const normalizedSpacing = name.replace(/\s+/g, " ").trim();

    if (normalizedSpacing.length > CLAN_NAME_MAX_LENGTH) {
        throw new Error(
            `El nombre del clan no puede superar ${CLAN_NAME_MAX_LENGTH} caracteres`,
        );
    }

    const spaceCount = (normalizedSpacing.match(/ /g) ?? []).length;

    if (spaceCount > 1) {
        throw new Error("El nombre del clan solo puede contener un espacio");
    }

    if (!isValidDisplayName(normalizedSpacing)) {
        throw new Error(
            "El nombre del clan solo puede contener letras y espacios",
        );
    }

    return normalizedSpacing;
}

function isAlignmentCompatible(
    alignment: ClanAlignment,
    criminal: boolean,
    faction: CharacterFaction,
): boolean {
    if (alignment === "citizen") {
        return faction === "armada" || (!criminal && faction === "none");
    }

    return faction === "caos" || (criminal && faction === "none");
}

function getClanAlignmentFromCharacter(character: {
    criminal: boolean;
    faction: CharacterFaction;
}): ClanAlignment {
    if (
        character.faction === "caos" ||
        (character.criminal && character.faction === "none")
    ) {
        return "criminal";
    }

    return "citizen";
}

function mapClanMember(
    row: ClanMemberRecord,
    includeOnlineStatus: boolean,
): ClanMemberResponse {
    return {
        characterId: row.character_id,
        name: row.name,
        classId: row.id_clase,
        level: row.level,
        criminal: Boolean(row.criminal),
        online: includeOnlineStatus ? Boolean(row.connected) : null,
        role: row.role,
    };
}

function mapClanRequest(row: ClanRequestRecord): ClanRequestResponse {
    return {
        id: row.id,
        characterId: row.character_id,
        name: row.name,
        classId: row.id_clase,
        level: row.level,
        criminal: Boolean(row.criminal),
        online: Boolean(row.connected),
        message: row.message,
        createdAt: row.created_at,
    };
}

async function getCharacterState(
    client: PoolClient,
    characterId: string,
): Promise<CharacterState | null> {
    const result = await client.query<CharacterState>(
        `
      SELECT id, account_id, name, level, gold, COALESCE(criminal, FALSE) AS criminal, COALESCE(faction, 'none') AS faction, clan_id, connected
      FROM characters
      WHERE id = $1
        AND deleted_at IS NULL
      LIMIT 1
    `,
        [characterId],
    );

    return result.rows[0] ?? null;
}

async function getOwnedCharacterState(
    client: PoolClient,
    accountId: string,
    characterId: string,
): Promise<CharacterState | null> {
    const result = await client.query<CharacterState>(
        `
      SELECT id, account_id, name, level, gold, COALESCE(criminal, FALSE) AS criminal, COALESCE(faction, 'none') AS faction, clan_id, connected
      FROM characters
      WHERE id = $1
        AND account_id = $2
        AND deleted_at IS NULL
      LIMIT 1
    `,
        [characterId, accountId],
    );

    return result.rows[0] ?? null;
}

async function getCharacterClanSummaryWithClient(
    client: PoolClient,
    characterId: string,
): Promise<CharacterClanSummary> {
    const result = await client.query<{
        clan_id: string | null;
        clan_name: string | null;
        clan_alignment: ClanAlignment | null;
        clan_min_join_level: number | null;
        clan_role: ClanRole | null;
    }>(
        `
      SELECT
        c.clan_id,
        cl.name AS clan_name,
        cl.alignment AS clan_alignment,
        cl.min_join_level AS clan_min_join_level,
        cm.role AS clan_role
      FROM characters c
      LEFT JOIN clans cl ON cl.id = c.clan_id
      LEFT JOIN clan_members cm ON cm.character_id = c.id AND cm.clan_id = c.clan_id
      WHERE c.id = $1
        AND c.deleted_at IS NULL
      LIMIT 1
    `,
        [characterId],
    );

    const row = result.rows[0];

    return {
        clanId: row?.clan_id ?? null,
        clanName: row?.clan_name ?? null,
        clanTag: row?.clan_name ? `<${row.clan_name}>` : null,
        clanAlignment: row?.clan_alignment ?? null,
        clanMinJoinLevel: row?.clan_min_join_level ?? null,
        clanRole: row?.clan_role ?? null,
    };
}

async function getClanMembers(
    client: PoolClient,
    clanId: string,
    options?: { prioritizeOnline?: boolean; includeOnlineStatus?: boolean },
): Promise<ClanMemberResponse[]> {
    const orderBy = options?.prioritizeOnline
        ? "ORDER BY CASE WHEN cm.role = 'leader' THEN 0 WHEN cm.role = 'co_leader' THEN 1 ELSE 2 END, COALESCE(c.connected, FALSE) DESC, c.level DESC, c.name ASC"
        : "ORDER BY CASE WHEN cm.role = 'leader' THEN 0 WHEN cm.role = 'co_leader' THEN 1 ELSE 2 END, c.level DESC, c.name ASC";
    const result = await client.query<ClanMemberRecord>(
        `
      SELECT
        cm.clan_id,
        cm.character_id,
        cm.role,
        cm.joined_at,
        c.name,
        c.id_clase,
        c.level,
        COALESCE(c.criminal, FALSE) AS criminal,
        COALESCE(c.connected, FALSE) AS connected
      FROM clan_members cm
      JOIN characters c ON c.id = cm.character_id
      WHERE cm.clan_id = $1
        AND c.deleted_at IS NULL
      ${orderBy}
    `,
        [clanId],
    );

    return result.rows.map((row) =>
        mapClanMember(row, options?.includeOnlineStatus ?? false),
    );
}

async function getClanMemberCount(
    client: PoolClient,
    clanId: string,
): Promise<number> {
    const result = await client.query<{ member_count: string }>(
        `
      SELECT COUNT(*)::text AS member_count
      FROM clan_members
      WHERE clan_id = $1
    `,
        [clanId],
    );

    return Number(result.rows[0]?.member_count ?? 0);
}

async function getClanRequests(
    client: PoolClient,
    clanId: string,
): Promise<ClanRequestResponse[]> {
    const result = await client.query<ClanRequestRecord>(
        `
      SELECT
        cr.id,
        cr.clan_id,
        cr.character_id,
        cr.message,
        cr.created_at,
        c.name,
        c.id_clase,
        c.level,
        COALESCE(c.criminal, FALSE) AS criminal,
        COALESCE(c.connected, FALSE) AS connected
      FROM clan_requests cr
      JOIN characters c ON c.id = cr.character_id
      WHERE cr.clan_id = $1
        AND c.deleted_at IS NULL
      ORDER BY cr.created_at ASC, c.name ASC
    `,
        [clanId],
    );

    return result.rows.map(mapClanRequest);
}

async function getClanDetails(
    client: PoolClient,
    clanId: string,
    includeRequests: boolean,
    includeOnlineStatus: boolean,
): Promise<ClanDetailsResponse | null> {
    const result = await client.query<ClanRow>(
        `
      SELECT
        cl.id,
        cl.name,
        cl.alignment,
        cl.min_join_level,
        cl.leader_character_id,
        leader.name AS leader_name,
        COUNT(cm.character_id)::text AS member_count
      FROM clans cl
      JOIN characters leader ON leader.id = cl.leader_character_id
      LEFT JOIN clan_members cm ON cm.clan_id = cl.id
      WHERE cl.id = $1
      GROUP BY cl.id, cl.name, cl.alignment, cl.min_join_level, cl.leader_character_id, leader.name
      LIMIT 1
    `,
        [clanId],
    );

    const row = result.rows[0];

    if (!row) {
        return null;
    }

    const [members, requests] = await Promise.all([
        getClanMembers(client, clanId, {
            prioritizeOnline: includeOnlineStatus,
            includeOnlineStatus,
        }),
        includeRequests ? getClanRequests(client, clanId) : Promise.resolve([]),
    ]);

    return {
        id: row.id,
        name: row.name,
        alignment: row.alignment,
        minJoinLevel: row.min_join_level,
        leaderCharacterId: row.leader_character_id,
        leaderName: row.leader_name,
        memberCount: Number(row.member_count),
        members,
        requests,
    };
}

async function resolveTargetCharacter(
    client: PoolClient,
    payload: z.infer<typeof kickClanMemberSchema>,
): Promise<CharacterState | null> {
    if (payload.targetCharacterId) {
        return getCharacterState(client, payload.targetCharacterId);
    }

    const result = await client.query<CharacterState>(
        `
      SELECT id, account_id, name, level, gold, COALESCE(criminal, FALSE) AS criminal, COALESCE(faction, 'none') AS faction, clan_id, connected
      FROM characters
      WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
        AND deleted_at IS NULL
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    `,
        [payload.targetName ?? ""],
    );

    return result.rows[0] ?? null;
}

async function getClanRole(
    client: PoolClient,
    characterId: string,
    clanId: string,
): Promise<ClanRole | null> {
    const result = await client.query<{ role: ClanRole }>(
        `
      SELECT role
      FROM clan_members
      WHERE character_id = $1
        AND clan_id = $2
      LIMIT 1
    `,
        [characterId, clanId],
    );

    return result.rows[0]?.role ?? null;
}

export async function listClansForCharacter(
    accountId: string,
    characterId: string,
): Promise<ClanOverviewResponse> {
    const client = await pool.connect();

    try {
        const character = await getOwnedCharacterState(
            client,
            accountId,
            characterId,
        );

        if (!character) {
            throw new Error("Personaje invalido");
        }

        const [clansResult, pendingRequestResult] = await Promise.all([
            client.query<ClanRow>(
                `
          SELECT
            cl.id,
            cl.name,
            cl.alignment,
            cl.min_join_level,
            cl.leader_character_id,
            leader.name AS leader_name,
            COUNT(cm.character_id)::text AS member_count
          FROM clans cl
          JOIN characters leader ON leader.id = cl.leader_character_id
          LEFT JOIN clan_members cm ON cm.clan_id = cl.id
          GROUP BY cl.id, cl.name, cl.alignment, cl.min_join_level, cl.leader_character_id, leader.name
          ORDER BY cl.created_at ASC, cl.name ASC
        `,
            ),
            client.query<{ clan_id: string }>(
                `
          SELECT clan_id
          FROM clan_requests
          WHERE character_id = $1
          LIMIT 1
        `,
                [characterId],
            ),
        ]);

        const currentSummary = await getCharacterClanSummaryWithClient(
            client,
            characterId,
        );
        const currentClan = currentSummary.clanId
            ? await getClanDetails(
                  client,
                  currentSummary.clanId,
                  currentSummary.clanRole === "leader" ||
                      currentSummary.clanRole === "co_leader",
                  true,
              )
            : null;

        return {
            currentClan,
            pendingRequestClanId: pendingRequestResult.rows[0]?.clan_id ?? null,
            clans: clansResult.rows.map<ClanSummaryResponse>((row) => ({
                id: row.id,
                name: row.name,
                alignment: row.alignment,
                minJoinLevel: row.min_join_level,
                memberCount: Number(row.member_count),
                leaderName: row.leader_name,
            })),
        };
    } finally {
        client.release();
    }
}

export async function getClanDetailsForCharacter(
    accountId: string,
    characterId: string,
    clanId: string,
): Promise<ClanDetailsResponse> {
    const client = await pool.connect();

    try {
        const character = await getOwnedCharacterState(
            client,
            accountId,
            characterId,
        );

        if (!character) {
            throw new Error("Personaje invalido");
        }

        const belongsToClan = character.clan_id === clanId;
        const characterRole = belongsToClan
            ? await getClanRole(client, characterId, clanId)
            : null;
        const details = await getClanDetails(
            client,
            clanId,
            characterRole === "leader" || characterRole === "co_leader",
            belongsToClan,
        );

        if (belongsToClan && details) {
            details.requests =
                characterRole === "leader" || characterRole === "co_leader"
                    ? details.requests
                    : [];
        }

        if (!details) {
            throw new Error("Clan invalido");
        }

        return details;
    } finally {
        client.release();
    }
}

export async function getCharacterClanSummary(
    characterId: string,
): Promise<CharacterClanSummary> {
    const client = await pool.connect();

    try {
        return getCharacterClanSummaryWithClient(client, characterId);
    } finally {
        client.release();
    }
}

export async function createClan(
    payload: unknown,
): Promise<{ ok: true; clanId: string; characterId: string; gold: number }> {
    const parsed = createClanSchema.parse(payload);
    const clanName = validateClanName(parsed.name);
    const nameNormalized = normalizeClanName(clanName);
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const character = await getCharacterState(client, parsed.characterId);

        if (!character) {
            throw new Error("Personaje invalido");
        }

        if (character.clan_id) {
            throw new Error("Ya perteneces a un clan");
        }

        if (character.level < CLAN_CREATION_LEVEL_REQUIRED) {
            throw new Error(
                `Necesitas nivel ${CLAN_CREATION_LEVEL_REQUIRED} para crear un clan`,
            );
        }

        if (character.gold < CLAN_CREATION_COST) {
            throw new Error("No tienes el oro suficiente para crear un clan");
        }

        const clanAlignment = getClanAlignmentFromCharacter({
            criminal: Boolean(character.criminal),
            faction: character.faction,
        });

        const existingClan = await client.query<{ id: string }>(
            `
        SELECT id
        FROM clans
        WHERE name_normalized = $1
        LIMIT 1
      `,
            [nameNormalized],
        );

        if (existingClan.rowCount) {
            throw new Error("Ya existe un clan con ese nombre");
        }

        const clanResult = await client.query<{ id: string }>(
            `
        INSERT INTO clans (name, name_normalized, leader_character_id, alignment, min_join_level)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
            [
                clanName,
                nameNormalized,
                parsed.characterId,
                clanAlignment,
                parsed.minJoinLevel,
            ],
        );

        const clanId = clanResult.rows[0]?.id;

        if (!clanId) {
            throw new Error("No se pudo crear el clan");
        }

        await client.query(
            `
        INSERT INTO clan_members (clan_id, character_id, role)
        VALUES ($1, $2, 'leader')
      `,
            [clanId, parsed.characterId],
        );

        await client.query(
            `
        UPDATE characters
        SET clan_id = $2,
            gold = gold - $3,
            updated_at = NOW()
        WHERE id = $1
      `,
            [parsed.characterId, clanId, CLAN_CREATION_COST],
        );

        await client.query(
            `
        DELETE FROM clan_requests
        WHERE character_id = $1
      `,
            [parsed.characterId],
        );

        await client.query("COMMIT");

        return {
            ok: true,
            clanId,
            characterId: parsed.characterId,
            gold: character.gold - CLAN_CREATION_COST,
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function createClanRequest(
    payload: unknown,
): Promise<{ ok: true; requestClanId: string; characterId: string }> {
    const parsed = createClanRequestSchema.parse(payload);
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const [character, clanResult] = await Promise.all([
            getCharacterState(client, parsed.characterId),
            client.query<{
                id: string;
                alignment: ClanAlignment;
                min_join_level: number;
            }>(
                `
          SELECT id, alignment, min_join_level
          FROM clans
          WHERE id = $1
          LIMIT 1
        `,
                [parsed.clanId],
            ),
        ]);

        if (!character) {
            throw new Error("Personaje invalido");
        }

        if (character.clan_id) {
            throw new Error("Ya perteneces a un clan");
        }

        const clan = clanResult.rows[0];

        if (!clan) {
            throw new Error("Clan invalido");
        }

        if (character.level < clan.min_join_level) {
            throw new Error(
                "No cumples el nivel minimo para postularte a este clan",
            );
        }

        if (
            !isAlignmentCompatible(
                clan.alignment,
                Boolean(character.criminal),
                character.faction,
            )
        ) {
            throw new Error("Tu alineacion no es compatible con este clan");
        }

        const memberCount = await getClanMemberCount(client, parsed.clanId);

        if (memberCount >= CLAN_MAX_MEMBERS) {
            throw new Error(
                `El clan ya alcanzo el maximo de ${CLAN_MAX_MEMBERS} miembros`,
            );
        }

        const existingRequest = await client.query<{ clan_id: string }>(
            `
        SELECT clan_id
        FROM clan_requests
        WHERE character_id = $1
        LIMIT 1
        FOR UPDATE
      `,
            [parsed.characterId],
        );

        if (existingRequest.rows[0]?.clan_id === parsed.clanId) {
            throw new Error("Ya enviaste una solicitud a este clan");
        }

        await client.query(
            `
        DELETE FROM clan_requests
        WHERE character_id = $1
      `,
            [parsed.characterId],
        );

        await client.query(
            `
        INSERT INTO clan_requests (clan_id, character_id, message)
        VALUES ($1, $2, $3)
      `,
            [parsed.clanId, parsed.characterId, parsed.message?.trim() ?? ""],
        );

        await client.query("COMMIT");

        return {
            ok: true,
            requestClanId: parsed.clanId,
            characterId: parsed.characterId,
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function acceptClanRequest(
    payload: unknown,
): Promise<{ ok: true; applicantCharacterId: string; clanId: string }> {
    const parsed = reviewClanRequestSchema.parse(payload);
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const reviewer = await getCharacterState(
            client,
            parsed.reviewerCharacterId,
        );

        if (!reviewer?.clan_id) {
            throw new Error("No perteneces a ningun clan");
        }

        const reviewerRole = await getClanRole(
            client,
            parsed.reviewerCharacterId,
            reviewer.clan_id,
        );

        if (reviewerRole !== "leader" && reviewerRole !== "co_leader") {
            throw new Error(
                "Solo el lider o un co-lider puede aceptar solicitudes",
            );
        }

        const requestResult = await client.query<{
            clan_id: string;
            character_id: string;
        }>(
            `
        SELECT clan_id, character_id
        FROM clan_requests
        WHERE id = $1
        LIMIT 1
        FOR UPDATE
      `,
            [parsed.requestId],
        );

        const request = requestResult.rows[0];

        if (!request || request.clan_id !== reviewer.clan_id) {
            throw new Error("La solicitud ya no existe para tu clan");
        }

        const [applicant, clanResult] = await Promise.all([
            getCharacterState(client, request.character_id),
            client.query<{ alignment: ClanAlignment }>(
                `
          SELECT alignment
          FROM clans
          WHERE id = $1
          LIMIT 1
          FOR UPDATE
        `,
                [reviewer.clan_id],
            ),
        ]);

        if (!applicant) {
            throw new Error("El postulante ya no existe");
        }

        if (applicant.clan_id) {
            throw new Error("El postulante ya pertenece a otro clan");
        }

        const clanAlignment = clanResult.rows[0]?.alignment;

        if (!clanAlignment) {
            throw new Error("Clan invalido");
        }

        if (
            !isAlignmentCompatible(
                clanAlignment,
                Boolean(applicant.criminal),
                applicant.faction,
            )
        ) {
            throw new Error(
                "El postulante ya no cumple la alineacion del clan",
            );
        }

        const insertMemberResult = await client.query<{ character_id: string }>(
            `
        INSERT INTO clan_members (clan_id, character_id, role)
        SELECT $1, $2, 'member'
        WHERE (
          SELECT COUNT(*)
          FROM clan_members
          WHERE clan_id = $1
        ) < $3
        RETURNING character_id
      `,
            [reviewer.clan_id, applicant.id, CLAN_MAX_MEMBERS],
        );

        if (!insertMemberResult.rowCount) {
            throw new Error(
                `El clan ya alcanzo el maximo de ${CLAN_MAX_MEMBERS} miembros`,
            );
        }

        await client.query(
            `
        UPDATE characters
        SET clan_id = $2,
            updated_at = NOW()
        WHERE id = $1
      `,
            [applicant.id, reviewer.clan_id],
        );

        await client.query(
            `
        DELETE FROM clan_requests
        WHERE character_id = $1
      `,
            [applicant.id],
        );

        await client.query("COMMIT");

        return {
            ok: true,
            applicantCharacterId: applicant.id,
            clanId: reviewer.clan_id,
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function rejectClanRequest(
    payload: unknown,
): Promise<{ ok: true; applicantCharacterId: string; clanId: string }> {
    const parsed = reviewClanRequestSchema.parse(payload);
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const reviewer = await getCharacterState(
            client,
            parsed.reviewerCharacterId,
        );

        if (!reviewer?.clan_id) {
            throw new Error("No perteneces a ningun clan");
        }

        const reviewerRole = await getClanRole(
            client,
            parsed.reviewerCharacterId,
            reviewer.clan_id,
        );

        if (reviewerRole !== "leader") {
            throw new Error("Solo el lider puede rechazar solicitudes");
        }

        const requestResult = await client.query<{
            clan_id: string;
            character_id: string;
        }>(
            `
        SELECT clan_id, character_id
        FROM clan_requests
        WHERE id = $1
        LIMIT 1
        FOR UPDATE
      `,
            [parsed.requestId],
        );

        const request = requestResult.rows[0];

        if (!request || request.clan_id !== reviewer.clan_id) {
            throw new Error("La solicitud ya no existe para tu clan");
        }

        await client.query(
            `
        DELETE FROM clan_requests
        WHERE id = $1
      `,
            [parsed.requestId],
        );

        await client.query("COMMIT");

        return {
            ok: true,
            applicantCharacterId: request.character_id,
            clanId: reviewer.clan_id,
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function leaveClan(
    payload: unknown,
): Promise<{ ok: true; characterId: string; clanId: string }> {
    const parsed = leaveClanSchema.parse(payload);
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const character = await getCharacterState(client, parsed.characterId);

        if (!character?.clan_id) {
            throw new Error("No perteneces a ningun clan");
        }

        const role = await getClanRole(
            client,
            parsed.characterId,
            character.clan_id,
        );

        if (!role) {
            throw new Error("No perteneces a ningun clan");
        }

        if (role === "leader") {
            throw new Error("El lider no puede abandonar el clan");
        }

        await client.query(
            `
        DELETE FROM clan_members
        WHERE clan_id = $1
          AND character_id = $2
      `,
            [character.clan_id, parsed.characterId],
        );

        await client.query(
            `
        UPDATE characters
        SET clan_id = NULL,
            updated_at = NOW()
        WHERE id = $1
      `,
            [parsed.characterId],
        );

        await client.query("COMMIT");

        return {
            ok: true,
            characterId: parsed.characterId,
            clanId: character.clan_id,
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function kickClanMember(
    payload: unknown,
): Promise<{ ok: true; targetCharacterId: string; clanId: string }> {
    const parsed = kickClanMemberSchema.parse(payload);
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const leader = await getCharacterState(
            client,
            parsed.leaderCharacterId,
        );

        if (!leader?.clan_id) {
            throw new Error("No perteneces a ningun clan");
        }

        const leaderRole = await getClanRole(
            client,
            parsed.leaderCharacterId,
            leader.clan_id,
        );

        if (leaderRole !== "leader") {
            throw new Error("Solo el lider puede expulsar miembros");
        }

        const target = await resolveTargetCharacter(client, parsed);

        if (!target) {
            throw new Error("No existe ese personaje");
        }

        if (target.id === parsed.leaderCharacterId) {
            throw new Error("No puedes expulsarte a ti mismo");
        }

        if (target.clan_id !== leader.clan_id) {
            throw new Error("Ese personaje no pertenece a tu clan");
        }

        const targetRole = await getClanRole(client, target.id, leader.clan_id);

        if (!targetRole) {
            throw new Error("Ese personaje no pertenece a tu clan");
        }

        if (targetRole === "leader") {
            throw new Error("No puedes expulsar al lider del clan");
        }

        await client.query(
            `
        DELETE FROM clan_members
        WHERE clan_id = $1
          AND character_id = $2
      `,
            [leader.clan_id, target.id],
        );

        await client.query(
            `
        UPDATE characters
        SET clan_id = NULL,
            updated_at = NOW()
        WHERE id = $1
      `,
            [target.id],
        );

        await client.query("COMMIT");

        return {
            ok: true,
            targetCharacterId: target.id,
            clanId: leader.clan_id,
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function deleteClan(
    payload: unknown,
): Promise<{ ok: true; clanId: string; memberCharacterIds: string[] }> {
    const parsed = deleteClanSchema.parse(payload);
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const leader = await getCharacterState(
            client,
            parsed.leaderCharacterId,
        );

        if (!leader?.clan_id) {
            throw new Error("No perteneces a ningun clan");
        }

        const leaderRole = await getClanRole(
            client,
            parsed.leaderCharacterId,
            leader.clan_id,
        );

        if (leaderRole !== "leader") {
            throw new Error("Solo el lider puede borrar el clan");
        }

        const membersResult = await client.query<{ character_id: string }>(
            `
        SELECT character_id
        FROM clan_members
        WHERE clan_id = $1
      `,
            [leader.clan_id],
        );

        await client.query(
            `
        DELETE FROM clans
        WHERE id = $1
      `,
            [leader.clan_id],
        );

        await client.query("COMMIT");

        return {
            ok: true,
            clanId: leader.clan_id,
            memberCharacterIds: membersResult.rows.map(
                (row) => row.character_id,
            ),
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function setClanMemberRole(payload: unknown): Promise<{
    ok: true;
    clanId: string;
    targetCharacterId: string;
    role: ClanRole;
}> {
    const parsed = setClanMemberRoleSchema.parse(payload);
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const leader = await getCharacterState(
            client,
            parsed.leaderCharacterId,
        );

        if (!leader?.clan_id) {
            throw new Error("No perteneces a ningun clan");
        }

        const leaderRole = await getClanRole(
            client,
            parsed.leaderCharacterId,
            leader.clan_id,
        );

        if (leaderRole !== "leader") {
            throw new Error("Solo el lider puede asignar co-lideres");
        }

        if (parsed.targetCharacterId === parsed.leaderCharacterId) {
            throw new Error("No puedes cambiar tu propio rango");
        }

        const target = await getCharacterState(
            client,
            parsed.targetCharacterId,
        );

        if (!target || target.clan_id !== leader.clan_id) {
            throw new Error("Ese personaje no pertenece a tu clan");
        }

        const targetRole = await getClanRole(client, target.id, leader.clan_id);

        if (!targetRole) {
            throw new Error("Ese personaje no pertenece a tu clan");
        }

        if (targetRole === "leader") {
            throw new Error("No puedes cambiar el rango del lider");
        }

        await client.query(
            `
        UPDATE clan_members
        SET role = $3
        WHERE clan_id = $1
          AND character_id = $2
      `,
            [leader.clan_id, target.id, parsed.role],
        );

        await client.query("COMMIT");

        return {
            ok: true,
            clanId: leader.clan_id,
            targetCharacterId: target.id,
            role: parsed.role,
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function transferClanLeadership(payload: unknown): Promise<{
    ok: true;
    clanId: string;
    previousLeaderCharacterId: string;
    newLeaderCharacterId: string;
}> {
    const parsed = transferClanLeadershipSchema.parse(payload);
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const leader = await getCharacterState(
            client,
            parsed.leaderCharacterId,
        );

        if (!leader?.clan_id) {
            throw new Error("No perteneces a ningun clan");
        }

        const leaderRole = await getClanRole(
            client,
            parsed.leaderCharacterId,
            leader.clan_id,
        );

        if (leaderRole !== "leader") {
            throw new Error("Solo el lider puede transferir el liderazgo");
        }

        if (parsed.targetCharacterId === parsed.leaderCharacterId) {
            throw new Error("No puedes transferirte el liderazgo a ti mismo");
        }

        const target = await getCharacterState(
            client,
            parsed.targetCharacterId,
        );

        if (!target || target.clan_id !== leader.clan_id) {
            throw new Error("Ese personaje no pertenece a tu clan");
        }

        const targetRole = await getClanRole(client, target.id, leader.clan_id);

        if (!targetRole) {
            throw new Error("Ese personaje no pertenece a tu clan");
        }

        if (
            getClanAlignmentFromCharacter({
                criminal: Boolean(leader.criminal),
                faction: leader.faction,
            }) !==
            getClanAlignmentFromCharacter({
                criminal: Boolean(target.criminal),
                faction: target.faction,
            })
        ) {
            throw new Error(
                "Solo puedes transferir el liderazgo a un miembro de tu misma faccion",
            );
        }

        const nextAlignment = getClanAlignmentFromCharacter({
            criminal: Boolean(target.criminal),
            faction: target.faction,
        });

        await client.query(
            `
        UPDATE clan_members
        SET role = CASE
            WHEN character_id = $2 THEN 'member'
            WHEN character_id = $3 THEN 'leader'
            ELSE role
        END
        WHERE clan_id = $1
          AND character_id IN ($2, $3)
      `,
            [leader.clan_id, parsed.leaderCharacterId, target.id],
        );

        await client.query(
            `
        UPDATE clans
        SET leader_character_id = $2,
            alignment = $3,
            updated_at = NOW()
        WHERE id = $1
      `,
            [leader.clan_id, target.id, nextAlignment],
        );

        const incompatibleMembersResult = await client.query<{
            character_id: string;
        }>(
            `
        SELECT cm.character_id
        FROM clan_members cm
        JOIN characters c ON c.id = cm.character_id
        WHERE cm.clan_id = $1
          AND c.deleted_at IS NULL
          AND NOT (
            ($2 = 'citizen' AND (COALESCE(c.faction, 'none') = 'armada' OR (COALESCE(c.criminal, FALSE) = FALSE AND COALESCE(c.faction, 'none') = 'none')))
            OR
            ($2 = 'criminal' AND (COALESCE(c.faction, 'none') = 'caos' OR (COALESCE(c.criminal, FALSE) = TRUE AND COALESCE(c.faction, 'none') = 'none')))
          )
      `,
            [leader.clan_id, nextAlignment],
        );

        if (incompatibleMembersResult.rowCount) {
            const incompatibleCharacterIds = incompatibleMembersResult.rows.map(
                (row) => row.character_id,
            );

            await client.query(
                `
            DELETE FROM clan_members
            WHERE clan_id = $1
              AND character_id = ANY($2::uuid[])
          `,
                [leader.clan_id, incompatibleCharacterIds],
            );

            await client.query(
                `
            UPDATE characters
            SET clan_id = NULL,
                updated_at = NOW()
            WHERE id = ANY($1::uuid[])
          `,
                [incompatibleCharacterIds],
            );
        }

        await client.query("COMMIT");

        return {
            ok: true,
            clanId: leader.clan_id,
            previousLeaderCharacterId: parsed.leaderCharacterId,
            newLeaderCharacterId: target.id,
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}
