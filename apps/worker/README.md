# @wwm/worker

This Cloudflare Worker is the capture and stage service. It turns a URL into a run of stages: **URL → SSRF checks → capture (Browser Run) → build each slice → validate → store**. It streams progress over SSE and serves stages, textures, runs and the curated list (contracts §7). The package also hosts the `Room` Durable Object relay (contracts §6).

Owners: Phase 07 (everything here) and Phase 06 (`src/room.ts` and `src/routes/rooms.ts` only).

## API (contracts §7)
| Route | Notes |
|---|---|
| `POST /api/stages` `{url, difficulty?, seed?}` | Returns `200 {runId, stageIds}` on a cache hit, or `202 {jobId}`. Errors are `400 URL_FORBIDDEN` and `429 RATE_LIMITED` with `Retry-After`. A second POST for the same URL, difficulty and builder while the first job is still running returns the same `jobId`. |
| `GET /api/jobs/:jobId` | SSE. `event: progress` goes through the steps `queued → capturing → extracting → building → validating → storing`. The stream then sends exactly one `done {runId, stageIds}` (as soon as **slice 0** is stored) or one `error {code, message}`. |
| `GET /api/stages/:stageId` | Returns the `StageData`, `Cache-Control: immutable`. `texture.path` is `<stageId>/texture`, relative to the stage URL. |
| `GET /api/stages/:stageId/texture` | Returns the WebP slice texture at DPR 2 (`size × 2`), `Cache-Control: immutable`. |
| `GET /api/runs/:runId` | Returns `{runId, url, title, stageIds}`. The stages of later slices appear here as they finish. `stage.source.slice.count` gives the final count. |
| `GET /api/curated` | Reads Phase 10's D1 table `curated(run_id, title, url, thumb, stars, position)`. It returns `{runs: []}` until that table exists. |
| `GET /api/health` | Returns `{ok, contract}`. |

The error codes are the contract's: `URL_FORBIDDEN`, `CAPTURE_BLOCKED` (HTTP ≥ 400, bot check, empty page, or the content filter), `CAPTURE_TIMEOUT`, `BUILD_FAILED`, `UNPLAYABLE` (from the injected solver hook), and `RATE_LIMITED`.

## How a job runs
1. **POST** runs the static URL policy, then the KV run cache, then the in-flight dedupe, then the full policy (opt-out list and DoH resolution), then the per-IP build limit. It then creates a `BuildJob` Durable Object and sends `202`.
2. **`BuildJob.alarm()`** runs `runBuildJob` (`src/pipeline.ts`):
   - It takes a slot from the global browser semaphore (`Limiter` DO, `BROWSER_MAX_CONCURRENCY`).
   - It captures. The budget is `CAPTURE_BUDGET_MS`, 20 s.
   - It runs `moderate` (a no-op hook).
   - It decodes the 1× PNG and builds slice 0, runs `validateStage`, and runs the optional `validatePlayable` hook.
   - It stores the result, then sends `done`. The slice-0 budget is `SLICE0_BUDGET_MS`, 30 s from capture start (E: the 2013 timeout).
   - Slices 1…n−1 are built afterwards in the same alarm. If one fails, the run is truncated and marked `partial`.
3. **Storage:**
   - R2 holds `stages/<stageId>.json`, `textures/<captureId>/<slice>.webp`, `captures/<captureId>/{capture.json,screenshot.png}`.
   - D1 holds `runs` and `stages` (migrations/0001).
   - KV holds `run:<normUrl>:<difficulty>:<builderVersion>[:seed=n]` → `{runId}` with a 7-day TTL, `job:<key>` (120 s) and `optout:<domain>`.
   - User-URL runs are **unlisted**. You can reach them only by ID, and they never appear in `/api/curated`.

### Why the builder sees a 1× image (deviation, recorded as CCR-07-2)
The capture uses DPR 2, as G0 requires. But a DPR-2 full page is 2560×12000×4 B ≈ 123 MB of RGBA, which doesn't fit the 128 MB isolate limit. So Chromium produces two things:
- a **CSS-scale (1×) full-page PNG**. This is `CaptureBundle.screenshot`, with `scale: 1`, and it is what `BuildInput.image` gets.
- one **DPR-2 WebP per slice**, cropped by Chromium itself through CDP `Page.captureScreenshot` with a clip. These become `StageData.texture`, with `scale: 2`.

This way the Worker never decodes or re-encodes a 2× image. Peak memory is about one 1× RGBA image (≤ 31 MB). The PNG decoder is `src/image/png.ts`, which streams through the native `DecompressionStream`.

### CPU budget (task 4)
The builder runs inside the `BuildJob` alarm, with `limits.cpu_ms = 300000` in `wrangler.jsonc` (Workers Paid). The pipeline logs `build.<i>` in ms for each slice, and `runs.timings_json` stores all the step timings. If the real builder (Phase 03) comes close to the limit on 6000 px pages, the next step is a Container. Measure that when it merges. The stub builder takes ~0 ms.

## SSRF policy (`src/policy/`)
- **Static rules.** Only `http:` and `https:` are allowed, only on the default ports, with no credentials and at most 2048 characters.
  - IP literals in any spelling are judged after WHATWG parsing (decimal, octal, hex and short IPv4, and bracketed IPv6).
  - Forbidden addresses: private, loopback, link-local and metadata, CGNAT, benchmarking, documentation, multicast and reserved ranges. IPv4-mapped, compatible, NAT64, 6to4 and Teredo IPv6 forms are also forbidden, and only 2000::/3 global unicast passes.
  - Forbidden hostnames: `localhost`, `*.localhost`, `.local`, `.internal`, `.lan`, `.home.arpa`, `.corp`, `.test`, `.onion`, and single-label hosts.
- **DNS.** The Worker resolves A and AAAA over DoH (`DOH_URL`). The host is refused if **any** answer is forbidden, or if it doesn't resolve.
- **Opt-out.** KV `optout:<domain>` covers the domain and all of its subdomains.
- **Every browser request.** CDP `Fetch.enable` on the **browser target** pauses every request from every page, frame and worker, and every **redirect hop**. `RequestGuard` then applies the same rules (memoized per host) and continues or fails each request. The final page URL is re-checked too.
  - Playwright's `page.route()` is **not** enough. We verified that it never sees redirect hops: a redirect to a "private" host was fetched 4 times.
  - An init script removes `WebSocket`, `WebTransport`, `RTCPeerConnection`, `Worker` and `SharedWorker` from every frame, because CDP `Fetch` can't see their traffic. We verified that WebSockets from pages and from workers bypass `Fetch`.
  - Service workers and downloads are disabled on the context. Local Chromium also gets WebRTC and background-networking flags.
- **Dev/test only.** `DEV_ALLOWED_HOSTS` holds exact **loopback** `host:port` pairs that skip the IP and port rules, so tests can capture a local fixture site. Entries that aren't loopback are ignored. It must stay empty in production.
- **Residual risks** (documented, not fixed):
  - DNS rebinding between our DoH check and Chromium's own lookup (a TOCTOU gap). On Browser Run, egress comes from Cloudflare's network, not ours.
  - `<link rel=preconnect>` and DNS prefetch can open a TCP connection or send a DNS query without any HTTP request.

## Capturers (`src/capture/`)
| Capturer | Where | Use |
|---|---|---|
| `BrowserRunCapturer` (a) | Worker | Production. `@cloudflare/playwright` 1.3.6 (Playwright 1.58). It uses session reuse: `sessions()` → free session → `connect(…, {persistent})`, else `acquire(keep_alive 120 s)`. In `wrangler dev` it runs against a local Chrome that wrangler downloads, so no account is needed. |
| `LocalChromiumCapturer` (b) | Node (`node/`) | Tests and the benchmark. It uses Playwright Chromium. |
| `HttpCapturer` | Worker → Node sidecar | `CAPTURE_BACKEND=sidecar`. The integration tests use it (workerd can't run Playwright), and it's an optional dev fallback. |

All three run `captureWithBrowser` (`src/capture/core.ts`): the SSRF guard, then `@wwm/capture-script`'s `capturePage`, then bot-wall detection, then slice textures. Playwright was chosen over Puppeteer because the capture script and the fixture tool already speak Playwright, so the whole sequence is shared. Both forks expose CDP.

## Abuse controls
- **Builds.** 10 per hour per IP (`BUILD_LIMIT_PER_HOUR`), counted only on a cache miss. The `Limiter` DO keeps a sliding log. The Rate Limiting binding supports only 10 s and 60 s periods, so it can't do this.
- **Reads.** 100 per minute per IP, through the `READ_LIMITER` Rate Limiting binding. The IP comes from `cf-connecting-ip`.
- **Browsers.** A global semaphore (`Limiter` DO `browser`, leased). If it's still full after 45 s, the job returns `RATE_LIMITED`.

## Retention (task 9)
A daily cron (`17 3 * * *`) deletes non-curated runs older than `RETENTION_DAYS` (30): their stage JSON, textures, capture bundle, and D1 rows. It handles at most 200 runs per tick. Curated runs are the `run_id`s in Phase 10's `curated` table. KV cache entries expire on their own after 7 days.

## Hooks for later phases (`src/builder.ts`)
- `defaultStageBuilder()` returns the **STUB** builder today. The stub centres `fixtures/stages/handmade-simple` in each slice, and the stub stages are marked in `provenance.notes`. **At the Phase 03 merge**, replace its body with `return { version: STAGE_BUILDER_VERSION, buildStage }` from `@wwm/stage-builder`, then add the dependency.
- `DEFAULT_HOOKS.validatePlayable` belongs to Phase 09 (the solver). `DEFAULT_HOOKS.moderate` belongs to Phase 11/12. It is a no-op today.
- Routes live in `src/routes/<name>.ts` as `Hono<AppEnv>` sub-apps, one registration line each in `src/router.ts`. Phase 06 adds `app.route('/api/rooms', roomsRoutes)`.

## Commands
- `pnpm --filter @wwm/worker dev` applies the local D1 migrations, then starts `wrangler dev` on :8787 with local R2/D1/KV/DO/rate limits and local Browser Run Chrome.
  - Sidecar alternative: `pnpm --filter @wwm/worker capture-sidecar`, then `wrangler dev --var CAPTURE_BACKEND:sidecar --var CAPTURE_SIDECAR_URL:http://127.0.0.1:8788`.
- `pnpm --filter @wwm/worker smoke http://localhost:8787 [url…]` drives a running Worker end to end. It defaults to the fixture URLs.
- `pnpm --filter @wwm/worker bench [slug…]` measures cold capture+build timings on the fixture URLs with local Chromium.
- `pnpm --filter @wwm/worker types` regenerates `worker-configuration.d.ts` (`--strict-vars=false`, so vars are `string`).
- Tests: `pnpm vitest run --project @wwm/worker`.
  - `url-policy` holds the SSRF rules.
  - `capture-guard` runs real Chromium: redirect hops, subresources, workers and sockets.
  - `pipeline` covers events, slices and error codes.
  - `units` covers PNG, WebP, the wire format, SSE and bot walls.
  - `worker.integration` runs the real Worker in workerd through wrangler's `createTestHarness`, with local bindings and the sidecar.
  - The browser tests skip without Playwright Chromium, except under CI.
  - `@cloudflare/vitest-pool-workers` 0.22 needs Vitest 4, and this repo uses Vitest 5, so the integration tests use `createTestHarness` instead.
- TypeScript: `tsconfig.json` checks `src/` with the workers types plus DOM. `@wwm/capture-script`'s in-page code needs DOM types, and they coexist under TS 7. `tsconfig.node.json` checks `node/` and `test/`.

## Enabling production (orchestrator / Phase 12 checklist)
1. Upgrade to a **Workers Paid** plan. You need it for `limits.cpu_ms`, Browser Run concurrency, and Durable Object alarms at scale.
2. Create the resources and put their IDs into `wrangler.jsonc`:
   - `wrangler r2 bucket create wwm-stages`
   - `wrangler d1 create wwm`, which gives you `database_id`
   - `wrangler kv namespace create CACHE`, which gives you `id`
   - Pick a unique `ratelimits[].namespace_id`.
3. Run `wrangler d1 migrations apply wwm --remote`.
4. Check that the vars have production values:
   - `CAPTURE_BACKEND=browser-run`
   - `DEV_ALLOWED_HOSTS=""`, which must stay empty
   - `BROWSER_MAX_CONCURRENCY` at or below the account's Browser Run limit
   - `DOH_URL` (default `https://cloudflare-dns.com/dns-query`)
5. Browser Run needs no extra config beyond `"browser": {"binding": "BROWSER"}`. To try the real service before deploying, set `"remote": true` on the binding and run `wrangler dev` (this needs `wrangler login`).
6. Deploy with `wrangler deploy`. The dry-run bundle is 4.0 MB, or 793 KB gzipped.
7. Verify on the real service with `pnpm --filter @wwm/worker smoke https://<worker-host>`. Then check these in the logs:
   - `browser session reused` appears. The local emulator reports disconnected sessions as still connected, so reuse couldn't be observed locally.
   - `capture.textures` in ms. It is about 1 s per slice over the local Browser Run proxy.
   - `build.<i>` in ms with the real builder, measured against `cpu_ms`.
8. Seed `optout:<domain>` keys for takedown requests. Phase 10 creates `curated` and inserts the curated `run_id`s. Those runs are then exempt from retention.
