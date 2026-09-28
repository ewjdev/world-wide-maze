# Cost controls — September 27, 2026

Eric approved a $50/month operating target and requested implementation in an isolated worktree with a PR. Base: `433943d` on main. Branch: `codex/cost-controls`. The original checkout and unrelated lesson/planning changes were preserved.

## Delivered for review

A persistent Budget Durable Object atomically accounts for admission using integer USD microdollars, UTC hour/day/month quotas, per-feature pools and concurrency leases. Paid work fails closed on missing/unavailable state. Conservative reservations are never automatically refunded. A fresh month requires operator reconciliation; no silent fresh allowance. Room renewals atomically replace their slot even at capacity, old jobs cannot start after their lease expires, and AI concurrency is shared across providers.

The guards cover hosted builds (including automatic/admin refresh), uploads, docent, automatic moderation, Jev provider calls, telemetry forwarding, replay/score submission, dynamic card generation, public API reads and R2 writes. Configured build/docent limits are lowered, AI retries are off, model/input/output sizes are bounded, browser keep-alive is ten seconds, routine logs are sampled at 10%, and preview public APIs are disabled. CLI voice generation needs an explicit character allowance and has no paid retries.

Operator controls are in the existing Access-protected admin page. They show reserved spend, threshold state and counters, accept upward spend reconciliation/measured storage, pause services/features and attest to PostHog's billing limit. `$25` is a dashboard/log warning, `$35` pauses optional work, and `$40` stops further positive-cost admission. These are not external email alerts or invoice caps.

Rooms have funded ten-minute leases, an absolute 30-minute lifetime and inactive-connection cleanup. SSE watchers/backpressure/lifetime are bounded. Home/log metadata is served as static HTML; static practice uses bundled assets and keyboard controls without API requests. Artifact caching rechecks current moderation policy before every hit. Existing reference-aware retention runs six times/day; card scan cursors persist across ticks. Storage credits are conservative and manual; no blanket or destructive orphan/history cleanup was introduced.

## Validation

- `pnpm check`: 112 test files passed, 3 skipped; 1,343 tests passed, 32 skipped. Typechecking passed. Biome reports existing warnings/informational diagnostics, no errors. Earlier failures identified the changed static-route expectation, a missing Budget export in the solver probe, and a test-environment assumption; all corrected. A first overloaded parallel run also hit timing-sensitive tests; the successful full run passed them.
- New real-workerd/SQLite tests: concurrent admissions cannot exceed two build slots or the $40 boundary; duplicate IDs cannot replay/refund; AI callers share slots; twenty occupied room slots can renew without opening a twenty-first; initialization/Access boundaries fail closed. Pure policy tests cover invalid units, daily/hourly/monthly limits, storage ceilings, UTC rollovers and feature/provider switches.
- Real WebSocket integration: abandoned sockets close while relay pings continue. Production keeps a 20-second inactivity threshold; the test uses a development-only five-second override. No phone input cadence changed.
- Catalog integration: normalized cache hits can serve an authorized artifact without another R2 read; subsequent domain blocks and review withdrawal still deny direct artifact URLs.
- Production web build succeeded. Chromium loaded `/play/practice?offline=1&backend=webgl`, reached phase `play`, accepted keyboard input, emitted zero `/api/` requests and reported zero page errors. Render inspected locally. This is browser evidence, not physical-phone acceptance.
- Deployment config validation passed for production and previews. Worker deployment dry-run succeeded; no deployment performed. Docent corpus regenerated and checked after documentation updates.

## Live inspection and uncompleted provider gates

Read-only inspection found production version `94b7a0cd-42db-4ee9-84ac-b40dcd324abb` on the baseline main commit. `ewj.dev` is an active Free Website zone. The current Wrangler OAuth session can read zone/deployment metadata, but AI Gateway configuration and both rate-limit/custom WAF ruleset reads returned 403. The Worker preview-list API returned an empty list; no previews were deleted. Production secret names confirm a gateway token and Typesafe key but do not prove the gateway's billing mode. No secret values were printed or committed, no billing limits were changed and no paid inference was exercised.

[Operator procedure](../launch/cost-controls.md) gives the initialization, monthly reconciliation, shutdown/restore and rollback steps. [Execution checklist](../../plans/cost-controls-execution.md) retains exact owner dashboard steps for Gateway, actual AI payer, PostHog, Cloudflare budget notifications, edge protection and ElevenLabs. Deployment will intentionally pause dynamic service until initial reconciliation. Provider/WAF settings, a preview-inventory recheck at rollout, live billing reconciliation, populated production D1 cost measurements and production acceptance remain explicit rollout gates. Theoretical cleanup capacity (1,200 runs/day) is not measured production throughput.

Application admission cannot cap denied-request flood charges or the whole shared Cloudflare account. Do not describe the site as fully protected until provider settings and the edge block/restore rehearsal are verified. Merge/deployment and any production acceptance are separate from this PR delivery.
