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
