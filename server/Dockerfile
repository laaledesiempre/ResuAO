FROM node:24-bookworm-slim AS base

FROM base AS deps
WORKDIR /app

# No hay lockfile por paquete: el lockfile vive en la raíz del monorepo
# (npm workspaces). Esta imagen standalone instala sin lockfile.
COPY package.json ./
RUN npm install

FROM deps AS build
WORKDIR /app

COPY . .
RUN npm run build

FROM base AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/jsons ./jsons
COPY --from=build /app/mapas_source ./mapas_source

EXPOSE 7666

CMD ["npm", "start"]
