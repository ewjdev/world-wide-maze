# Jev administration

Jev is available only to authenticated, allowlisted administrators at `/admin/jev`. `/admin` contains the provider enable switch, daily USD cap and current budget ledger. Every `/api/admin/jev/*` request verifies the existing Cloudflare Access JWT and admin email allowlist. Admin HTML routes also go through the Worker. There is no deployed public `/api/jev` endpoint. Static JavaScript is public, but it contains neither credentials nor saved runs.

## Defaults and activation

New Durable Object namespaces start **disabled, with a $0 daily limit**. The Worker also requires the `TYPESAFE_API_KEY` secret before it can call Jev. Nothing in this change uploads a secret or enables paid calls. Keep `/admin*` and `/api/admin/*` in the existing Cloudflare Access application, including the spectator subroute. The API independently rejects bypass requests.

After deployment, configure the server secret through the normal authorized secret-management process. In `/admin`, set a positive daily limit and enable provider calls, then save. The controls apply only to that deployment. Production and preview have separate Durable Object namespaces and budgets. Disable preview usage or use a separate key if account-wide isolation is needed.

Disabling blocks new billable dispatches; already reserved/in-flight calls can finish. Baseline runs and replay remain available. Jev chooses targets; the physics controller steers. Jump is currently disabled. Saved scores remain private and are not submitted to the public leaderboard.

## Spend contract

The ledger uses integer microdollars and reserves **$0.002688 per call** before dispatch, based on the pinned `jev-1.13.0` model’s maximum 64,000 input tokens at $0.042 per million input tokens, with free output tokens ([TypeSafe pricing](https://docs.typesafe.ai/models), checked 2026-09-27). Review this contract before changing the model or when provider pricing changes. This is an enforced cap on **estimated TypeSafe spend by this deployment**, not a provider invoice guarantee or a cap on Cloudflare hosting or other applications using the same key.

A single SQLite Durable Object serializes reservations and commits the journal and budget reservation atomically. It waits for durable storage before dispatch. A valid provider receipt settles the reservation to rounded-up input-token cost. Missing, invalid, oversized or timed-out responses retain the full reservation; automatic retries never refund it. Duplicate attempt IDs cannot spend twice. Turning Jev off/on, changing limits, restarting, replaying or reconnecting does not clear the ledger. Lowering the cap below existing usage leaves zero remaining capacity.

Days reset at **00:00 UTC**, based on dispatch reservation time. A late receipt settles the original day. All admin users share this cap. A request is refused unless the remaining balance can cover the full reservation, so a small unused balance may remain. Settings changes record the verified admin email and timestamp. Individual reservations retain run/attempt IDs and day for audit.

## Persistence and limits

Runs, maze snapshots, decision frames, provider receipts, movement recordings and outcomes are stored in private Durable Object SQLite. Large journal records are split into Unicode-safe pieces. Owner capabilities are persisted as hashes and are required in addition to admin authentication for mutation. A refreshed/disconnected owner produces an interrupted run; history is retained and can be replayed or exported. Only the initiating browser currently streams the live physics display; another admin can inspect saved history.

The existing 64 provider attempts/run, 32 MiB/run and 512 MiB archive limits remain. The local pilot’s 600 lifetime-attempt limit is replaced by the daily USD cap for cloud runs. Archive capacity fails closed; no history is silently deleted. Export records and implement an explicit retention/capacity operation before this archive fills. The SQLite journal is designed for this bounded admin pilot, not an unrestricted public service.

`pnpm dev:jev` remains a separate local pilot at `/dev/jev`, reading ignored `.env.jev` and preserving `local/jev`. Its lifetime attempt cap is separate from the deployment budget. Local run history is not automatically uploaded. Local `/admin` still requires an authenticated backend; there is no development authentication bypass in the deployed code.

## Validation (2026-09-27)

- 50 focused tests passed: budget bounds and concurrent reservations, UTC rollover, settlement idempotency, disabled/exhausted dispatch, uncertain outcomes, reservation/journal rollback, large Unicode records, admin authentication/origin/body caps, plus existing runtime/physics/score/replay checks.
- 10 additional tests passed, including actual workerd SQLite/RPC settings and run-journal round trips and existing admin client tests.
- Repository type checking, production web build and production Worker deployment dry run passed. Lint retains existing warnings.
- Desktop/mobile browser checks used synthetic authenticated API fixtures to verify switch and dollar-to-cent updates, saved state, layout and spectator navigation. They made no paid provider calls and do not constitute production Access acceptance.
- Production deployment, real Access login and a paid cloud Jev run have not been performed. Defaults remain off/$0 until an admin explicitly changes them.
