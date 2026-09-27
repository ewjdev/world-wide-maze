# URL catalog: validation rubric and rollout

Phase 21, 2026-09-26. This rubric separates local implementation evidence from deployment acceptance. A passed synthetic classifier test demonstrates control flow, not classification accuracy.

## Operating defaults

- D1 owns catalog, review decisions, current approved variant, attempts, build claims and audit events. R2 holds private versioned evidence/stages. KV accelerates lookups; every hit still passes D1 policy and artifact checks. No public R2 bucket is required.
- Variants hash normalized URL, effective seed, difficulty and builder version. A missing KV pointer falls back to D1. A pending, failed or incomplete refresh cannot replace an existing approved pointer. Shared uploads have content-derived identity and are excluded from canonical URL variants.
- `MODERATION_MODE=manual` is committed for all environments. New captures become private pending review. `auto` enables bounded screenshot + every slice + text evaluation through the configured Anthropic AI Gateway. Uncertainty, unavailable provider, malformed output and oversize evidence stay pending. The 0.95 confidence threshold is provisional, not calibrated. `test-allow` works only in development.
- In auto mode, an approved variant older than seven days may trigger one background refresh; the approved version stays playable. Refreshes obey URL policy, kill switches, capacity limits, claims and a 24-hour retry throttle. Operators can request explicit recapture in manual mode.
- Approved non-curated artifacts expire using `RETENTION_DAYS` (30 in production, 7 in preview). Pending/blocked evidence expires after seven days. D1 metadata and audit history are retained; this includes canonical URL queries, visible only to authorized operators. Raw query values are suppressed in application logs. Establish a metadata deletion/privacy policy before unrestricted public use.
- New user-content responses use `private, no-store`, including share cards. Immutable R2 object keys still permit server-side reuse. Already downloaded browser/social-network copies cannot be recalled by this change.
- Existing curated runs are backfilled approved; other legacy runs become pending. This deliberately withdraws their hosted direct links until reviewed. Featured placement remains separate from content approval.
- Configure `ADMIN_ACCESS_TEAM_DOMAIN`, `ADMIN_ACCESS_AUD`, and comma-separated `ADMIN_EMAILS`. Put both `/admin*` and `/api/admin/*` behind the same Cloudflare Access application. The Worker independently verifies signed Access tokens and the email allowlist, including on workers.dev/preview bypass paths. Empty configuration returns 503.

## PR acceptance rubric

| Requirement | Pass criterion | Evidence / status |
|---|---|---|
| Durable reuse | KV deletion returns the same approved run while capture is disabled; pointer repopulates | Real local workerd with D1/R2/KV: `catalog-serving.integration.test.ts` |
| Version and seed identity | Equivalent effective seeds reuse; new builder/seed/difficulty separate variants; uploaded evidence bytes cannot collide through a claimed ID | `units.test.ts`, `upload-identity.test.ts`, `upload.integration.test.ts` |
| Refresh isolation | Failed/pending/incomplete refresh preserves approved pointer; only one lease owner builds | `catalog.test.ts`, `catalog-serving.integration.test.ts`, `refresh.test.ts` |
| Revocation | Warm KV cannot override URL/domain/run blocks; run, stage, texture, scores, ghost, share page and card reads stop | `catalog-serving.integration.test.ts`, `catalog.test.ts`; curated and journey gates also covered by worker/card suites |
| Safe intake | All screenshots/slices considered; timeout/error/uncertainty remains private; block before job completion prevents publication | `moderation.test.ts`, `pipeline.test.ts`; provider mocked |
| Capture policy | Exact URL/domain checks apply to submitted/final URLs and browser requests, with existing DNS/SSRF defenses retained | Policy and pipeline test suites |
| Admin authorization | Invalid signature/audience/issuer/expiry/non-operator denied; unconfigured endpoints fail closed | `admin-auth.test.ts` real RS256 fixtures; workerd unconfigured routes; admin route tests inject valid identity separately |
| Operator decisions | Reason + actor audit, approve/block/reverse, URL/domain rules, all-slice evidence, failed attempts, recapture and removal work | `admin-routes.test.ts`, `catalog.test.ts`, real migrated SQLite and storage doubles |
| Retention | Metadata survives expiry; shared capture objects retained until last reference; interrupted removal retries | `catalog.test.ts`, `worker.integration.test.ts` |
| Admin usability | Desktop/mobile layout, auth/error states, pagination, failed actions, evidence and confirmation before removal | 9 UI tests and 13 Playwright checks using intercepted synthetic APIs; 390px mobile visual review |
| Repository health | Typecheck, lint, complete tests and production web bundle pass | See phase-21 build log for executed results |

## Deployment gates — not claimed by local tests

1. **Preview migration/readback:** back up D1, apply additive `0005_url_catalog.sql` to preview first; count runs vs moderation cases, inspect legacy statuses and missing R2 references. Review withdrawal of non-curated legacy links. Never deploy the new Worker before its tables exist.
2. **Real Access:** configure Access and allowlist, sign in as an operator, confirm real JWT/JWKS flow and evidence reads. Verify unauthenticated, wrong-account and direct Worker hostname access are denied; perform one reasoned decision and read its persisted event back.
3. **Provider evaluation:** review provider data handling, disable gateway content logging, use owned/permissioned labeled captures including explicit content, educational/medical/art exceptions, bot walls, login pages, ambiguous images and below-fold slices. Record precision/recall, false-positive review load, timeout rate and costs before enabling `auto`. Pending review is the fallback, including unsupported content. No classification quality claim is made yet.
4. **Two-region cache/latency:** exercise approved warm KV, deleted KV/D1 fallback, changed screenshot, builder change and simultaneous submissions from two regions. Record p50/p95 and Browser Rendering calls. Required functional target: zero captures for a reusable approved variant. Set latency budgets from these measured baselines; local workerd timing is not a global latency result.
5. **Takedown drill:** warm each content route, set an exact URL rule and then a domain rule; verify fresh requests deny across both regions, including redirected submissions, uploads, curated/portal destinations, cards and completed-job SSE. Audit/purge prior CDN public responses where supported; document unrecoverable client/social caches. Artifact removal must preserve audit rows and retry incomplete R2 deletion.
6. **Activation:** review preview evidence before production migration/deployment. Keep manual review initially, monitor capture attempts/queue age/serve latency/provider cost, then enable `auto` gradually. Queue age/storage growth and false-positive trend dashboards are operational follow-up work, not claimed UI features in this PR.

## Operator runbook

- Search `/admin` by URL or host. Inspect screenshot and every raw slice before approving. A blocked capture with no built stages needs a recapture; approval cannot fabricate missing artifacts.
- To stop all versions, add an exact URL or domain/subdomain block with a reason. Run-only rejection affects one version. Clear the same rule explicitly to reverse it; clearing does not restore removed artifacts or override another applicable block/legacy owner opt-out.
- Site-owner opt-outs remain separate legacy `optout:<domain>` rules. Clearing a moderation rule does not clear an owner opt-out. Existing takedown/legal drafts still govern the operator procedure.
- If the UI is unavailable, an authorized operations engineer can insert/update the D1 `policy_rules` row and append `moderation_events` in a D1 batch, recording actor, target and reason. Use the schema and normalization from `Catalog.setRule`; include both final and submitted host associations when removing featured placement. Verify direct-ID denial before R2 cleanup. Do not treat KV deletion as a block.
- Removal first revokes D1 availability, then removes private artifacts. A deletion-pending flag makes interrupted work retryable on the retention cron. Removal is irreversible; rule/decision reversal is possible only while artifacts remain.
- Roll back activity with `MODERATION_MODE=manual` and the existing capture kill switch. Preserve migration tables and serve gates. Do not roll back to the old unconditional content reads. If KV is faulty, delete its pointer and use D1 fallback; never restore a KV-only allow decision.

## Scope boundaries

No production migration, deployment, live classifier call, real Access sign-in, remote cache purge or regional benchmark is represented as completed by this PR. Catalog history begins with retained legacy runs and new attempts; previously deleted runs/URLs cannot be reconstructed. Private client-only mazes stay local. Model verdicts and classifiers are fallible; operator review and block overrides remain available.
