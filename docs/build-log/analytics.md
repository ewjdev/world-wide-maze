# Build log: explicit website and game analytics

- Date: 2026-09-26.
- Agent: Codex, with a separate browser-validation sub-agent requested by the user.
- Branch: `feat/product-analytics`, based on `fix/portal-dismiss-once` at `9b19e1b`.
- Authorization: implement the analytics plan on a new branch, commit it, independently browser-test it, and validate analytics in PostHog. The user also selected optional return-visit measurement. No production deployment, merge or push was requested or performed.

## What changed

Extended the existing first-party telemetry endpoint into a versioned, shared-schema pipeline to PostHog project 260845. Explicit events cover website navigation, onboarding/pairing, building, gameplay, completion/failure, retries and outbound clicks. Visit and stage-attempt IDs support meaningful counts; provider UUIDs support deduplication on bounded retries.

Active and play duration are monotonic, non-overlapping deltas. Hidden, idle, paused, disconnected and portal-prompt time are handled explicitly. Host/controller surfaces stay separate. Last observed game phase is an inferred stop after inactivity, not a claim about a player's reason for leaving.

Added an English/Japanese analytics preference page linked from title, settings and website footer. Visit-only is the default; persistent browser identity requires the optional choice and expires after 90 days. Off, DNT and GPC suppress capture. Arbitrary URLs, captured content, room/pairing credentials, raw errors and client IP are excluded. No replay, autocapture, third-party browser SDK or person profiles were enabled.

Production configuration is prepared to collect after deployment; preview/dev defaults remain disabled. PostHog's existing project was configured on its Free plan; report definitions and saved links are in `infra/analytics/`. The organization-level external AI processing opt-in was left untouched.

## Verification

- Independent browser pass: actual app on localhost:5174 through local Worker:8790 to PostHog US. Navigation, pairing/no-sensor fallback, keyboard gameplay, failed build, pause/resume, restart, exit, optional identity and opt-out tested. See [browser report](../launch/evidence/analytics-browser-2026-09-26.md).
- Provider transport snapshot: 114 sanitized records, 38/38 batches accepted. PostHog SQL returned stored host/site/controller events. Exact final `title` and `game_phase` UUIDs were read back for visit `0c2773d7-75a2-48fb-9cf1-f18c50feeecb`; occurrence 18:18:47 UTC, Worker receipt 18:18:52.271 UTC.
- Browser testing found duplicate development title events from React StrictMode. Observer attachment now skips the discarded mount; fresh browser readback confirmed one title and one initial phase.
- Additional review fixed denied-storage-write handling: current-page opt-out remains honored, and failed persistence never claims browser identity.
- Production web build and production/preview deploy-config checks passed. The analytics base module imports the small constants export, preserving lazy loading of schema/game code.
- Initial `pnpm check`: 78 suites passed, 1 skipped; 1,054 tests passed, 11 skipped. Final check after the storage regression test: typecheck/lint passed and all 1,055 assertions passed; the share-card suite failed only its existing 60-second `afterAll` server-close hook. Isolated rerun of that suite passed all 40 tests and cleanup (38.30 seconds). No unrelated test-harness code was changed.
- Seven production reports were saved and read back in PostHog, plus a separate QA receipt table. Development variants returned the expected 2 visits → 1 loaded → 1 played → 0 finished funnel and 8.928 seconds of play. Temporary QA servers were stopped after verification; the user's existing development servers were left running.
- Existing style warnings, Node experimental warnings and large game-bundle warnings remain unrelated to this change.

## Remaining release boundary

The branch is locally implemented and provider-validated. Production collection still requires deployment and a real production visit/readback. No physical phone tilt or full stage completion was manually exercised; lifecycle unit tests and the repository's replay tests cover those deterministic game transitions. Return metrics describe the opt-in cohort, not all people or cross-device identity. Browser blocking, sudden process termination and network loss can leave gaps.
