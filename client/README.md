# Resu vanilla client

No-framework SPA replacement for the Next.js frontend: TypeScript + esbuild +
PixiJS + Howler, plain DOM for UI. Spanish UI text.

## Build & run

```sh
npm install                       # first time (approves esbuild postinstall)
npm run build                     # one-off production build -> dist/
npm run dev                       # watch + serve on http://127.0.0.1:8080
npm run serve                     # serve dist/ on http://127.0.0.1:8080
npm run typecheck                 # tsc --noEmit
```

The built-in static server (`build.mjs --serve`):

- serves `dist/` with SPA fallback for extension-less routes (real 404s for
  asset paths — the game loader probes candidate URLs and relies on 404s);
- proxies `/api/*` to the Hono API so the client stays same-origin (the API
  only CORS-allows the Next.js origin). Target defaults to
  `http://127.0.0.1:3001`, override with `AO_API_TARGET=http://127.0.0.1:3002`.

Runtime config (set on `globalThis` before the bundle loads):

- `__RESU_API_URL__` — API base URL (default `""` = same origin via proxy);
- `__RESU_WS_URL__` — game websocket (default `ws://127.0.0.1:7666`).

**Important:** the game server on :7666 consumes game tickets against the API
on **:3001** (its `API_BASE_URL`). Tickets issued by the disposable SQLite
test API on :3002 are rejected by the game server, so play requires :3001.

## Screens

Hash router (`src/main.ts`): `#/login`, `#/register`, `#/characters`,
`#/create-character`, `#/play`. Session is restored from the
`resu_session` httpOnly cookie on boot. All API calls use
`fetch(..., { credentials: "include" })`.

The play view builds a plain-DOM HUD (HP/mana bars, gold, level, position,
ping, FPS, chat log + input) around the Pixi canvas.

## Architecture map (what came from where in `frontend/`)

Copied **verbatim** (only import-path adjustments where noted):

| `client/src/...`                              | from `frontend/...`                       | notes |
|-----------------------------------------------|-------------------------------------------|-------|
| `lib/aowProtocol.ts`                          | `lib/aowProtocol.ts`                      | binary protocol, packet builders/parsers |
| `lib/sound.ts`                                | `lib/sound.ts`                            | Howler wrapper (steps, FX, music) |
| `lib/viewport.ts`, `lib/hotkeys.ts`, `lib/runtime-config.ts`, `lib/character-settings.ts`, `lib/number-format.ts`, `lib/clientDiagnostics.ts` | same paths in `lib/` | support modules |
| `lib/characterCreation.ts`, `lib/name-validation.ts` | same paths in `lib/`           | class/race/gender/head data + name rules |
| `types/game.ts`                               | `types/game.ts`                           | shared types |
| `utils/gameLoader.ts`                         | `utils/gameLoader.ts`                     | asset JSON loaders |
| `components/game/engine/Engine.ts`            | same                                      | 3k-line game engine, untouched |
| `components/game/rendering/*.ts`              | same                                      | scene/character/FX renderers; `characterRenderer.ts` imports `RefObject` from `../vanilla` |
| `components/game/input/`, `network/`, `config/`, `state/`, `assets/` | same                 | targeting, packet queue, ping, timing, preload |
| `components/game/session/handleIncomingGamePacket.ts`, `incoming*.ts`, `incomingPacketTypes.ts`, `createIncomingPacketContext.ts` | same | full incoming-packet pipeline, reused as-is |
| `public/init/ maps/ graphics/ sounds/ static/{graphics,maps_local,spells}` | `frontend/public/...` | game assets |

**Ported** (React hooks/components rewritten as vanilla functions/classes;
`useCallback`/`useRef` become the identity shims in
`components/game/vanilla.ts`, refs stay `{ current }` objects):

| `client/src/...`                              | from `frontend/...`                       | notes |
|-----------------------------------------------|-------------------------------------------|-------|
| `components/game/core/assetPipeline.ts`       | `core/useAssetPipeline.ts`                | mechanical |
| `components/game/core/sceneController.ts`     | `core/useSceneController.ts`              | mechanical |
| `components/game/core/movementSync.ts`        | `core/useMovementSync.ts`                 | mechanical (client-side prediction + reconciliation) |
| `components/game/core/hudStateController.ts`  | `core/useHudStateController.ts`           | mechanical |
| `components/game/core/remoteEntityController.ts` | `core/useRemoteEntityController.ts`    | mechanical |
| `components/game/core/combatController.ts`    | `core/useCombatController.ts`             | mechanical; debug-mode effect dropped (fixed at construction) |
| `components/game/core/keyboardGameplay.ts`    | `core/useKeyboardGameplay.ts`             | the listener effect becomes `attachKeyboardGameplay()` returning a cleanup |
| `components/game/core/rendererBootstrap.ts`   | `core/useRendererBootstrap.ts`            | the mount effect becomes `bootstrapRenderer()` returning a dispose fn |
| `components/game/core/rendererShared.ts`      | module scope of `core/MapRendererCore.tsx` (lines 91-130, 250-653) | dialog bubbles, cast bars, step sounds, helpers |
| `components/game/core/npcAdminTools.ts`       | `core/useNpcAdminTools.ts`                | admin actions kept; context-menu UI state is a no-op |
| `components/game/core/gameClient.ts`          | `core/MapRendererCore.tsx`                | the orchestrator: refs as fields, effects as explicit wiring; map-change re-bootstrap replaces the `[mapNumber]` effect |
| `components/game/session/gameSession.ts`      | `session/useGameSession.ts`               | websocket lifecycle, ping, packet queue |
| `components/game/session/outgoingRequests.ts` | `session/useOutgoingRequests.ts`          | the 21 request effects become explicit methods |
| `components/game/diagnostics/clientInputDiagnostics.ts` | `diagnostics/useClientInputDiagnostics.ts` | mechanical |
| `components/game/admin/npcInspector.ts`       | `admin/npcInspector.tsx`                  | minus the JSX item-graphic renderer |
| `game/bootstrap.ts`                           | `app/play/page.tsx` (connection flow)     | ticket -> `GameClient` wiring |
| `spritePreview.ts` + `views/createCharacter.ts` | `components/CreateCharacterView.tsx` + `CharacterSpritePreview.tsx` | 2D-canvas body+head preview instead of Pixi |
| `views/login.ts register.ts characters.ts play.ts` | `app/*/page.tsx`                     | rewritten as plain DOM |

## What works (verified)

- Register/login/logout/session-restore/character create/select/game-ticket
  against the live API (curl + headless Chromium end-to-end).
- Play: websocket handshake with ticket, world render (map, NPCs, items,
  roofs), own character on screen with name label, WASD/arrow walking with
  client prediction + server reconciliation, other-entity sync, chat send +
  receive, HP/mana/gold/level/position HUD, ping + FPS, seguro indicators,
  step sounds via Howler, dialog bubbles/cast bars/FX overlays, map-change
  transition (re-bootstrap), death-world grayscale.
- Headless e2e: `test/e2e.mjs` (login -> play -> walk -> chat -> screenshot)
  and `test/e2e-create.mjs` (create-character flow). Packet-level probes:
  `test/handshake.ts`, `test/movement.ts` (bundle with esbuild and run with
  node; see comments in each file).

## What is stubbed / not implemented

- Trade, market, retos, bail (fianza), crafting, admin intervals/overview,
  character-stats modal: their state emissions show a
  "no implementado en este cliente" chat notice (state is logged to console).
- NPC context menu / inspector modal (admin) — actions exist in
  `npcAdminTools.ts` but there is no UI.
- Inventory/spell/macro HUD panels, hotbar, buff sidebar — HUD data is
  maintained (`playerHudRef`) but only the bars/gold/level/pos are rendered.
- Stamina bar: the protocol's `PlayerHudState` has no stamina field, so the
  HUD shows HP and mana only.
- Runtime timing config fetch (`/api/runtime-config`) — the client uses
  `DEFAULT_RUNTIME_TIMING`; hotkey remapping UI also omitted (defaults used).
- Arenas (typeGame=2) — the connection always sends typeGame=1.
- Sound volume control UI (master volume fixed at 1).

## Notes for maintainers

- `process.env` is defined as `{}` at build time (esbuild `define`) for the
  few `NEXT_PUBLIC_*` reads in ported code; all have safe fallbacks.
- `build.mjs` copies `index.html` + `public/` into `dist/` on every build.
- The `frontend/`, `api/`, `server/` trees are untouched; everything the
  client needs was copied into `client/`.
