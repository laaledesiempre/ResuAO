# Resu

Argentum Online jugable en el navegador, en un **solo proceso**: API HTTP (Hono)
+ game server WebSocket + cliente vanilla (PixiJS), con SQLite como base de
datos por defecto. Sin Next.js, sin Docker obligatorio, sin Postgres.

Fork unificado de [aoweb](https://github.com/dcatanzaro/aoweb) (Damián
Catanzaro). La hoja de ruta del proyecto está en [ROADMAP.md](ROADMAP.md).

## Requisitos

- Node.js 22 o superior
- pnpm (para `api/` y `server/`)
- npm (para `client/`)
- Docker, solo si querés Postgres o la imagen all-in-one

## 1. Levantar todo (modo unificado, SQLite)

```bash
cd api
pnpm install
pnpm run unified -- --serve   # API en :3001 + ws en :7666 + cliente estático
```

La base SQLite se crea y se aplica el esquema automáticamente al arrancar
(`SQLITE_PATH`, default `data/resu.sqlite`).

Flags disponibles (pisan a las variables de entorno):

```bash
pnpm run unified -- --port 3003 --game-port 7667   # puertos custom
pnpm run unified -- --db /ruta/resu.sqlite         # setea SQLITE_PATH
pnpm run unified -- --serve                        # sirve client/dist (SPA)
pnpm run unified -- --help
```

Para que `--serve` tenga algo que servir, buildear el cliente primero:

```bash
cd client
npm install
npm run build    # genera client/dist
```

Abrir `http://localhost:3001`.

## 2. Desarrollo (procesos por separado, hot reload)

API (Hono, `tsx watch`):

```bash
cd api
pnpm install
pnpm dev        # :3001
```

Game server WebSocket:

```bash
cd server
pnpm install
pnpm dev        # ws://localhost:7666
```

Cliente vanilla (esbuild watch):

```bash
cd client
npm install
npm run dev
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
DB_BACKEND=postgres pnpm run unified -- --serve
```

## 4. Tests

```bash
cd api
pnpm test       # vitest, corre contra ambos backends (sqlite y postgres)
```

## 5. Producción (Docker all-in-one)

Un solo contenedor: proceso unificado + cliente estático, SQLite persistido en
`/data`. Ver [DEPLOYMENT.md](DEPLOYMENT.md).

```bash
docker build -t resu .
docker run -p 3001:3001 -v resu-data:/data resu
```

Seed `admin`/`admin` con cambio obligatorio de password en el primer login.
