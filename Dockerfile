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

# ---- Build stage: install the npm workspaces root and build all packages ----
FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/
COPY api/package.json api/
COPY server/package.json server/
RUN npm ci

COPY client/ client/
COPY api/ api/
COPY server/ server/
RUN npm run build && npm prune --omit=dev

# ---- Runtime ----
FROM node:24-bookworm-slim AS runtime

# Mirror the repo layout: unified.ts resolves ../client/dist and
# ../server/dist relative to the API root.
WORKDIR /app/api

ENV NODE_ENV=production \
    DB_BACKEND=sqlite \
    DATA_DIR=/data \
    PORT=3001 \
    GAME_PORT=7666 \
    API_BASE_URL=http://127.0.0.1:3001

# Hoisted production deps live in the root node_modules (no prod version
# conflicts between workspaces, so nothing nested is needed at runtime).
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/node_modules /app/node_modules

COPY --from=build /app/api/package.json /app/api/package.json
COPY --from=build /app/api/dist /app/api/dist
# schema.sqlite.sql lives next to dist/ because src/sqliteDb.ts resolves it
# as ../schema.sqlite.sql at runtime.
COPY --from=build /app/api/schema.sqlite.sql /app/api/schema.sqlite.sql

COPY --from=build /app/server/package.json /app/server/package.json
COPY --from=build /app/server/dist /app/server/dist

# Static client (served by `unified --serve` on the API port).
COPY --from=build /app/client/dist /app/client/dist

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh && mkdir -p /data

VOLUME /data
EXPOSE 3001

CMD ["/app/docker-entrypoint.sh"]
