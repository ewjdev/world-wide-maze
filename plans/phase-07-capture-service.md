# Phase 07 — Capture & Stage Service (apps/worker)

**Wave:** 1 (capture and storage first; wires in `@wwm/stage-builder` once Phase 03 lands) · **Depends on:** 02 · **Blocks:** 08 (live URLs), 12

## Goal
A safe, cached, hosted pipeline: **URL → capture → build → validate → stored `StageData` + texture**. It runs on Cloudflare Workers with Browser Rendering, with progress streamed to the client. This is what makes "any website" real.

## Read first
- `plans/contracts.md` §2, §3, §7
- `RESEARCH.md` Part 4.1 and Part 7 (risks)
- `research/recreation-plan.md` "Scope the website promise honestly"
- The `cloudflare`, `wrangler` and `workers-best-practices` skills (load them)

## Owns
`apps/worker/**` **except** `src/room.ts` and `src/routes/rooms.ts` (those belong to Phase 06), and `apps/worker/migrations/**` (D1)

## Tasks
1. **Worker skeleton:** a Hono (or itty-router) router, structured JSON logging, and error responses using the contract error codes. Configure `wrangler.jsonc` bindings: `BROWSER`, `STAGES` (R2), `DB` (D1), `CACHE` (KV), the `ROOM` DO (declared by 02, implemented by 06), and a `BUILD_QUEUE` (Queues) or DO-based job runner.
2. **URL policy (`url-policy.ts`):**
   - Normalize: lowercase the host, strip tracking params, drop the fragment.
   - Allow only `http:` and `https:`, default ports 80/443, no credentials in the URL.
   - Block IP-literal hosts in private, loopback, link-local, CGNAT and metadata ranges (v4 + v6), plus `localhost` and `.internal`/`.local` hostnames.
   - An opt-out domain list (KV) and a max URL length.
   - Also enforce the policy **on every navigation and redirect inside the browser** (Playwright/Puppeteer request interception: abort requests to disallowed hosts, and abort downloads and non-http schemes).
   - Tests for bypass tricks: decimal or octal IPs, IPv6-mapped IPv4, DNS names resolving to private IPs (use DoH resolution before navigating and reject private answers), and redirects to private addresses.
3. **Capture (`capture.ts`):**
   - Launch Browser Rendering (`@cloudflare/puppeteer` or `@cloudflare/playwright`, whichever is more current and stable; document the choice).
   - Viewport 1280×800, DPR 1, a fresh context with no cookies, JS enabled, a 20 s total budget.
   - Run `preparePage` + `extractPage` from `@wwm/capture-script`, then take a full-page screenshot capped at 6000 px height, as WebP.
   - Produce a `CaptureBundle`.
   - Detect bot walls and interstitials (heuristics: tiny page, known challenge markers) → `CAPTURE_BLOCKED`.
   - Reuse browser sessions (Browser Rendering session reuse) to cut cold starts.
4. **Build job:**
   - `POST /api/stages` checks the cache (KV key `stage:<normUrl>:<difficulty>:<builderVersion>`, TTL 7 days) → `200 {stageId}`. On a miss it enqueues a job → `202 {jobId}`.
   - The job does capture → decode the screenshot to RGBA (a WASM image decoder that works in Workers, e.g. `@jsquash/webp`/`png`) → `buildStage` → `validateStage` → (Phase 09's solver hook, when it exists: an interface `validatePlayable?(stage)` injected later) → store to R2 (`stages/<stageId>.json`, `textures/<captureId>.webp`) and a D1 row (stageId, url, title, createdAt, builderVersion, counts).
   - **CPU budget:** if `buildStage` exceeds Worker CPU limits for tall pages, run the builder in a **Container** or in the job's DO with a raised CPU limit. Measure and document this. As a last resort, return the `CaptureBundle` to the client and build in a client Web Worker (the builder is pure TS). Pick the simplest option that works, and record why.
5. **Progress:** `GET /api/jobs/:jobId` as SSE, with steps `queued → capturing → extracting → building → validating → storing → done`. It's a nice UX moment, and Phase 08 shows it as "building your maze…".
6. **Serving:** `GET /api/stages/:id` and `/texture` with immutable cache headers (content-addressed IDs). `GET /api/curated` reads a D1 table `curated`.
7. **Abuse controls:** per-IP rate limits (the Rate Limiting binding or a DO counter) of 10 builds per hour and 100 reads per minute. A global concurrency cap on browser sessions, and returning `RATE_LIMITED` with `Retry-After`.
8. **Content safety hook:** an interface `moderate(screenshot): Promise<'ok'|'block'>`. It's a no-op now, and Phase 11 or 12 can plug in a model. Stages built from user URLs are **unlisted** by default: they're only reachable by ID and never shown in the public lists.
9. **Retention:** a scheduled cron deletes non-curated textures and stages older than 30 days (a configurable policy, documented in the README and surfaced later on the About page).
10. **Local dev:** `pnpm --filter worker dev` works against local R2/D1/KV. Browser Rendering in local dev uses the remote binding or a local Chromium fallback. Document how.

## Acceptance criteria
- Integration test (Vitest with the Workers pool): `POST /api/stages` for a fixture URL returns a stored stage that passes `validateStage`. A second call is served from the cache in under 100 ms (log it).
- The SSRF test suite passes (at least 15 cases, including redirect-to-private and DNS-rebinding-style resolution).
- SSE progress events arrive in order, and error paths return the correct codes (`URL_FORBIDDEN`, `CAPTURE_TIMEOUT`, `CAPTURE_BLOCKED`, `BUILD_FAILED`).
- Rate limiting is verified by a test.
- Timings documented: cold capture+build p50 for the 6 fixture URLs. **Target under 10 s** (the original sometimes took about 2 min).

## Out of scope
The Room DO (06), the solver (09), AI (11), and the leaderboard endpoints (Phase 10 adds `routes/scores.ts`; leave the router extensible).
