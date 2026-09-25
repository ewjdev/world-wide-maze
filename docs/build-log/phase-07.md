# Build log: Phase 07 (Capture & Stage Service, `apps/worker`)

- **Agent:** Claude Opus 5.5 (1M context), run as a Claude Code sub-agent in an isolated git worktree (branch `worktree-agent-aac1037da1a89d32e`).
- **Start / end:** 2026-09-25 ~08:05Z → ~08:45Z.
- **Environment:** macOS (arm64), Node 26.0.0, pnpm 11.5.0, wrangler 4.140.0 (workerd 1.20260923.1), `@cloudflare/playwright` 1.3.6, Playwright 1.63 Chromium.

## Instructions received (summary)
- Execute `plans/phase-07-capture-service.md`. The **G0 updates** apply: DPR 2, one URL becomes a run of slice stages with slice 0 first, a 30 s budget, and per-slice texture crops.
- Phase 03's builder isn't merged yet. So I coded against an injected `StageBuilder` with a stub, and left `validatePlayable` and `moderate` as hooks.
- No Cloudflare account, no resources, no deploy. Everything runs locally.
- I designed a `Capturer` seam with (a) a Browser Run implementation and (b) a local-Chromium implementation. The tests use (b).
- The SSRF suite is security-critical: at least 15 cases, and the policy is enforced on every browser request.
- Phase 06 owns `src/room.ts` and `src/routes/rooms.ts`, so I kept the router simple enough to merge easily.

## What was built
- **Worker** (Hono):
  - Routes: `POST /api/stages`, `GET /api/jobs/:id` (SSE), `GET /api/stages/:id[/texture]`, `GET /api/runs/:id`, `GET /api/curated`, and health.
  - Structured JSON logs, and errors as `{code, message}` using the contract codes.
- **Durable Objects:**
  - `BuildJob` runs one job in an alarm, persists its events and replays them over SSE.
  - `Limiter` keeps a per-IP sliding build log and a global browser semaphore with leases.
- **Storage:**
  - R2: stages, slice textures and capture bundles.
  - D1: `migrations/0001_runs_stages.sql`.
  - KV: the run cache, in-flight dedupe and the opt-out list.
  - The Rate Limiting binding handles reads. A daily retention cron deletes old runs.
- **SSRF policy** (`src/policy/`):
  - An IP parser covering every inet_aton and IPv6 spelling, with a forbidden-range table.
  - Static URL rules, DoH resolution with an "any private answer rejects" rule, and the opt-out list.
  - A per-capture request guard, wired into CDP `Fetch` at the browser target.
- **Capture core** (`src/capture/core.ts`), shared by Browser Run, local Chromium and the Node sidecar:
  - It runs the SSRF guard, an init script that removes unguardable APIs, and `@wwm/capture-script`'s `capturePage`.
  - It then runs bot-wall detection and takes the per-slice DPR-2 WebP crops through CDP.
- **Pipeline** (`src/pipeline.ts`):
  - capture → moderate → streaming PNG decode (native `DecompressionStream`) → build and validate slice 0 → store → `done` → background slices.
- **Node side** (`node/`): the local-Chromium capturer, the capture sidecar with a binary wire format, an in-memory store, the `bench` CLI and the `smoke` CLI.
- **Tests:** 96 new tests in 5 files. They cover SSRF rules, real-Chromium guard tests, pipeline paths, units, and a `createTestHarness` integration test of the real Worker in workerd.

## Key decisions and findings (evidence-based)
- **`@cloudflare/playwright` over Puppeteer.** The capture script and the fixture tool already speak Playwright, so the capture sequence is shared as is. I verified in a scratch Worker that `page.route`, `newBrowserCDPSession`, CDP WebP screenshots, and `deviceScaleFactor: 2` all work through the binding.
- **Browser Run works in `wrangler dev` with no account.** Wrangler downloads a local Chrome for the binding. So path (a) is exercised locally, not only in production.
- **Playwright `route()` misses redirect hops.** Verified: a subresource redirect to a "private" host was fetched 4 times while `route()` saw only the first URL. So enforcement uses CDP `Fetch.enable` on the **browser** target instead. Verified locally and through `@cloudflare/playwright`, it pauses every hop, iframe and dedicated-worker request, and the private target received 0 hits.
- **WebSockets bypass CDP `Fetch`.** Verified: `Network.setBlockedURLs` didn't block them. `routeWebSocket` and an init script block page sockets but not sockets opened inside a worker. So the init script also removes `Worker`/`SharedWorker`, as well as WebSocket, WebTransport and RTCPeerConnection. This trades away worker-dependent page features for SSRF safety.
- **CDP `Page.captureScreenshot` `clip.scale` is absolute.** It ignores the emulated DPR (verified: `scale: 1` gave a 1280-wide image at DPR 2), so it must be set to `dpr`.
- **DPR-2 memory.** A DPR-2 full page is about 123 MB of RGBA, which exceeds the 128 MB isolate limit. So the builder gets the 1× CSS-scale screenshot and the textures are DPR-2 crops made by Chromium. I raised this as CCR-07-2.
- **The Workers Vitest pool can't run here.** `@cloudflare/vitest-pool-workers` 0.22 has a peer dependency on Vitest ^4.1, and the repo uses Vitest 5. I used wrangler's `createTestHarness`, Cloudflare's runner-agnostic integration API from July 2026, which runs the production build in workerd with local bindings.
- **The DOM lib is needed in the worker tsconfig.** `@wwm/capture-script`'s in-page code needs DOM types. They coexist with the workers types under TS 7, with one `BufferSource` fix in the PNG decoder.

## Attempts that failed, and why
- **First texture test** failed because textures came out 1280 px wide (see the `clip.scale` finding above).
- **`@jsquash/png`** was added and then removed. WASM init in Workers is awkward, and a small streaming decoder on `DecompressionStream` is faster and leaner for Chromium PNGs.
- **Structural typing of Playwright objects.** `Browser` isn't assignable to a plain structural interface because `newCDPSession(page)` requires the nominal `Page` type. I made the handles generic over the page type, which removed both adapters.
- **Test builder version.** A test builder with version `'test'` failed `validateStage` (it isn't semver).
- **Session reuse.** At first every job acquired a new session. `connect()` needs an undocumented `persistent: true` option (it's in the library source, not the typings), otherwise the session dies with the WebSocket. Even with the option, the **local** emulator still lists the previous session with a `connectionId`, so I couldn't observe reuse locally. It's an item on the enablement checklist.
- **Local dev server collisions.** Port 8787 was already taken by a parallel process, and I then picked 8797, which another local project uses. My `pkill -f "wrangler dev …"` patterns missed the actual `cli.js dev …` processes. I found them and killed them by PID.
- **Rate limiting fired on me.** During the dev smoke run I hit my own 10 builds/hour limit, and the 11th POST correctly returned 429. I restarted with `--var BUILD_LIMIT_PER_HOUR:1000`.

## Manual human interventions
None.

## Test evidence
- `pnpm check`: typecheck, then `biome check` (130 files, no fixes), then `vitest run`: **22 files, 224 tests passed** (the worker adds 96). The worker's integration test runs in about 14 s.
- **Integration test** (`test/worker.integration.test.ts`): the real Worker in workerd, local R2/D1/KV/DO/rate limit, the capture sidecar running local Chromium, a fake DoH endpoint and a local fixture site.
  - POST → 202 → SSE `queued, capturing, extracting, building, validating, storing, done`. The stored stage passes `validateStage`, and the texture WebP is exactly `size × 2`.
  - A 4-slice page is ready at slice 0 in 2.7 s, and all slices appear in `/api/runs`.
  - **The second POST is a cache hit: 200 in 2.5 ms**, logged as `[timing] … cached POST=2.5 ms` (the target is under 100 ms).
  - `URL_FORBIDDEN` for 8 hostile URLs, including DNS answers in private ranges.
  - SSE errors: `CAPTURE_BLOCKED` (403, challenge), `CAPTURE_TIMEOUT` (a page that never loads), `URL_FORBIDDEN` (a redirect to a private host), and `BUILD_FAILED` (sidecar down).
  - Build rate limit: 429 with `Retry-After` of about 3600. Read rate limit: the 101st read in a minute gets 429.
  - The curated table is read, and the retention cron deletes old non-curated runs and keeps the curated ones.
- **SSRF suite:** 52 policy tests (19 numbered scenario tests plus IP-range tables) and 5 real-Chromium tests. The internal server received **0 hits** across the redirect-hop, subresource, iframe, fetch, beacon, EventSource, worker and WebSocket cases.
- **Cold capture+build timings, local Chromium** (`pnpm --filter @wwm/worker bench`: real network and DoH, DPR 2, stub builder, same browser process reused):

  | fixture | slices | slice 0 ready (ms) | capture | prep+extract+shot | textures | decode |
  |---|---|---|---|---|---|---|
  | news site (removed before publication) | 4 | 3178 | 2992 | 2485 | 396 | 125 |
  | example-sparse | 1 | 912 | 885 | 802 | 52 | 15 |
  | govuk-card-grid | 3 | 3223 | 2903 | 2611 | 252 | 81 |
  | hn-front | 1 | 1064 | 1021 | 903 | 88 | 28 |
  | image-gallery | 4 | 3058 | 2905 | 2443 | 431 | 125 |
  | mdn-dark-docs | 3 | 1819 | 1744 | 1504 | 206 | 63 |
  | wikipedia-article | 4 | 2885 | 2761 | 2224 | 505 | 114 |

  **p50 is 2.9 s (target under 10 s).** The builder is the stub (about 0 ms). The real builder's time adds to this.
- **Through `wrangler dev` with Browser Run's local Chrome** (path (a), `pnpm --filter @wwm/worker smoke`). Every stage was valid and every texture matched its declared size:
  - example.com: 2.2 s
  - HN: 2.6 s
  - MDN: 4.9 s
  - GOV.UK: 5.3 s
  - Wikipedia: 7.7 s
  - News-site fixture (removed before publication): 8.4 s
  - Commons POTD: 11.9 s

  **p50 is 5.3 s.** This path is slower because every paused request and every texture (about 1 MB of base64) crosses the CDP WebSocket through the local Browser Run proxy. Textures take about 1 s per slice there, versus about 0.1 s direct. Cached re-POSTs took 1.9–3.1 ms.
- **`wrangler deploy --dry-run`:** 4061 KiB, 793 KiB gzipped.

## Remaining defects / follow-ups
- **The builder is a STUB.** It centres `handmade-simple` in each slice. Wire `@wwm/stage-builder` at the Phase 03 merge (a one-function change in `src/builder.ts`), then re-run `bench` and look at `build.<i>` against `cpu_ms`.
- **Browser Run session reuse is unverified.** The local emulator limitation is described above. Check for `browser session reused` in the logs after enablement.
- **Texture transfer dominates Browser Run timings.** If production shows the same, capture slice 0's texture first and store and emit `done` before the rest, or lower the WebP quality (85 today).
- **Residual SSRF risks:**
  - DNS-rebinding TOCTOU between our DoH check and Chromium's own resolver.
  - `preconnect` and DNS prefetch.
  - Pages that depend on Web Workers render without them.
- **Chatty log line.** `@cloudflare/playwright` prints a `Websocket error … Network connection lost` object on every disconnect in local dev. It is harmless, but noisy.
- **Phase 10's `curated` columns are assumed** to be `run_id, title, url, thumb, stars, position`. Align them at merge.
