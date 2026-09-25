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
- ~~**Leaderboard** is local to the browser until Phase 10's `/api/scores`.~~ Done in 08b (below).
- The tutorial runs on the first real stage (E) and the practice stage is offered as "Practice site"; there is
  no separate tutorial-only mini stage.

---

## Phase 08b: Phase 10's leaderboards, ranking UI and ghosts wired into the game

- **Agent:** Claude Opus 5.5 (1M context), Claude Code sub-agent in an isolated git worktree
  (branch `worktree-agent-aa1178db08b0ba9b8`).
- **Start / end:** 2026-09-25 ~10:05Z → ~10:45Z.
- **Environment:** as above (macOS, Apple M5 Max, Node 26, pnpm 11.5, Vite 8.3, wrangler 4.140, Playwright 1.63).

### Instructions received (summary)
- Swap the game to the HTTP leaderboard (contracts §7): the stage board on the Result screen, the global run
  board on the Ranking screen (E: session totals, `[a-z0-9_]` names, skip = not submitted). Submit a
  `VersionedReplay` recorded from the game's input; confirm it re-simulates to the same result, or record the
  stream the sim actually consumed, or submit unverified. Measure and document. Fall back to the device when the
  API is unreachable.
- Mount Phase 10's `Leaderboard`, `NameEntry`, `ShareButton` and `ChallengeBanner`, restyled to the Phase 08
  look (`impeccable` skill).
- "Race the #1 run" toggle on the stage intro/countdown when the ghost endpoint has a track (`createGhostBall`);
  challenge links `/s/:id?beat=&by=` → `/play/:id` with a banner.
- E2E: replay run → name → stage board and run board; ghost toggle renders a ghost; offline fallback. Screenshots
  `docs/build-log/assets/phase-08/b-*`. Ownership: `apps/web/src/{game,ui,ranking,i18n}/**`, `apps/web/test/**`;
  no `packages/*` or worker edits.

### What was built
- **Boards** (`src/game/leaderboard.ts`, rewritten): `GameBoards` = Phase 10's `createRankingClient()` (6 s
  timeout) plus `LocalRankingClient`, a localStorage board with the same `RankingClient` API and the Worker's
  ordering (best per name, score desc, time asc).
  - A stage's board is on the **server** when the stage came from the Worker (capture-service runs and deep links
    to service stage ids). Stages built in the browser (practice, the offline fixture captures) use the
    **device** board. The session total goes to the server run board only if every stage of the session is a
    server stage and no stage repeats (the Worker checks each stage and refuses duplicates).
  - Network errors, 5xx and 404 at submit → the score is saved and ranked on the device (the player never loses
    a finished game); the server is then skipped for 30 s. `navigator.onLine === false` skips it straight
    away. Name, profanity, plausibility and rate-limit errors go back to the name entry.
  - `?offline=1` forces preservation mode (no scores traffic at all).
- **Replay recording** (`src/game/game.ts`): the `InputSample` of every sim tick of the current attempt, taken in
  the sim's input callback, i.e. exactly what the sim consumed. On `lost` the driver now pauses until the
  respawn, so the tick stream matches `@wwm/physics` `replay()` (which resets on the tick after `lost`).
  Each cleared stage keeps `{physicsVersion: PHYSICS_VERSION, inputs}` (schema `VersionedReplay`), submitted
  with its stage score. Not attached: attempts with a time-up respawn (no sim event, `replay()` can't reproduce
  it) and anything recorded on the worker driver. A 422 "replay mismatch" is resent once without the replay
  (stored unverified), see the timer issue below. Stage `timeMs` is now simulated play time (ticks / SIM_HZ).
- **Physics driver default → lockstep** (main thread, fixed step). N. `?physics=worker` keeps Phase 05's
  free-running worker. Measured cost of one step on the main thread (`scripts/step-cost.ts`, Node, all fixture
  stages): **7–18 µs/step, 0.014–0.036 ms per 60 Hz frame**, so the worker buys nothing for the game.
- **Ghost race**: when a server stage's board has entries, the game fetches the #1 verified run
  (`/ghost` only then: a "none yet" 404 would log a console error) and, if its `physicsVersion` matches,
  re-simulates the track (`recordGhostTrack`) while the intro plays. A "Race the #1 run" toggle (name + score,
  `G` key, `aria-pressed`, persisted) appears on the intro, countdown and map. The ghost ball follows the
  player's own tick clock, so both start at GO. New `look: 'holo'` in `ranking/ghost.ts`: a faint shell in a
  faceted wire cage in the bridge blue, so it reads as "not a ball" next to the player. A small
  "Racing <name>" tag sits bottom-right during play.
- **Challenge links**: `/play/:stageId?beat=&by=` → `ChallengeBanner` (game tone) at the top during the intro
  and countdown of that stage. The result answers it: "You beat mika's 1,500!" (green plate) or
  "17 points short of mika's 1,500.".
- **Result screen**: two columns. The Phase 08 tally stays on the left, and the stage board ("This stage",
  top 8 with times) sits on the right; one column under 900 px. Share is Phase 10's `ShareButton`
  ("Challenge a friend", `?beat=<stage score>`). It links to `/s/:stageId` for server stages (OG card) and to
  `/play/<ref>?beat=` for device stages, whose `/s/` page would 404.
- **Ranking screen**: the E rank ("??" → 1st/1位), total, then Phase 10's `NameEntry` (game tone, i18n,
  `hideScore`). After submitting, it lists each cleared stage's rank with a green "replay verified" tag. The
  right column holds tabs: "All sites" (the run board of session totals, E) plus up to 3 stage boards; "you"
  is highlighted. Device boards say so, with the reason (offline / this site isn't on the ranking server).
- **Phase 10 components** (`src/ranking/**`): optional `labels` (i18n) on all four, `tone: 'game'`, `href`/`text`
  overrides on `ShareButton`, `formatRank` + `headingLevel` on `Leaderboard`, test ids on `NameEntry`,
  `stored`/`note` on `SubmitResult`, a request timeout, and board GETs with `cache: 'no-cache'`: the Worker's
  `max-age=10` otherwise hid the player's own name right after submitting. `VersionedReplay` now comes from
  `@wwm/schema` (it was redeclared).
- **Game tone** (`ranking.css`): chamfered plates on the fog-white `--sky`, Unbounded for ranks, scores and
  headings, Figtree for names (no monospace), the 2013 colour roles. The "you" row is a blue tint plus a
  chamfered YOU chip, not a side stripe. The name field and buttons match `.wwm-btn`. The Phase 08 name bar
  and board table CSS were removed.
- **i18n**: `ghost.*`, `challenge.*`, `boards.*` and the new `ranking.*`/`result.*` strings in en + ja (parity
  test green). The ja rank reads 1位 (the ja share text used to say "1st 位").
- **Names**: `sanitizeName` used to turn other characters into `-` (the 2013 input did), which the scores API
  rejects. It now follows Phase 10's `normalizeName`: spaces → `_`, the rest dropped (N).

### Measurements: does the recorded replay re-simulate?
`scripts/replay-fidelity.ts` plays the practice stage in Chromium with the Phase 05 fixture replay injected,
3× per driver, then re-simulates what the game recorded with headless `replay()`:

| driver | live run | re-simulated recording |
|---|---|---|
| lockstep ×3 | goal, 11 items, 5429 ticks | **goal at tick 5429, 11 items, 0.00 m from the live ball: 3/3 identical** |
| worker #1 | goal, 11 items, 5452 ticks recorded | goal at tick 5397, 11 items, end 0.05 m off |
| worker #2 | goal, 5400 | goal at 5397, 0.02 m off |
| worker #3 | goal, 5386 | **no goal**, end 0.21 m off |

The worker latches the newest input for however many ticks it runs, so the main thread can only approximate the
stream (the frame's input × the frame's ticks). One run in three doesn't even reach the goal when replayed.
Hence lockstep by default, and worker recordings are never submitted. In the e2e the Worker **verified** the
game's lockstep replay (claimed 1484; the Worker's timer rule gives 1479, which is within its 3 s slack).

### Attempts that failed, and why
- **Probing the Worker for every stage** (`HEAD /api/stages/:id`, to give fixture stages server boards when the
  server has them): each 404 is a browser console error ("Failed to load resource"), which G2 forbids. Replaced
  by "server iff the stage came from the Worker". The ghost is fetched only when the board has entries, for the
  same reason.
- **Own name missing from the board right after submitting**: the board GET was served from the HTTP cache
  (`cache-control: public, max-age=10`). Board reads now revalidate.
- **The e2e harness**: `unstable_startWorker` gives no access to bindings and doesn't apply D1 migrations, so the
  scores tables didn't exist. Switched to wrangler's `createTestHarness` (like the Worker's own integration
  tests). It applies migrations, and the e2e seeds `handmade-simple` into R2 + D1 exactly as the build pipeline
  stores a service stage (stage JSON, texture, `runs` + `stages` rows). The phone and room tests pass unchanged
  on it.
- **Space on a focused ghost toggle** also reached the global "skip intro" handler; the toggle stops the event.
- First ghost look (one translucent `MeshBasicMaterial` sphere) read as a flat purple disc over the red island;
  replaced by the holo look.
- Screenshot timing: two shots were taken mid-animation or while the board loaded. The shots now wait for the
  content.

### Manual human interventions
None.

### Test evidence
- `pnpm check`: green. **45 files passed, 2 skipped; 563 tests passed, 12 skipped** (the skips are pre-existing).
- New `test/leaderboard.test.ts` (9 tests): the device board ordering and ranks; server vs device source with
  no probing requests; 201 → server; network failure → device and offline cool-down; 404/5xx → device;
  429 stays an error; a 422 replay mismatch is resent without the replay; ghost only when the board has entries;
  `rankFor`.
- `test/game.e2e.test.ts` (real Worker + Room DO + D1/R2 in workerd, Vite, Chromium), **8/8 in ~135 s**:

  | test | result |
  |---|---|
  | Phase 08 replay run from the title (practice) | exact score as before; ranked **1st on the device** board |
  | **08b** replay run on the service stage | stage board on the result ("No scores yet"); the recorded replay **equals the injected stream tick for tick (5429)** and re-simulates to the same goal tick and items; name → **1st**, `data-source=server`, **"replay verified"**; the name is on the run tab and the stage tab (with 1,484 and 0:45.2); the API returns it on `/api/scores/stage/:id` (`timeMs` = 5429/120 s) and `/api/scores/run`; `/ghost` returns the 5429-tick track |
  | **08b** ghost race on `/play/<id>?beat=1500&by=mika` | banner shows mika; toggle shows "e2e_bot · 1,484 pts", `aria-pressed` false → true; in play the `wwm-ghost` mesh is visible and **moved 6.8 m in 2.5 s**; off in the map removes it |
  | **08b** challenge + stage board | verdict "17 points short of mika's 1,500."; the result's stage board shows e2e_bot; the ranking shows "2nd" before entry (a tie ranks behind the earlier entry) |
  | **08b** offline at the ranking (`context.setOffline`) | ranked **1st on the device** (`data-source=device`), the board shows the name + note "The ranking server can't be reached…", and the name never reached the server |
  | phone pairing, disconnect/resume, build failure | unchanged, pass |

  No console errors or warnings in any of them. The offline test filters only the dev server's own
  lost-connection messages.
- Screenshots (`docs/build-log/assets/phase-08/`, 1440×900 unless noted, `WWM_SHOTS=1`), reviewed:
  `b-01-intro-ghost-challenge`, `b-02-countdown-ghost`, `b-03-play-ghost`, `b-03b-map-ghost`,
  `b-04-ranking-submitted`, `b-05-ranking-submitted-stage-tab`, `b-06-result-board-challenge`,
  `b-07-ranking-entry`, `b-08-ranking-offline`, and `b-09-result-narrow` (820 px).
- Impeccable detector on the changed UI: only the pre-existing, intentional thumbnail colour stripe
  (see Phase 08).
- `vite build`: ok.

### Remaining defects and follow-ups
- **Worker replay timer rule (Phase 10 follow-up / CCR).** `scoreReplayEvents` starts the timer at the first
  POWER press. In the game (E) that holds only on the very first game; after that, the timer starts at GO.
  A player who waits more than about 2 s after GO before pressing POWER therefore gets a 422 "replay mismatch".
  The game resends without the replay, so the score counts but unverified. Proposal: add
  `timerStartTick?: number` to `VersionedReplay` (the game knows it exactly), or have the Worker start the timer
  at tick 0 unless the replay says otherwise.
- **Ghost "none yet" = 404** (CCR): browsers log it as a console error. A `200 null` or `204` would let the game
  ask directly, instead of reading the board first. Also, a board whose top entries are all unverified still
  gets a 404 from `/ghost`.
- **Practice and fixture stages have device boards only.** For global boards (and ghosts) on the curated set,
  build those runs through the Worker (Phase 10's `curate.mjs`) or seed them as service stages at deploy
  (Phase 12). Then deep links point at service ids.
- **`/s/*` isn't proxied by Vite in dev** (`apps/web/vite.config.ts`, not in this phase's paths). Share links
  work in production when the Worker serves `/s/*` (Phase 12 routing).
- **Replay-less attempts:** after a time-up respawn the stage has no replay (stored unverified). An `engine`/
  `physics` "respawn" input marker would fix it (Phase 05).
- **Ghost in the map view** is ball-sized and hard to spot from the map camera. `createGhostBall` supports
  `scale`, but switching the scale with the view isn't wired yet.
- `vite build` warns that `ranking/ghost.ts`'s dynamic `import('@wwm/physics')` is ineffective, because the game
  imports physics statically for the lockstep driver anyway. It's harmless.
- The worker driver (`?physics=worker`) is kept for comparison. If nobody needs it, Phase 12 can drop the second
  Rapier copy from the bundle.
