# Phase 12 — Launch Hardening & Deploy

**Wave:** 4 · **Depends on:** 08, 09, 10 (and 11 if included) · **Produces:** G4 "Public demo"

## Goal
Take the game from "works on our machines" to a public demo that's measured, observable, safe and cheap to run, with honest published performance numbers.

## Read first
- `plans/00-overview.md` §5
- `research/recreation-plan.md` "Implementation sequence" (the provisional targets and *how* to report them)
- The `cloudflare`, `wrangler`, `workers-best-practices` and `web-perf` skills

## Owns
`infra/**` (deploy scripts, environments), `.github/workflows/deploy.yml`, `docs/launch/**`, `apps/web/src/telemetry/**`, `tests/load/**`, plus cross-cutting **fix-up PRs coordinated through the orchestrator** (list every file you touch outside your owned paths in the hand-off)

## Tasks
1. **Environments:** `staging` and `production` Workers, R2, D1 and KV, secrets management, a custom domain with HTTPS (required for DeviceOrientation), and COOP/COEP headers if physics uses SharedArrayBuffer. Deploy the web app as Workers static assets.
2. **Measurement report** (`docs/launch/performance.md`), recording the device, browser, network and method for each:
   - Frame-time distribution on 3 named desktops (integrated GPU, midrange, high end) across 5 stages, showing the quality ladder tier reached.
   - **Controller-to-visible-motion latency:** camera-filmed end-to-end tests (high-speed phone video of the phone plus the screen) on the same Wi-Fi and cross-region, plus RTT logs. Target under 100 ms on normal networks. **If the target is missed**, evaluate a WebRTC DataChannel upgrade and write a recommendation.
   - Time-to-first-control for a new player (target under 30 s): 5 fresh users, recorded.
   - Cold and warm stage-build latency p50/p95 for 30 URLs.
3. **Device matrix:** iOS Safari (2 iOS versions), Android Chrome (2 devices), and desktop Chrome, Safari, Firefox and Edge. Check pairing, permission denial, backgrounding, rotation, reconnect, and keyboard-only. Record results in a checklist table.
4. **Load and abuse tests:**
   - k6 or Artillery against the API, with 200 concurrent rooms relaying 60 Hz input.
   - A burst of 50 concurrent new-URL builds: verify the queueing, the Browser Rendering concurrency cap, rate limits, and that the UI degrades gracefully to curated stages.
5. **Security review:**
   - Run the `security-review` skill on the worker.
   - Re-verify the SSRF suite against production config, and check CSP headers, input size limits, scores-API abuse, and the DO message size and rate caps.
6. **Observability:**
   - Workers Logs and Analytics, error tracking in the web app (a privacy-respecting and minimal setup), a funnel (title → paired → played → finished), build-failure reasons, and solver-failure classes.
   - A dashboard link in `docs/launch/runbook.md`.
7. **Cost model:** estimated monthly cost at 1k, 10k and 100k plays per day (Browser Rendering minutes, DO requests, R2, D1, AI if Phase 11 is included), plus cache hit rates. Set budget alerts.
8. **Legal and policy pages:**
   - Privacy (what's captured and stored, retention from Phase 07, opt-out domains).
   - Takedown and opt-out contact, and terms.
   - A tribute disclaimer (not affiliated with Google; credits).

   **Flag for user review. Don't publish these without approval.**
9. **Launch checklist** (`docs/launch/checklist.md`), where every item is green with evidence:
   - All gates G0–G3 passed.
   - A fresh-browser end-to-end playthrough on production.
   - Phone onboarding works on the device matrix.
   - Curated stages load with capture disabled (the kill switch works).
   - Known limitations are published on `/about`.
   - The rollback procedure has been tested once.
10. **Deploy:** a GitHub Actions deploy to staging on `main` and to production on tag, with D1 migrations applied in CI. **The production deploy requires explicit user approval.**

## Acceptance criteria (= G4)
- `docs/launch/checklist.md` is all green with linked evidence.
- The performance report is published with real measurements (no estimates presented as measurements).
- The user has approved the legal pages, the curated list and the production deploy.

## Out of scope
New features. Any feature bug found gets routed back to the owning phase by the orchestrator.
