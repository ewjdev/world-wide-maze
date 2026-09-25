# Build log: Phase 10 (Showcase: history, build record, "how it's made", leaderboards, sharing)

- **Agent:** Claude Opus 5.5 (1M context), run as a Claude Code sub-agent in an isolated git worktree (branch `worktree-agent-ad544bb823e25475d`).
- **Start / end:** 2026-09-25 ~09:00Z → ~09:50Z.
- **Environment:** macOS (arm64), Node 26.0.0, pnpm 11.5.0, wrangler 4.140.0 (workerd), Vite 8.3.1, Playwright 1.63 Chromium (Metal ANGLE, WebGPU headless).

## Instructions received (summary)
- Execute `plans/phase-10-showcase.md`; its **G0 updates** win (global run board + per-stage boards, curated items are runs with stars, E/R/N labels, the 501/4 item correction).
- Phase 08 runs in parallel and owns the rest of `apps/web`, including the Result/Ranking screens. Deliver a ranking client and components with a clean API for the orchestrator to wire in later.
- Own `apps/web/src/pages/{about,making,log}/**`, `apps/web/src/ranking/**`, `apps/worker/src/routes/{scores,share}.ts`, new migrations and `content/**`; one-line route registrations allowed. Don't touch `packages/*`.
- Proposals only for anything needing the owner's approval (`content/curated-proposal.md`, ≥ 12 candidates). No publishing, no Cloudflare resources, no deploy, no original 2013 art/audio/logos.
- Scores API: `[a-z0-9_]` names 1–32, profanity filter, rate limit, plausibility, optional replay verification with `@wwm/physics` when `physicsVersion` matches (measure the CPU cost). Integration tests in the Phase 07 harness style.
- Use the `impeccable` skill, screenshot every page into `docs/build-log/assets/phase-10/` and review them.

## What was built
**Worker (`apps/worker`)**
- `migrations/0002_scores.sql`: `scores(stage_id, name, score, time_ms, replay_key, verified, created_at, ip_hash)` per-stage boards, and `run_scores(run_id?, name, total_score, time_ms, stages_json, created_at, ip_hash)` for the global run board (E: 2013 had one global top 10; ours shows 50).
- `migrations/0003_curated.sql`: `curated(run_id, title, url, thumb, stars, position)`, exactly the six columns Phase 07 reads. Created empty; rows only after approval.
- `src/routes/scores.ts` (mounted at `/api/scores`):
  - `POST /api/scores` for `{kind:'stage'}` and `{kind:'run'}` (contracts §7) → `201 {rank, verified?, note?}`.
  - `GET /api/scores/stage/:stageId` and `GET /api/scores/run`: top 50, best entry per name, ordered score desc → time asc → earliest.
  - `GET /api/scores/stage/:stageId/ghost`: the #1 **verified** replay, for "Race the #1 run".
- `src/routes/scores-rules.ts` (pure, unit-tested): name check + profanity filter (leetspeak folding, separator removal, an allowlist against Scunthorpe false positives), plausibility, replay parsing/scoring, daily-salted IP hashing.
  - **Plausibility:** max score = small×1 + large×100 + 5 × ⌊300 − t_min⌋. The physical minimum time t_min = the straight start→goal distance at 30 m/s. That speed is derived (R) from the contract constants: tilt ≤ 45° gives a horizontal pull of ≤ 32.7 m/s², and damping of 1.204/s caps a sliding ball at ≈ 27 m/s. When Phase 09 publishes par times, `stageLimits(stage, par)` also enforces the brief's `time ≥ par × 0.5`.
  - Run submissions: the total must equal the sum of the stage scores; every stage must exist and be plausible. Only the last stage may be an unfinished game over, so it gets no minimum time.
- **Replay verification in workerd:** the replay is re-simulated with `@wwm/physics` `replay()`, then scored with the 2013 rules. The timer starts at the first POWER press and resets on `lost`. The items must match exactly, and the time bonus must be within 3 s.
  - If the replay doesn't match the claimed score, the submission gets `422`.
  - It is stored with `verified = 0` (and a `note`) when:
    - `physicsVersion` differs from the server's
    - the replay is a bare array without a version
    - the replay is longer than 36 000 ticks
  - The replay goes to R2 as `replays/<stageId>/<uuid>.json`.
- `src/routes/scores-wasm.ts`: a scoped shim so Rapier runs in workerd (see "Attempts that failed").
- `src/routes/share.ts` + `share-html.ts`:
  - `GET /s/:stageId?beat=&by=` returns an HTML page with Open Graph and Twitter `summary_large_image` tags, escaped. It meta-refreshes to `/play/:stageId?beat=&by=`.
  - `GET /api/share/:stageId/card` serves the R2 hero shot `share/<stageId>.png`, or 302s to the stage texture.
- Route registration: two lines in `src/router.ts`. Dependencies: `@wwm/physics`, `@dimforge/rapier3d-deterministic-compat@0.20.0` (the same version physics pins).

**Web (`apps/web`)**
- **`/about`** (`pages/about/`): hero with a plan of a real builder stage (GOV.UK, SVG), an object label, credits with source links, the promotional song credit, a timeline, a then-vs-now tech table, the **E/R/N table generated at build time from `docs/reference/fidelity-spec.md`** (84 rows in 11 sections, plus the open questions), the 501/4 correction, "tribute, not a restoration", the evidence gaps, and a source list. Every fact lives in `history.ts` with its sources. A test asserts that **every source URL appears in `research/world-wide-maze.md`**.
- **`/making/:stageId`** (`pages/making/`): rebuilds a capture fixture with the real `@wwm/stage-builder` in a Web Worker and scrubs 7 steps, drawn with `@wwm/stage-debugger/draw`:
  1. the page
  2. background
  3. islands
  4. candidate bridges
  5. carved maze
  6. items, rails, start and goal
  7. **the real engine** (fast intro, then map orbit)

  Each step has a verbatim quote from Saqoosha's case study, with a link.
  - `handmade-simple` and 64-hex API stages show the finished-geometry steps only.
  - `?slice=` selects a part of a long page.
  - `?card=1` is a bare 3D view used to render share cards.
- **`/log`** (`pages/log/`): renders every `docs/build-log/*.md` unedited, plus evidence screenshots per phase.
  - The summary restates only what the logs state: phases, model named, logged windows (a small Gantt with overlap made visible), counts of failed attempts and human interventions.
  - Notes: windows overlap and must not be added; orchestration and owner time aren't in the logs; the repo link comes from `VITE_REPO_URL`, else "not public yet".
  - No productivity figures.
- **`src/ranking/`** (for Phase 08 to mount; see `index.ts` for usage):
  - clients: `createRankingClient()` (HTTP) and `createMemoryRankingClient()` (fake for tests, previews and offline play)
  - components: `useLeaderboard` + `<Leaderboard>` (loading, empty, error and "you" states, light/dark tone), `<NameEntry>` (2013 name entry, skip), `<ShareButton>` (Web Share API, else copy link), `<ChallengeBanner>` + `readChallenge()`
  - share helpers: `shareUrl`, `shareText`
  - ghosts: `recordGhostTrack()` + `createGhostBall()` add a translucent ball via `engine.debug().scene`
  - `/dev/ranking` previews every component and state.
- Design: an exhibition-catalogue voice. Paper and ink, Newsreader (reading serif), Instrument Sans (UI), IBM Plex Mono (dates and data only), all self-hosted via `@fontsource`. Accents are the 2013 colour roles (item teal, bridge green, elevator red, rail yellow). E/R/N marks differ by **shape + letter**, not colour alone. Motion is limited to one staggered plan reveal and a step crossfade, both off under `prefers-reduced-motion`.

**Content (`content/`)**
- `curated-proposal.md`: **16 candidates** with URL, why it's a good maze, licence/permission notes and L/M/H risk flags, a suggested first 12, and a pre-release checklist. The news-site fixture is flagged internal-only, and HN and google.com are listed as not proposed.
- `curated.json`: `approved: []`.
- Scripts that print commands instead of touching remote resources:
  - `scripts/curate.mjs`: builds the approved runs via the Worker and writes an upsert SQL.
  - `scripts/render-cards.mjs`: renders 1200×630 cards with the engine.
  - `scripts/export-pack.mjs`: offline pack of `stage-i.json` + texture + manifest.
  - `scripts/showcase-shots.mjs`: the screenshots below.
- `content/out/` is git-ignored because it holds third-party screenshots.

## Attempts that failed, and why
1. **Rapier in workerd:** the first verified submission came back `verified:false` with "WebAssembly.instantiate(): Wasm code generation disallowed by embedder".
   - Cause: `@dimforge/rapier3d-deterministic-compat` compiles its inlined base64 WASM at runtime, which workerd forbids.
   - Fix: the package's `dist/rapier_wasm3d_bg.wasm` is **byte-identical** to the inlined copy (sha256 checked in a unit test). Wrangler precompiles it as a module, and a scoped `WebAssembly.instantiate` shim hands that module to Rapier's `init()` only while physics loads.
   - Proper fix: let `loadRapier()` accept a module (Phase 05 follow-up).
2. **Worker tests imported Worker-typed modules** under `tsconfig.node.json`, which failed the typecheck (`R2ObjectBody`, `Env`). Fixed by moving the constants and HTML helpers into pure modules (`scores-rules.ts`, `share-html.ts`).
3. **The `curated` table vs Phase 07's test:** my first migration had 3 extra columns (slug, licence, added_at). Phase 07's integration test inserts 6 values positionally and runs `CREATE TABLE curated`, so 2 tests failed.
   - The table now has exactly the six assumed columns. Licence notes live in `content/curated.json`.
   - Phase 07's test got a one-word change (`CREATE TABLE IF NOT EXISTS`), because the migration now creates the table.
4. **`/log` summary said "0 models, date not stated":** the bold-field regex captured the colon inside `**Agent:**`. Fixed and covered by a test.
5. **Internal news-site fixture (removed before publication) leaking into production builds:** a render-time filter doesn't stop Vite from emitting globbed files, and negative glob patterns didn't exclude them.
   - Fix: character-class globs (`[!b]*`) for captures and log assets.
   - Checked with a clean `vite build`: no news-site screenshot or evidence image is emitted.
   - One news-site file remained, its builder golden, emitted by Phase 04's `/dev/engine` sandbox glob (follow-up).
6. The full-page `/log` screenshot exceeded Chromium's capture limit, so it was replaced by viewport shots. The page also needed a small effect so `#phase-XX` links scroll after client render.
7. Biome: `then` as an object key (renamed `was`), `!important` (replaced with more specific selectors), descending-specificity CSS (reordered, and the anchors got classes), and ARIA-on-plain-element warnings.

## Manual human interventions
None.

## Test evidence
- `pnpm check`: green. 39 test files passed and 2 skipped; **461 tests passed** and 12 skipped.
- `apps/worker/test/scores.integration.test.ts` (workerd via `createTestHarness`, local D1/R2/DO/rate limits, stage seeded into R2, no browser needed), 9 tests:
  - Name validation: format, and profanity including leetspeak and separators. Scunthorpe-style names pass.
  - Plausibility rejects: score above the stage maximum (422), a faster-than-physical time (422), an unknown stage (404).
  - Rate limit: 20 submissions per IP pass, the 21st gets `429 RATE_LIMITED` with `Retry-After`.
  - Ordering: top-N by score desc then time asc, best per name, the returned rank, and the cap at 50.
  - **Replay verification:** the Phase 05 fixture replay (5,429 ticks, 9 small + 2 large, goal) is verified at 1,479 points and becomes the ghost. A +100 lie is rejected (422). A stale `physicsVersion` and a bare array are stored unverified.
  - Run board: the sum check, per-stage plausibility, a game-over last stage, global ordering.
  - Share page: OG and Twitter tags, `beat`/`by` carried, `<script>` escaped, 404, card falls back to a 302 to the texture.
- `apps/worker/test/scores-rules.test.ts`, 12 tests: names, profanity, limits, replay parsing and scoring, tolerance, the headless 1,479 score, WASM byte identity, share helpers.
- `apps/web/test/showcase.test.tsx`, 14 tests:
  - `/about` renders every credit and caveat through the app routes; every source URL is in the research dossier; the 501/4 correction matches `stage-format.md`.
  - The fidelity table parses every section.
  - `/log` renders every build log and the summaries restate the logs.
  - Ranking: the HTTP client error mapping, the memory client, components in every state, ghost interpolation.
- **Replay verification cost (measured):** one 5,429-tick (45 s) replay verified in workerd in **120–135 ms wall time per request, including cold Rapier init** (≈ 22 µs/tick; Node: 117 ms). The cap `VERIFY_MAX_TICKS = 36 000` (5 min at 120 Hz) is therefore ≈ 0.8 s of CPU, well inside the Workers CPU limit.
  - Worker bundle (dry run): 12.1 MB, 3.7 MB gzipped (was 4.0 MB / 0.8 MB). Rapier is loaded lazily per replay request. It fits the Workers Paid 10 MB compressed limit but not Free's 3 MB.
- Screenshots (reviewed): `docs/build-log/assets/phase-10/`
  - `about*.png`, `making-{capture,background,islands,bridges,maze,items,3d,ghost,mobile}.png`, `log*.png`, `ranking*.png`
  - share cards: `cards/govuk-card-grid.png`, `cards/handmade-simple.png` (1200×630, the real engine)
  - `making-ghost.png` shows the ghost ball replaying the fixture run on `handmade-simple`.
- `impeccable` detector (`detect.mjs --json` on pages + ranking): `[]`.

## Remaining defects and follow-ups
- **Ghost race on a curated stage (G3):** the API, the ghost track/ball and a demo (`/making/handmade-simple`, step 7) are done. It still needs Phase 08 to mount `createGhostBall` in `/play`, and a curated stage with a verified #1 replay or a Phase 09 solver replay ("Race the bot").
- **Engine follow-up (Phase 04):** `engine.addGhost({color, opacity})` with the engine's own glow material, instead of an overlay through `debug()`.
- **Physics follow-up (Phase 05):** let `loadRapier()` accept a precompiled `WebAssembly.Module`, so the workerd shim can go.
- **Phase 04's `/dev/engine` sandbox** bundles the news-site fixture's builder golden into production builds (moot since the fixture was removed before publication). Exclude it, or gate the dev routes out of production.
- **Share-card validators** (X/Facebook/LinkedIn) need a public URL, so they weren't run. The evidence is the rendered cards plus the HTML tags asserted in tests. Also:
  - The Worker must serve `/s/*` in production (Phase 12 routing). In Vite dev, `/s/*` isn't proxied.
  - The card is a map-view hero shot. Phase 12 may want a closer, more flattering camera.
- The plausibility minimum time is a physical bound (30 m/s), not the brief's `par × 0.5`. It switches automatically once par times exist, but Phase 09 needs to persist them somewhere the Worker can read.
- IP hashes use a daily-rotating salt derived from the date, not a secret. That's fine for rate limits and purges; a secret salt would be better (Phase 12).
- `/about` can't show original art, audio or logos: no rights. The owner decides whether to ask the rights holders.
- Phase 08 owns `/` and the i18n setup. The showcase pages are English only for now.

## Contract Change Requests
- **CCR-10-1 (schema doesn't match contracts §9 v0.2.2):**
  - Field: `SubmitStageScoreRequest.replay` / `SubmitScoreRequestSchema`.
  - Problem: contracts §9 v0.2.2 says `replay?: {physicsVersion, inputs}`, but `@wwm/schema` 0.2.4 still types it as a bare `InputSample[]`.
  - Workaround: the Worker parses the replay separately and accepts both shapes; a bare array is stored unverified.
  - Request: type it as `{physicsVersion: string; inputs: InputSample[]}`. Consumers: Phase 08 (Result screen submit), this Worker route.
- **CCR-10-2 (additive):**
  - Field: `SubmitScoreResponse`.
  - Request: add optional `verified?: boolean` and `note?: string`. The Worker already returns them.
  - Also: document `GET /api/scores/stage/:stageId/ghost` → `{name, score, timeMs, physicsVersion, inputs}` in §7.
