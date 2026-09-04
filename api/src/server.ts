import { Hono, type Context, type Next } from "hono";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import config from "./config";
import pool, { dbDialect } from "./db";
import { requireAuth } from "./middleware/auth";
import { normalizeErrorPayload } from "./lib/apiErrors";
import {
    getSessionTokenFromCookie,
    setSessionCookie,
    clearSessionCookie,
    INVALID_SESSION_MESSAGE,
} from "./lib/sessionCookie";
import { getRankingHeadSprites } from "./lib/rankingHeads";
import { seedAdminAccount } from "./seedAdmin";
import {
    changePasswordForSession,
    confirmPasswordReset,
    consumeGameTicket,
    createCharacterForSession,
    createGameTicket,
    deleteCharacterForSession,
    getPasswordResetStatus,
    getPublicSessionByToken,
    loginAccount,
    logoutSession,
    registerAccount,
    requestPasswordReset,
    selectSessionCharacter,
} from "./repositories/auth";
import {
    createAccountAdmin,
    deleteAccountAdmin,
    listAdminAccounts,
    resetAccountPasswordAdmin,
    updateAccountAdmin,
} from "./repositories/accounts";
import {
    getCharacterSettingsBySessionToken,
    saveCharacterSettingsBySessionToken,
} from "./repositories/characterSettings";
import {
    acceptClanRequest,
    createClan,
    createClanRequest,
    deleteClan,
    getCharacterClanSummary,
    getClanDetailsForCharacter,
    kickClanMember,
    leaveClan,
    listClansForCharacter,
    rejectClanRequest,
    setClanMemberRole,
    transferClanLeadership,
} from "./repositories/clans";
import {
    connectArenaRoomByAccount,
    createArenaGameTicket,
    createArenaRoom,
    disconnectArenaRoomByAccount,
    getArenaRoom,
    joinArenaRoom,
    joinArenaRoomByLink,
    leaveArenaRoom,
    leaveArenaRoomByAccount,
    listPublicArenaRooms,
    resetAllArenaRoomMembersConnectedStatus,
} from "./repositories/arenas";
import {
    banCharacterByName,
    banIpByCharacterName,
    claimCharacterConnection,
    getCharacterByAccountAndEmail,
    jailCharacterByName,
    listCharacterRanking,
    patchCharacter,
    patchCharacterBankItems,
    patchCharacterItems,
    patchCharacterSpells,
    patchCharacterStorage,
    releaseCharacterConnection,
    resetAllCharactersConnectedStatus,
    unbanCharacterByName,
    unbanIpByCharacterName,
} from "./repositories/characters";
import {
    getAccountVault,
    getClanVault,
    syncAccountVault,
    syncClanVault,
} from "./repositories/vaults";
import {
    buyMarketListing,
    cancelMarketListing,
    claimMarket,
    createMarketListing,
    getMarketClaims,
    listMarketListings,
} from "./repositories/market";
import {
    countUnreadCorreo,
    deleteCorreo,
    listCorreo,
    markCorreoRead,
    sendCorreo,
} from "./repositories/correo";
import {
    getGameNpcById,
    listGameNpcChangesSince,
    listGameNpcs,
    reseedGameNpcs,
    upsertGameNpc,
} from "./repositories/gameNpcs";
import {
    getGameObjectById,
    listGameObjectChangesSince,
    listGameObjects,
    upsertGameObject,
} from "./repositories/gameObjects";
import {
    getGameBalance,
    listGameBalanceChangesSince,
    upsertGameBalance,
} from "./repositories/gameBalance";
import {
    getGameCraftingRecipeById,
    listGameCraftingRecipeChangesSince,
    deleteGameCraftingRecipe,
    listGameCraftingRecipes,
    upsertGameCraftingRecipe,
} from "./repositories/gameCraftingRecipes";
import {
    getGameSmeltingRecipeById,
    listGameSmeltingRecipeChangesSince,
    listGameSmeltingRecipes,
    upsertGameSmeltingRecipe,
} from "./repositories/gameSmeltingRecipes";
import {
    getRuntimeTimingConfig,
    updateRuntimeTimingValue,
} from "./repositories/runtimeSettings";
import {
    getSiteConfig,
    setSiteConfig,
} from "./repositories/siteConfig";
import { getPublicWiki } from "./repositories/wiki";
import {
    createUserOnlineStat,
    listUserOnlineStats,
} from "./repositories/userOnlineStats";
import { createChallengeHistory } from "./repositories/challenges";

const app = new Hono();
const SLOW_REQUEST_LOG_THRESHOLD_MS = 2000;
const SLOW_CHARACTER_SAVE_LOG_THRESHOLD_MS = 1000;
const JSON_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

// Extension -> mime. Uploads are validated against this list and the same map
// drives Content-Type when serving /api/uploads/*.
const UPLOAD_CONTENT_TYPES: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
};

const UPLOAD_ALLOWED_MIMES = new Set([
    ...Object.values(UPLOAD_CONTENT_TYPES),
    // Browsers are inconsistent when uploading fonts/audio.
    "audio/mp3",
    "audio/x-wav",
    "audio/wave",
    "audio/ogg",
    "application/ogg",
    "application/font-woff",
    "application/x-font-woff",
    "application/x-font-ttf",
    "application/x-font-opentype",
    "application/octet-stream",
    "binary/octet-stream",
    "font/sfnt",
    "image/svg",
    "image/x-png",
]);

function sanitizeUploadFilename(name: string): string {
    const base = path.basename(name).replace(/[^A-Za-z0-9._-]+/g, "-");
    return base.replace(/^\.+/, "").slice(0, 120) || "archivo";
}

function resolveUploadPath(filename: string): string | null {
    const root = path.resolve(config.uploadsDir);
    const resolved = path.resolve(root, filename);

    if (path.dirname(resolved) !== root) {
        return null;
    }

    return resolved;
}

type RouteResult = {
    status: number;
    body: unknown;
};

function routeResult(status: number, body: unknown): RouteResult {
    return { status, body };
}

function errorResult(status: number, error: unknown): RouteResult {
    return routeResult(status, {
        error:
            typeof error === "string"
                ? error
                : error instanceof Error
                  ? error.message
                  : "Unexpected error",
    });
}

function json(c: Context, body: unknown, status = 200): Response {
    return c.json(body as never, status as ContentfulStatusCode);
}

function respond(c: Context, result: RouteResult): Response {
    return json(c, result.body, result.status);
}

class HttpError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
    }
}

function isCharacterSaveRoute(method: string, path: string): boolean {
    return (
        method === "PUT" &&
        /^\/character_save\/[^/]+(?:\/(?:items|bank|storage|spells))?$/.test(
            path,
        )
    );
}

function getBearerToken(c: Context): string {
    const authorization = c.req.header("Authorization") || "";
    return authorization.startsWith("Bearer ")
        ? authorization.slice(7).trim()
        : "";
}

function getGameDataAdminProxyHeader(c: Context): string {
    return c.req.header("x-game-data-admin-token")?.trim() || "";
}

function getRequestIp(c: Context): string | null {
    const forwardedFor = c.req
        .header("x-forwarded-for")
        ?.split(",")[0]
        ?.trim();

    if (forwardedFor) {
        return forwardedFor;
    }

    try {
        return getConnInfo(c).remote.address?.trim() || null;
    } catch {
        return null;
    }
}

function routeParam(c: Context, name: string): string {
    return c.req.param(name) ?? "";
}

function queryParam(c: Context, name: string): string | undefined {
    const value = c.req.query(name);
    return typeof value === "string" ? value : undefined;
}

/**
 * Mirrors express.json({ limit: "2mb" }): parses the request body only when
 * the content type is JSON, yields {} for empty/absent bodies, and rejects
 * malformed JSON with a 400 like the Express body parser does.
 */
async function readBody(c: Context): Promise<unknown> {
    const contentType = c.req.header("content-type") ?? "";

    if (!contentType.includes("json")) {
        return {};
    }

    const raw = await c.req.text();

    if (!raw.trim()) {
        return {};
    }

    try {
        return JSON.parse(raw);
    } catch (error) {
        throw new HttpError(
            400,
            error instanceof Error ? error.message : "Invalid JSON body",
        );
    }
}

function parseRouteId(rawId: string): number {
    return Number.parseInt(rawId, 10);
}

// ---------------------------------------------------------------------------
// Shared handler logic (used by the Bearer-token routes and by the /api/*
// cookie-session routes, which call the same code instead of self-HTTP).
// ---------------------------------------------------------------------------

async function handleGetSession(token: string): Promise<RouteResult> {
    try {
        if (!token) {
            return errorResult(401, "Unauthorized");
        }

        const session = await getPublicSessionByToken(token);

        if (!session) {
            return errorResult(401, "Unauthorized");
        }

        return routeResult(200, session);
    } catch (error) {
        return errorResult(500, error);
    }
}

async function handleSelectCharacter(
    token: string,
    body: unknown,
): Promise<RouteResult> {
    try {
        if (!token) {
            return errorResult(401, "Unauthorized");
        }

        const characterId =
            typeof (body as { characterId?: unknown })?.characterId === "string"
                ? (body as { characterId: string }).characterId.trim()
                : "";

        if (!characterId) {
            return errorResult(400, "characterId es requerido");
        }

        const session = await selectSessionCharacter(token, characterId);

        if (!session) {
            return errorResult(401, "Unauthorized");
        }

        return routeResult(200, session);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        const status =
            message === "Personaje invalido"
                ? 400
                : message === "Tu personaje se encuentra baneado." ||
                    message === "Tu personaje tiene un ban de IP activo."
                  ? 403
                  : 500;
        return errorResult(status, message);
    }
}

async function handleCreateCharacter(
    token: string,
    body: unknown,
): Promise<RouteResult> {
    try {
        if (!token) {
            return errorResult(401, "Unauthorized");
        }

        const session = await createCharacterForSession(token, body);

        if (!session) {
            return errorResult(401, "Unauthorized");
        }

        return routeResult(201, session);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        const status =
            message === "Ese nombre de personaje ya esta en uso" ? 409 : 400;
        return errorResult(status, message);
    }
}

async function handleDeleteCharacter(
    token: string,
    rawCharacterId: string,
): Promise<RouteResult> {
    try {
        if (!token) {
            return errorResult(401, "Unauthorized");
        }

        const characterId = rawCharacterId.trim();

        if (!characterId) {
            return errorResult(400, "characterId es requerido");
        }

        const session = await deleteCharacterForSession(token, characterId);

        if (!session) {
            return errorResult(401, "Unauthorized");
        }

        return routeResult(200, session);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        const status =
            message === "Personaje invalido"
                ? 400
                : message === "No se puede borrar un personaje conectado"
                  ? 409
                  : message === "No se puede borrar un personaje baneado"
                    ? 403
                    : 500;
        return errorResult(status, message);
    }
}

async function handleGetCharacterSettings(token: string): Promise<RouteResult> {
    try {
        if (!token) {
            return errorResult(401, "Unauthorized");
        }

        const settings = await getCharacterSettingsBySessionToken(token);

        if (!settings) {
            return errorResult(400, "No hay un personaje seleccionado");
        }

        return routeResult(200, settings);
    } catch (error) {
        return errorResult(500, error);
    }
}

async function handleSaveCharacterSettings(
    token: string,
    body: unknown,
): Promise<RouteResult> {
    try {
        if (!token) {
            return errorResult(401, "Unauthorized");
        }

        const settings = await saveCharacterSettingsBySessionToken(token, body);

        if (!settings) {
            return errorResult(400, "No hay un personaje seleccionado");
        }

        return routeResult(200, settings);
    } catch (error) {
        const status =
            error instanceof Error && error.name === "ZodError" ? 400 : 500;
        return errorResult(status, error);
    }
}

async function handleCreateGameTicket(token: string): Promise<RouteResult> {
    try {
        if (!token) {
            return errorResult(401, "Unauthorized");
        }

        const gameTicket = await createGameTicket(token);

        if (!gameTicket) {
            return errorResult(400, "No hay un personaje seleccionado");
        }

        return routeResult(200, gameTicket);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        const status =
            message === "Tu personaje se encuentra baneado." ||
            message === "Tu personaje tiene un ban de IP activo."
                ? 403
                : 500;
        return errorResult(status, message);
    }
}

async function handleListClans(token: string): Promise<RouteResult> {
    try {
        if (!token) {
            return errorResult(401, "Unauthorized");
        }

        const session = await getPublicSessionByToken(token);

        if (!session) {
            return errorResult(401, "Unauthorized");
        }

        const characterId = session.selectedCharacterId?.trim() || "";

        if (!characterId) {
            return errorResult(
                409,
                "No hay un personaje seleccionado en la sesion.",
            );
        }

        return routeResult(
            200,
            await listClansForCharacter(session.account._id, characterId),
        );
    } catch (error) {
        return errorResult(400, error);
    }
}

async function handleGetClanDetails(
    token: string,
    clanId: string,
): Promise<RouteResult> {
    try {
        if (!token) {
            return errorResult(401, "Unauthorized");
        }

        const session = await getPublicSessionByToken(token);

        if (!session) {
            return errorResult(401, "Unauthorized");
        }

        const characterId = session.selectedCharacterId?.trim() || "";

        if (!characterId || !clanId) {
            return routeResult(characterId ? 400 : 409, {
                error: characterId
                    ? "clanId es requerido"
                    : "No hay un personaje seleccionado en la sesion.",
            });
        }

        return routeResult(
            200,
            await getClanDetailsForCharacter(
                session.account._id,
                characterId,
                clanId,
            ),
        );
    } catch (error) {
        return errorResult(400, error);
    }
}

async function handleListArenaRooms(token: string): Promise<RouteResult> {
    try {
        if (!token) {
            return errorResult(401, "Unauthorized");
        }

        const rooms = await listPublicArenaRooms(token);

        if (!rooms) {
            return errorResult(401, "Unauthorized");
        }

        return routeResult(200, { rooms });
    } catch (error) {
        return errorResult(500, error);
    }
}

async function handleCreateArenaRoom(
    token: string,
    body: unknown,
): Promise<RouteResult> {
    try {
        if (!token) {
            return errorResult(401, "Unauthorized");
        }

        const room = await createArenaRoom(token, body);

        if (!room) {
            return errorResult(401, "Unauthorized");
        }

        return routeResult(201, room);
    } catch (error) {
        return errorResult(400, error);
    }
}

async function handleGetArenaRoom(
    token: string,
    roomId: string,
): Promise<RouteResult> {
    try {
        if (!token) {
            return errorResult(401, "Unauthorized");
        }

        const room = await getArenaRoom(token, roomId);

        if (!room) {
            return errorResult(404, "Sala no encontrada");
        }

        return routeResult(200, room);
    } catch (error) {
        return errorResult(500, error);
    }
}

async function handleJoinArenaRoom(
    token: string,
    roomId: string,
    body: unknown,
): Promise<RouteResult> {
    try {
        if (!token) {
            return errorResult(401, "Unauthorized");
        }

        const room = await joinArenaRoom(token, roomId, body);

        if (!room) {
            return errorResult(401, "Unauthorized");
        }

        return routeResult(200, room);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        const status = message === "Sala no encontrada" ? 404 : 400;
        return errorResult(status, message);
    }
}

async function handleJoinArenaRoomByLink(
    token: string,
    joinToken: string,
): Promise<RouteResult> {
    try {
        if (!token) {
            return errorResult(401, "Unauthorized");
        }

        const room = await joinArenaRoomByLink(token, joinToken);

        if (!room) {
            return errorResult(401, "Unauthorized");
        }

        return routeResult(200, room);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        const status = message === "Sala no encontrada" ? 404 : 400;
        return errorResult(status, message);
    }
}

async function handleLeaveArenaRoom(
    token: string,
    roomId: string,
): Promise<RouteResult> {
    try {
        if (!token) {
            return errorResult(401, "Unauthorized");
        }

        const result = await leaveArenaRoom(token, roomId);

        if (!result) {
            return errorResult(401, "Unauthorized");
        }

        return routeResult(200, result);
    } catch (error) {
        return errorResult(500, error);
    }
}

async function handleArenaSelectTemplate(
    token: string,
    roomId: string,
    body: unknown,
): Promise<RouteResult> {
    try {
        if (!token) {
            return errorResult(401, "Unauthorized");
        }

        const result = await createArenaGameTicket(token, roomId, body);

        if (!result) {
            return errorResult(401, "Unauthorized");
        }

        return routeResult(200, result);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        const status = message === "Sala no encontrada" ? 404 : 400;
        return errorResult(status, message);
    }
}

async function handlePublicRuntimeConfig(): Promise<RouteResult> {
    try {
        const timing = await getRuntimeTimingConfig();
        return routeResult(200, {
            timing: {
                walkStepMs: timing.walkStepMs,
                actionCooldowns: timing.actionCooldowns,
                visualEffects: timing.visualEffects,
            },
        });
    } catch (error) {
        return errorResult(500, error);
    }
}

async function handleListUserOnlineStats(
    hoursParam: string | undefined,
): Promise<RouteResult> {
    try {
        const hours = typeof hoursParam === "string" ? Number(hoursParam) : 24;
        return routeResult(200, await listUserOnlineStats(hours));
    } catch (error) {
        return errorResult(500, error);
    }
}

// ---------------------------------------------------------------------------
// Admin helpers + startup
// ---------------------------------------------------------------------------

function isAuthorizedGameDataAdmin(session: {
    account: { _id: string; email: string | null };
}): boolean {
    if (
        config.gameDataAdminAccountId &&
        session.account._id === config.gameDataAdminAccountId
    ) {
        return true;
    }

    return (
        (session.account.email ?? "").toLowerCase() ===
        config.gameDataAdminEmail
    );
}

async function getAuthorizedSession(c: Context) {
    const token = getBearerToken(c);

    if (!token) {
        return null;
    }

    const session = await getPublicSessionByToken(token);

    if (!session) {
        return null;
    }

    return { token, session };
}

type AdminSession = {
    session: { account: { _id: string; email: string | null } };
};

async function requireAdminEmailSession(
    c: Context,
): Promise<AdminSession | Response> {
    if (!config.gameDataAdminAccountId) {
        return json(c, { error: "Admin de game-data deshabilitado." }, 403);
    }

    if (
        !config.gameDataAdminProxyToken ||
        getGameDataAdminProxyHeader(c) !== config.gameDataAdminProxyToken
    ) {
        return json(c, { error: "No autorizado." }, 403);
    }

    const authorized = await getAuthorizedSession(c);

    if (!authorized) {
        return json(c, { error: "Unauthorized" }, 401);
    }

    if (!isAuthorizedGameDataAdmin(authorized.session)) {
        return json(c, { error: "No autorizado." }, 403);
    }

    return authorized;
}

type SiteAdminSession = {
    token: string;
    session: { account: { _id: string; email: string | null; is_admin: boolean } };
};

async function requireAdminSession(
    c: Context,
): Promise<SiteAdminSession | Response> {
    const token = getBearerToken(c) || getSessionTokenFromCookie(c);

    if (!token) {
        return json(c, { error: "Unauthorized" }, 401);
    }

    const session = await getPublicSessionByToken(token);

    if (!session) {
        return json(c, { error: "Unauthorized" }, 401);
    }

    if (!session.account.is_admin) {
        return json(c, { error: "No autorizado." }, 403);
    }

    return { token, session };
}

async function ensurePgStatStatements(): Promise<void> {
    try {
        await pool.query("CREATE EXTENSION IF NOT EXISTS pg_stat_statements");
        await pool.query("SELECT 1 FROM pg_stat_statements LIMIT 1");
        console.log("pg_stat_statements ready");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
            `[API] pg_stat_statements no pudo habilitarse automaticamente: ${message}`,
        );
    }
}

type ApiHttpServer = ReturnType<typeof serve>;

async function bootApi(port: number): Promise<ApiHttpServer> {
    await pool.query("SELECT 1");

    if (dbDialect === "sqlite") {
        console.log(`SQLite connected successfully (${config.sqlitePath})`);
    } else {
        console.log("PostgreSQL connected successfully");
        await ensurePgStatStatements();
    }

    await seedAdminAccount();

    const server = serve({
        fetch: app.fetch,
        port,
    });

    await new Promise<void>((resolve) => {
        server.on("listening", () => resolve());
    });
    console.log(`API listening on port ${port}`);
    return server;
}

async function start(): Promise<void> {
    try {
        await bootApi(config.port);
    } catch (error) {
        console.error("Failed to connect to the database", error);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// Global middleware: body limit, slow-request logging, CORS.
// ---------------------------------------------------------------------------

function applyCorsHeaders(c: Context): void {
    const origin = c.req.header("origin");

    if (config.corsOrigin === "*" && origin) {
        c.header("Access-Control-Allow-Origin", origin);
    } else if (config.corsOrigin !== "*") {
        c.header("Access-Control-Allow-Origin", config.corsOrigin);
    }

    c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    c.header("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");

    // Cookie-session routes need credentialed CORS.
    if (c.req.path.startsWith("/api/")) {
        c.header("Access-Control-Allow-Credentials", "true");
    }
}

app.use("*", async (c, next) => {
    const isUploadRoute = c.req.path === "/api/admin/upload";
    const limitBytes = isUploadRoute ? UPLOAD_MAX_BYTES : JSON_BODY_LIMIT_BYTES;
    const contentLength = Number(c.req.header("content-length") ?? 0);

    if (Number.isFinite(contentLength) && contentLength > limitBytes) {
        applyCorsHeaders(c);
        return json(c, { error: "request entity too large" }, 413);
    }

    if (c.req.method === "OPTIONS") {
        applyCorsHeaders(c);
        return c.body(null, 204);
    }

    const startedAt = Date.now();
    await next();
    const durationMs = Date.now() - startedAt;
    const isCharacterSave = isCharacterSaveRoute(c.req.method, c.req.path);

    if (
        isCharacterSave &&
        durationMs >= SLOW_CHARACTER_SAVE_LOG_THRESHOLD_MS
    ) {
        console.warn(
            `[API][character-save][slow] ${c.req.method} ${c.req.path} -> ${c.res.status} in ${durationMs}ms | pool total=${pool.totalCount} idle=${pool.idleCount} waiting=${pool.waitingCount}`,
        );
    } else if (
        !isCharacterSave &&
        durationMs >= SLOW_REQUEST_LOG_THRESHOLD_MS
    ) {
        console.warn(
            `[API][slow] ${c.req.method} ${c.req.path} -> ${c.res.status} in ${durationMs}ms | pool total=${pool.totalCount} idle=${pool.idleCount} waiting=${pool.waitingCount}`,
        );
    }

    applyCorsHeaders(c);
});

app.onError((error, c) => {
    applyCorsHeaders(c);

    if (error instanceof HttpError) {
        return json(
            c,
            { error: error.message },
            error.status,
        );
    }

    console.error("[API][unhandled]", error);
    return json(c, {
        error: error instanceof Error ? error.message : "Unexpected error",
    }, 500);
});

// ---------------------------------------------------------------------------
// Public platform routes
// ---------------------------------------------------------------------------

app.get("/health", async (c) => {
    await pool.query("SELECT 1");
    return json(c, { ok: true });
});

app.get("/runtime-config", async (c) => respond(c, await handlePublicRuntimeConfig()));

app.get("/api/site-config", async (c) => {
    try {
        return json(c, { config: await getSiteConfig() });
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.get("/ranking", async (c) => {
    try {
        const sort = queryParam(c, "sort") === "kills" ? "kills" : "level";
        const rawClassId =
            typeof queryParam(c, "classId") === "string"
                ? Number.parseInt(queryParam(c, "classId") as string, 10)
                : Number.NaN;
        const classId =
            Number.isInteger(rawClassId) && rawClassId > 0
                ? rawClassId
                : undefined;
        const result = await listCharacterRanking({ sort, classId });
        return json(c, result);
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.get("/wiki", async (c) => {
    try {
        return json(c, await getPublicWiki());
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.get("/runtime-config/admin", async (c) => {
    try {
        const timing = await getRuntimeTimingConfig();
        return json(c, { timing });
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.get("/internal/runtime-config", requireAuth, async (c) => {
    try {
        const timing = await getRuntimeTimingConfig();
        return json(c, { timing });
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.put("/internal/runtime-config/timing", requireAuth, async (c) => {
    try {
        const body = await readBody(c);
        const path =
            typeof (body as { path?: unknown })?.path === "string"
                ? (body as { path: string }).path.trim()
                : "";

        if (!path) {
            return json(c, { error: "path es requerido" }, 400);
        }

        const timing = await updateRuntimeTimingValue(
            path,
            (body as { value?: unknown })?.value,
        );
        return json(c, { timing });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, message === "Intervalo invalido" ? 400 : 500);
    }
});

// ---------------------------------------------------------------------------
// Admin game-data routes
// ---------------------------------------------------------------------------

app.put("/api/admin/site-config", async (c) => {
    try {
        const authorized = await requireAdminSession(c);
        if (authorized instanceof Response) {
            return authorized;
        }

        const body = (await readBody(c)) as { config?: unknown };
        const config = await setSiteConfig(body?.config);
        return json(c, { config });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        const status = message === "La configuracion debe ser un objeto" ? 400 : 500;
        return json(c, { error: message }, status);
    }
});

app.post("/api/admin/game-data/npcs/reseed", async (c) => {
    try {
        const authorized = await requireAdminSession(c);
        if (authorized instanceof Response) {
            return authorized;
        }

        return json(c, await reseedGameNpcs());
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, 500);
    }
});

app.get("/api/admin/accounts", async (c) => {
    try {
        const authorized = await requireAdminSession(c);
        if (authorized instanceof Response) {
            return authorized;
        }

        const accounts = await listAdminAccounts(queryParam(c, "q"));
        return json(c, { accounts });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, 500);
    }
});

app.post("/api/admin/accounts", async (c) => {
    try {
        const authorized = await requireAdminSession(c);
        if (authorized instanceof Response) {
            return authorized;
        }

        const account = await createAccountAdmin(await readBody(c));
        return json(c, { account });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        const status = message.includes("Ya existe") ? 409 : 400;
        return json(c, normalizeErrorPayload({ error: message }), status);
    }
});

app.put("/api/admin/accounts/:id", async (c) => {
    try {
        const authorized = await requireAdminSession(c);
        if (authorized instanceof Response) {
            return authorized;
        }

        const accountId = routeParam(c, "id").trim();
        const body = (await readBody(c)) as {
            disabled?: unknown;
            is_admin?: unknown;
        };

        if (
            accountId === authorized.session.account._id &&
            (body?.disabled === true || body?.is_admin === false)
        ) {
            return json(c, {
                error: "No podes deshabilitar ni quitar el admin de tu propia cuenta.",
            }, 400);
        }

        const account = await updateAccountAdmin(accountId, body);
        return json(c, { account });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        const status =
            message === "Cuenta no encontrada"
                ? 404
                : message === "Nada para actualizar"
                  ? 400
                  : 500;
        return json(c, { error: message }, status);
    }
});

app.post("/api/admin/accounts/:id/reset-password", async (c) => {
    try {
        const authorized = await requireAdminSession(c);
        if (authorized instanceof Response) {
            return authorized;
        }

        const accountId = routeParam(c, "id").trim();
        const body = await readBody(c);
        const account = await resetAccountPasswordAdmin(accountId, body);
        return json(c, { account });
    } catch (error) {
        if (error instanceof Error && error.name === "ZodError") {
            return json(c, {
                error: "La contraseña debe tener entre 8 y 100 caracteres.",
            }, 400);
        }
        const message = error instanceof Error ? error.message : "Unexpected error";
        const status = message === "Cuenta no encontrada" ? 404 : 500;
        return json(c, { error: message }, status);
    }
});

app.delete("/api/admin/accounts/:id", async (c) => {
    try {
        const authorized = await requireAdminSession(c);
        if (authorized instanceof Response) {
            return authorized;
        }

        const accountId = routeParam(c, "id").trim();

        if (accountId === authorized.session.account._id) {
            return json(c, {
                error: "No podes eliminar tu propia cuenta.",
            }, 400);
        }

        await deleteAccountAdmin(accountId);
        return json(c, { ok: true });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        const status =
            message === "Cuenta no encontrada"
                ? 404
                : message === "No podes eliminar la ultima cuenta admin."
                  ? 400
                  : 500;
        return json(c, { error: message }, status);
    }
});

app.post("/api/admin/upload", async (c) => {
    try {
        const authorized = await requireAdminSession(c);
        if (authorized instanceof Response) {
            return authorized;
        }

        const body = await c.req.parseBody();
        const file = body["file"];

        if (!(file instanceof File)) {
            return json(c, { error: "Se esperaba un archivo en el campo 'file'" }, 400);
        }

        if (file.size <= 0) {
            return json(c, { error: "El archivo esta vacio" }, 400);
        }

        if (file.size > UPLOAD_MAX_BYTES) {
            return json(c, { error: "El archivo supera el maximo de 10 MB" }, 413);
        }

        const safeName = sanitizeUploadFilename(file.name || "archivo");
        const ext = path.extname(safeName).toLowerCase();
        const expectedMime = UPLOAD_CONTENT_TYPES[ext];
        const declaredMime = (file.type || "").toLowerCase();

        if (!expectedMime) {
            return json(c, { error: "Tipo de archivo no permitido" }, 400);
        }

        if (declaredMime && !UPLOAD_ALLOWED_MIMES.has(declaredMime)) {
            return json(c, { error: "Tipo de archivo no permitido" }, 400);
        }

        await fs.promises.mkdir(config.uploadsDir, { recursive: true });
        const storedName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${safeName}`;
        const targetPath = resolveUploadPath(storedName);

        if (!targetPath) {
            return json(c, { error: "Nombre de archivo invalido" }, 400);
        }

        await fs.promises.writeFile(targetPath, Buffer.from(await file.arrayBuffer()));

        return json(c, { url: `/api/uploads/${storedName}` }, 201);
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.get("/api/uploads/:filename", async (c) => {
    try {
        const filename = routeParam(c, "filename");
        const targetPath = filename ? resolveUploadPath(filename) : null;

        if (!targetPath) {
            return json(c, { error: "Archivo no encontrado" }, 404);
        }

        const stat = await fs.promises.stat(targetPath).catch(() => null);

        if (!stat || !stat.isFile()) {
            return json(c, { error: "Archivo no encontrado" }, 404);
        }

        const contentType =
            UPLOAD_CONTENT_TYPES[path.extname(targetPath).toLowerCase()] ??
            "application/octet-stream";
        const data = await fs.promises.readFile(targetPath);

        c.header("Content-Type", contentType);
        c.header("Content-Length", String(data.length));
        c.header("Cache-Control", "public, max-age=31536000, immutable");
        return c.body(new Uint8Array(data));
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.get("/admin/game-data/objects", async (c) => {
    try {
        const authorized = await requireAdminEmailSession(c);
        if (authorized instanceof Response) {
            return authorized;
        }

        return json(c, await listGameObjects(c.req.query()));
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.get("/admin/game-data/objects/:id", async (c) => {
    try {
        const authorized = await requireAdminEmailSession(c);
        if (authorized instanceof Response) {
            return authorized;
        }

        const id = parseRouteId(routeParam(c, "id"));
        if (!Number.isInteger(id) || id <= 0) {
            return json(c, { error: "id invalido" }, 400);
        }

        return json(c, await getGameObjectById(id));
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, message === "Game object not found" ? 404 : 500);
    }
});

app.put("/admin/game-data/objects/:id", async (c) => {
    try {
        const authorized = await requireAdminEmailSession(c);
        if (authorized instanceof Response) {
            return authorized;
        }

        const id = parseRouteId(routeParam(c, "id"));
        if (!Number.isInteger(id) || id <= 0) {
            return json(c, { error: "id invalido" }, 400);
        }

        return json(
            c,
            await upsertGameObject(
                id,
                await readBody(c),
                authorized.session.account._id,
            ),
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, 400);
    }
});

app.get("/admin/game-data/npcs", async (c) => {
    try {
        const authorized = await requireAdminEmailSession(c);
        if (authorized instanceof Response) {
            return authorized;
        }

        return json(c, await listGameNpcs(c.req.query()));
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.get("/admin/game-data/npcs/:id", async (c) => {
    try {
        const authorized = await requireAdminEmailSession(c);
        if (authorized instanceof Response) {
            return authorized;
        }

        const id = parseRouteId(routeParam(c, "id"));
        if (!Number.isInteger(id) || id <= 0) {
            return json(c, { error: "id invalido" }, 400);
        }

        return json(c, await getGameNpcById(id));
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, message === "Game npc not found" ? 404 : 500);
    }
});

app.put("/admin/game-data/npcs/:id", async (c) => {
    try {
        const authorized = await requireAdminEmailSession(c);
        if (authorized instanceof Response) {
            return authorized;
        }

        const id = parseRouteId(routeParam(c, "id"));
        if (!Number.isInteger(id) || id <= 0) {
            return json(c, { error: "id invalido" }, 400);
        }

        return json(
            c,
            await upsertGameNpc(
                id,
                await readBody(c),
                authorized.session.account._id,
            ),
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, 400);
    }
});

app.get("/admin/game-data/crafting-recipes", async (c) => {
    try {
        const authorized = await requireAdminEmailSession(c);
        if (authorized instanceof Response) return authorized;
        return json(c, await listGameCraftingRecipes(c.req.query()));
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.get("/admin/game-data/crafting-recipes/:id", async (c) => {
    try {
        const authorized = await requireAdminEmailSession(c);
        if (authorized instanceof Response) return authorized;
        const id = parseRouteId(routeParam(c, "id"));
        if (!Number.isInteger(id) || id <= 0) {
            return json(c, { error: "id invalido" }, 400);
        }
        return json(c, await getGameCraftingRecipeById(id));
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, message === "Game crafting recipe not found" ? 404 : 500);
    }
});

app.put("/admin/game-data/crafting-recipes/:id", async (c) => {
    try {
        const authorized = await requireAdminEmailSession(c);
        if (authorized instanceof Response) return authorized;
        const id = parseRouteId(routeParam(c, "id"));
        if (!Number.isInteger(id) || id <= 0) {
            return json(c, { error: "id invalido" }, 400);
        }
        return json(
            c,
            await upsertGameCraftingRecipe(
                id,
                await readBody(c),
                authorized.session.account._id,
            ),
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, 400);
    }
});

app.delete("/admin/game-data/crafting-recipes/:id", async (c) => {
    try {
        const authorized = await requireAdminEmailSession(c);
        if (authorized instanceof Response) return authorized;
        const id = parseRouteId(routeParam(c, "id"));
        if (!Number.isInteger(id) || id <= 0) {
            return json(c, { error: "id invalido" }, 400);
        }
        return json(
            c,
            await deleteGameCraftingRecipe(id, authorized.session.account._id),
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, message === "Game crafting recipe not found" ? 404 : 400);
    }
});

app.get("/admin/game-data/smelting-recipes", async (c) => {
    try {
        const authorized = await requireAdminEmailSession(c);
        if (authorized instanceof Response) return authorized;
        return json(c, await listGameSmeltingRecipes());
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.get("/admin/game-data/smelting-recipes/:id", async (c) => {
    try {
        const authorized = await requireAdminEmailSession(c);
        if (authorized instanceof Response) return authorized;
        const id = parseRouteId(routeParam(c, "id"));
        if (!Number.isInteger(id) || id <= 0) {
            return json(c, { error: "id invalido" }, 400);
        }
        return json(c, await getGameSmeltingRecipeById(id));
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, message === "Game smelting recipe not found" ? 404 : 500);
    }
});

app.put("/admin/game-data/smelting-recipes/:id", async (c) => {
    try {
        const authorized = await requireAdminEmailSession(c);
        if (authorized instanceof Response) return authorized;
        const id = parseRouteId(routeParam(c, "id"));
        if (!Number.isInteger(id) || id <= 0) {
            return json(c, { error: "id invalido" }, 400);
        }
        return json(
            c,
            await upsertGameSmeltingRecipe(
                id,
                await readBody(c),
                authorized.session.account._id,
            ),
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, 400);
    }
});

app.get("/admin/game-data/balance", async (c) => {
    try {
        const authorized = await requireAdminEmailSession(c);
        if (authorized instanceof Response) return authorized;
        return json(c, await getGameBalance());
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, message === "Game balance not found" ? 404 : 500);
    }
});

app.put("/admin/game-data/balance", async (c) => {
    try {
        const authorized = await requireAdminEmailSession(c);
        if (authorized instanceof Response) return authorized;
        return json(
            c,
            await upsertGameBalance(
                await readBody(c),
                authorized.session.account._id,
            ),
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, 400);
    }
});

// ---------------------------------------------------------------------------
// Internal game-data routes (requireAuth)
// ---------------------------------------------------------------------------

app.get("/internal/game-data/objects", requireAuth, async (c) => {
    try {
        return json(c, await listGameObjects(c.req.query()));
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.get("/internal/game-data/objects/changes", requireAuth, async (c) => {
    try {
        const sinceValue = queryParam(c, "sinceVersion");
        const sinceVersion =
            typeof sinceValue === "string"
                ? Number.parseInt(sinceValue, 10)
                : 0;
        return json(
            c,
            await listGameObjectChangesSince(
                Number.isFinite(sinceVersion) ? Math.max(0, sinceVersion) : 0,
            ),
        );
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.get("/internal/game-data/objects/:id", requireAuth, async (c) => {
    try {
        const id = parseRouteId(routeParam(c, "id"));
        if (!Number.isInteger(id) || id <= 0) {
            return json(c, { error: "id invalido" }, 400);
        }

        return json(c, await getGameObjectById(id));
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, message === "Game object not found" ? 404 : 500);
    }
});

app.put("/internal/game-data/objects/:id", requireAuth, async (c) => {
    try {
        const id = parseRouteId(routeParam(c, "id"));
        if (!Number.isInteger(id) || id <= 0) {
            return json(c, { error: "id invalido" }, 400);
        }

        return json(c, await upsertGameObject(id, await readBody(c)));
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, 400);
    }
});

app.get("/internal/game-data/npcs", requireAuth, async (c) => {
    try {
        return json(c, await listGameNpcs(c.req.query()));
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.get("/internal/game-data/npcs/changes", requireAuth, async (c) => {
    try {
        const sinceValue = queryParam(c, "sinceVersion");
        const sinceVersion =
            typeof sinceValue === "string"
                ? Number.parseInt(sinceValue, 10)
                : 0;
        return json(
            c,
            await listGameNpcChangesSince(
                Number.isFinite(sinceVersion) ? Math.max(0, sinceVersion) : 0,
            ),
        );
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.get("/internal/game-data/npcs/:id", requireAuth, async (c) => {
    try {
        const id = parseRouteId(routeParam(c, "id"));
        if (!Number.isInteger(id) || id <= 0) {
            return json(c, { error: "id invalido" }, 400);
        }

        return json(c, await getGameNpcById(id));
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, message === "Game npc not found" ? 404 : 500);
    }
});

app.put("/internal/game-data/npcs/:id", requireAuth, async (c) => {
    try {
        const id = parseRouteId(routeParam(c, "id"));
        if (!Number.isInteger(id) || id <= 0) {
            return json(c, { error: "id invalido" }, 400);
        }

        return json(c, await upsertGameNpc(id, await readBody(c)));
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, 400);
    }
});

app.get("/internal/game-data/crafting-recipes", requireAuth, async (c) => {
    try {
        return json(c, await listGameCraftingRecipes(c.req.query()));
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.get("/internal/game-data/crafting-recipes/changes", requireAuth, async (c) => {
    try {
        const sinceValue = queryParam(c, "sinceVersion");
        const sinceVersion =
            typeof sinceValue === "string"
                ? Number.parseInt(sinceValue, 10)
                : 0;
        return json(
            c,
            await listGameCraftingRecipeChangesSince(
                Number.isFinite(sinceVersion) ? Math.max(0, sinceVersion) : 0,
            ),
        );
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.get("/internal/game-data/crafting-recipes/:id", requireAuth, async (c) => {
    try {
        const id = parseRouteId(routeParam(c, "id"));
        if (!Number.isInteger(id) || id <= 0) {
            return json(c, { error: "id invalido" }, 400);
        }
        return json(c, await getGameCraftingRecipeById(id));
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, message === "Game crafting recipe not found" ? 404 : 500);
    }
});

app.put("/internal/game-data/crafting-recipes/:id", requireAuth, async (c) => {
    try {
        const id = parseRouteId(routeParam(c, "id"));
        if (!Number.isInteger(id) || id <= 0) {
            return json(c, { error: "id invalido" }, 400);
        }
        return json(c, await upsertGameCraftingRecipe(id, await readBody(c)));
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, 400);
    }
});

app.delete("/internal/game-data/crafting-recipes/:id", requireAuth, async (c) => {
    try {
        const id = parseRouteId(routeParam(c, "id"));
        if (!Number.isInteger(id) || id <= 0) {
            return json(c, { error: "id invalido" }, 400);
        }
        return json(c, await deleteGameCraftingRecipe(id));
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, message === "Game crafting recipe not found" ? 404 : 400);
    }
});

app.get("/internal/game-data/smelting-recipes", requireAuth, async (c) => {
    try {
        return json(c, await listGameSmeltingRecipes());
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.get("/internal/game-data/smelting-recipes/changes", requireAuth, async (c) => {
    try {
        const sinceValue = queryParam(c, "sinceVersion");
        const sinceVersion =
            typeof sinceValue === "string"
                ? Number.parseInt(sinceValue, 10)
                : 0;
        return json(
            c,
            await listGameSmeltingRecipeChangesSince(
                Number.isFinite(sinceVersion) ? Math.max(0, sinceVersion) : 0,
            ),
        );
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.get("/internal/game-data/smelting-recipes/:id", requireAuth, async (c) => {
    try {
        const id = parseRouteId(routeParam(c, "id"));
        if (!Number.isInteger(id) || id <= 0) {
            return json(c, { error: "id invalido" }, 400);
        }
        return json(c, await getGameSmeltingRecipeById(id));
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, message === "Game smelting recipe not found" ? 404 : 500);
    }
});

app.put("/internal/game-data/smelting-recipes/:id", requireAuth, async (c) => {
    try {
        const id = parseRouteId(routeParam(c, "id"));
        if (!Number.isInteger(id) || id <= 0) {
            return json(c, { error: "id invalido" }, 400);
        }
        return json(c, await upsertGameSmeltingRecipe(id, await readBody(c)));
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, 400);
    }
});

app.get("/internal/game-data/balance", requireAuth, async (c) => {
    try {
        return json(c, await getGameBalance());
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, message === "Game balance not found" ? 404 : 500);
    }
});

app.get("/internal/game-data/balance/changes", requireAuth, async (c) => {
    try {
        const sinceValue = queryParam(c, "sinceVersion");
        const sinceVersion =
            typeof sinceValue === "string"
                ? Number.parseInt(sinceValue, 10)
                : 0;
        return json(
            c,
            await listGameBalanceChangesSince(
                Number.isFinite(sinceVersion) ? Math.max(0, sinceVersion) : 0,
            ),
        );
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.put("/internal/game-data/balance", requireAuth, async (c) => {
    try {
        return json(c, await upsertGameBalance(await readBody(c)));
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, { error: message }, 400);
    }
});

// ---------------------------------------------------------------------------
// Auth routes (Bearer token)
// ---------------------------------------------------------------------------

app.post("/auth/register", async (c) => {
    try {
        const result = await registerAccount(await readBody(c));
        return json(c, result, 201);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        const status = message.includes("Ya existe")
            ? 409
            : message === "El registro de cuentas esta deshabilitado."
              ? 403
              : 400;
        return json(c, { error: message }, status);
    }
});

app.post("/auth/login", async (c) => {
    try {
        const result = await loginAccount(await readBody(c));
        return json(c, result);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        const status = message === "Credenciales invalidas"
            ? 401
            : message === "La cuenta esta deshabilitada."
              ? 403
              : 400;
        return json(c, { error: message }, status);
    }
});

app.post("/auth/password-reset/request", async (c) => {
    try {
        const result = await requestPasswordReset(
            await readBody(c),
            getRequestIp(c),
        );
        return json(c, result);
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.get("/auth/password-reset/:token", async (c) => {
    try {
        const token = routeParam(c, "token").trim();

        if (!token) {
            return json(c, { error: "Token invalido" }, 400);
        }

        return json(c, await getPasswordResetStatus(token));
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.post("/auth/password-reset/confirm", async (c) => {
    try {
        const result = await confirmPasswordReset(await readBody(c));
        return json(c, result);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, {
            error:
                message === "TOKEN_INVALIDO"
                    ? "El link de recuperacion es invalido o ya vencio"
                    : message,
        }, 400);
    }
});

app.get("/auth/session", async (c) =>
    respond(c, await handleGetSession(getBearerToken(c))),
);
app.get("/auth/me", async (c) =>
    respond(c, await handleGetSession(getBearerToken(c))),
);

app.post("/auth/logout", async (c) => {
    try {
        const token = getBearerToken(c);

        if (token) {
            await logoutSession(token);
        }

        return json(c, { ok: true });
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.post("/auth/select-character", async (c) =>
    respond(c, await handleSelectCharacter(getBearerToken(c), await readBody(c))),
);

app.post("/auth/create-character", async (c) =>
    respond(c, await handleCreateCharacter(getBearerToken(c), await readBody(c))),
);

app.delete("/auth/characters/:characterId", async (c) =>
    respond(
        c,
        await handleDeleteCharacter(
            getBearerToken(c),
            routeParam(c, "characterId"),
        ),
    ),
);

app.post("/auth/game-ticket", async (c) =>
    respond(c, await handleCreateGameTicket(getBearerToken(c))),
);

app.get("/auth/character-settings", async (c) =>
    respond(c, await handleGetCharacterSettings(getBearerToken(c))),
);

app.put("/auth/character-settings", async (c) =>
    respond(
        c,
        await handleSaveCharacterSettings(getBearerToken(c), await readBody(c)),
    ),
);

app.get("/auth/clans", async (c) =>
    respond(c, await handleListClans(getBearerToken(c))),
);

app.get("/auth/clans/:clanId", async (c) =>
    respond(
        c,
        await handleGetClanDetails(getBearerToken(c), routeParam(c, "clanId")),
    ),
);

// ---------------------------------------------------------------------------
// Arena routes (Bearer token)
// ---------------------------------------------------------------------------

app.get("/arenas/rooms", async (c) =>
    respond(c, await handleListArenaRooms(getBearerToken(c))),
);

app.post("/arenas/rooms", async (c) =>
    respond(c, await handleCreateArenaRoom(getBearerToken(c), await readBody(c))),
);

app.get("/arenas/rooms/:roomId", async (c) =>
    respond(c, await handleGetArenaRoom(getBearerToken(c), routeParam(c, "roomId"))),
);

app.post("/arenas/rooms/:roomId/join", async (c) =>
    respond(
        c,
        await handleJoinArenaRoom(
            getBearerToken(c),
            routeParam(c, "roomId"),
            await readBody(c),
        ),
    ),
);

app.post("/arenas/join/:joinToken", async (c) =>
    respond(
        c,
        await handleJoinArenaRoomByLink(
            getBearerToken(c),
            routeParam(c, "joinToken"),
        ),
    ),
);

app.post("/arenas/rooms/:roomId/leave", async (c) =>
    respond(
        c,
        await handleLeaveArenaRoom(getBearerToken(c), routeParam(c, "roomId")),
    ),
);

app.post("/arenas/rooms/:roomId/select-template", async (c) =>
    respond(
        c,
        await handleArenaSelectTemplate(
            getBearerToken(c),
            routeParam(c, "roomId"),
            await readBody(c),
        ),
    ),
);

// ---------------------------------------------------------------------------
// Game ticket consumption (game server)
// ---------------------------------------------------------------------------

app.post("/game-ticket/consume", requireAuth, async (c) => {
    try {
        const body = await readBody(c);
        const ticket =
            typeof (body as { ticket?: unknown })?.ticket === "string"
                ? (body as { ticket: string }).ticket.trim()
                : "";
        const clientIp =
            typeof (body as { clientIp?: unknown })?.clientIp === "string"
                ? (body as { clientIp: string }).clientIp.trim()
                : "";

        if (!ticket) {
            return json(c, { error: "ticket es requerido" }, 400);
        }

        const result = await consumeGameTicket(ticket, clientIp);

        if (!result) {
            return json(c, { error: "Game ticket invalido" }, 404);
        }

        return json(c, result);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        const status =
            message === "Tu IP se encuentra baneada." ||
            message === "Tu personaje tiene un ban de IP activo."
                ? 403
                : 500;
        return json(c, { error: message }, status);
    }
});

// ---------------------------------------------------------------------------
// Internal moderation / arena membership routes
// ---------------------------------------------------------------------------

app.post("/internal/moderation/ban-character", requireAuth, async (c) => {
    try {
        const result = await banCharacterByName(await readBody(c));

        if (!result) {
            return json(c, { error: "Character not found" }, 404);
        }

        return json(c, result);
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.post("/internal/moderation/ban-ip", requireAuth, async (c) => {
    try {
        const result = await banIpByCharacterName(await readBody(c));

        if (!result) {
            return json(c, { error: "Character not found" }, 404);
        }

        return json(c, result);
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.post("/internal/moderation/unban-character", requireAuth, async (c) => {
    try {
        const result = await unbanCharacterByName(await readBody(c));

        if (!result) {
            return json(c, { error: "Character not found" }, 404);
        }

        return json(c, result);
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.post("/internal/moderation/unban-ip", requireAuth, async (c) => {
    try {
        const result = await unbanIpByCharacterName(await readBody(c));

        if (!result) {
            return json(c, { error: "Character not found" }, 404);
        }

        return json(c, result);
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.post("/internal/moderation/jail-character", requireAuth, async (c) => {
    try {
        const result = await jailCharacterByName(await readBody(c));

        if (!result) {
            return json(c, { error: "Character not found" }, 404);
        }

        return json(c, result);
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.post("/internal/arenas/rooms/:roomId/disconnect", requireAuth, async (c) => {
    try {
        const roomId = routeParam(c, "roomId");
        const body = await readBody(c);
        const accountId =
            typeof (body as { accountId?: unknown })?.accountId === "string"
                ? (body as { accountId: string }).accountId.trim()
                : "";

        if (!roomId || !accountId) {
            return json(c, { error: "accountId es requerido" }, 400);
        }

        await disconnectArenaRoomByAccount(roomId, accountId);
        return json(c, { ok: true });
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.post("/internal/arenas/rooms/:roomId/connect", requireAuth, async (c) => {
    try {
        const roomId = routeParam(c, "roomId");
        const body = await readBody(c);
        const accountId =
            typeof (body as { accountId?: unknown })?.accountId === "string"
                ? (body as { accountId: string }).accountId.trim()
                : "";

        if (!roomId || !accountId) {
            return json(c, { error: "accountId es requerido" }, 400);
        }

        await connectArenaRoomByAccount(roomId, accountId);
        return json(c, { ok: true });
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

// ---------------------------------------------------------------------------
// Character routes (game server)
// ---------------------------------------------------------------------------

app.get("/character", requireAuth, async (c) => {
    try {
        const result = await getCharacterByAccountAndEmail(c.req.query());

        if (!result) {
            return json(c, {
                account: {},
                character: {},
            }, 404);
        }

        return json(c, result);
    } catch (error) {
        const statusCode =
            error instanceof Error && error.name === "ZodError" ? 400 : 500;
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, statusCode);
    }
});

app.put("/character_save/:id", requireAuth, async (c) => {
    try {
        const result = await patchCharacter(routeParam(c, "id"), await readBody(c));

        if (!result) {
            return json(c, { error: "Character not found" }, 404);
        }

        return json(c, result);
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.put("/character_save/:id/items", requireAuth, async (c) => {
    try {
        const body = await readBody(c);
        const result = await patchCharacterItems(
            routeParam(c, "id"),
            (body as { items?: unknown })?.items ?? [],
        );

        if (!result) {
            return json(c, { error: "Character not found" }, 404);
        }

        return json(c, result);
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.put("/character_save/:id/bank", requireAuth, async (c) => {
    try {
        const body = await readBody(c);
        const result = await patchCharacterBankItems(
            routeParam(c, "id"),
            (body as { bankItems?: unknown })?.bankItems ?? [],
        );

        if (!result) {
            return json(c, { error: "Character not found" }, 404);
        }

        return json(c, result);
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.put("/character_save/:id/storage", requireAuth, async (c) => {
    try {
        const result = await patchCharacterStorage(
            routeParam(c, "id"),
            (await readBody(c)) ?? {},
        );

        if (!result) {
            return json(c, { error: "Character not found" }, 404);
        }

        return json(c, result);
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.put("/character_save/:id/spells", requireAuth, async (c) => {
    try {
        const body = await readBody(c);
        const result = await patchCharacterSpells(
            routeParam(c, "id"),
            (body as { spells?: unknown })?.spells ?? [],
        );

        if (!result) {
            return json(c, { error: "Character not found" }, 404);
        }

        return json(c, result);
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.post("/internal/characters/:characterId/connect", requireAuth, async (c) => {
    try {
        const result = await claimCharacterConnection(
            routeParam(c, "characterId"),
        );

        if (!result.ok) {
            const status =
                result.reason === "already_connected" ? 409 : 404;
            const error =
                result.reason === "already_connected"
                    ? "Character already connected"
                    : "Character not found";
            return json(c, { error }, status);
        }

        return json(c, result);
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.post("/internal/characters/:characterId/disconnect", requireAuth, async (c) => {
    try {
        const result = await releaseCharacterConnection(
            routeParam(c, "characterId"),
        );

        if (!result) {
            return json(c, { error: "Character not found" }, 404);
        }

        return json(c, result);
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

app.post("/internal/characters/reset-connected", requireAuth, async (c) => {
    try {
        const [updatedCharacters, updatedArenaMembers] = await Promise.all([
            resetAllCharactersConnectedStatus(),
            resetAllArenaRoomMembersConnectedStatus(),
        ]);

        return json(c, {
            ok: true,
            updated: updatedCharacters + updatedArenaMembers,
            updatedCharacters,
            updatedArenaMembers,
        });
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 500);
    }
});

// ---------------------------------------------------------------------------
// Internal vault routes
// ---------------------------------------------------------------------------

app.get("/internal/vaults/account/:accountId", requireAuth, async (c) => {
    try {
        return json(c, await getAccountVault(routeParam(c, "accountId")));
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.put("/internal/vaults/account/:accountId", requireAuth, async (c) => {
    try {
        return json(
            c,
            await syncAccountVault(
                routeParam(c, "accountId"),
                (await readBody(c)) ?? {},
            ),
        );
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.get("/internal/vaults/clan/:clanId", requireAuth, async (c) => {
    try {
        return json(c, await getClanVault(routeParam(c, "clanId")));
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.put("/internal/vaults/clan/:clanId", requireAuth, async (c) => {
    try {
        return json(
            c,
            await syncClanVault(
                routeParam(c, "clanId"),
                (await readBody(c)) ?? {},
            ),
        );
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

// ---------------------------------------------------------------------------
// Internal market routes
// ---------------------------------------------------------------------------

app.get("/internal/market/listings", requireAuth, async (c) => {
    try {
        return json(
            c,
            await listMarketListings({
                search: queryParam(c, "search"),
                sellerCharacterId: queryParam(c, "sellerCharacterId"),
                limit:
                    typeof queryParam(c, "limit") === "string"
                        ? Number.parseInt(queryParam(c, "limit") as string, 10)
                        : undefined,
                sortPrice:
                    queryParam(c, "sortPrice") === "desc"
                        ? "desc"
                        : queryParam(c, "sortPrice") === "asc"
                          ? "asc"
                          : queryParam(c, "sortPrice") === "recent"
                            ? "recent"
                            : undefined,
                includeInactive:
                    typeof queryParam(c, "includeInactive") === "string"
                        ? queryParam(c, "includeInactive") === "true"
                        : undefined,
            }),
        );
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.post("/internal/market/listings", requireAuth, async (c) => {
    try {
        return json(c, await createMarketListing((await readBody(c)) as never), 201);
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.post("/internal/market/buy", requireAuth, async (c) => {
    try {
        return json(c, await buyMarketListing((await readBody(c)) as never));
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.post("/internal/market/listings/:listingId/cancel", requireAuth, async (c) => {
    try {
        const body = await readBody(c);
        return json(
            c,
            await cancelMarketListing({
                sellerCharacterId: (body as { sellerCharacterId?: string })
                    ?.sellerCharacterId as string,
                listingId: routeParam(c, "listingId"),
            }),
        );
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.get("/internal/market/claims/:characterId", requireAuth, async (c) => {
    try {
        return json(c, await getMarketClaims(routeParam(c, "characterId")));
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.post("/internal/market/claims/:characterId/claim", requireAuth, async (c) => {
    try {
        const body = await readBody(c);
        return json(
            c,
            await claimMarket({
                characterId: routeParam(c, "characterId"),
                characterGold: (body as { characterGold?: number })
                    ?.characterGold as number,
                characterItems:
                    (body as { characterItems?: never[] })?.characterItems ??
                    [],
            }),
        );
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

// ---------------------------------------------------------------------------
// Internal correo routes (VB6 ModCorreo.bas)
// ---------------------------------------------------------------------------

app.get("/internal/correo/:characterId", requireAuth, async (c) => {
    try {
        return json(c, await listCorreo(routeParam(c, "characterId")));
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.get("/internal/correo/:characterId/unread", requireAuth, async (c) => {
    try {
        return json(c, {
            unread: await countUnreadCorreo(routeParam(c, "characterId")),
        });
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.post("/internal/correo/:characterId/read", requireAuth, async (c) => {
    try {
        await markCorreoRead(routeParam(c, "characterId"));
        return json(c, { ok: true });
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.post("/internal/correo", requireAuth, async (c) => {
    try {
        return json(c, await sendCorreo((await readBody(c)) as never), 201);
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.delete("/internal/correo/:characterId/:messageId", requireAuth, async (c) => {
    try {
        return json(c, {
            deleted: await deleteCorreo(
                routeParam(c, "characterId"),
                routeParam(c, "messageId"),
            ),
        });
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

// ---------------------------------------------------------------------------
// Internal clan routes
// ---------------------------------------------------------------------------

app.get("/internal/clans/character/:characterId/summary", requireAuth, async (c) => {
    try {
        return json(
            c,
            await getCharacterClanSummary(routeParam(c, "characterId")),
        );
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.post("/internal/clans", requireAuth, async (c) => {
    try {
        return json(c, await createClan(await readBody(c)), 201);
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.post("/internal/clans/requests", requireAuth, async (c) => {
    try {
        return json(c, await createClanRequest(await readBody(c)), 201);
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.post("/internal/clans/requests/:requestId/accept", requireAuth, async (c) => {
    try {
        const body = await readBody(c);
        return json(
            c,
            await acceptClanRequest({
                ...(body as Record<string, unknown>),
                requestId: routeParam(c, "requestId"),
            }),
        );
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.post("/internal/clans/delete", requireAuth, async (c) => {
    try {
        return json(c, await deleteClan(await readBody(c)));
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.post("/internal/clans/member-role", requireAuth, async (c) => {
    try {
        return json(c, await setClanMemberRole(await readBody(c)));
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.post("/internal/clans/transfer-leadership", requireAuth, async (c) => {
    try {
        return json(c, await transferClanLeadership(await readBody(c)));
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.post("/internal/clans/requests/:requestId/reject", requireAuth, async (c) => {
    try {
        const body = await readBody(c);
        return json(
            c,
            await rejectClanRequest({
                ...(body as Record<string, unknown>),
                requestId: routeParam(c, "requestId"),
            }),
        );
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.post("/internal/clans/leave", requireAuth, async (c) => {
    try {
        return json(c, await leaveClan(await readBody(c)));
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

app.post("/internal/clans/kick", requireAuth, async (c) => {
    try {
        return json(c, await kickClanMember(await readBody(c)));
    } catch (error) {
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, 400);
    }
});

// ---------------------------------------------------------------------------
// Internal challenges / stats routes
// ---------------------------------------------------------------------------

app.post("/internal/challenges/history", requireAuth, async (c) => {
    try {
        const result = await createChallengeHistory(await readBody(c));
        return json(c, result, 201);
    } catch (error) {
        const status =
            error instanceof Error && error.name === "ZodError" ? 400 : 500;
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, status);
    }
});

app.post("/internal/user-online-stats", requireAuth, async (c) => {
    try {
        const result = await createUserOnlineStat(await readBody(c));
        return json(c, result, 201);
    } catch (error) {
        const status =
            error instanceof Error && error.name === "ZodError" ? 400 : 500;
        return json(c, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, status);
    }
});

app.get("/user-online-stats", async (c) =>
    respond(c, await handleListUserOnlineStats(queryParam(c, "hours"))),
);

// ---------------------------------------------------------------------------
// Cookie-session routes (/api/*)
//
// These absorb the old Next.js proxy layer (frontend/app/api/**) into the API
// itself: the browser authenticates once via login/register (httpOnly cookie)
// and every other route reads the cookie and invokes the same handler logic
// as the Bearer-token routes (no HTTP self-call). Payload obfuscation from
// frontend/app/api/auth/encrypted-payload.ts is intentionally not ported.
// ---------------------------------------------------------------------------

function sessionTokenOr401(c: Context): string | Response {
    const token = getSessionTokenFromCookie(c);

    if (!token) {
        return json(c, { error: INVALID_SESSION_MESSAGE }, 401);
    }

    return token;
}

function respondProxied(c: Context, result: RouteResult): Response {
    return json(c, normalizeErrorPayload(result.body), result.status);
}

// Mirrors forwardSessionJsonRequest: clears the cookie when the underlying
// session is rejected (401), refreshes it on every other status.
function respondSessionForwarded(
    c: Context,
    token: string,
    result: RouteResult,
): Response {
    if (result.status === 401) {
        clearSessionCookie(c);
        return json(c, normalizeErrorPayload(result.body), 401);
    }

    setSessionCookie(c, token);
    return json(c, normalizeErrorPayload(result.body), result.status);
}

app.post("/api/auth/login", async (c) => {
    try {
        const result = await loginAccount(await readBody(c));
        setSessionCookie(c, result.sessionToken);
        return json(c, {
            account: result.account,
            characters: result.characters,
            selectedCharacterId: (
                result as { selectedCharacterId?: string | null }
            ).selectedCharacterId,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        const status = message === "Credenciales invalidas"
            ? 401
            : message === "La cuenta esta deshabilitada."
              ? 403
              : 400;
        return json(c, normalizeErrorPayload({ error: message }), status);
    }
});

app.post("/api/auth/register", async (c) => {
    try {
        const result = await registerAccount(await readBody(c));
        setSessionCookie(c, result.sessionToken);
        // The old Next layer answered 200 here (not the upstream 201).
        return json(c, {
            account: result.account,
            characters: result.characters,
            selectedCharacterId: (
                result as { selectedCharacterId?: string | null }
            ).selectedCharacterId,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        const status = message.includes("Ya existe")
            ? 409
            : message === "El registro de cuentas esta deshabilitado."
              ? 403
              : 400;
        return json(c, normalizeErrorPayload({ error: message }), status);
    }
});

const handleCookieSessionRead = async (c: Context): Promise<Response> => {
    const token = getSessionTokenFromCookie(c);

    if (!token) {
        return json(c, { error: INVALID_SESSION_MESSAGE }, 401);
    }

    const session = await getPublicSessionByToken(token);

    if (!session) {
        clearSessionCookie(c);
        return json(c, { error: INVALID_SESSION_MESSAGE }, 401);
    }

    setSessionCookie(c, token);
    return json(c, session);
};

app.get("/api/auth/session", handleCookieSessionRead);
app.get("/api/auth/me", handleCookieSessionRead);

app.post("/api/auth/change-password", async (c) => {
    const token = getSessionTokenFromCookie(c);

    if (!token) {
        return json(c, { error: INVALID_SESSION_MESSAGE }, 401);
    }

    try {
        const session = await changePasswordForSession(
            token,
            await readBody(c),
        );

        if (!session) {
            clearSessionCookie(c);
            return json(c, { error: INVALID_SESSION_MESSAGE }, 401);
        }

        setSessionCookie(c, token);
        return json(c, session);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(c, normalizeErrorPayload({ error: message }), 400);
    }
});

const handleCookieLogout = async (c: Context): Promise<Response> => {
    const token = getSessionTokenFromCookie(c);

    if (token) {
        await logoutSession(token);
    }

    clearSessionCookie(c);
    return json(c, { ok: true });
};

app.post("/api/auth/signout", handleCookieLogout);
app.post("/api/auth/logout", handleCookieLogout);

app.post("/api/auth/select-character", async (c) => {
    const token = sessionTokenOr401(c);
    if (token instanceof Response) return token;

    return respondProxied(
        c,
        await handleSelectCharacter(token, await readBody(c)),
    );
});

app.post("/api/auth/create-character", async (c) => {
    const token = sessionTokenOr401(c);
    if (token instanceof Response) return token;

    return respondProxied(
        c,
        await handleCreateCharacter(token, await readBody(c)),
    );
});

app.delete("/api/auth/delete-character/:characterId", async (c) => {
    const token = sessionTokenOr401(c);
    if (token instanceof Response) return token;

    return respondSessionForwarded(
        c,
        token,
        await handleDeleteCharacter(token, routeParam(c, "characterId")),
    );
});

app.get("/api/auth/character-settings", async (c) => {
    const token = sessionTokenOr401(c);
    if (token instanceof Response) return token;

    return respondProxied(c, await handleGetCharacterSettings(token));
});

app.put("/api/auth/character-settings", async (c) => {
    const token = sessionTokenOr401(c);
    if (token instanceof Response) return token;

    return respondProxied(
        c,
        await handleSaveCharacterSettings(token, await readBody(c)),
    );
});

app.post("/api/auth/game-ticket", async (c) => {
    const token = sessionTokenOr401(c);
    if (token instanceof Response) return token;

    return respondProxied(c, await handleCreateGameTicket(token));
});

app.post("/api/auth/password-reset/request", async (c) => {
    try {
        const result = await requestPasswordReset(
            await readBody(c),
            getRequestIp(c),
        );
        return json(c, normalizeErrorPayload(result));
    } catch {
        return json(
            c,
            {
                error: "No se pudo enviar el email de recuperacion. Intenta de nuevo.",
            },
            500,
        );
    }
});

app.post("/api/auth/password-reset/confirm", async (c) => {
    try {
        const result = await confirmPasswordReset(await readBody(c));
        // The password reset invalidates every session: drop the cookie too.
        clearSessionCookie(c);
        return json(c, result);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        return json(
            c,
            normalizeErrorPayload({
                error:
                    message === "TOKEN_INVALIDO"
                        ? "El link de recuperacion es invalido o ya vencio"
                        : message,
            }),
            400,
        );
    }
});

app.get("/api/auth/password-reset/:token", async (c) => {
    try {
        const token = routeParam(c, "token").trim();

        if (!token) {
            return json(c, { error: "Token invalido" }, 400);
        }

        return json(c, normalizeErrorPayload(await getPasswordResetStatus(token)));
    } catch (error) {
        return json(c, normalizeErrorPayload({
            error: error instanceof Error ? error.message : "Unexpected error",
        }), 500);
    }
});

app.get("/api/clans", async (c) => {
    const token = sessionTokenOr401(c);
    if (token instanceof Response) return token;

    return respondSessionForwarded(c, token, await handleListClans(token));
});

app.get("/api/clans/:clanId", async (c) => {
    const token = sessionTokenOr401(c);
    if (token instanceof Response) return token;

    return respondSessionForwarded(
        c,
        token,
        await handleGetClanDetails(token, routeParam(c, "clanId")),
    );
});

app.get("/api/ranking", async (c) => {
    const sort = queryParam(c, "sort") === "kills" ? "kills" : "level";
    const rawClassId = Number.parseInt(queryParam(c, "classId") ?? "", 10);
    const classId =
        Number.isInteger(rawClassId) && rawClassId > 0 ? rawClassId : undefined;

    try {
        const ranking = await listCharacterRanking({
            sort,
            classId,
        });
        const headSpritesById = getRankingHeadSprites(
            ranking.characters.map((character) => character.headId),
        );

        c.header("Cache-Control", "s-maxage=300, stale-while-revalidate=86400");
        return json(c, {
            characters: ranking.characters,
            headSpritesById,
        });
    } catch (error) {
        console.error("No se pudo cargar el ranking:", error);
        return json(c, { characters: [], headSpritesById: {} });
    }
});

app.get("/api/users-online-stats", async (c) =>
    respondProxied(
        c,
        await handleListUserOnlineStats(queryParam(c, "hours")?.trim() || "24"),
    ),
);

app.get("/api/runtime-config", async (c) =>
    respondProxied(c, await handlePublicRuntimeConfig()),
);

// ---------------------------------------------------------------------------
// Cookie-session arena routes
// ---------------------------------------------------------------------------

app.get("/api/arenas/rooms", async (c) => {
    const token = sessionTokenOr401(c);
    if (token instanceof Response) return token;

    return respondProxied(c, await handleListArenaRooms(token));
});

app.post("/api/arenas/rooms", async (c) => {
    const token = sessionTokenOr401(c);
    if (token instanceof Response) return token;

    return respondProxied(c, await handleCreateArenaRoom(token, await readBody(c)));
});

app.get("/api/arenas/rooms/:roomId", async (c) => {
    const token = sessionTokenOr401(c);
    if (token instanceof Response) return token;

    return respondProxied(c, await handleGetArenaRoom(token, routeParam(c, "roomId")));
});

app.post("/api/arenas/rooms/:roomId/join", async (c) => {
    const token = sessionTokenOr401(c);
    if (token instanceof Response) return token;

    return respondProxied(
        c,
        await handleJoinArenaRoom(token, routeParam(c, "roomId"), await readBody(c)),
    );
});

app.post("/api/arenas/rooms/:roomId/leave", async (c) => {
    const token = sessionTokenOr401(c);
    if (token instanceof Response) return token;

    return respondProxied(
        c,
        await handleLeaveArenaRoom(token, routeParam(c, "roomId")),
    );
});

app.post("/api/arenas/rooms/:roomId/select-template", async (c) => {
    const token = sessionTokenOr401(c);
    if (token instanceof Response) return token;

    return respondProxied(
        c,
        await handleArenaSelectTemplate(
            token,
            routeParam(c, "roomId"),
            await readBody(c),
        ),
    );
});

app.post("/api/arenas/join/:joinToken", async (c) => {
    const token = sessionTokenOr401(c);
    if (token instanceof Response) return token;

    return respondProxied(
        c,
        await handleJoinArenaRoomByLink(token, routeParam(c, "joinToken")),
    );
});

export { app, bootApi };

// Auto-start only when this file is the process entrypoint (the unified
// entrypoint imports { app, bootApi } instead of triggering a listen here).
if (path.resolve(process.argv[1] ?? "") === __filename) {
    void start();
}
