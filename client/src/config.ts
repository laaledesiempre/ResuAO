// Central runtime configuration for the vanilla client.
// The dev/static server proxies /api/* to the Hono API (see build.mjs), so
// same-origin is the default and no CORS is involved. The game server on
// :7666 consumes game tickets against the API on :3001, so the proxy points
// there by default; the disposable SQLite test API on :3002 has an identical
// contract for auth-flow testing (set AO_API_TARGET when serving).
// Override at runtime via globalThis.__RESU_API_URL__.
export const API_BASE_URL = (globalThis as any).__RESU_API_URL__ ?? "";

export const DEFAULT_WS_URL =
    (globalThis as any).__RESU_WS_URL__ ??
    (typeof location !== "undefined"
        ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:7666`
        : "ws://127.0.0.1:7666");
