# Runbook — World Wide Maze (revival)

Status: **written before the first deploy** (Phase 12). Nothing below has been run against a real Cloudflare
account; every command was checked locally against `wrangler dev` unless it says otherwise. Replace
`<ACCOUNT>`, `<DOMAIN>` once the resources exist (infra/README.md).

## 1. What's running
| Piece | Where | Notes |
|---|---|---|
| Web app (Vite build) | Workers static assets of Worker `wwm` / `wwm-staging` | Security headers from `apps/web/public/_headers`; SPA fallback; free, uncounted requests |
| API Worker (Hono) | same Worker, `run_worker_first` for `/api/*`, `/s/*` | `apps/worker/src` |
| Room relay | Durable Object `Room`, one per 6-digit code | WebSocket Hibernation; logs `svc: wwm-room` |
| Build jobs | DO `BuildJob` (alarm runs capture → build → store) | `cpu_ms` 300 000 |
| Limits | DO `Limiter` (per-IP builds/scores, global build cap, browser semaphore); Rate Limiting bindings (`READ_LIMITER` 100/min, `ROOM_CREATE_LIMITER` 30/min, `ROOM_WS_LIMITER` 120/min) | IPv6 counted per /64 |
| Storage | R2 `wwm-stages`, D1 `wwm`, KV `CACHE` | retention cron 03:17 UTC deletes non-curated runs > 30 days |
| Captures | Browser Run binding `BROWSER` | `BROWSER_MAX_CONCURRENCY` = 2 |

## 2. Dashboards and logs
- **Workers → wwm → Observability** (Workers Logs, 7-day retention, `head_sampling_rate: 1`):
  `https://dash.cloudflare.com/<ACCOUNT>/workers/services/view/wwm/production/observability` *(link valid once the
  Worker exists)*. Useful queries (Query Builder, filter on the JSON fields):
  - Build failures by reason: `msg = "job failed"` (level warn), group by `code` (the contract error codes).
    Later-slice failures: `msg = "background slice failed; run truncated"`. Step timings: the `timings` field of
    `msg = "slice 0 ready"` / `"run finished"`.
  - Solver failure classes: `msg = "job failed"` with `code = "UNPLAYABLE"`; the `error` field is
    `slice <i>: <solver reason>` from Phase 09's `validatePlayable` hook.
  - Abuse: `msg = "cross-site request refused"`, `msg = "global build limit reached"`,
    `msg = "capture disabled (kill switch)"`, room lines `svc = "wwm-room"` with `over the rate cap` /
    `oversized`.
  - Relay health: `svc = "wwm-room"` `msg` starting with `keepalive` (once a minute per live room: RTT p50/p95,
    input rate, lost frames).
  - Funnel (only if telemetry is enabled, §6): `msg = "telemetry"`, group by `event` →
    `title → paired → played → finished`, `ended` by `reason`, `build_failed` by `code`, `client_error` by `kind`.
- **Workers → wwm → Metrics**: requests, errors, CPU time, subrequests; **Durable Objects** tab per class
  (requests, duration GB-s — the Room relay is the main cost driver, see cost-model.md).
- **Browser Run** dashboard (Compute → Browser Run): sessions, browser hours, concurrency.
- **R2 / D1 / KV** metrics pages for storage growth.
- **Billing → Notifications**: budget alerts — see §7.

## 3. Routine checks (weekly, 10 minutes)
1. `node infra/scripts/smoke.mjs https://<DOMAIN>` — all PASS.
2. Workers Logs: error rate, top `code` of failed builds, `client_error` count (if telemetry on).
3. Browser Run hours vs. the 10 included; R2 GB vs. the model; DO GB-s trend.
4. Leaderboards: scan the top 20 of `/api/scores/run` for implausible names/scores (see §5.4).

## 4. Deploy, verify, roll back
- **Staging:** merge to `main` → `.github/workflows/deploy.yml` (job `staging`) builds the web app, applies D1
  migrations, deploys `wwm-staging`, runs the smoke test.
- **Production:** push a tag `vX.Y.Z` → job `production` waits for approval in the GitHub Environment
  `production` → deploy → smoke test.
- **Roll back** (Worker code + assets together; D1 migrations are *not* rolled back, so migrations must stay
  backward compatible):
  ```sh
  cd apps/worker
  pnpm exec wrangler deployments list --env production          # find the previous version id
  pnpm exec wrangler rollback <version-id> --env production --message "rollback: <reason>"
  node ../../infra/scripts/smoke.mjs https://<DOMAIN>
  ```
  **Not yet tested** (needs a real deployment) — the G4 checklist requires one rehearsal on staging.

## 5. Incidents
### 5.1 Capture abuse, cost spike or a bad page in the news → kill switch
New captures off in seconds, no deploy. Cached runs and the curated/offline stages keep working; the game shows
the build error screen with the featured stages as alternatives.
```sh
cd apps/worker
pnpm exec wrangler kv key put --binding CACHE "kill:capture" "on <date> <reason>" --env production --remote
# undo:
pnpm exec wrangler kv key delete --binding CACHE "kill:capture" --env production --remote
```
(Verified locally: with the key set, `POST /api/stages` for a new URL answers `429 RATE_LIMITED` "building new
sites is paused…"; cached URLs still return 200 — docs/launch/evidence/kill-switch.txt.) The permanent form is the
var `CAPTURE_ENABLED = "0"` in `wrangler.jsonc` + deploy.

### 5.2 Takedown / opt-out request
Follow docs/launch/legal-drafts/takedown.md (operator procedure). The opt-out is enforced before the cache
lookup, so it applies at once to cached runs too.

### 5.3 Pairing abuse (room flooding, code guessing)
Symptoms: DO requests spike, `ROOM_CREATE_LIMITER` 429s, `over the rate cap` room lines. The per-IP limits are
in `wrangler.jsonc` (`ratelimits`). Harder options: a WAF rate-limiting rule on `/api/rooms` (dashboard), or
lowering `ROOM_CREATE_LIMITER`. The structural fix (a pairing secret in the QR link) is an open CCR (checklist).

### 5.4 Leaderboard spam
```sh
pnpm exec wrangler d1 execute wwm --env production --remote --command \
  "SELECT id, name, score, verified, created_at, ip_hash FROM scores ORDER BY created_at DESC LIMIT 50"
pnpm exec wrangler d1 execute wwm --env production --remote --command "DELETE FROM scores WHERE id IN (…)"
```
Entries from one abuser share an `ip_hash` for the day. Unverified entries (`verified = 0`) are the usual suspects.

### 5.5 Browser Run failures / slow builds
Logs: `CAPTURE_TIMEOUT`, `RATE_LIMITED` ("all capture browsers are busy"). Check the Browser Run dashboard for
concurrency; raise `BROWSER_MAX_CONCURRENCY` (account limit: 120 on Workers Paid as of 2026-04) or engage the kill
switch.

### 5.6 Secrets
`IP_HASH_SALT` (≥ 16 chars): `pnpm exec wrangler secret put IP_HASH_SALT --env production`. Rotating it only
changes future hashes. Without it the Worker logs `IP_HASH_SALT is not set` and falls back to a public dev default.

## 6. Telemetry (off by default)
Client: `apps/web/src/telemetry` — no-op unless the web build sets `VITE_TELEMETRY_URL=/api/t` (GitHub variable
`WWM_TELEMETRY_URL`). Server: `TELEMETRY_INGEST = "1"` in the env's vars. Both need the user's approval and the
privacy notice's telemetry paragraph. DNT/GPC browsers send nothing.

## 7. Budget alerts (to set up in the dashboard — requires the account owner)
Billing → Notifications → "Usage-based billing" alerts at **$25 / $100 / $250 per month** (the estimates are
$7–9 at 1k plays/day and $32–99 at 10k, see cost-model.md), plus product alerts for Browser Run hours > 50 and
Durable Objects GB-s > 5 M per month. First response to an alert: check §2 dashboards, then §5.1.
