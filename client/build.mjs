// Build/dev script for the Resu vanilla client.
// Usage:
//   node build.mjs              -> one-off production build into dist/
//   node build.mjs --watch      -> rebuild on change
//   node build.mjs --serve      -> serve dist/ on :8080 (SPA fallback)
//   node build.mjs --watch --serve
import * as esbuild from "esbuild";
import { cpSync, copyFileSync, mkdirSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const args = new Set(process.argv.slice(2));
const watch = args.has("--watch");
const serve = args.has("--serve");
const root = resolve(new URL(".", import.meta.url).pathname);
const dist = join(root, "dist");

function runtimeConfigScript() {
    const apiUrl = process.env.RESU_API_URL?.trim();
    const wsUrl = process.env.RESU_WS_URL?.trim();
    const lines = [];
    if (apiUrl) lines.push(`globalThis.__RESU_API_URL__ = ${JSON.stringify(apiUrl)};`);
    if (wsUrl) lines.push(`globalThis.__RESU_WS_URL__ = ${JSON.stringify(wsUrl)};`);
    return `${lines.join("\n")}\n`;
}

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ogg": "audio/ogg",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".map": "application/json",
};

function copyStatics() {
    mkdirSync(dist, { recursive: true });
    copyFileSync(join(root, "index.html"), join(dist, "index.html"));
    if (existsSync(join(root, "public"))) {
        cpSync(join(root, "public"), dist, { recursive: true });
    }
}

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
    entryPoints: [join(root, "src/main.ts")],
    bundle: true,
    outfile: join(dist, "bundle.js"),
    format: "esm",
    target: "es2022",
    sourcemap: true,
    minify: !watch,
    logLevel: "info",
    define: {
        // ported Next.js code reads a few NEXT_PUBLIC_* env vars; all usages
        // have safe fallbacks, so an empty object is enough
        "process.env": "{}",
    },
};

copyStatics();

if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log("[build] watching for changes...");
} else {
    await esbuild.build(buildOptions);
    console.log("[build] done -> dist/");
}

if (serve) {
    const port = Number(process.env.PORT || 8080);
    // /api/* is proxied to the Hono API so the client stays same-origin
    // (the API only allows the Next.js origin for CORS-with-credentials).
    const apiTarget = process.env.AO_API_TARGET ?? "http://127.0.0.1:3001";
    const server = createServer(async (req, res) => {
        try {
            if (req.url === "/runtime-config.js") {
                res.writeHead(200, {
                    "content-type": "application/javascript; charset=utf-8",
                    "cache-control": "no-store",
                });
                res.end(runtimeConfigScript());
                return;
            }

            if (req.url?.startsWith("/api/")) {
                const body =
                    req.method === "GET" || req.method === "HEAD"
                        ? undefined
                        : await new Promise((resolveBody, rejectBody) => {
                              const chunks = [];
                              req.on("data", (chunk) => chunks.push(chunk));
                              req.on("end", () => resolveBody(Buffer.concat(chunks)));
                              req.on("error", rejectBody);
                          });

                const upstream = await fetch(`${apiTarget}${req.url}`, {
                    method: req.method,
                    headers: {
                        "content-type":
                            req.headers["content-type"] ?? "application/json",
                        cookie: req.headers.cookie ?? "",
                    },
                    body,
                    redirect: "manual",
                });

                const responseHeaders = {};
                const contentType = upstream.headers.get("content-type");
                if (contentType) responseHeaders["content-type"] = contentType;
                const setCookies =
                    typeof upstream.headers.getSetCookie === "function"
                        ? upstream.headers.getSetCookie()
                        : [];
                if (setCookies.length > 0) {
                    responseHeaders["set-cookie"] = setCookies;
                }
                res.writeHead(upstream.status, responseHeaders);
                res.end(Buffer.from(await upstream.arrayBuffer()));
                return;
            }

            let urlPath = decodeURIComponent(
                new URL(req.url ?? "/", "http://x").pathname,
            );
            if (urlPath.endsWith("/")) urlPath += "index.html";
            let filePath = join(dist, urlPath);
            let data;
            try {
                data = await readFile(filePath);
            } catch {
                // Real 404 for asset-like paths (the game loader probes
                // candidate URLs and needs real 404s to fall through);
                // SPA fallback only for extension-less routes.
                if (extname(urlPath)) {
                    res.writeHead(404, { "content-type": "text/plain" });
                    res.end("not found");
                    return;
                }
                filePath = join(dist, "index.html");
                data = await readFile(filePath);
            }
            res.writeHead(200, {
                "content-type":
                    MIME[extname(filePath)] ?? "application/octet-stream",
            });
            res.end(data);
        } catch (err) {
            res.writeHead(500);
            res.end(String(err));
        }
    });
    server.listen(port, () => {
        console.log(`[serve] http://127.0.0.1:${port}`);
    });
}
