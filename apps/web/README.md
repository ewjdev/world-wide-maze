# @wwm/web

The desktop game and the phone controller (Vite + React + react-router). Owners: Phase 08 (game shell,
state machine, HUD, audio, i18n), Phase 06 (`src/controller/`), Phase 10 (history / museum pages, `/about`).

## Routes
| Route | What |
|---|---|
| `/` | The game: title (attract orbit of a curated stage) → how-to (first visit) → connect → calibrate → select → building → intro → play → result → ranking |
| `/play/:stageId` | Deep link. `practice`, `fixture-<slug>[~<slice>]` (built in the browser), or a capture-service stage id (the run is found with `computeRunId`, so later slices follow) |
| `/p/:code` | The host joins an existing room code (e.g. after a desktop reload) |
| `/j/:trail` | Phase 13: a shared web journey (light page, no renderer); every stop links to `/play/<ref>` |
| `/c/:code` | Phone controller (Phase 06) |
| `/about` | Placeholder until Phase 10 |
| `/dev/engine`, `/dev/physics`, `/dev/input` | Phase 04 / 05 / 06 sandboxes |

## Architecture (`src/`)
- `game/machine.ts`: the contract `GamePhase` as an explicit transition table. Pure; data-dependent choices
  (first visit, spares left, more slices) arrive in the event payload. Every edge is unit-tested.
- `game/rules.ts`: the 2013 rules, pure: `GameTimer` (E: whole seconds follow `Math.round`, `last30`,
  `timesup`, reset on every respawn), `addScore` (E: +1 spare per 3000 crossed while spares < 3),
  `finishStage` (time bonus 5 × seconds; game over = items only), restart point, name sanitising.
- `game/game.ts`: `Game`, the whole experience outside React. Owns the engine, a `SimDriver`, the input
  sources and the room, audio, and the rules; walks the machine. React reads `view` via `useSyncExternalStore`.
  Per frame: sample inputs → `SimDriver.advance` → events → rules / `engine.handleEvent` / audio / haptics →
  `engine.setBall/setControl/setElevators` → `engine.frame`; `InputSample.frameYaw = engine.cameraYaw()`.
- `game/sim-driver.ts`: `WorkerDriver` (default, `createWorkerSimulation`) and `LockstepDriver`
  (main-thread fixed step, tick-exact; used for injected replays and as a fallback). The game timer advances
  in sim-step time, so a replay's score is deterministic.
- `game/stages.ts`: where stages come from. `PracticeRun` (handmade-simple), `FixtureRun` (a
  `fixtures/captures` page built by `@wwm/stage-builder` in `builder.worker.ts`: the offline / preservation
  path, no server needed), `ApiRun` (`POST /api/stages` → SSE → `done` after slice 0, later slices polled
  from `/api/runs/:id`).
- `game/leaderboard.ts`: `Leaderboard` interface; `LocalLeaderboard` (this browser) until Phase 10 ships
  `/api/scores`; `HttpLeaderboard` is the contract §7 client for that swap.
- `audio/audio.ts`: WebAudio manager, every sound synthesized in code (see `public/audio/CREDITS.md`).
- `i18n/`: i18next, `en` and `ja` complete (key parity is tested). The controller keeps its own table.
- `ui/`: screens and overlays (`Screens.tsx`, `Play.tsx`, `Result.tsx`, `Settings.tsx`, `parts.tsx`) and
  `game.css` (the visual world: `#F8F8F8` sky, 2013 colour roles, chamfered plates, Unbounded + Figtree).

## Rules implemented (labels from docs/reference/fidelity-spec.md)
- E: 300 s timer; starts on the first POWER of the first game, else on entering play; stops for the map,
  falls, the goal and blur; resets to 300 on every respawn; caution + faster BGM in the last 30 s.
- E: 3 spare balls; a fall (on `lost`) or time-up costs one; game over below 0; the respawn is the nearest
  restart point of the last-touched island (the sim's `fell.restartAt`).
- E: small +1 credited 300 ms after pickup, large +100, time bonus 5 × whole seconds; 1UP per 3000 in the run
  total (also during the result count-up); game over scores items only.
- E: runs of slice stages: the result offers Next stage (score and spares carry over) or Finish → ranking;
  after the last slice, "Play another site".
- E: fireworks = round(time left) mod 10; GOAL / TIME IS UP / GAME OVER signs after a tile curtain.
- N: a 3-2-1 countdown on repeat stages (the first game has the tutorial instead); the map's "Retry this
  stage" (removes the stage's points); disconnect → freeze with a reconnect overlay → resume.

## Link portals and web journeys (Phase 13, N)
- Rolling into a portal (`SimEvent portal`) opens "Travel to <label>?" (`ui/Journey.tsx`), pausing the sim and
  the timer. Travel = Enter / Y / the phone's JUMP (after a release); stay = Esc / M / the phone's MENU / N.
- Travel banks the stage (items only, no time bonus; `StageResult.exit = 'portal'`), keeps score and spares, plays
  `engine.playPortal`, and builds the link like a typed URL (`createApiRun`: `POST /api/stages` → SSE → the usual
  error screen). A link to an offline fixture page builds in the browser instead. Machine edge `play → building`
  on `TRAVEL`.
- `/api/health` is probed once per session when a stage has portals; unreachable (or `?offline=1`) greys the gates
  and the prompt says "Needs the online service".
- `game/journey.ts`: the stops (`view.journey`), `/j/<base64url>` share links (validated, ≤ 12 stops). The trail
  shows in the HUD (bottom right), on the building screen, the result and the ranking ("Share my web journey").
- Strings: `ui/journey-strings.ts` (en + ja, registered into i18next at runtime; parity tested).
- Hooks: `__wwmGame.debugRollIntoPortal(id)`, `debugRollIntoGoal()` roll the ball in with the real physics.
- `test/portal.e2e.test.ts`: roll in → prompt → stay → re-arm → travel (mocked `/api`) → the second site loads with
  the score carried → share page; and the offline prompt.

## Testing hooks
Set `window.__WWM_TEST__` before load: `{ replay?: InputSample[], lockstep?, timeScale?, noAutoPause?,
skipIntro? }`. `window.__wwmGame` exposes `debugState()`, `debugSetTimeLeft(sec)`, `getView()`.

## Commands
- Dev: `pnpm --filter @wwm/web dev` (http://localhost:5173, `/api` proxied to `WWM_API_URL` or :8787). The
  game works without the worker (practice + fixture sites; pairing and URL builds need it).
- Tests: `pnpm vitest run --project @wwm/web`. `test/game.e2e.test.ts` boots the real Worker (workerd) and
  Vite and drives Chromium: replay run → exact score, simulated-phone pairing, disconnect/resume, build
  failures. `test/controller.e2e.test.ts` (Phase 06) needs `WWM_E2E_BASE`.
- Screens: `node apps/web/scripts/shots.ts <baseUrl> <outDir>` walks every screen with a simulated phone.
- Thumbnails: `node apps/web/scripts/thumbs.ts` regenerates `public/thumbs/*.webp` from the fixtures.
- Dev probes: `scripts/probe.ts`, `scripts/drive-probe.ts` (keyboard drive / `fall` mode),
  `scripts/replay-probe.ts` (replay run, logs state each second).
