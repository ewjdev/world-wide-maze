# Build log: Phase 12 (Launch hardening — local-only portion)

- **Agent:** Claude Opus 5.5 (1M context), run as a Claude Code sub-agent in an isolated git worktree
  (branch `worktree-agent-ad6fc209299547522`), with two read-only helper sub-agents (a security audit of the
  Worker + web app, and a review of this branch's diff).
- **Start / end:** 2026-09-25 ~10:45Z → ~12:00Z.
- **Environment:** macOS 26.6.2, Apple M5 Max, Node 26.0.0, pnpm 11.5, Vite 8.3, wrangler 4.140
  (workerd 1.20260923.1), Playwright Chromium 153, Lighthouse 12.8.2 (via `npx`, npm cache only).

## Instructions received (summary)
Local-only Phase 12 while the user is asleep: **no deploys, no Cloudflare resources, no `wrangler login`/remote
commands, no pushes, no emails**; legal pages are drafts for review; deploy config prepared but inert. Another
agent owns `packages/stage-builder`, `packages/physics`, `fixtures/{builder,replays,eval}`,
`apps/worker/src/{builder,pipeline}.ts` this wave. Tasks: performance report with real measurements only; bundle
(one Rapier copy, code-split the 1.6 MB chunk); security review + fixes (CSP/headers, input limits, DO caps,
stats gate, IP-hash salt); load tests; telemetry hooks + structured logs + runbook; cost model, G4 checklist,
`infra/` + deploy workflow; legal drafts.

## What was built
**Security (Worker)** — `apps/worker/src/security.ts` (new) and small changes in existing routes:
- Security headers on every Worker response (API: `default-src 'none'` CSP, nosniff, DENY, CORP, COOP, HSTS on
  https; share page: inline-style-only CSP). Static assets: `apps/web/public/_headers` (strict CSP with
  `'wasm-unsafe-eval'` for Rapier, Permissions-Policy allowing motion sensors, immutable caching for `/assets/*`).
- Byte-capped body reads that also hold for chunked bodies (`POST /api/stages` 8 KiB, scores 12 MiB, telemetry
  16 KiB) → 413.
- Room DO: binary frames ≤ 64 B and text ≤ 4,096 chars (else close 1009); per-socket token bucket 150/s,
  burst 300 (excess dropped and counted; 600 drops → close 1008); client close reasons sanitised before logging;
  structured JSON log lines; keepalive health logged once a minute instead of every 5 s.
- `GET /api/rooms/:code/stats` only when `ROOM_STATS=1` (dev/test); `"0"` in staging/production (contracts v0.2.3).
- Rate Limiting bindings for room creation (30/min/IP) and WebSocket upgrades (120/min/IP); IPv6 clients keyed on
  their /64; cross-site (`Sec-Fetch-Site: cross-site`) state-changing requests refused (403).
- IP hashes: HMAC-SHA-256 with the `IP_HASH_SALT` secret (dev default + warning when unset).
- `POST /api/stages`: opt-out checked before the cache (opted-out sites stop at once), a global build cap
  (`GLOBAL_BUILD_LIMIT_PER_HOUR`), and a **capture kill switch** (`CAPTURE_ENABLED=0` or KV `kill:capture`).
- `Limiter` DO deletes its storage by alarm once nothing in it is live (per-IP objects no longer keep old
  timestamps forever).
- Telemetry ingest `POST /api/t` (allow-listed fields only, logged not stored), off unless `TELEMETRY_INGEST=1`.

**Web** — lazy routes for every page (the phone controller no longer downloads three.js/engine/Rapier),
`vendor-react`/`vendor-three` chunks, the unused standard Rapier build stubbed out of the bundle, `/s/*` proxied in
Vite dev. `apps/web/src/telemetry`: funnel events derived from the game's view (`title → paired → played →
finished`, `ended`, `build_failed`, `client_error`), a no-op default sink, a batching beacon sink behind the
build-time `VITE_TELEMETRY_URL`, DNT/GPC respected, per-page-load random id only.

**Deploy (not run)** — `wrangler.jsonc` `env.staging` / `env.production` (static assets from `../web/dist`, SPA
fallback, `run_worker_first` for `/api/*` and `/s/*`, all bindings/vars redeclared, placeholders);
`.github/workflows/deploy.yml` (staging on `main`, production on `v*` tag behind the `production` GitHub
Environment's required reviewers, D1 migrations first, config guard, smoke test; inert until
`WWM_DEPLOY_ENABLED=true`); `infra/` scripts (config guard, smoke, bundle report, cost model, kill-switch check,
perf and Lighthouse drivers); `tests/load/` (rooms, builds).

**Docs** — `docs/launch/{performance,runbook,cost-model,checklist,known-limitations}.md`,
`docs/launch/legal-drafts/{privacy,terms,takedown,tribute-disclaimer}.md` (all marked DRAFT), evidence in
`docs/launch/evidence/`.

**Fixes from the review of this branch's diff:** the deploy workflow exposes the Cloudflare token only to the
migration and deploy steps and passes ref names through env vars (no `${{ }}` inside `run:`), and production runs
only from `v*` tags; deployed environments (`WWM_ENV`) refuse score submissions with 503 instead of hashing IPs with
the public dev salt; IPv4-mapped IPv6 is keyed as IPv4; the flood counter resets when a socket's bucket refills;
telemetry lines carry no request id and unscrubbed messages are dropped server-side; an exception in the room
router now returns a JSON 500 with the security headers.

## Measurements (details and methods in docs/launch/performance.md)
- Frames, M5 Max, headed Chromium, WebGPU, 60 Hz: 6 stages incl. a Wikipedia slice, 59.7–60.0 fps, p99 18.5–18.6 ms,
  ≤ 0.1 % frames over 25 ms, tier 0. CPU ×20 proxy: ~56 fps, p99 ~33 ms. No integrated-GPU data (none available).
- Build latency, 24 real URLs, local Browser Run: cold p50 4.5 s / p95 8.6 s (21 ok, 3 blocked/timeout);
  warm at rest p50 2.3 ms / p95 3.9 ms.
- Bundle: every route used to load a 1,459 kB (440 kB gz) entry; now 5.6 KiB entry + 95 KiB-gz React vendor.
  Controller page total transfer 147 KiB. `dist` Rapier copies 4 → 2 (the second only for `?physics=worker`).
- Lighthouse (lab): controller 98/100 (mobile/desktop), `/` 77/92, `/about` 77/98, `/log` 69/89; CLS 0 except `/log`.
- Load (local workerd): 200 rooms and 400 sockets opened, 0 relay drops, but one local workerd saturates between
  50 and 100 rooms at 60 Hz. Build burst: default limits → 10 × 202 + 40 × 429; with the per-IP limit raised,
  40 of 50 jobs hit `CAPTURE_TIMEOUT` because the capture budget includes the semaphore wait (Phase 07 issue).

## Attempts that failed, and why
- **`security-review` skill** failed to start: it runs `git log origin/HEAD...` and this worktree has no remote.
  Replaced by two read-only review sub-agents (audit of the whole Worker + web, then this branch's diff).
- First frame-time run counted "> 16.7 ms" frames: at 60 Hz vsync intervals scatter around 16.7 ms, so ~45 % were
  "slow" by that measure. Re-ran with > 25 ms (1.5 vsyncs) plus a histogram.
- Worker `tsconfig.node.json` failed after adding tests that imported `routes/telemetry.ts` (it pulls Worker-only
  types through `app-env.ts`); the allow-list moved to a pure `telemetry-rules.ts` (same fix Phase 10 needed).
- First semaphore burst ran against a dev server that was being restarted (streams ended at once); re-ran on a
  fresh persistence dir.
- The first cost model assumed the Room DO is billed for the whole play; Cloudflare bills hibernation-eligible idle
  DOs nothing, so the base case bills per message and the old assumption became the "pessimistic" table.
- CSP `upgrade-insecure-requests` and HSTS are served locally too; harmless on localhost in Chromium.

## Manual human interventions
None (the user was asleep).

## Test evidence
- `pnpm check`: green — **47 files passed, 2 skipped; 633 tests passed, 12 skipped** (final run) (the game e2e 8/8 ran inside
  it; the lazy routes needed `routes.test.tsx` and `showcase.test.tsx` to await route loading).
- `controller.e2e` (normally skipped) run against a dev stack: 10/10.
- New tests: `apps/worker/test/security.test.ts` (headers, body caps, IPv6 keys, cross-site, HMAC hashes,
  telemetry allow-list, staging/production config invariants), Room DO caps in `room.test.ts`, stats gate and
  room rate limits in `rooms-route.test.ts`, `apps/web/src/telemetry/telemetry.test.ts`.
- Local smoke of the staging config 7/7; kill switch verified; SSRF suite green (part of `pnpm check`).

## Remaining defects and follow-ups
See the hand-off report (security open items, CCRs, Phase 07 semaphore/budget and failed-job dedupe issues,
Rapier WASM loading, `/log` CLS, known limitations on `/about`, and everything that needs the user).

### Open list (kept current; items fixed in Phase 12b are moved to "Fixed in 12b" below)
- ~~Pairing secret (room takeover by guessing the 6-digit code)~~: fixed in 12b.
- ~~zod `eval` probe reported by the CSP~~: fixed in 12b.
- ~~`CaptureBundle` size limits~~: fixed in 12b.
- ~~Phase 07: capture budget includes the browser-semaphore wait; failed jobs keep their dedupe key~~: fixed in 12b.
- ~~Rapier inlined as base64 JS and loaded on `/`~~: fixed in 12b.
- ~~`/log` CLS 0.17–0.20~~: fixed in 12b (0.063 mobile / 0.003 desktop).
- Still open: see "Open after 12b" at the end of the Phase 12b section.

---

# Phase 12b: security and pipeline follow-ups

- **Agent:** Claude Opus 5.5 (1M context), a Claude Code sub-agent in an isolated git worktree
  (branch `worktree-agent-a2a233cb8c0fe900e`). It used two parallel helper sub-agents in the same worktree, each
  with its own files: task 4 (capture iframe bypass) and task 5 (Rapier deferred load). It did tasks 1–3, 6 and 7
  itself, then reviewed and integrated the helpers' work.
- **Start / end:** 2026-09-25 ~11:45Z → ~12:25Z.
- **Environment:** as in Phase 12 (macOS 26.6.2, M5 Max, Node 26.0.0, pnpm 11.5, Vite 8.3, wrangler 4.140,
  Playwright Chromium, Lighthouse 12.8.2 via `npx`).

## Instructions received (summary)
Implement contracts v0.2.7 (§9: CCR-12-1 zod jitless, CCR-12-2 pairing secret, CCR-12-3 capture limits) end to end;
fix the Phase 07 pipeline bugs (capture budget vs. browser queue, failed-job dedupe) and re-run the burst before and
after; prove or disprove, then fix, a capture iframe bypass in real Chromium; load Rapier's `.wasm` as an asset only
when a stage loads; fix the `/log` CLS; update the launch checklist and performance docs. **Hard constraints:** no
deploy, no Cloudflare resources, no `wrangler login` or remote commands, no pushes, nothing published.

## What was built
**Task 1: schema 0.2.7** (`packages/schema`)
- `z.config({ jitless: true })` at the top of `zod.ts`. Every consumer reaches zod through this module, so the
  setting is on before the first parse.
- `CAPTURE_LIMITS`, enforced by `CaptureBundleSchema`: elements ≤ 20,000, title ≤ 512, url ≤ 2,048, text ≤ 120, lines ≤ 200 per element.
  `@wwm/capture-script` clamps `title` and `lines` to match, so a real page can't produce a bundle that fails its own parse.
  `MAX_ELEMENTS` was already 6,000.
- `CreateRoomResponse {code, hostToken, pairToken}` + `RoomTokenSchema`, `RoomCloseCode`, `ROOM_CLOSE_CODES`
  (4400/4401/4404/4409), `ROOM_TOKEN_BYTES`. `CONTRACT_VERSION` 0.2.7, CHANGELOG, README, version test.
- New `test/limits.test.ts` checks each limit at its boundary. It also checks that jitless is on, and spies on the `Function`
  constructor during parsing: 0 calls.

**Task 2: pairing secret (CCR-12-2)**
- Worker (`src/room-tokens.ts` new, `src/routes/rooms.ts`, `src/room.ts`):
  - `POST /api/rooms` issues two 128-bit base64url tokens (`no-store`).
  - The Room DO stores only their SHA-256 digests and compares them in constant time (`timingSafeEqual` on digests).
    Malformed tokens are still hashed, so response time doesn't depend on how a token is wrong.
  - The host needs its `hostToken`.
  - A controller with the `pairToken` is always admitted and may replace another (4409).
  - A controller without a token (the typed code) is admitted only while no **live** controller is connected.
  - Anything else closes with **4401**.
  - The route answers 400 to tokens that can't be base64url.
  - Rooms claimed before 0.2.7 (no digests) count as gone (4404).
- `@wwm/net`:
  - `createRoom` returns the validated `{code, hostToken, pairToken}`.
  - `roomWsUrl(…, token)`, `pairingUrl(…, pairToken)` → `/c/<code>#p=<token>` (the token is in the fragment only).
  - `resolvePairToken`: the `#p=` token wins and is remembered per code in sessionStorage; otherwise the remembered
    token; otherwise the typed-code path.
  - `forgetPairToken`, and `rememberHostRoom` / `recallHostRoom` (sessionStorage, or a `#h=…&p=…` fragment for another tab).
  - `CLOSE_UNAUTHORIZED` → fatal `unauthorized` error, with no reconnect loop.
- Web:
  - The host (`useHostRoom` / `openHostRoom`, `game.ts` `RoomView.pairToken`) puts the full URL, fragment included,
    in the QR code and the copyable link. This covers the game's pairing screen, the disconnect overlay and the
    `/dev/input` panel.
  - `/p/<code>` and `/dev/input?code=` rejoin with the remembered tokens.
  - The phone (`ControllerPage`, `session.ts`) reads the fragment, removes it from the address bar
    (`history.replaceState`), and presents the token on every reconnect.
  - A 4401 shows a clear "Another phone is already connected… scan the QR code" screen (en + ja), and forgets a
    refused remembered token.
- Load test `tests/load/rooms.mjs` and `infra/scripts/smoke.mjs` updated for the tokens.

**Task 3: Phase 07 pipeline** (`src/pipeline.ts`, `src/store.ts`, `src/build-job.ts`, `node/memory-store.ts`)
- The job acquires a browser slot first. It stays `queued` while waiting; the gate's existing 45 s limit ends it with
  `RATE_LIMITED` "all capture browsers are busy".
- Only then do the 20 s capture and 30 s slice-0 clocks start (`timings.queue` records the wait).
- Before sending `error`, a failed job deletes its own `job:<cacheKey>` dedupe entry, and only if the entry still
  points at it (`StageStore.clearInflightJob`). An interrupted `BuildJob` does the same.
- `tests/load/builds.mjs` gained `--retry-failed [k]`.

**Task 4: capture iframe bypass (helper sub-agent; reviewed)**
- New real-Chromium suite in `test/capture-guard.test.ts` (13 tests, helper site `test/helpers/frame-bypass-site.ts`).
  The internal server counts HTTP requests, WebSocket upgrades and raw TCP connections.
- Cases:
  - about:blank iframe used synchronously after append, including via `contentDocument.defaultView`,
    `Function('return this')` and `document.write`
  - parsed about:blank, srcdoc, data:, blob:, javascript: frames
  - cross-site out-of-process iframe (`localhost` vs `127.0.0.1`)
  - nested frames
  - `<object>` / `<embed>`
  - popups
  - a control case that proves the attacks do reach the server without the guard
- **Result:** `WebSocket`, `Worker`, `SharedWorker` and `RTCPeerConnection` were already stripped in every realm:
  Playwright's `addInitScript` runs in each frame and popup, including a new about:blank iframe before the parent can use it.
- **But `WebSocketStream` leaked from every realm, the top-level page included (11 of 11 cases hit the internal
  server).**
- **Fix** (`src/capture/core.ts`): `UNGUARDED_APIS` adds `WebSocketStream` and, defensively, `TCPSocket` /
  `TCPServerSocket` / `UDPSocket`; `window.open` returns null. After the fix, every case gets 0 hits and 0 connections.

**Task 5: Rapier deferred load (helper sub-agent; reviewed)**
- A Vite plugin (`rapierWasmAsset`) swaps the compat package's base64 `init()` argument for the URL of the
  byte-identical `.wasm` (hashed asset, streaming compile).
- The game creates its physics driver when the first stage starts building, so `/` no longer downloads Rapier.
- Node and workerd are unchanged (`loadRapier({ wasmModule })`).
- A new assertion in `packages/physics/test/rapier.test.ts` makes both the build and the tests fail if a Rapier
  upgrade changes the rewritten expression.

**Task 6: `/log` CLS**
- A `layout-shift` observer showed that the cause was the web-font swap, not the lazy images. Georgia is wider than
  Newsreader, so the lede re-wrapped by one line.
- Fix: metric-matched `@font-face` fallbacks in `showcase.css`: Georgia at 92 % with ascent/descent overrides, and
  Arial at 101.7 %. They were tuned by comparing every text block with the web fonts blocked vs loaded.

## Evidence
- **`pnpm check`: green**: typecheck, then biome (386 files), then **51 test files passed, 2 skipped; 721 tests passed, 13 skipped**
  (Phase 12 ended at 633). The game e2e ran inside it. Its pairing test now opens the QR link, checks that the
  token left the address bar, and sends in a typed-code intruder, which gets the `unauthorized` screen while the
  host keeps its controller.
- **Controller e2e** (`WWM_E2E_BASE`) against a local stack (Vite + `wrangler dev`), **11/11**. Includes the new
  "ATTACK: a second phone typing the code is refused; the paired phone keeps control" test (no token, then a made-up
  token; the paired phone keeps streaming at > 40 Hz and no new disconnect is logged), and the host rejoining in a
  new tab through the `#h=` fragment.
- **Room DO (workerd):** 17 tests in `room.test.ts`, 7 of them new for v0.2.7:
  - the host needs its token (a missing token, a made-up token or the pair token all get 4401)
  - a malformed token never opens
  - the typed code works while no controller is connected
  - **ATTACK:** no token, a guessed token or the host token all get 4401, before and after the 3 s liveness window,
    while the paired phone streams. Stats show `unauthorized: 4, replaced: 0`, and the host saw no peer change.
  - a silent typed-code phone can rejoin by code after 3 s
  - the QR phone takes over from a typed-code phone
- Route and token unit tests are in `rooms-route.test.ts`.
- **Net unit tests:** 51 (URLs, fragment, sessionStorage remember/forget, host rejoin, 4401 fatal).
- **Pipeline:** 6 new unit tests:
  - queue wait isn't capture time
  - the slice-0 clock starts at the slot
  - `capturing` is reported only after the slot
  - failed jobs clear their own dedupe entry but not a newer job's
- **Burst, before vs after** (same machine and command; `docs/launch/performance.md` §7.2,
  `docs/launch/evidence/load-builds-semaphore-12b-{before,after}.json`):
  - before: 10 done, 40 × `CAPTURE_TIMEOUT`; re-POSTing 5 failed URLs returned the failed job 5 of 5 times
  - after: 27 done, 23 × `RATE_LIMITED` busy, 0 × `CAPTURE_TIMEOUT`; the 5 retries were fresh jobs and all 5 finished
- **CSP:** production build, 0 `securitypolicyviolation` reports on `/`, `/c/123456`, `/about`, `/log`, `/making`
  (Phase 12 had one zod probe per page). Lighthouse "Best practices" 96 → 100 on `/` and `/c`.
- **Lighthouse** (`docs/launch/evidence/lighthouse-12b.json`):
  - `/log` CLS 0.167 / 0.204 → **0.063 / 0.003** (mobile / desktop), Perf 69 / 89 → 86 / 99
  - `/` transfer 1,940 → **874 KiB**, desktop Perf 92 → 98
- **Rapier** (performance.md §4):
  - `/` 1,681 → 612 KiB gz, with no Rapier
  - game route to `play` 1,625 → 1,334 KiB gz
  - Rapier 1,069 → 778 KiB gz
- **SSRF:** capture-guard 18 tests (13 new) + url-policy + pipeline green; before the fix all bypass cases leaked
  through `WebSocketStream`.

## Attempts that failed, and why
- Integration test for "malformed token → 400" through `fetch` with an `Upgrade` header: undici refuses to send that
  header. Replaced with a WebSocket that must never open. The 400 itself is asserted in the route unit test.
- The first version of the e2e attack test asserted "no `phone: disconnected` in the host log". The log already had
  one from pairing: the known dev-only StrictMode double connect (polish backlog). The test now compares the count
  before and after the attack.
- Pipeline timing tests with 100–150 ms margins passed alone but failed once under the full `pnpm check` load
  (slice-0 decode and build is slower there). The margins are now 400/600 ms and 2/2.5 s.
- `/log` CLS: the first assumption (images without reserved size) was wrong: they're lazy and far below the fold.
  Measuring the shift sources pointed to the font swap. Canvas-based font metrics at 100 px ignored optical sizing,
  so the fallback was tuned against real DOM boxes instead.
- Dev ports: 8787 was held by a stale `wrangler dev` from another worktree (`agent-a7d3ff90…`, left running), so this
  run used 8797/5183. **Incident:** a `pkill -f "wrangler dev --port 8797"` meant for this run's own failed start
  likely also stopped a `workerd` that belonged to a different local project (`~/Desktop/projects/esl/packages/backend`,
  listening on 8797). It is no longer running. Reported to the user; nothing else was touched.
- The `security-review` skill still can't run here (no git remote), as in Phase 12.

## Manual human interventions
None.

## Open after 12b
- **Contract clarifications for the orchestrator** (implemented as described, see the hand-off CCRs):
  - "no controller connected" means no controller heard from within 3 s (`CONTROLLER_LIVE_MS`)
  - host rejoin: tokens are kept in sessionStorage, or passed with a `#h=` fragment
  - malformed tokens get HTTP 400 before the upgrade
- The room token for WebSockets travels in the **query string** (per contract). Cloudflare's request logs record URLs,
  so tokens can appear in Workers Logs. Options: log redaction, or moving the token to `Sec-WebSocket-Protocol`
  (a contract change).
- The typed-code path can take over a controller that has been silent for more than 3 s (e.g. a locked phone). The QR
  phone takes control back on reconnect, but a typed-code phone can't. This is by design; document it on `/about`.
- `/making` CLS ≈ 0.07–0.14: chip row and demo canvas resize (Phase 10 page).
- `/log` mobile CLS 0.063 remains, from a transient partial-subset font state (below 0.1).
- The capture guard is a denylist of socket APIs, and a future Chromium socket API needs adding to `UNGUARDED_APIS`.
  The bypass tests ran on local Playwright, not on the real Browser Run service.
- The iPhone/Android pairing flow with the new QR fragment has not been tried on physical phones 👤.
- Unchanged from Phase 12: everything that needs the user (deploy, resources, legal, curated approval, device
  matrix, staging load tests).

# CI on GitHub runners

- **Agent:** Claude Opus 5.5 (1M context), a Claude Code sub-agent in an isolated git worktree, branch
  `fix/ci-runners` (from `launch/config-legal-story`), draft PR #2. It pushed to that branch only, to get real CI
  runs.
- **Date:** 2026-09-25 ~19:00Z.

## Instructions received (summary)
Make `pnpm check` pass on GitHub-hosted runners. It passed on the M5 Mac, but CI had failed on every run,
main included. The fix had four parts:
- make the engine fall back to WebGL2 on a WebGPU device loss, quietly;
- make the e2e tests deterministic in CI, keep the "no console errors" checks strict, and keep one local
  WebGPU assertion;
- scale the perf budget on CI, as Phase 05 did;
- find out whether the EPIPE/ECONNRESET lines were a flake.

The public engine API had to stay the same, and nothing could be pushed to main or `launch/config-legal-story`.

## What failed on the runners (run 36176284471)
- **12 browser e2e tests** (game ×7, extension ×3, portal ×1) failed with
  `THREE.WebGPURenderer: WebGPU Device Lost … Reason: unknown`, a warning
  `A valid external Instance reference no longer exists`, and a pageerror `Instance dropped in popErrorScope`.
  - The runners have no GPU. With `--enable-unsafe-webgpu`, Chromium offers a software WebGPU adapter that loses its
    device part-way through a page.
  - three.js r186 has no recovery from that. It logs an `error`, stops drawing, and leaves the
    `device.popErrorScope()` promises in `WebGPUPipelineUtils` without a `catch`, so they become unhandled
    rejections.
  - The gameplay assertions passed, because physics does not need the renderer. Only the console checks failed.
  - The error counts (11, 22, 33 …) grow because each suite's `problems` array is shared across its tests, so
    one test's messages show up in every later test.
- **stage-builder** `wikipedia-article` whole-page build took 2906 ms against the 1500 ms budget. The runner has
  2–4 vCPUs and runs every Vitest project in parallel. The same build takes 372 ms on the M5.

## What was built
**Engine: WebGPU → WebGL2 fallback** (`packages/engine/src/backend.ts` new, `engine.ts`). The public API is
unchanged.
- **No `navigator.gpu`:** WebGL2 is chosen up front with no log. This is a normal browser, not a failure.
- **No adapter or device at startup:** three's own fallback runs and logs its single warning. The failure is
  remembered for the page, so later engines (e.g. the game remounting on a route change) start on WebGL2 without
  another warning.
- **Device lost, at startup or mid-session:**
  - The engine's handler replaces three's error log with one `[@wwm/engine] WebGPU device lost (…); continuing
    on WebGL2.` warning.
  - `frame()` keeps advancing state but skips drawing while the engine recreates the renderer.
  - The new renderer is `forceWebGL` and draws on a fresh canvas with the same attributes. The fresh canvas takes
    the old one's place in the DOM, because a canvas that had a `webgpu` context can never get a `webgl2` one.
  - The engine keeps the scene, the loaded stage, the post nodes and all per-frame state. Only the
    `RenderPipeline` and node clock are rebuilt. The pipelines are compiled, then drawing resumes, and the run
    continues where it was.
  - A loss during `createEngine` is recovered before it returns.
  - `engine.dispose()` removes the replacement canvas.
- **`popErrorScope` after a loss:** a rejection now resolves to `null` ("no error", which is what the spec gives
  for a lost device), so there are no unhandled rejections. Real validation errors still come through.
- **WebGL2 context loss:** there is nothing left to fall back to, so it gets one warning instead of three's error.

**Tests**
- `apps/web/test/browser-env.ts` (new) sets up both environments:
  - **Locally:** the GPU flags as before, and the engine must report `webgpu`.
  - **CI:** the pages run as a browser without WebGPU (`navigator.gpu` is deleted by an init script before any page
    script), and the engine must report `webgl2`.
  - It is used by `game.e2e` and `portal.e2e`. The extension e2e inlines the same few lines, because it lives in
    another package.
- **New local-only e2e** (`game.e2e`): during a run, the test destroys the real WebGPU device and delivers the loss
  the way a GPU reset does. It then checks that:
  - the backend switches to `webgl2`;
  - the new renderer keeps drawing;
  - the sim keeps ticking in the `play` phase;
  - there is still exactly one game canvas;
  - exactly one `[@wwm/engine]` warning and no other console message or pageerror appears.

  The test cannot run in CI, which has no WebGPU. Against the old engine it fails: three logs the error, and the
  backend never changes.
- **`packages/engine/test/backend.test.ts`** (new): unit tests for the backend choice, the one-warning rule, and
  the `popErrorScope` guard.
- **One CI-only console exception:** with no GPU, Chromium composites in software and reads every WebGL frame
  back.
  - ANGLE reports this as `GL Driver Message (OpenGL, Performance, …): GPU stall due to ReadPixels`, four times per
    context.
  - A bare `gl.clear()` loop in the same Chromium produces it, so it comes from the environment, not the app.
  - `SOFTWARE_GL_NOISE` ignores exactly that performance message. GL errors, the engine's own warnings and all
    pageerrors still fail the tests.
- **Perf:** `stage-builder` keeps the 1.5 s budget locally. CI gets `CI_PERF_FACTOR = 4` (6 s), which follows the
  Phase 05 physics perf test (3 ms locally, 8 ms in CI). The test is kept.
- **Flake fixed:** the extension e2e read the bookmarklet's `href` right after navigation. `MazifyPage` sets that
  `href` from an effect (it is `/mazify` until then), so under load the test read the placeholder. Seen locally
  when three e2e files ran in parallel. The test now polls for `javascript:`.

## EPIPE / ECONNRESET
These are harmless. The log lines are Vite's `ws proxy error` / `ws proxy socket error`, which the dev-server
`/api` WebSocket proxy logs to stderr.
- **EPIPE** came during the phone pairing test, which passed. The browser closes a socket while the proxy is still
  writing to it. Causes include React StrictMode's double mount, which closes the first socket (the known
  `DEV_NOISE`), the rejected "intruder" phone, and closing contexts.
- **ECONNRESET** came in `afterAll`, when `browser.close()` resets the proxied sockets that were still open.

No assertion depends on these lines, and they do not happen in production (no Vite proxy). Nothing was changed.

## Test evidence
- Local (M5 Max, WebGPU): `pnpm check` green, 71 files passed and 2 skipped, 953 tests passed and 13 skipped.
  The device-loss e2e passes.
- Local in CI mode (`CI=1`, WebGL2 on SwiftShader): the game, portal and extension e2e suites pass.
