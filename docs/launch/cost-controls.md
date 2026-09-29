# $50 cost controls: operator procedure

Approved by Eric on September 27, 2026. Application controls are deployed. Capture and writes resumed with manual review on September 29 UTC; see the [restart receipt and remaining provider steps](capture-restart-2026-09-29.md). **$50 is an operating target, not a guaranteed maximum invoice.** Denied Worker requests, existing storage, independent CLI runs and shared provider accounts can still incur charges. Complete the provider settings and emergency edge procedure below before enabling paid work.

## What the application enforces

`apps/worker/src/budget-policy.ts` is the source of truth. Amounts are integer USD microdollars. The singleton Budget Durable Object atomically checks and debits operation, byte, dollar and concurrency allowances with synchronous SQLite transactions. Multiple clients cannot each receive a separate allowance. Failures and ambiguous timeouts keep the entire reservation; there are no automatic refunds. Lost concurrency leases expire. Queued jobs check their lease before starting. Request IDs for leased work cannot execute twice during their 24-hour retention window.

| Control | Behavior |
| --- | --- |
| $25 | Warning visible in operator snapshot; a structured threshold log is emitted |
| $35 | New builds, moderation, Jev, card renders and telemetry stop; essential reads, existing play and docent remain subject to remaining allowances |
| $40 | No further positive-cost admission; existing funded work may finish; no room renewal |
| Pools | AI $10, build $10, room $10, other $5, plus at least $5 fixed/prior-spend reserve |
| Builds/uploads | 60 per UTC hour, 300/day, 3,000/month; two shared slots; $0.01 each |
| Docent | 100/day, 1,000/month; $0.01 per attempt; bounded prompt, 600 output tokens, no retries |
| AI overall | $1 per UTC day; two slots shared by docent, moderation and Jev; no paid model fallback |
| Rooms | 20 funded slots; ten-minute reservations; 30-minute absolute session life; inactive connections close; at most 20,000 minutes/month under the $10 pool |
| Scores/cards | Two slots per kind, $0.01 per attempt; scores 1,000/day and 10,000/month; cards 60/hour, 300/day and 3,000/month |
| Telemetry | Disabled until provider-limit attestation; 20,000/day and 500,000/month; rejected collection returns terminal 204 |
| Public dynamic requests | Local 100/minute/IP guard, then global 100,000/day and 1,000,000/month ceilings at $0.000020/request; other pool can stop these sooner; negative admission cached for 30 seconds |
| R2 writes | Reserve attempted bytes before writing; 10 GiB/month new writes, 20 GiB reconciled occupancy ceiling; no automatic credits for failed writes, overwrites or deletions |
| Public previews | Dynamic APIs denied; capture/real AI/telemetry off; bundled static practice available |

Unit caps are ceilings, not promised capacity: dollar pools bind earlier. The cost ledger is deliberately conservative and distinct from actual invoiced spend. Ten-minute build/score/card leases are crash recovery limits, not permission to increase the Worker CPU ceiling. AI attempts have absolute timeouts shorter than their leases. No central budget call occurs on a WebSocket frame.

Home and `/log` are static assets; `/play/practice?offline=1` uses bundled geometry/textures, keyboard control and local scores, without API/relay/telemetry calls. Normal clients seeing a global shutdown response stop further API attempts for that page session and show the static practice link. Reload to retry after service resumes. Feature-specific denials retain existing local-score, source-link and keyboard fallbacks.

Artifact caching happens **behind** a current catalog authorization on every request. Browser responses stay `private, no-store`; warm cached stages/textures do not bypass a subsequent takedown. Cleanup keeps the existing reference-aware catalog deletion rules and now runs six times/day. It does not blanket-expire a bucket, delete curated content, erase review history or remove audio.

## Reconciliation and paid activation

Merging to main triggers the production deployment workflow when `WWM_DEPLOY_ENABLED=true`. A new production ledger starts **uninitialized**, so public dynamic routes return 429 while static pages work. Telemetry also starts unapproved. Plan for this intentional pause; do not “fix” it by setting `COST_CONTROLS=0` (production ignores that bypass).

1. Check the dated [restart receipt](capture-restart-2026-09-29.md) and M1–M6 in [the execution checklist](../../plans/cost-controls-execution.md). Gateway limits, edge rules and billing alerts are now configured through authenticated dashboards. AI payer, analytics and voice gates still apply to those features.
2. Record actual billing mode, current-month usage, fixed fees, shared-account allowances, existing preview usage and storage. Worker secret **names** include `AI_GATEWAY_TOKEN`, `IP_HASH_SALT`, `TYPESAFE_API_KEY`; this does not establish whether the gateway holds a BYOK key or uses Unified Billing. Never paste key values into chat, source files or the PR.
3. Verify the deployed commit/version and complete smoke checks. Preview smoke explicitly expects a shutdown; production smoke reports intentional budget pause separately from normal online service. A passing paused smoke is not provider acceptance.
4. Sign in at `https://wwm.ewj.dev/admin` through the existing Cloudflare Access application. Select **Load cost controls**. Before enabling, verify month, uninitialized status and saved switches.
5. In **Reconciled total (USD)** enter at least $5 and enough to cover fixed fees + month-to-date WWM spend + uncertainty. When reconciling an existing ledger, never lower reservations; add previously unaccounted spend. Example: $5 fixed + $3 prior usage + $2 uncertainty means enter **10**, not 5. Do not blindly use this example.
6. Measure the `wwm-stages` bucket's actual byte occupancy (R2 bucket metrics/export). Enter exact bytes in **Measured stored bytes**. Include retained orphaned objects. Separately account for D1, KV, learning audio and old previews in the spend total. If the metric is delayed, round up and record the source/time. Do not initialize to zero unless verified empty.
7. Save reconciliation. The response must show initialized, the correct UTC month and the saved values. Leave individual features paused until their provider checks are complete. Leave the PostHog checkbox unchecked until the organization billing cap and remaining shared allowance are verified.
8. One bounded acceptance request per enabled service: capture/moderation stays gated correctly; docent returns expected citations; room pairs and expires; a valid score stays verified; telemetry provider receipt arrives; stored byte reservations increase. Read back the operator counters and provider usage. No broad load test against paid production.

At every UTC month boundary the ledger pauses again and clears monthly/day counters while preserving storage estimates and switches. Repeat reconciliation before opening the next month's allowance. No automatic reminder or recurring account mutation was installed.

## Pause, restore and emergency flood procedure

For an ordinary budget stop, use **Pause online services** or the per-feature checkboxes at `/admin`. The authenticated admin path remains available. Existing room leases stop renewing and close within at most ten minutes; already-paid operations may finish. A read-denial cache can delay a resume by up to 30 seconds. At $40, spend cannot be reset downward; keep services paused until the next period or a separately reviewed policy change.

For a request flood, application rejection is insufficient: Workers still execute and can be billed. On **Cloudflare → ewj.dev → Security rules**, prepare the disabled custom rule `wwm-emergency-dynamic-stop`, action **Block**, using:

```text
(http.host eq "wwm.ewj.dev" and
 (starts_with(http.request.uri.path, "/api/") or
  starts_with(http.request.uri.path, "/s/") or
  starts_with(http.request.uri.path, "/r/") or
  starts_with(http.request.uri.path, "/j/")))
```

Check rule ordering and any Skip rules, save disabled, and record its ID. Rehearse during a controlled window after static practice is deployed: pause application services, enable the rule, confirm `/api/health` and a POST to `/api/stages` are blocked at the edge while `/`, `/log` and `/play/practice?offline=1` still load/play. Verify Security Events and Worker invocation metrics. The rule blocks the budget API too; disable it in Cloudflare to regain that API. Restoring the edge rule does not restore the budget automatically.

This expression does not protect alternative hosts. Disable the production `workers.dev` route if it is unused, or protect it with Access; do the same for published preview URLs. At inspection, the Cloudflare Worker preview-list API returned no previews. Recheck **Workers & Pages → wwm → Previews** before rollout and delete only obsolete ones after identifying their owning PR. Wrangler 4.140.0 does not provide a `preview list` command. Existing previews retain old code until updated/deleted. Production and shared-account provider settings must not be copied into arbitrary previews. The restart receipt records the dashboard-installed rules. Production alternate hosts and GitHub preview automation are disabled; a deployment guard preserves that setting.

For routine per-IP edge limiting on the Free zone, use its available rate-limiting rule with hostname `wwm.ewj.dev`, path starts with `/api/`, IP counter, **100 requests per 10 seconds**, **Block for 10 seconds**, if these fields are offered. [Parameter reference](https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/). Verify plan-supported fields before saving; do not purchase an upgrade or replace an unrelated rule. Start by observing normal pairing, uploads and page loading. If the plan cannot express this rule, retain the application guard and the custom emergency block and record the missing preventative layer. This rate limit is per IP, not a global dollar cap.

## Billing controls and remaining provider configuration

Detailed click paths and evidence requirements are in [M1–M6](../../plans/cost-controls-execution.md#manual-setup-m1--cloudflare-ai-spend-rules):

- **AI Gateway `wwm` (saved/read back):** aggregate $1/day and $10/month spend rules; no dimensions; confirm tracked models/callers. [Provider instructions](https://developers.cloudflare.com/ai-gateway/features/spend-limits/).
- **Actual AI payer:** dedicated Anthropic workspace $10/month cap if BYOK; otherwise inspect Unified Billing/recharge. Preserve settings for unrelated projects sharing the account. Gateway limits are estimated and can overshoot.
- **PostHog project 260845:** organization billing, Product analytics limit $0 if supported and verified to mean free allowance only; inspect every enabled product. Otherwise keep forwarding paused. [Billing limits](https://posthog.com/docs/billing/limits-alerts).
- **Cloudflare account alerts (saved/read back):** $25/$35/$40 using the recipient prefilled by Cloudflare. Existing alerts were retained. These are account-wide usage notifications, not WWM-only caps. Email delivery has not been tested. Application threshold logs are sampled and the operator snapshot is on-demand; neither is an email alert.
- **ElevenLabs:** verify usage-based billing / PAYG recharge for the owning account. Public visitors only play existing audio. For a reviewed CLI run, first use `pnpm learning:voice` (dry run), then explicitly set `WWM_VOICE_MAX_CHARACTERS` to 1–10,000 for `--write` or `--audition`; each attempted call consumes that invocation's allowance and retries are off. This is not a monthly provider cap.

## Retention, monitoring and rollback

Review provider spend against the ledger after activation and during growth. Include gateway fees/taxes where applicable. A material excess over reservations means pause the affected service, increase the reconciliation upward, and review its unit estimate before resuming. Existing storage is billed even when reads/writes stop. The original demand model remains available for comparison; run `node infra/scripts/cost-model.mjs --protected` for the committed allowances and an uncapped denial-flood scenario.

Cleanup is bounded to 200 runs per tick (theoretical 1,200/day vs 300 admitted builds/day), with pending evidence expiring after seven days and approved non-curated runs after 30. Card scanning is capped. Orphan discovery and catalog/score history deletion are not automatic in this PR; the conservative storage counter never credits cleanup. Measure/reconcile after deletion. Do not set blanket bucket lifecycle expiration: scores/ghosts, curated stages, shared capture textures and voice clips have reference requirements.

Rollback must retain the Budget namespace and its migration history. Prefer pausing features and rolling forward a fix. Deploying pre-control code would bypass the ledger; first activate the edge block and leave provider limits in force. Do not delete the ledger or restore old code with paid paths open. An application rollback does not roll back provider billing settings.
