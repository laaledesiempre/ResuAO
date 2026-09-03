# Resu

Argentum Online jugable en el navegador, en un **solo proceso**: API HTTP (Hono)
+ game server WebSocket + cliente vanilla (PixiJS), con SQLite como base de
datos por defecto. Sin Next.js, sin Docker obligatorio, sin Postgres.

Fork unificado de [aoweb](https://github.com/dcatanzaro/aoweb) (Damián
Catanzaro). La hoja de ruta del proyecto está en [ROADMAP.md](ROADMAP.md).

## Requisitos

- Node.js 22 o superior (con npm)
- Docker, solo si querés Postgres o la imagen all-in-one

El repo es un monorepo de **npm workspaces** (`client/`, `api/`, `server/`):
una sola instalación desde la raíz deja todo listo, con las dependencias
compartidas en un único `node_modules`. Cada paquete mantiene su propio
`package.json`, así que se puede trabajar un paquete de forma aislada si hace
falta.

```bash
npm install        # instala client + api + server desde la raíz
npm run build      # buildea los tres paquetes
```

## 1. Levantar todo (modo unificado, SQLite)

```bash
npm run build                      # genera client/dist, api/dist, server/dist
npm run dev                        # API en :3001 + ws en :7666 + cliente estático
# equivalente: npm run unified -w api -- --serve
```

La base SQLite se crea y se aplica el esquema automáticamente al arrancar
(`SQLITE_PATH`, default `data/resu.sqlite`).

Flags disponibles (pisan a las variables de entorno):

```bash
npm run unified -w api -- --port 3003 --game-port 7667   # puertos custom
npm run unified -w api -- --db /ruta/resu.sqlite         # setea SQLITE_PATH
npm run unified -w api -- --serve                        # sirve client/dist (SPA)
npm run unified -w api -- --help
```

Abrir `http://localhost:3001`.

## 2. Desarrollo (procesos por separado, hot reload)

API (Hono, `tsx watch`):

```bash
npm run dev -w api        # :3001
```

Game server WebSocket:

```bash
npm run dev -w server     # ws://localhost:7666
```

Cliente vanilla (esbuild watch):

```bash
npm run dev -w client
```

Variables de entorno: ver `api/.env.example` y `server/.env.example`. Las que
cambian el host que usa el navegador son:

- `RESU_API_URL` — base URL de la API para el cliente estático. Default `""`
  (same-origin; `/api/*` lo proxifica el server que sirve el cliente).
- `RESU_WS_URL` — WebSocket del game server para el cliente estático. Default
  auto: same-origin `/ws` detrás de proxy en 80/443, o
  `ws(s)://<hostname>:7666` en dev.

El server unificado y `client/build.mjs --serve` exponen esas dos vars en
`/runtime-config.js`, que `client/index.html` carga antes del bundle. No hace
falta rebuildear el cliente para cambiarlas.

## 3. Postgres (opcional)

SQLite es el default (`DB_BACKEND=sqlite`). Para deployments grandes se puede
usar Postgres con `DB_BACKEND=postgres`:

```bash
cd api
docker compose -f docker-compose.postgres.yml up -d   # postgres en :5432
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/resu \
DB_BACKEND=postgres npm run unified -- --serve
```

## 4. Tests

```bash
npm test -w client    # tests unitarios del cliente
npm test -w api       # vitest; los de integración necesitan la API levantada
                      # en :3001 (y Postgres para el backend postgres)
```

## 5. Producción (Docker all-in-one)

Un solo contenedor: proceso unificado + cliente estático, SQLite persistido en
`/data`. Ver [DEPLOYMENT.md](DEPLOYMENT.md).

```bash
docker build -t resu .
docker run -p 3001:3001 -v resu-data:/data resu
```

Seed `admin`/`admin` con cambio obligatorio de password en el primer login.
