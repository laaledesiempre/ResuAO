# ROADMAP — Resu (fork unificado de dcatanzaro/aoweb)

Objetivo final: Argentum Online jugable en Linux de forma nativa, con backend
unificado, sin Next.js, sin Postgres, y a largo plazo backend + cliente 100% Rust.

**Visión de largo plazo**: si M3/M4 salen bien, este AO en Rust es la base de AO
para futuras generaciones: extensible, modificable e infinitamente pluggeable.
Todo vía APIs e interfaces — los clientes ganan flexibilidad, los custom servers
ganan tools para gestionar sistemas, y la comunidad puede construir encima sin
forkear el núcleo.

Rol de cada etapa:

- **M1/M1.5 — saneamiento del stack + fidelidad al VB6.** M1 reemplazó Next.js
  por un proceso único (Hono + SQLite + cliente vanilla). M1.5 completó las
  mecánicas de gameplay tomando los valores/mecánicas/textos del servidor VB6
  libre (ao-libre/ao-server y, donde falta, el código oficial SourceForge):
  nada inventado por nosotros.
- **M3/M4 — la base definitiva.** Reescritura en Rust con excelencia de
  ingeniería como requisito, no como deseo (ver "Principios de arquitectura").

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

### M1 — Backend único JS (single stack) ✅

- [x] **Baseline**: stack original (Docker Postgres) verificado funcionando.
- [x] **Port Postgres → SQLite**: `DB_BACKEND=sqlite` + `SQLITE_PATH`,
  adaptador `api/src/sqliteDb.ts` sobre `node:sqlite`, schema consolidado
  `api/schema.sqlite.sql` (31 tablas), normalización de tipos por declared-type.
- [x] **Unificación de backend en Hono**: Express eliminado; API routes de Next
  absorbidas en `/api/*` con cookie httpOnly; game server ws en el mismo proceso.
- [x] **Cliente vanilla**: paquete `client/` (TS + esbuild + Pixi + Howler, cero
  frameworks). Login/registro/crear/seleccionar/jugar, motor Pixi portado, HUD
  en DOM, ventanas de juego (trade/mercado/banco/crafting/retos) funcionales,
  admin web con branding configurable y gestión de cuentas (alta incluida).
- [x] **CLI**: `api/src/unified.ts` con `--serve`, `--port`, `--game-port`, `--db`.
- [x] **Distribución**: imagen Docker all-in-one (`Dockerfile` en raíz, SQLite
  en `/data`, mapas y assets incluidos) con CI en Forgejo; cliente con
  `RESU_API_URL`/`RESU_WS_URL` en runtime.
- [x] **Toolchain**: monorepo npm workspaces (un lockfile, un `node_modules`,
  cero pnpm), deps actualizadas (TypeScript 7), paquetes muertos eliminados
  (axios/https/lodash), 0 vulnerabilidades, dump SQL legacy eliminado.
- [ ] **Criterio de salida**: `resu --serve` levanta todo con un solo archivo
  SQLite, sin Docker ni Postgres, y dos clientes en LAN se ven, caminan y
  combaten. ✅ a nivel sistema (E2E headless verificado); **falta solo la
  validación humana de una partida LAN real con dos navegadores.**

### M1.5 — Fidelidad al AO clásico (VB6)

Fuente de verdad: ao-libre/ao-server (y código oficial SourceForge donde ao-libre
no tiene el feature). Regla: valores, mecánicas y textos del VB6; lo que no
existe en el VB6 no se inventa.

**Vitales y estados**

- [x] Hambre/sed (intervalos Server.ini 6500/6000 ms, −10 por tick, sin daño de
  HP; bloquea aprender hechizos de pergamino; restauración fija por objeto con
  los valores de `obj.dat`).
- [x] Veneno (1–5 HP cada 500 ms, sin expiración; Toxina lo aplica; Antídoto
  Mágico y Poción Violeta lo curan; NPCs venenosos al 30%).
- [x] Stamina/energía (creación VB6, regen solo con hambre/sed > 0, consumo al
  trabajar con texto exacto).
- [x] Skills 0–100 progresivos (fórmula `SubirSkill` exacta, ELU = 200×1.05^s,
  chance de trabajos del Server.ini; suben pescando/talando/minando/combatiendo).
- [x] Skillpoints (10 iniciales, +5 por nivel igual para todas las clases, gate
  "Para poder entrenar un skill debes asignar los 10 skills iniciales.",
  asignación desde el tab Skills). Reemplaza al sistema de puntos de atributo
  (el VB6 no lo tiene; eliminado).

**Mundo y NPCs**

- [x] Guardias que atacan criminales (y del caos a ciudadanos), `GuardiasAI`.
- [x] Entrenador NPC (criaturas de `NPCs.dat`, `/ENTRENAR` + ventana).
- [x] Monturas (5 de `obj.dat`, cooldown 10 s, velocidad ×0.75, desmonte al
  atacar/castear/morir, gráficos del ao-cliente).
- [x] Mascotas/doma (`/DOMAR`: Carisma × skill, 20%, máx 3, 50 criaturas
  domables, siguen y pelean con el amo, mueren si el amo muere).
- [x] Oficios: carpintería alineada 1:1 con `ObjCarpintero.dat` (34 recetas),
  mensajes exactos de `Trabajo.bas`.

**Combate y economía**

- [x] Robar (`/robar`: tabla de suerte por skill, stamina 15, reglas de
  seguro/Armada/Caos/zona segura, textos por género).
- [x] Apuñalar como skill (fórmulas de chance por clase de `SistemaCombate.bas`).
- [x] Correo entre jugadores (`ModCorreo.bas` oficial: 60 mensajes, aviso de no
  leídos al loguear, ventana listar/leer/enviar/borrar).

**Ambiente y UI**

- [x] Música por mapa (`musicNum` de los `.dat`, enviado como el `PlayMidi` del
  VB6 en cada cambio de mapa).
- [x] Lluvia (`/lluvia` GM, toggle global, overlay + sonido del ao-cliente,
  226 mapas con lluvia de `FK.ind`).
- [x] HUD: mini-barras hambre/sed/stamina, badges de estado (Paralizado,
  Inmovilizado, Envenenado, buffs con countdown, cooldown de montura), tabs
  Stats/Skills/Misc., ventanas entrenador y correo, gritar con prefijo `-`.

**Descartado por no existir en el VB6** (verificado en el código): alquimia,
robo a NPCs, peso de inventario, niebla, ranking in-game (está el ranking web),
puntos de atributo por nivel, lluvia drenando stamina (código muerto en VB6).

#### Pendientes conocidos (M1.5)

- [ ] Validación humana de partida LAN con dos navegadores (criterio M1).
- [ ] Verificación del build Docker en CI de Forgejo (no hay daemon local).
- [ ] Convertir los MIDIs del ao-cliente a `.ogg` en `client/public/music/<n>.ogg`
  (el mecanismo de música por mapa ya los espera; no había sintetizador).
- [ ] Adjuntar items por correo (campos `item`/`itemCount` ya en tabla y
  protocolo; falta UI + `RetirarItemCorreo`).
- [ ] Sonido de lluvia "bajo techo" (`lluviain.wav`): falta enviar triggers por
  tile al client (hoy suena siempre la variante exterior).
- [ ] Reimportar game data en DBs ya seedeadas (`import-game-data -w api`) para
  criaturas del entrenador, monturas, `domable` y recetas de carpintería.
- [ ] Skill Defensa (bloqueo con escudo): el VB6 tiene doble roll de rechazo;
  Resu lo funde en la evasión.
- [ ] Subida por uso de Meditar/Ocultarse/Supervivencia (la infra `subirSkill`
  ya los soporta; falta enganchar los eventos).
- [ ] Consumo de stamina en crafting (el VB6 lo cobra en construir/upgrade).
- [ ] Clases Ladrón/Pirata/Trabajador: no existen en Resu; sus ramas VB6
  (robo mejorado, guantes de hurto, menor costo de stamina al trabajar) quedan
  portadas pero inalcanzables.
- [ ] NPC "Oso Polar" (165 de NPCs.dat, domable) no existe en los datos de Resu.
- [ ] Verificar recetas de herrería y sastrería contra `obj.dat` (sastrería no
  tiene fuente VB6; herrería no fue auditada).
- [ ] Buzones de mapa (`otCorreo = 47`) para abrir el correo clickeando el
  objeto, como el VB6 (hoy es botón en Acciones).
- [ ] Montura: persistir `monturaEqpSlot` en charfile (detalle VB6 menor; hoy se
  desmonta al desconectar como el VB6).
- [ ] Revelar al oculto al gritar y gritos de GM invisibles por consola
  (detalles del `HandleYell` VB6).
- [ ] Mensajes de fallo de trabajos ("No has pescado nada!") con dedup
  `UltimoMensaje` del VB6.
- [ ] Mascotas atacando usuarios a orden del amo (`AllMascotasAtacanUser`).
- [ ] Guardias con spells: verificar que los datos de los Guardia Imperial
  incluyan sus spells del `NPCs.dat`.
- [ ] Bonus de zona segura en harvesting (`safeZoneBonus`) es preexistente y NO
  es del VB6: revisar si se mantiene.

### M2 — App de escritorio Linux

- [ ] **Tauri** (webview del sistema, sin Chromium embebido — lo más liviano
  posible sin escribir GUI nativa, que contradiría tener un cliente JS).
- [ ] El backend M1 corre como sidecar de Node empaquetado.
- [ ] Modos: **host** (levanta server, otros entran por LAN — UPnP opcional para
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

- [ ] `resu-domain` — reglas del juego puras (combate, NPCs, crafting, clanes,
  economía, facciones). Sin I/O. Testeable al 100% sin DB ni red.
- [ ] `resu-protocol` — definición del protocolo binario ws + tipos de la API
  HTTP. Una sola fuente de verdad, compartida con el cliente nativo (M4).
  Spec versionada publicada en markdown.
- [ ] `resu-store` — traits de persistencia por agregado + adapter SQLite
  (sqlx, mismo schema del M1). Segundo adapter (postgres) solo si aparece la
  necesidad real.
- [ ] `resu-server` — capa de aplicación: axum + tokio, ws, ejecución de
  efectos, schedulers, admin API (OpenAPI).
- [ ] `resu-ext` (evaluar) — scripting para custom servers (Rhai/Lua/WASM,
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

- [ ] Motor 2D liviano: **macroquad** o **ggez** (prototipar y decidir; Bevy
  solo si hace falta, probablemente no).
- [ ] Reutiliza el crate `resu-protocol` del M3 — cero duplicación de
  protocolo entre servidor y cliente (principio 3).
- [ ] Mismos principios de arquitectura: lógica de cliente (estado del mundo,
  predicción, interpolación) separada del render y del I/O; input como puerto;
  assets detrás de un trait `AssetLoader` (permite packs custom / HD).
- [ ] Assets: reutilizar gráficos/sonidos/mapas del proyecto.
- [ ] Alcance inicial: paridad con el cliente vanilla (moverse, combatir, chat,
  inventario). Lo fancy después.

**Criterio de salida**: binario nativo Linux que se conecta a un server M1/M3 y
es jugable. Acá M2 queda deprecado.

## Estimaciones honestas

- M1: ✅ terminado (a falta solo de la validación humana de una partida LAN).
- M1.5: ✅ terminado (pendientes menores listados arriba).
- M2: días sobre M1 terminado (empaquetado, no features).
- M3: meses de laburo hobby (34k LOC de lógica de juego + la disciplina de
  arquitectura). Es el corazón del proyecto.
- M4: meses. Reimplementar el motor de render/input/protocolo.

## Gestión

- Repo local en `~/src/resu`, espejado en Forgejo (CI + registry de imágenes)
  y GitHub; upstream como remoto de solo referencia.
- Una branch por milestone, PR/merge local al terminar cada uno.
- No refactors fuera de scope: cada cambio persigue el criterio de salida del
  milestone activo.
- Las decisiones de arquitectura se documentan acá ANTES de implementarlas
  (este archivo es el contrato; el código lo ejecuta).
