# Phase 21 — URL catalog and content review

Date: 2026-09-26. New product behavior, not recovered 2013 behavior.

## Changes

Implemented the approved plan in the managed `url-catalog-moderation` worktree on `codex/url-catalog-moderation`. Added D1 catalog/attempts/review/audit/build claims; R2 private evidence retention; KV-to-D1 fallback; shared authoritative policy gates; bounded optional classifier; Access-protected operator APIs and a lazy `/admin` console. Added contract version 0.3.3 through CCR-21-1. Shared upload identity covers evidence bytes. Review/removal preserves catalog history.

Automatic classification is opt-in and fails to private review. Existing non-curated captures migrate to pending. The intended deployment sequence and precise local/deployed boundaries are in [the validation rubric](../launch/url-catalog-validation.md).

## Validation

- `CI=true VITEST_MAX_WORKERS=4 pnpm check`: **passed**, 85 test files passed / 2 skipped; **1,139 tests passed / 14 skipped**, 185.83 seconds. Typecheck and lint pass; one pre-existing CSS specificity warning and one info diagnostic remain. Skips include optional reference/device coverage and the CI-disabled graphics check; no skipped result is counted as validation.
- `pnpm --filter @wwm/web build`: passed (existing large Three.js chunk warning).
- `pnpm exec wrangler deploy --dry-run --outdir /tmp/wwm-phase21-worker` from the Worker directory: passed; bundle only, no deployment.
- `node apps/web/src/admin/validate-browser.mjs`: **13 checks passed**, desktop and 390px mobile, no overflow or browser errors. Nine admin unit/API/SSR tests also pass in the full suite.
- `git diff --check`: passed.

Evidence includes real local workerd/D1/R2/KV serving tests, migrated SQLite catalog/API tests, real RS256 token fixtures, synthetic moderation provider tests, upload identity regressions, and a real Chromium same-host redirect test proving the blocked target was never fetched. Admin browser tests use intercepted APIs; they do not verify deployed authentication or provider quality.

Earlier runs exposed and corrected stale immutable-cache assertions, missing approval on shared game fixtures, the upload content-ID expectation and a retention-query typo. Unbounded local test concurrency also produced timing-sensitive controller failures; those tests passed in a focused rerun and the complete four-worker CI-mode run. No controller production code or assertion was weakened.

Review screenshots: [desktop](assets/phase-21/admin-desktop.png), [mobile](assets/phase-21/admin-mobile.png). Both contain synthetic evidence and operator identity.

## Risks and handoff

- Deploy additive migration before the new Worker; configure real Access before expecting admin availability.
- Review legacy non-curated withdrawal and provider evaluation before enabling automatic approval.
- Local no-store responses cannot recall existing client/CDN/social copies; preview and production takedown drills remain required.
- Two-region performance, storage/cost trends and classification false-positive rates need live measurement.
- No remote deployment, production data mutation or merge performed as part of this implementation request.
