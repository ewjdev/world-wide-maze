# Build log: Phase 08 (Game integration: shell, state machine, HUD, audio)

- **Agent:** Claude Opus 5.5 (1M context), run as a Claude Code sub-agent in an isolated git worktree
  (branch `worktree-agent-a6984b5fa98b464cb`).
- **Start / end:** 2026-09-25 ~08:55Z → ~09:55Z.
- **Environment:** macOS (Apple M5 Max), Node 26.0.0, pnpm 11.5.0, Vite 8.3, React 19.3, three r186.1,
  wrangler 4.140 (workerd), Playwright 1.63 Chromium (real GPU, Metal ANGLE).

## Instructions received (summary)
- Execute `plans/phase-08-game-integration.md`; its **G0 updates** override the earlier text (exact 2013 timer,
  lives, one-up and scoring rules; runs of slice stages; the evidenced HUD layout; signs; audio cue list).
- Wire engine, physics worker, net/controller and the capture API into the game; make it also playable from
  `fixtures/` built client-side (offline / preservation mode); stub the leaderboard behind an interface.
- Required E2E: replay-driven keyboard run with an exact expected score, simulated-controller pairing, build
  failure fallback, disconnect → pause → reconnect → resume.
- Screenshot every screen into `docs/build-log/assets/phase-08/`, look at them, iterate. Use the `impeccable`
  skill. Write a human playtest script (5 fixture stages, keyboard and iPhone, lock/unlock check).
- Ownership: `apps/web/**` except `src/controller/**` and `src/dev/*`; no `packages/*` edits.

## What was built
- **Phase machine** (`src/game/machine.ts`): the contract `GamePhase` as a typed transition table (all 18
  phases). Pure; data-dependent branches (first visit, spares < 0, more slices) come in the event payload.
- **Rules** (`src/game/rules.ts`), all E unless noted, from the recovered bundle (`game/world` Timer @1027009,
  `addScore` @1043673, FLY_AWAY, RESTARTING):
  - `GameTimer`: `remains -= dt`, whole seconds step down to `Math.round(remains)` (verified in the bundle:
    `n=Math.round(this.timeRemains); if(n<this.timeRemainsInt)…`), `last30`, `timesup`, reset to 300 on
    OPENING and every respawn. Runs only in play: stops for the map, falls, fly-away, blur and disconnect (N).
  - Small +1 credited 300 ms after pickup (flushed at the goal), large +100, time bonus 5 × whole seconds
    added at the goal, one spare per 3000 crossed while spares < 3, game over = items only, restart point =
    nearest restart point of the last-touched island (the sim's `fell.restartAt`; own lookup for time-ups),
    fireworks = round(time left) mod 10, nicknames sanitised to `[a-z0-9_]`.
- **Game controller** (`src/game/game.ts`): owns the engine, the sim, the inputs (keyboard + gamepad +
  phone combined; the most recently active wins), the room, audio and rules; React reads a snapshot through
  `useSyncExternalStore`. Engine per-frame calls exactly as the Phase 04 README prescribes; `frameYaw =
  engine.cameraYaw()`; the sim's `goal` is routed to `engine.playGoal(round(timeLeft) % 10)` (not
  `handleEvent`, which would fire a second fly-away with 5 fireworks); `fell/lost/item/landed` go to
  `handleEvent`; `spawnBall(restartAt)` on restart; one fresh canvas per engine; the textured `ImageBitmap`
  is only closed once the engine has replaced it (single-tile stages texture from it directly).
- **Sim drivers** (`src/game/sim-driver.ts`): `WorkerDriver` (default) and `LockstepDriver` (main-thread
  fixed step). The timer advances in sim-step time inside the input callback, so a replay run is tick-exact.
- **Stage sources** (`src/game/stages.ts`): practice (handmade-simple), fixtures built by `@wwm/stage-builder`
  in a Web Worker (`builder.worker.ts`, seed 1, normal; texture cropped per slice with `createImageBitmap`),
  and the capture service (`POST /api/stages` → SSE → `done` after slice 0 → `/api/runs/:id` polled for the
  rest; texture resolved relative to the stage URL). `/play/:stageId` also resolves service stage ids through
  `computeRunId` so the rest of the run follows.
- **Screens** (`src/ui/`): title with the attract orbit (engine map view over Hacker News), how-to,
  connect (Phase 06 `QrCode` + `formatCode`, same test ids as `PairingPanel`), calibrate (15 s, keyboard
  fallback), select (URL bar + practice + 7 saved sites with thumbnails and stars), building (SSE steps),
  error (per code, curated alternatives), intro caption + skip, countdown (N, repeat stages only), HUD
  (E layout; large-item slots; RTT chip on phone; "Too tilted!" with 500 ms hysteresis), tutorial (E steps,
  PC and phone variants with drawn key caps; jump locked until step 4; persisted), map menu (back, retry,
  another site, quit + E confirm), signs (E tile curtain + GOAL / TIME IS UP / GAME OVER), result (E count-up
  10 ms per second ≤ 3 s, point ticks, 1UP pop, share, Next / Finish), ranking (E "??" → rank, name entry,
  top 10, new game / back to top, share), disconnect hold overlay (code + QR + keyboard fallback), unsupported.
- **Visual world** (`src/ui/game.css`, impeccable): the #F8F8F8 fog-white sky, the E colour roles
  (red / green / blue / yellow + item teal + ball ink), COLOR_TRIANGLE facets as the panel material,
  chamfered plates instead of rounded cards, Unbounded (display) + Figtree (UI) self-hosted via
  `@fontsource-variable`, one motion vocabulary (rise, facet curtain, letter drop), reduced-motion support.
- **Audio** (`src/audio/audio.ts`): WebAudio, every SE and the five BGM loops synthesized in code (no files,
  no 2013 audio); impact volume ∝ impact², guardrail throttle 500 ms, rolling loop pitched by speed and silent
  in the air; mute persisted; unlocked on the first gesture. `public/audio/CREDITS.md`.
- **i18n** (`src/i18n/`): i18next, per-mount instance, `en` + `ja` complete (key parity tested), runtime switch.
- **Leaderboard** (`src/game/leaderboard.ts`): `Leaderboard` interface; `LocalLeaderboard` in use;
  `HttpLeaderboard` implements the contract §7 client for Phase 10.
- **Routes**: `/` game, `/play/:stageId`, `/p/:code` (host joins an existing room), `/about` placeholder.
- **Tooling**: `scripts/shots.ts` (walks every screen with a simulated phone), `scripts/thumbs.ts`,
  `scripts/probe.ts`, `scripts/drive-probe.ts` (keyboard drive; `fall` mode), `scripts/replay-probe.ts`.

## Attempts that failed, and why
- **Sign words wrapped mid-word** ("TIME IS U / P") because each letter was a flex item. Letters are now
  grouped per word with `nowrap`.
- **Half-transparent curtain tiles**: a triangle `clip-path` per tile left the game showing through half of
  every cell. Each tile is now a full square split into two pastel triangles by a gradient (E: the curtain
  covers the screen).
- **The result tally stuck on the first row**: one effect scheduled all three row reveals and its own
  cleanup cancelled the later timers when the first fired. Each reveal is now its own step.
- **`.wwm-root p { margin: 0 }` beat every component margin** (specificity 0,1,1), which collapsed the
  disconnect overlay's code onto its button. Now `:where(.wwm-root) p`.
- **`localhost:8080/admin` counted as a URL scheme** (`localhost:`), so the input rejected it before the
  worker could. Only `scheme://` now counts as explicit; everything else gets `https://`.
- **E2E off-by-one**: `replay().goalTick` is 1-based; the first expectation assumed 0-based.
- **Controller double connect (polish backlog):** confirmed dev-only. With the production build (`vite build`
  + `vite preview`) the full walkthrough logs no phone warning; under the dev server React StrictMode's
  double mount logs "WebSocket is closed before the connection is established" once per phone load.

## Manual human interventions
None. The physical-phone session is pending: [phase-08-playtest.md](phase-08-playtest.md).

## Test evidence
- `pnpm check`: green. **42 files, 508 tests passed, 12 skipped** (the skips are pre-existing: Phase 06's
  `controller.e2e` needs `WWM_E2E_BASE`, and reference-data tests). Phase 08 adds 5 test files:
  - `machine.test.ts`: all 47 legal edges, every other (phase, event) pair is illegal, FAIL from anywhere,
    covers every contract `GamePhase`, a full session script.
  - `rules.test.ts`: scoring, one-ups, `finishStage`, fireworks, timer rounding / last30 / timesup / big dt /
    reset / stop, restart points, names, ordinals, the local leaderboard.
  - `stages.test.ts`: URL normalisation, the catalog, i18n key parity and glyph placeholders.
  - `routes.test.tsx` (updated), and **`game.e2e.test.ts`** (real Worker + Room DO in workerd, Vite, Chromium):

    | test | result |
    |---|---|
    | Keyboard full run on handmade-simple with the Phase 05 replay injected (lockstep) | goal at tick **5429** (= Node replay), **255 s** left, 2 large + 9 small → result total **1484** = 1275 + 200 + 9, exactly the Node-replay + rules prediction; ranking "1st" after submit |
    | Pairing with a simulated iPhone (synthetic 60 Hz tilt) | QR = `/c/<code>`, Connected!, calibrate → the phone's `calibrated` advances to select; POWER + 15° tilt for 1.6 s moved the ball 19 m; the phone shows the host's TIME/SCORE/BALLS |
    | Disconnect → freeze → reconnect → resume | phone page hidden → overlay with the code within the 1.5 s silence rule; over 2.5 s the timer, game clock and ball position are bit-identical; phone visible → overlay gone, same timer (< 1.5 s drift), and it runs again |
    | Build failure fallback | `localhost:8080/admin` → real worker 400 → `URL_FORBIDDEN` screen; mocked SSE `CAPTURE_BLOCKED` → error screen with alternatives; the Hacker News alternative is built client-side and plays |

    Runtime about 50 s. No console errors or warnings on the host during the runs (the browser's own
    "Failed to load resource: 400" for the deliberately forbidden URL is the subject of the failure test).
- **Fall / restart path** (`drive-probe.ts practice fall ArrowDown`, worker physics): jump over the rail →
  `falling` → spares 3 → 2 on `lost` → `restarting` 3 s later with the timer back at 300 → `play` at the
  island's restart point (60, 60) px.
- **Screenshots** (`docs/build-log/assets/phase-08/`, production build, 1440×900 unless noted), reviewed by
  eye: `01-title`, `02-howto`, `03-pairing`, `04-connected`, `05-calibrate`, `06-select`, `07-building`,
  `08-intro-fold`, `09-intro-flyover`, `10-play-tutorial`, `11-play-power`, `12-play-hud`, `13-map`,
  `14-map-confirm`, `15-disconnect`, `16-timeup`, `17-play-after-restart`, `18-countdown`, `19-goal`,
  `20-result-tally`, `21-result`, `22-ranking`, `23-ranking-submitted`, `24-gameover`,
  `24b-ranking-after-gameover`, `25-error`, `26-select-ja`, `27-title-ja`, `28-title-narrow` and
  `29-select-narrow` (820 px), `phone-01-select`, `phone-02-play` (emulated iPhone 15 Pro).
- **Lighthouse 12** on the title (production build): accessibility **100**, best practices **100** (after
  adding the favicon and a label for the icon-only sound toggle at narrow widths). The other menus can't be
  reached by a fresh Lighthouse load; they share the same components (labelled controls, visible focus,
  `aria-live` status lines, keyboard focus moved to the primary action on every screen).
- **Impeccable detector** (`detect.mjs` on `src/ui`): one finding, the 4-colour stripe under the site
  thumbnails ("side-tab"). Kept on purpose: it is the four 2013 colour roles as the islands' slab edge, and
  it grows on hover.
- Engine stats during play (M5 Max, headless WebGPU): 60 fps, 47 draw calls, tier 0.

## Fidelity notes (for the About page data)
- E: 300 s timer, whole seconds via `Math.round`, reset on every respawn; 3 spares, game over below 0; small +1
  after 300 ms, large +100, time × 5; 1UP per 3000; fireworks = round(time) mod 10; tutorial steps and copy;
  map pauses physics and timer; blur pauses; E strings from `translation-en/ja.json` (quoted or adapted).
- R: the order "timer starts on the first POWER even before the tutorial reaches step 3" (the bundle starts it
  in `enableOrientation`, which any POWER press calls).
- N: countdown on repeat stages; the map's "Retry this stage" (removes that stage's points); disconnect hold
  with the same code instead of the 2013 reload page; explicit build errors with curated alternatives instead
  of the silent "not available" stage; offline fixture mode; per-stage board records (local until Phase 10);
  the practice stage is the handmade stage, not google.com.

## Remaining defects and follow-ups
- **Physical phone and Android**: pending the human session (script above), including the Phase 06 lock/unlock
  check, which this phase now makes visible (freeze overlay).
- **Konami "takoyaki ball" easter egg**: not done; the engine has no ball-skin API (engine follow-up).
- **Bundle size**: `index` 1.5 MB (three + app) and Rapier twice (worker + the main-thread lockstep fallback,
  loaded lazily). Phase 12 should code-split the dev sandboxes out of the main chunk.
- **Chase camera faces the goal**, so on a top-left → bottom-right stage the page text reads upside down at the
  start (E behaviour, engine `resetToStart`); flag for the playtest.
- **Attract mode** is the map orbit of a fixture stage; swap for Phase 09's solver ghost when it lands.
- **Leaderboard** is local to the browser until Phase 10's `/api/scores`.
- The tutorial runs on the first real stage (E) and the practice stage is offered as "Practice site"; there is
  no separate tutorial-only mini stage.
