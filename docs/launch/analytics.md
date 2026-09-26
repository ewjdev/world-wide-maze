# World Wide Maze product analytics

Approved by the user on 2026-09-26 for implementation on a new branch, browser testing, provider validation and commit. Deployment/merge are separate from this branch's local acceptance.

## Architecture and configuration

Browser explicit events → same-origin `POST /api/t` → shared schema validation → PostHog US `/batch/` → saved reports. No PostHog browser SDK, DOM autocapture, replay, person profiles, fingerprinting, raw error messages or arbitrary URLs. Existing CSP stays intact. PostHog project **260845**; the `phc_` token in the Worker configuration is the public ingest-only token, not a personal API credential.

- Production: `VITE_TELEMETRY_URL=/api/t`, `TELEMETRY_INGEST=1`, `POSTHOG_HOST=https://us.i.posthog.com`, `POSTHOG_TOKEN`, `ANALYTICS_RELEASE=analytics-v1`. Changes take effect when the branch is deployed.
- Preview: client and Worker telemetry disabled explicitly; no production token. Development defaults also disabled.
- Local QA: override both switches, supply the public token and use `ANALYTICS_RELEASE=analytics-qa-20260926`. Development events are marked by the Worker, never trusted from the browser. `TELEMETRY_DEBUG=1` may log sanitized records only when `WWM_ENV=development`.
- Forwarding has a 5-second timeout. Batches of up to 20 records flush after 5 seconds; transient failures retry at most twice with unchanged UUIDs. Page exit uses a best-effort beacon. No durable offline queue; lost-network/browser-kill gaps remain possible.
- The endpoint is byte-capped at 16 KiB, bounded to 50 events, covered by the existing API read rate limit, cross-site protected and restricted to the official US/EU PostHog ingestion hosts. DNT/GPC are honored on both client and server.
- Production logs delivery counts/status only. They do not contain analytics IDs or event bodies. Client data remains untrusted and can be spoofed; this is product usage evidence, not score or security authority.

## Measurement contract

`packages/schema/src/telemetry.ts` is the source of truth. Unknown properties are stripped separately from envelope, context and event payloads. Enumerations prevent arbitrary strings from entering properties. Event UUIDs support provider deduplication. Each visit is a random UUID in sessionStorage with a 30-minute inactivity timeout; full-page navigation in the same tab preserves it. Separate tabs/devices may represent the same human.

| Question | Events / fields | Interpretation |
|---|---|---|
| Where did traffic come from? | `$pageview`, `route`, `source`, `medium`, `campaign`, device/browser/language | Categories only. Known source labels and campaign names (`launch`, `build-story`, `tribute`); unknown values become `other`. No raw referrer or UTM text. |
| Do visitors reach gameplay? | `$pageview` → `stage_loaded` → `played` → `finished` | Group by visit or attempt; deep links can skip title and Start. Keyboard players skip phone pairing. |
| Why does onboarding fail? | `pairing_started`, `paired`, `pairing_failed`, `controller_state`, `controller_connection` | Host and controller have different visit IDs and `surface`; never combine their counts as players. No room ID joins. |
| Where does building fail? | `build_started`, `stage_loaded.duration_ms`, `build_failed.code`, `build_cancelled` | Same `attempt` joins start/outcome. Duration is monotonic elapsed time including local load and presentation preparation. |
| How much do people play? | `engagement.active_ms`, `engagement.play_ms` | Non-overlapping DELTAS. SUM by visit/attempt first, then median/p90. Never average heartbeat rows as session duration. |
| Where do players stop? | `game_phase.phase`, `attempt`, timestamp; `ended.reason` | Last observed phase after 30 minutes of silence is an **inferred exit**, not a known exit reason. A received goal is completion; missing events alone do not prove a quit. |
| Is a level too hard? | `ended`, `stage_restarted`, `finished`, run/slice/input | Game-over and time-up are distinct; time-up may respawn. Completion rates use unique attempts. User-requested restart starts a new attempt. |
| Do players return? | `identity=browser`, `distinct_id`, `visit`, timestamp | Only users who selected optional browser measurement. Up to 90-day ID, not cross-device identity. Consent bias, cleared storage and blocked collection limit population claims. |

Activity is visible-page time within 30 seconds of recent pointer/key/scroll or host game-control input. Playing requires the `play` phase without a disconnect hold, portal prompt or travel. Intervals tick every second, cap a resumed interval at 2 seconds, and flush every 15 seconds plus phase/visibility/route/exit transitions. A pause can still be active website use but contributes zero play time. A page opened without further interaction contributes at most 30 seconds. This is an estimate, not a precise attention measurement.

## Identity and privacy

`/privacy/analytics` (linked from title, settings and showcase footer) offers Off, Measure this visit (default), and Remember my visits for analytics (optional). Persistent identity is never silently enabled. DNT/GPC override all choices. Off drops queued events and aborts outstanding fetch retries; events already delivered or dispatched by a browser beacon cannot be recalled. Switching back to visit-only removes the stored visitor ID. Browser ID expiry does not erase provider history.

PostHog setup selected the Free plan, whose UI states **1 million product events per month** and **one-year data retention**; no card or paid plan was selected. Browser IDs expire after 90 days. The draft full privacy notice has been updated to match; the live analytics page covers this feature specifically. Do not enable replay or automatic capture without a separate product/privacy review.

## Report definitions and operations

Production reports must filter `environment=production`; local acceptance uses `environment=development` and release `analytics-qa-20260926`. Do not mix those cohorts. Use visit and attempt IDs for totals and rates; `distinct_id` is only stable across visits when identity is `browser`. A sparse launch dataset is not enough to interpret retention or causal reasons for leaving.

The [player journey dashboard](https://us.posthog.com/project/260845/dashboard/2139055) has seven production reports and a separate development QA receipt report. Reference SQL and the [dashboard manifest](../../infra/analytics/manifest.md) live in `infra/analytics/`. The [QA report](evidence/analytics-browser-2026-09-26.md) and [build log](../build-log/analytics.md) record browser evidence, provider readback, automated checks and known manual-test limits. The normal PostHog UI is used for report creation; organization-wide external AI data processing was not enabled.

## Acceptance and rollback

1. Verify normal navigation, keyboard play, host/controller pairing and fallback, forbidden build, restart, pause/resume, hidden page and exit in the browser.
2. Read actual sanitized Worker records and acknowledged delivery; check identifiers/URLs/credentials are absent.
3. Read matching events back in PostHog Activity or SQL. Ingest HTTP success alone does not prove usable analytics.
4. Check Off emits nothing, browser identity appears only after selection, and return to visit-only clears the ID. Unit tests cover DNT/GPC, denied storage, schema boundaries, retry deduplication and active-time calculations.
5. Run `pnpm check`, production web build, and `node infra/scripts/check-deploy-config.mjs all`.
6. After a future merge/deploy, repeat a real production visit and verify its `environment=production` events. A local event in the hosted PostHog project is not proof of production deployment.

Rollback: set `TELEMETRY_INGEST=0` and rebuild with an empty `VITE_TELEMETRY_URL`. Existing gameplay is independent of analytics; failures must never block it. Keep preview/dev collection off after QA. Check event volume weekly; heartbeat volume is capped by activity and no frame/sensor stream is sent.
