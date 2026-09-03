#!/usr/bin/env node
/**
 * resu — unified single-process entrypoint (M1).
 *
 *   resu                    Hono API + WebSocket game server in one process.
 *   resu --serve            additionally serves the static vanilla client
 *                            (client/dist) on the API port, with SPA fallback.
 *
 * Flags (override env vars):
 *   --port <n>        API/static port        (default: env PORT or 3001)
 *   --game-port <n>   WebSocket game port    (default: env GAME_PORT or 7666)
 *   --db <path>       SQLite database file   (sets SQLITE_PATH)
 *   --serve           serve client/dist on the API port
 *   --help            show this help
 *
 * The game server (../server) still talks to the API over loopback HTTP
 * (API_BASE_URL + TOKEN_AUTH). Replacing that hop with in-process direct
 * calls is a future optimization, deliberately out of scope for M1.
 */

import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { parseArgs } from "util";
import type { Context } from "hono";
import type { DbPoolLike } from "./db.js";

const USAGE = `resu — unified AO Web server (API + game server in one process)

Usage:
  resu [options]

Options:
  --serve            also serve the static vanilla client (client/dist)
  --port <n>         API/static port (default: env PORT or 3001)
  --game-port <n>    WebSocket game port (default: env GAME_PORT or 7666)
  --db <path>        SQLite database file (sets SQLITE_PATH)
  --help             show this help
`;

const SPA_FALLBACK_EXCLUDED_PREFIXES = [
    "/api/",
    "/internal/",
    "/auth/",
    "/admin/",
    "/arenas/",
    "/character",
    "/game-ticket",
    "/health",
    "/ranking",
    "/wiki",
    "/runtime-config",
    "/user-online-stats",
];

function parsePort(value: string, flag: string): number {
    const port = Number(value);

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        console.error(`Invalid value for ${flag}: ${value}`);
        process.exit(1);
    }

    return port;
}

async function main(): Promise<void> {
    let values: ReturnType<typeof parseArgs>["values"];

    try {
        ({ values } = parseArgs({
            options: {
                serve: { type: "boolean", default: false },
                port: { type: "string" },
                "game-port": { type: "string" },
                db: { type: "string" },
                help: { type: "boolean", default: false },
            },
        }));
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        console.error(USAGE);
        process.exit(1);
    }

    if (values.help) {
        console.log(USAGE);
        return;
    }

    const apiPort = parsePort(
        (values.port as string | undefined) ?? process.env.PORT ?? "3001",
        "--port",
    );
    const gamePort = parsePort(
        (values["game-port"] as string | undefined) ?? process.env.GAME_PORT ?? "7666",
        "--game-port",
    );

    if (apiPort === gamePort) {
        console.error("--port and --game-port must be different");
        process.exit(1);
    }

    // Flags override env. Everything env-dependent (api config, db, game
    // server) is imported dynamically AFTER these assignments.
    process.env.PORT = String(apiPort);

    if (values.db) {
        process.env.SQLITE_PATH = path.resolve(values.db as string);
    }

    // The game server reaches the API over loopback HTTP; default its target
    // to the unified API port unless the operator set one explicitly.
    if (!process.env.API_BASE_URL?.trim()) {
        process.env.API_BASE_URL = `http://127.0.0.1:${apiPort}`;
    }

    const { app, bootApi } = await import("./server.js");
    const pool = (await import("./db.js")).default as unknown as DbPoolLike;

    if (values.serve) {
        const clientDist = path.resolve(__dirname, "..", "..", "client", "dist");

        if (!fs.existsSync(clientDist)) {
            console.warn(
                `[resu] --serve: ${clientDist} does not exist yet; static client disabled (API still available).`,
            );
        } else {
            const { serveStatic } = await import(
                "@hono/node-server/serve-static"
            );
            const indexHtml = fs.readFileSync(
                path.join(clientDist, "index.html"),
                "utf8",
            );

            app.use("/*", serveStatic({ root: clientDist }));
            app.notFound((c: Context) => {
                const isApiPath = SPA_FALLBACK_EXCLUDED_PREFIXES.some(
                    (prefix) => c.req.path.startsWith(prefix),
                );
                // Requests that look like files ("/maps/mapa_1.json") must get
                // a real 404, not the SPA HTML: the client's asset loader
                // relies on 404s to fall back to alternate asset paths.
                const looksLikeFile = path.posix.extname(c.req.path) !== "";

                if (c.req.method === "GET" && !isApiPath && !looksLikeFile) {
                    return c.html(indexHtml);
                }

                return c.json({ error: "Not found" }, 404);
            });
            console.log(`[resu] Serving static client from ${clientDist}`);
        }
    }

    const apiServer = await bootApi(apiPort);

    // The game server self-starts on import and reads PORT/API_BASE_URL from
    // the environment at that moment; remap PORT to the game port now that
    // the API has already consumed its own value.
    process.env.PORT = String(gamePort);
    const localRequire = createRequire(__filename);
    // Production images run this file compiled (dist/unified.js) alongside a
    // compiled game server (server/dist); in dev (tsx) only the TS sources
    // exist, so fall back to them.
    const compiledServerEntry = path.resolve(
        __dirname,
        "..",
        "..",
        "server",
        "dist",
        "server.js",
    );
    localRequire(
        fs.existsSync(compiledServerEntry)
            ? "../../server/dist/server"
            : "../../server/src/server",
    );
    console.log(
        `[resu] Game server starting on ws port ${gamePort} (API_BASE_URL=${process.env.API_BASE_URL})`,
    );

    let shuttingDown = false;
    const shutdown = (signal: string) => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;
        console.log(`[resu] ${signal} received, shutting down...`);
        apiServer.close();
        // The in-process game server (ws) exposes no handle; process exit
        // tears it down together with its schedulers.
        void pool
            .end()
            .catch(() => undefined)
            .finally(() => process.exit(0));
        setTimeout(() => process.exit(0), 3000).unref();
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

void main().catch((error) => {
    console.error("[resu] Failed to start:", error);
    process.exit(1);
});
