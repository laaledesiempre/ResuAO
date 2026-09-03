// Central runtime configuration for the vanilla client.
// The dev/static server proxies /api/* to the Hono API (see build.mjs), so
// same-origin is the default and no CORS is involved. The game server on
// :7666 consumes game tickets against the API on :3001, so the proxy points
// there by default; the disposable SQLite test API on :3002 has an identical
// contract for auth-flow testing (set AO_API_TARGET when serving).
// Override at runtime via globalThis.__RESU_API_URL__; the optional
// /runtime-config.js script sets this from RESU_API_URL when served by
// build.mjs --serve or the unified API server.
export const API_BASE_URL = (globalThis as any).__RESU_API_URL__ ?? "";

// Same idea for the game socket: /runtime-config.js may inject
// globalThis.__RESU_WS_URL__ from RESU_WS_URL. Without an override we stay
// same-origin behind a reverse proxy (standard ports) or use the dev game
// port on the current hostname.
export const DEFAULT_WS_URL =
    (globalThis as any).__RESU_WS_URL__ ??
    (typeof location !== "undefined"
        ? location.port === "" || location.port === "443" || location.port === "80"
            // Served behind a reverse proxy on standard ports: the proxy
            // routes /ws to the game server (see deploy istio VirtualService).
            ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`
            : `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:7666`
        : "ws://127.0.0.1:7666");
