# ROADMAP — Resu (fork unificado de dcatanzaro/aoweb)

Objetivo final: Argentum Online jugable en Linux de forma nativa, con backend
unificado, sin Next.js, sin Postgres, y a largo plazo backend + cliente 100% Rust.

**Visión de largo plazo**: si M3/M4 salen bien, este AO en Rust es la base de AO
para futuras generaciones: extensible, modificable e infinitamente pluggeable.
Todo vía APIs e interfaces — los clientes ganan flexibilidad, los custom servers
ganan tools para gestionar sistemas, y la comunidad puede construir encima sin
forkear el núcleo.

Rol de cada etapa:

- **M1/M2 — saneamiento del stack.** Next.js era overkill: no aportaba nada al
  juego y ensuciaba la arquitectura (lógica de backend viviendo en el frontend,
  tres procesos para una cosa sola). M1 lo reemplaza por un proceso único,
  Hono + SQLite + cliente vanilla: mismo juego, arquitectura honesta. No se
  busca perfección acá — se busca una base simple, testeada y entendible.
- **M3/M4 — la base definitiva.** Reescritura en Rust con excelencia de
  ingeniería como requisito, no como deseo (ver "Principios de arquitectura").

Restricción legal: el repo upstream no tiene licencia. Uso privado/fork local OK;
distribuir builds públicos requiere permiso de Damián Catanzaro.

## Decisiones técnicas (cerradas)

- **DB: SQLite** (no RocksDB). Motivos:
  - El dominio es relacional (personajes, clanes, mercado, bóvedas). RocksDB es KV
    y obligaría a reimplementar índices/joins a mano.
  - SQLite actúa como **contrato de datos estable** entre M1 (JS) y M3 (Rust):
    el backend Rust lee el mismo archivo `.sqlite` vía sqlx/rusqlite.
  - `node:sqlite` en M1: síncrono, embebido, cero deps nativas, sobrado para
    server local/LAN. Postgres queda disponible vía `DB_BACKEND=postgres` para
    deployments grandes.
- **Backend M1: Hono sobre Node**, un solo proceso que integra:
  - API HTTP (lo que fue `api/` Express + las API routes de Next).
  - Game server WebSocket (`server/`, ~34k LOC TS — portado, no reescrito).
  - Serving estático opcional del cliente (flag `--serve`).
- **Frontend M1: vanilla + PixiJS.** El motor del juego ya era TS plano
  (`frontend/components/game/{rendering,engine,input}` — 46 archivos, mayoría
  sin React). React era solo glue de bootstrap/HUD: se conserva el motor, se
  reemplaza el glue por DOM vanilla. Sin framework, build con esbuild.
- **Comportamiento por flags:**
  - `resu` (sin flags) → server AO completo headless (API + game server).
  - `resu --serve` → además sirve el cliente web (login, crear PJ, jugar).

### Deuda consciente de M1 (a eliminar en M3)

- **Traductor de dialecto SQL** (`api/src/sqliteDb.ts`): los repositorios tienen
  UN texto SQL en dialecto Postgres y el adaptador lo traduce a SQLite on the
  fly. El costo en runtime es despreciable (traducción una vez por SQL único,
  prepared statements cacheados); el costo real es complejidad de código. Se
  acepta porque evitó duplicar ~400 queries en dos dialectos. En M3 desaparece:
  sqlx con SQL nativo SQLite.
- **Hop HTTP loopback** game server → API (legacy de la arquitectura original).
  En M3 es una llamada in-process.
- **Dos fugas de abstracción**: branches con `dbDialect` en `market.ts` (CTEs
  que modifican datos) y `userOnlineStats.ts` (EXTRACT(EPOCH)). Mínimas,
  documentadas en código.

## Principios de arquitectura (contrato para M3/M4)

Estos principios son **requisitos de aceptación**, no lineamientos aspiracionales.
Un módulo de M3 no se da por terminado si los viola.

1. **Arquitectura hexagonal (ports & adapters).** El dominio (reglas del juego:
   combate, NPCs, crafting, clanes, economía) es código puro: sin I/O, sin red,
   sin DB, sin reloj de pared. Todo efecto colateral entra por un puerto
   (trait): `Store`, `Clock`, `Rng`, `Broadcaster`, `AssetLoader`. Los adapters
   viven al borde y son reemplazables sin tocar el dominio.
2. **Interfaces por agregado de dominio.** Persistencia definida como traits por
   agregado (`CharacterStore`, `ClanStore`, `MarketStore`, `VaultStore`...).
   SQLite via sqlx es el primer adapter; cualquier otro store es implementar el
   trait. Nada de SQL fuera de los adapters de persistencia.
3. **DRY con criterio: una fuente de verdad por concepto.** El protocolo de red
   se define UNA vez (crate `resu-protocol`, compartido entre backend y
   cliente nativo). Tipos de dominio compartidos, no duplicados. Tres líneas
   similares son mejor que una abstracción prematura — pero el mismo concepto
   en dos lugares es un bug esperando turno.
4. **Side effects explícitos y al borde.** Los servicios de dominio devuelven
   intenciones (eventos/comandos); la capa de aplicación los ejecuta
   (persistir, broadcast, programar timers). Persistencia transaccional
   explícita: qué se guarda, cuándo y por qué, documentado por agregado.
5. **Protocolo como contrato público, versionado y documentado.** Hoy el
   protocolo binario ws es implícito (existe solo como código). En M3 se
   documenta como spec versionada. La API HTTP se documenta con OpenAPI. Un
   cliente o tool de terceros tiene que poder implementarse leyendo SOLO la
   spec.
6. **Extensibilidad por diseño.** Eventos de dominio (pub/sub interno) como
   punto de enganche para funcionalidad sin tocar el núcleo. Evaluar scripting
   para custom servers (Rhai/Lua/WASM — decidir con prototipo en M3) para que
   un server custom agregue comandos/quests/comportamientos sin forkear.
7. **APIs para gestión y tools.** Admin API completa y documentada (moderación,
   game data, economía, métricas): los custom servers deben poder construir
   paneles, bots y herramientas contra ella.
8. **Uso de datos con criterio.** Schema normalizado, índices por patrón de
   acceso real (no especulativo), prohibido N+1, paginación en todo listado,
   proyecciones (traer solo las columnas que el caso de uso necesita).
9. **Testabilidad como consecuencia del diseño.** Dominio testeable unitario
   sin DB ni red (los puertos se mockean). Adapters con integration tests. El
   cliente vanilla M1 es el validador end-to-end contra AMBOS backends (JS y
   Rust): paridad observable, no prometida.
10. **Seguridad en el borde.** Nunca confiar en el cliente: validación de todo
    input en el servidor, rate limiting, tokens de sesión con expiración,
    autorización por acción y no por pantalla.

## Milestones

Cada milestone termina con algo **jugable/usable**. No se arranca el siguiente
sin cumplir el criterio de salida del anterior. Una branch por milestone.

### M1 — Backend único JS (single stack)

1. **Baseline**: levantar el stack original (Docker Postgres) y verificar que el
   juego funciona. Sin esto no hay referencia para comparar.
2. **Port Postgres → SQLite**: HECHO (ver "Estado M1" abajo).
3. **Unificación de backend en Hono**: HECHO.
   - Endpoints de Express → Hono. API routes de Next absorbidas en `/api/*`
     con sesión por cookie httpOnly. Game server ws en el mismo proceso.
4. **Cliente vanilla** (EN CURSO):
   - Pantallas mínimas: login, registro, crear/seleccionar personaje, jugar.
     Nada de wiki/ranking/SEO/arenas (queda fuera, "nada fancy").
   - Motor Pixi portado (`components/game/*` sin los .tsx de React), bootstrap
     y HUD con DOM vanilla.
   - Auth: cookie de sesión contra `/api/*` del backend Hono.
5. **CLI**: HECHO. `api/src/unified.ts` con `--serve`, `--port`, `--game-port`,
   `--db`.

**Criterio de salida**: `resu --serve` levanta todo con un solo archivo SQLite,
sin Docker ni Postgres, y dos clientes en LAN se ven, caminan y combaten.

#### Estado M1 — avances (2026-09-01/02)

- **Port SQLite (HECHO)**: `DB_BACKEND=sqlite` + `SQLITE_PATH` (default
  postgres, upstream-compatible). Adaptador `api/src/sqliteDb.ts` sobre
  `node:sqlite` (cero deps nativas), schema consolidado `api/schema.sqlite.sql`
  (31 tablas, sin cruft de migraciones), normalización de tipos por
  declared-type (BOOLEAN/TIMESTAMPTZ/JSONB/BIGINT matchean el output del driver
  pg). Interfaz `DbPoolLike` en `api/src/db.ts` — nivel driver, no dominio
  (las interfaces de dominio son diseño de M3).
- **Hono (HECHO)**: Express eliminado. Capa de cookies del Next absorbida en
  `/api/*`. 70/70 tests (3 nuevos de cookie-session) en AMBOS backends.
- **Proceso unificado (HECHO)**: `unified.ts` bootea API + game server ws en un
  solo proceso; validado end-to-end contra SQLite con 70/70 tests.
- **Cliente vanilla (HECHO, 2026-09-02)**: paquete `client/` (TS + esbuild +
  Pixi + Howler, cero frameworks). Vistas: login/registro/lista de personajes/
  crear/jugar, UI en español, tema oscuro, hash router. Motor Pixi portado de
  `frontend/components/game/` (módulos framework-free copiados; glue React
  reescrito a mano: `core/gameClient.ts`, `rendererBootstrap.ts`,
  `session/gameSession.ts`, etc.). HUD en DOM (HP/mana/oro/nivel/pos/ping/FPS,
  chat). Modales fancy (trade/market/crafting/retos/bail/admin) → stub
  "no implementado". Mapa completo del port en `client/README.md`.
  Verificado headless (Chromium CDP): render del mundo, caminar, chat, HUD.
- **Prueba E2E unificada (HECHA, 2026-09-02)**: `unified.ts --serve` sirviendo
  `client/dist` + API + ws en un proceso contra `data/resu.sqlite`. Suite
  70/70 (un test de stress de clanes necesitó timeout elevado: crea 50
  cuentas por HTTP y contra el proceso unificado supera 60s — limitación del
  test, no del sistema). Handshake ws verificado a nivel paquete: spawn en
  Ullathorpe, snapshots de área (NPCs/items), movimiento confirmado, chat
  round-trip.
- **Pendiente de validación humana**: partida LAN real con dos navegadores.
- **Divergencias conocidas del backend SQLite**:
  - Reloj: SQLite usa el clock del proceso, PG el del server (irrelevante en
    single-host).
  - Concurrencia: SQLite serializa escrituras con mutex (single-writer). OK para
    server local/LAN; NO es equivalente a PG bajo carga concurrente pesada.
  - Multi-proceso sobre el mismo archivo: WAL + busy_timeout 5s; `ensureSeeded`
    puede duplicar revisiones si dos procesos bootean una DB fresca a la vez
    (deployment single-instance: no aplica).
  - Timestamps TEXT ISO con formato exacto `%Y-%m-%dT%H:%M:%fZ` — cualquier
    escritor futuro (scripts, SQL manual) DEBE usar ese formato o las
    comparaciones se rompen silenciosamente.

### M2 — App de escritorio Linux

- **Tauri** (webview del sistema, sin Chromium embebido — lo más liviano posible
  sin escribir GUI nativa, que contradiría tener un cliente JS).
- El backend M1 corre como sidecar de Node empaquetado.
- Modos: **host** (levanta server, otros entran por LAN — UPnP opcional para
  internet) y **join** (pegar IP/URL de un server).
- Nota: M2 tiene fecha de vencimiento (M4 lo reemplaza). Es el puente para
  distribuir algo usable mientras exista el cliente JS.

**Criterio de salida**: un `.AppImage`/binario que un amigo baja, abre, y hostea
o se une a una partida sin instalar nada más.

### M3 — Backend Rust (la base definitiva del servidor)

Reescritura del backend M1 bajo los "Principios de arquitectura" de arriba.
No es un port línea por línea: es la reconstrucción del servidor con la
arquitectura que el código original nunca tuvo.

**Estructura (workspace de crates):**

- `resu-domain` — reglas del juego puras (combate, NPCs, crafting, clanes,
  economía, facciones). Sin I/O. Testeable al 100% sin DB ni red.
- `resu-protocol` — definición del protocolo binario ws + tipos de la API HTTP.
  Una sola fuente de verdad, compartida con el cliente nativo (M4). Spec
  versionada publicada en markdown.
- `resu-store` — traits de persistencia por agregado + adapter SQLite (sqlx,
  mismo schema del M1). Segundo adapter (postgres) solo si aparece la necesidad
  real.
- `resu-server` — capa de aplicación: axum + tokio, ws, ejecución de efectos,
  schedulers, admin API (OpenAPI).
- `resu-ext` (evaluar) — scripting para custom servers (Rhai/Lua/WASM,
  prototipar antes de comprometer).

**Plan de migración por módulos** (referencia: ~34k LOC TS en `server/src/` +
repositorios de `api/`): auth/sesiones → personajes/persistencia → mapas/mundo →
movimiento → NPCs → combate → items/inventario → economía (mercado/bóvedas) →
clanes/facciones → crafting/skills → admin/moderación. Cada módulo se valida
con el cliente vanilla M1 contra el backend Rust: **paridad observable, no
prometida**.

**Test de humo del milestone**: el cliente vanilla del M1 funciona contra el
backend Rust SIN ningún cambio — protocolo ws + API HTTP como contrato, dos
backends intercambiables con el mismo archivo `.sqlite`.

**Criterio de salida**: paridad funcional con M1; `resu-rs --serve` sirve el
mismo cliente y la misma DB; dominio con cobertura unitaria; spec del protocolo
publicada.

### M4 — Cliente nativo Rust

- Motor 2D liviano: **macroquad** o **ggez** (prototipar y decidir; Bevy solo si
  hace falta, probablemente no).
- Reutiliza el crate `resu-protocol` del M3 — cero duplicación de protocolo
  entre servidor y cliente (principio 3).
- Mismos principios de arquitectura: lógica de cliente (estado del mundo,
  predicción, interpolação) separada del render y del I/O; input como puerto;
  assets detrás de un trait `AssetLoader` (permite packs custom / HD).
- Assets: reutilizar gráficos/sonidos/mapas del proyecto.
- Alcance inicial: paridad con el cliente vanilla (moverse, combatir, chat,
  inventario). Lo fancy después.

**Criterio de salida**: binario nativo Linux que se conecta a un server M1/M3 y
es jugable. Acá M2 queda deprecado.

## Estimaciones honestas

- M1: semanas. El riesgo grande es el cliente vanilla (cuánto glue React hay
  que rehacer), no el port de DB.
- M2: días sobre M1 terminado (empaquetado, no features).
- M3: meses de laburo hobby (34k LOC de lógica de juego + la disciplina de
  arquitectura). Es el corazón del proyecto.
- M4: meses. Reimplementar el motor de render/input/protocolo.

## Gestión

- Repo local en `~/src/resu`, upstream como remoto de solo referencia.
- Una branch por milestone, PR/merge local al terminar cada uno.
- No refactors fuera de scope: cada cambio persigue el criterio de salida del
  milestone activo.
- Las decisiones de arquitectura se documentan acá ANTES de implementarlas
  (este archivo es el contrato; el código lo ejecuta).
