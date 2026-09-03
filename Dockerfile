# syntax=docker/dockerfile:1
#
# All-in-one Resu image: API + game server (unified process) + static client,
# backed by SQLite. Everything persists under /data (database + uploads).
#
#   docker build -t resu .
#   docker run -p 3001:3001 -v resu-data:/data resu
#   # or a host directory: -v /srv/resu:/data
#
# Then browse http://localhost:3001 and log in with admin / admin (the seed
# forces a password change on first login). Override with -e SEED_ADMIN_NAME /
# -e SEED_ADMIN_PASSWORD. TOKEN_AUTH is auto-generated per boot if unset.

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ---- Stage 1: static client build ----
FROM node:24-bookworm-slim AS client-build
WORKDIR /client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- Stage 2: API build (tsc) ----
FROM base AS api-build
WORKDIR /app
COPY api/package.json api/pnpm-lock.yaml api/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY api/ ./
RUN pnpm build

# ---- Stage 3: game server build (tsc) ----
FROM base AS server-build
WORKDIR /app
COPY server/package.json server/pnpm-lock.yaml server/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY server/ ./
RUN pnpm build

# ---- Runtime ----
FROM base AS runtime

# Mirror the repo layout: unified.ts resolves ../client/dist and
# ../server/dist relative to the API root.
WORKDIR /app/api

ENV NODE_ENV=production \
    DB_BACKEND=sqlite \
    DATA_DIR=/data \
    PORT=3001 \
    GAME_PORT=7666 \
    API_BASE_URL=http://127.0.0.1:3001

# API production deps + compiled output. schema.sqlite.sql lives next to dist/
# because src/sqliteDb.ts resolves it as ../schema.sqlite.sql at runtime.
COPY api/package.json api/pnpm-lock.yaml api/pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=api-build /app/dist ./dist
COPY api/schema.sqlite.sql ./schema.sqlite.sql

# Game server production deps + compiled output + data assets.
WORKDIR /app/server
COPY server/package.json server/pnpm-lock.yaml server/pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=server-build /app/dist ./dist
COPY --from=server-build /app/jsons ./jsons
COPY --from=server-build /app/mapas_source ./mapas_source

# Static client (served by `unified --serve` on the API port).
COPY --from=client-build /client/dist /app/client/dist

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh && mkdir -p /data

VOLUME /data
EXPOSE 3001

CMD ["/app/docker-entrypoint.sh"]
