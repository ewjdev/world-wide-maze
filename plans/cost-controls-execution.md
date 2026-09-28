# WWM cost-control execution plan

Prepared September 27, 2026. **Eric approved $50/month and implementation in one worktree/PR.** Application controls are implemented for review; provider settings and production activation remain outstanding. The original work packages below are consolidated into one PR; [the operator procedure](../docs/launch/cost-controls.md) is authoritative for the implemented limits and activation steps. Supporting audit: [cost-controls.md](cost-controls.md).

## Outcome and ownership

Keep normal usage near $50/month, automatically stop optional paid work at a conservatively estimated $40, and preserve bundled keyboard gameplay. Provider usage can lag and rejected traffic can still cost money; this is not an unconditional $50 invoice guarantee.

**Engineering handles:** inventory through available authenticated tools, code/configuration, secrets installation through secure prompts, tests, PRs, deployment checks, cache/retention rules, and operational controls. Eric should not manually recreate application limits in dashboards: deployments could overwrite them.

**Eric handles only where owner access is needed:** signing in/MFA, choosing the budget and billing-alert recipient, resolving settings shared with other projects, provider billing controls inaccessible to engineering, and physical phone acceptance. The manual steps below are a fallback for those access boundaries, not a requirement to do work that authenticated tooling can perform.

No settings have been read from the signed-in provider dashboards in this planning pass. Documentation paths below were checked against current provider documentation; account-specific menus and plan capabilities must be verified during execution.

## Execution order

| Step | Owner | Dependency | Deliverable and exit condition |
| --- | --- | --- | --- |
| 0. Establish actual state | Engineering; Eric for login or budget choice | None | Deployed version, billing mode, current spend, other projects sharing allowances, previews, and manual checklist statuses recorded |
| 1. Provider limits | Engineering when accessible; Eric otherwise | Step 0 | Gateway and analytics limits saved and read back; applicable provider backstop verified |
| 2. Immediate code protections | Engineering | Step 0; can proceed during owner setup | Lower existing limits, disable paid previews, eliminate automatic AI retries, close abandoned rooms, reduce routine logging |
| 3. Enforced budgets | Engineering | Step 2 | Atomic daily/monthly admission, concurrency and byte reservations, feature switches, and bounded relay leases |
| 4. Bound reads and stored data | Engineering | Steps 2–3 | CDN caching, cleanup throughput, query-cost evidence, complete cost model |
| 5. Fallback and rollout | Engineering; Eric for phone check | Steps 1–4 or explicit feature-off exceptions | Exhaustion rehearsal passes; production settings and usage read back; dated evidence saved |

Provider setup is an immediate defense, not a reason to delay code work. If a provider cap cannot be established, keep that paid feature off while completing the rest.

## Step 0 — inventory before changing settings

Engineering records these in a sanitized implementation evidence file, with timestamp and source:

- Production Worker `wwm`, domain `wwm.ewj.dev`, account ID `927320d088a7c2ec3c070b43da0e85de` from checked-in config; verify all three live.
- Cloudflare billing period, account-wide usage and fixed charges, other projects using the same included allowances, Workers plan, WAF entitlement, and current alerts.
- AI Gateway `wwm`: callers, spend rules, authentication, provider keys by alias/name only, billing mode, auto top-up, and whether direct provider credentials override stored keys. Never print credential values.
- PostHog project `260845` in the US region: organization, billed products, billing limits, free allowance already used, and who receives billing alerts.
- All active previews and alternate public Worker URLs. Current config sends production and previews to the same `wwm` gateway. Preview cron cleanup is not automatic.
- Existing R2 data size by bucket/prefix, oldest expired run, cleanup backlog, browser sessions, and room activity. Include the separate `wwm-learning-audio` bucket.

`infra/README.md` contains older statements about no deployment and separate gateways. Do not follow those as current state or rerun provisioning blindly. Reconcile them during implementation.

Approved budget: $50/month total target; $25 warning, $35 reduced service, $40 stop optional work; $10/month AI allocation. Fixed subscriptions, tax, domain renewal, and non-WWM usage must be shown separately where they are not included in this operational estimate.

## Manual setup M1 — Cloudflare AI spend rules

**When:** first, after confirming gateway callers. **Access:** account permission to edit AI Gateway.

1. Open [Cloudflare](https://dash.cloudflare.com/), select the account above, then **AI → AI Gateway → wwm → Settings → Spend limits**.
2. Add these two rules. Names are our labels; use the equivalent fields offered by the current UI.

| Rule | Amount | Window | Dimensions | Exhaustion |
| --- | --- | --- | --- | --- |
| `wwm-ai-daily` | $1 | Rolling 24 hours | None | Block |
| `wwm-ai-monthly` | $10 | Fixed monthly, recording reset date/time | None | Block |

3. Do not split by user, preview, model, or provider: those would create independent allowances. If a monthly window is unavailable, use rolling 30 days and record that difference; application/provider monthly controls still apply.
4. Keep paid fallback routes disabled. Save, leave the page, reopen it, and confirm both values/window/scopes remain.

**Verification receipt:** rule IDs/names, saved values, reset behavior, caller scope, timestamp. Engineering tests blocking with low isolated thresholds, not by spending the live allowance. These rules use estimated cost and can briefly overshoot under concurrency. [Cloudflare instructions](https://developers.cloudflare.com/ai-gateway/features/spend-limits/).

**Shared-gateway caveat:** WWM voice generation and evaluations also use `wwm`. The no-dimension limits intentionally aggregate tracked spend across its callers; discretionary runs may pause after exhausting it. If unrelated apps use this gateway, isolate WWM first. Do not enlarge or remove the aggregate budget to work around an exhausted allowance. Confirm ElevenLabs pricing is tracked before counting this as a voice-spend backstop.

## Manual setup M2 — actual AI billing backstop

**When:** after M1 and billing-mode inventory. Only follow the applicable branch.

### A. Anthropic bills WWM directly or through a stored BYOK key

1. Open [Claude Console](https://platform.claude.com/), then **Settings → Workspaces**. Identify the workspace owning the key used by WWM; engineering can identify its secret name/route without revealing it.
2. If dedicated to WWM, open its **Spend limits** tab and set the monthly maximum to **$10**. Record the reset and alert settings.
3. If shared, create/use a dedicated `wwm` workspace first. Create a workspace-scoped key and give it to engineering through a secure secret prompt or approved secret store, never chat or a committed file.
4. Engineering installs the key at the actual active location (Worker secret or Gateway provider key), verifies one bounded request and billing attribution, then retires only the superseded WWM credential. Preserve unrelated keys.

**Done:** workspace ID, $10 saved cap, billing period, active key attribution, and bounded success evidence recorded. Monthly workspace limits are documented in [Anthropic workspace settings](https://platform.claude.com/docs/en/manage-claude/workspaces).

### B. Cloudflare Unified Billing pays for inference

1. Open **AI → AI Gateway → Credits Available → Manage**.
2. Inspect auto top-up. Disable it only if this account credit pool is dedicated to WWM. On a shared account, retain unrelated settings and rely on the WWM gateway/application caps, recording the shared-pool exposure.
3. Do not purchase credits as part of this setup. Record current balance, recharge configuration, and whether missing provider keys can fall through to Unified Billing. Engineering configures required-provider-credentials behavior where supported if the intended mode is BYOK-only.

**Done:** billing mode and recharge state read back. Disabled auto top-up is not a hard cap: Cloudflare documents possible negative credit balances and a credit-purchase fee. Include those in the estimate. [Unified Billing documentation](https://developers.cloudflare.com/ai-gateway/features/unified-billing/).

## Manual setup M3 — PostHog paid-overage limit

**When:** first setup session, independent of M1. **Access:** billing access to the organization containing project `260845`.

1. Open [WWM in PostHog](https://us.posthog.com/project/260845), confirm the organization, then open its **billing settings**.
2. In **Product analytics**, find the billing-limit section and select **Set billing limit**.
3. Enter **$0**, save, and reopen to verify that a saved zero cap means free allowance only. Do not choose **Remove limit**. If zero is rejected or its meaning is ambiguous, record the limitation; engineering leaves forwarding off until an acceptable provider/application cap is established.
4. Inspect every other enabled/billed product. Leave unused replay, paid AI, logs, and other products disabled or capped. Each product's limit is separate; do not reduce services used by unrelated projects without isolating WWM first.
5. Confirm the organization owner receives alerts. PostHog documents automatic emails near the free allowance and billing limit; do not spend money to trigger them.

**Done:** organization, enabled products, saved dollar limits, remaining free allowance, and owner notification address verified. Reaching a limit discards additional data; it is not queued for later recovery. Engineering must label reporting gaps and stop retries when collection is intentionally disabled. [PostHog instructions](https://posthog.com/docs/billing/limits-alerts).

## Manual setup M4 — Cloudflare billing notifications

**When:** during first setup. **Access:** account billing controls and a monitored email address.

1. Open Cloudflare, select the account, then **Manage Account → Billing → Billable Usage → Create budget alert**.
2. Create alerts named `WWM review`, `WWM reduce`, and `WWM stop-check` with thresholds **$25, $35, and $40**, respectively. Set Eric's chosen recipient; do not invent an address.
3. Save each. Reopen **Billable Usage → Budget alerts** to verify all thresholds and recipients.

**Scope:** these measure account-wide usage-based spend, not WWM-only cost or the total invoice. Other projects may trigger them early, and fixed charges are separate. On a shared account, label them accordingly; engineering adds WWM-specific alerts from the application ledger. Enterprise availability differs. Notifications do not pause anything. [Cloudflare setup](https://developers.cloudflare.com/billing/manage/budget-alerts/).

**Done:** three saved alerts and their actual scope recorded. No new notification integration or recurring Codex automation is needed for this step.

## Conditional manual setup M5 — edge protection

**When:** engineering has prepared and tested exact rules for the account's plan. This is not a request to upgrade the plan now.

Engineering first inventories current rules and routes, builds a reviewed expression/threshold set, and applies it through authenticated API access if available. If owner-only UI access is necessary:

1. Select zone **ewj.dev → Security rules → Create rule → Rate limiting rules**.
2. Install the engineering-provided expression, counter, period, action, and timeout. Scope to `wwm.ewj.dev`. Avoid HTML challenges on telemetry/API/WebSocket traffic unless the client can complete them.
3. Save and verify normal browsing, capture/upload responses, and phone pairing. Check Security Events for unintended matches. Leave unsupported rules marked unresolved rather than inventing equivalent billing protection. [Rule creation instructions](https://developers.cloudflare.com/waf/rate-limiting-rules/create-zone-dashboard/).

Prepare this **disabled** emergency custom rule once the bundled static fallback is deployed:

```text
(http.host eq "wwm.ewj.dev" and
 (starts_with(http.request.uri.path, "/api/") or
  starts_with(http.request.uri.path, "/s/") or
  starts_with(http.request.uri.path, "/r/") or
  starts_with(http.request.uri.path, "/j/")))
```

Name: `wwm-emergency-dynamic-stop`. Action: **Block**. Engineering validates syntax, rule ordering/skip rules, and that this acts before Worker execution. Do not enable as a routine setup step. Before using it, `/` and `/log` must be asset-first and the static client must stop API polling. This rule does not cover `workers.dev`/preview hostnames or end already-open sockets; preview access controls and room leases must handle those. Record the exact enable/disable procedure after the isolated rehearsal. If the plan cannot support it, prepare a verified alternative before claiming complete flood protection.

## Conditional manual setup M6 — ElevenLabs

Public visitors currently play pre-generated clips; they do not trigger TTS. No subscription upgrade or cancellation is required for this plan.

If the generation account belongs only to WWM, inspect **Subscription → Manage Subscription**. On legacy plans, turn **Usage based billing** off, or set a deliberately approved finite threshold. New plans may use Pay As You Go instead; inspect recharge settings and keep automatic extra purchases disabled for a dedicated WWM account. If the account serves other projects, leave shared settings alone and document the separate generation allowance. [ElevenLabs billing](https://elevenlabs.io/docs/overview/administration/billing).

Engineering adds character/cost caps to voice CLI writes and auditions. Existing R2 clips and browser speech fallback continue working when generation stops. Record the actual plan and saved overage/recharge state; do not assume the AI Gateway recognizes voice cost.

## Engineering work packages

### PR 1 — immediate protections

Paths: `apps/worker/wrangler.jsonc`, `apps/worker/src/docent/providers.ts`, `apps/worker/src/room.ts`, corresponding tests, `infra/scripts/check-deploy-config.mjs` and deployment workflow only as needed.

- Production: global builds **600 → 60/hour**, docent **500 → 100/day**, docent IP limit **20 → 10/hour**, routine log sampling **1 → 0.1**; retain bounded operational counters independently.
- Previews: `CAPTURE_ENABLED="0"`, `DOCENT_PROVIDER="mock"`, telemetry off. Audit and update existing previews too; changing defaults alone does not retrofit them.
- Set AI SDK retries to zero until attempts reserve budget explicitly. Keep 600 output-token cap. Add early request-rate checks before upload/score bodies are parsed.
- Close rooms after verified heartbeat failure; enforce 30-minute maximum lifetime independently of keepalive traffic. Provide graceful keyboard fallback. Do not reduce the phone send rate yet.
- Keep existing 300,000 ms CPU ceiling until separate workload measurements justify safe per-component limits; record this interim exposure.

Exit: targeted integration tests pass, simulated abandoned sockets close, paid previews cannot invoke capture/model providers, and normal cached/practice gameplay works. These changes reduce exposure but do not finish global monthly enforcement.

### PR 2 — admission budgets and retries

Paths: new `apps/worker/src/budget.ts` and budget tests; `src/config.ts`, `src/limiter.ts`, `src/index.ts`, `src/routes/{stages,upload,docent,scores,share,telemetry}.ts`, `wrangler.jsonc` and generated Worker types. Exact module split is implementation-owned.

- Add a persistent Budget Durable Object with atomic reserve/settle/expire operations, integer cost units, operation IDs, concurrency leases, and daily/monthly counters. A central check covers every expensive route. Explicitly serialize read-modify-write operations across awaits; single-threaded execution alone is not proof of atomicity.
- Enforce all proposed counts in [the policy table](cost-controls.md#2-enforce-admission-budgets-before-expensive-work), plus byte and dollar reservations. The first exhausted dimension wins. Reject malformed configuration and fail closed on unavailable budget state.
- Use small reserved blocks for telemetry/room admission. Never make a central durable write on each WebSocket frame or static read. Budget the controller's own cost and protect it with early edge/local request limits.
- Add typed configuration with documented units/defaults. New monthly/day/byte limit variables do not exist yet; the implementation must add and generate them, not just paste names into the dashboard.
- Define UTC calendar windows for application unit quotas, while separately tracking provider billing periods. Preserve existing spend and storage at rollout; do not initialize a fresh monthly allowance as if prior usage were zero. Reserve conservative amounts if exact usage is unknown.
- Reserve the full bounded prompt/output cost and all attempts; cap total input tokens. Ambiguous timeout/disconnect results retain their reservation pending reconciliation. Never switch to another paid model on exhaustion.
- Existing paid previews remain off initially. Any later opt-in uses authenticated admission to a single aggregate preview allocation; no per-preview reset or caller-supplied budget scope can grant more spend.

Exit: concurrency, crash/restart, duplicate ID, timeout, retry, and rollover tests cannot exceed allocations; rejected work makes no provider calls or data writes except bounded enforcement/accounting. Include multiple-IP and multiple-preview scenarios.

### PR 3 — relay leases and user fallbacks

Paths: `apps/worker/src/{room,room-tokens}.ts`, `src/routes/rooms.ts`, `packages/net/src`, `apps/web/src/controller`, telemetry/docent/game UI modules and i18n. Shared schema changes go through the contract process.

- Limit globally active rooms to 20 and reserve room time in 10-minute increments within the daily/monthly allowance. Count reconnects and track host/phone traffic ceilings. Stop lease renewal on exhaustion; close existing rooms by their funded expiry.
- Optional 60 → 30 Hz input change is a separate measured change with immediate button transitions preserved. Eric validates on a physical phone before rollout.
- All feature denials produce clear fallbacks: cached/practice stages, source links, local scores, generic cards, or keyboard/gamepad. Never silently classify an unchecked replay as verified.
- Intentional analytics dropping returns a terminal no-retry response and updates aggregate collection-coverage counters. Budget-disabled features cannot trigger endless client retries or polling.

Exit: phone session expiry/reconnect, disconnected clients, background tabs, shared-network users, and exhaustion all behave predictably; browser tests prove fallback gameplay remains available.

### PR 4 — retention, caching, CPU, and query costs

Paths: `apps/worker/src/{store,index,pipeline,build-job}.ts`, capture modules, routes/cards, D1 migrations if needed, `apps/web` static metadata, preview cleanup workflow, and `infra/scripts/cost-model.mjs`.

- Bound capture queue, session acquisition/warm lifetime, total slices/solver rerolls, upload bytes, SSE watchers, card deduplication, and replay verification concurrency. Separate expensive workloads before tightening normal API CPU caps.
- Enforce write-byte reservations and total stored-data ceilings. Backfill current occupancy first. Resumable cleanup must outpace the maximum admitted 300 builds/day; prove at least 600 eligible runs/day on a representative fixture within a capped execution budget.
- Explicitly clean abandoned uploads, expired replays/scores, jobs, cards, and preview data with reference-aware retention. Validate a dry-run deletion manifest, including curated assets, score permalinks/ghosts, and audio clips. Never add blanket bucket expiration.
- Measure D1 rows examined on populated data and cache/precompute expensive standings. Add CDN cache verification for immutable assets and normalize query keys. Preserve opt-out/takedown invalidation.
- Pre-render home/log metadata and bundle the practice fallback so static mode needs no D1/R2/DO/provider calls. Update cost scenarios for AI, analytics, alarms, warm browser time, previews, enforcement, and cleanup. Conservative scenarios assume shared free allowances are already used.

Exit: backlog drains, dry-run manifest preserves referenced data, measured cache hits avoid backend work, and cost estimates include each paid integration.

### PR 5 — operating controls and production acceptance

Paths: deployment/infra scripts, `docs/launch/{runbook,cost-model,analytics}.md`, dated build log/evidence, and CI safeguards.

- Implement $25/$35/$40 alert/reduction/stop thresholds against the conservative ledger, plus per-feature switches and static-only mode. Record outstanding reservations and fixed/storage costs; estimate uncertainty consumes contingency.
- Keep the stop condition latched until a deliberate reset or documented period rollover. Operators can disable a feature without redeploying. KV flags supplement authoritative budget checks and are not treated as immediate accounting controls.
- Test every feature with tiny budgets in an isolated environment; verify denied operations do not invoke paid services. Rehearse static mode and edge block/restore, including existing rooms and preview URLs.
- Run `pnpm check`, deployment-config validation, `pnpm docent:index` after indexed documentation changes, and `pnpm docent:index --check`. Inspect CI before deployment; merging to main currently triggers production deployment.
- Deploy with paid previews off and conservative quotas. Read back deployed version/config, perform bounded browser/provider acceptance, then reconcile actual usage after one day through the chosen monitoring mechanism. Scheduling a new reminder/automation is a separate action, not performed by this plan.
- Roll back application changes without dropping the budget ledger or lifting provider caps. Keep paid features disabled if rollback cannot read the new ledger safely. Preserve a tested static-only deployment as the recovery artifact.

## Completion record

During execution replace each `Pending` with `Verified`, `Not applicable — reason`, or `Blocked — exact missing access/capability`. A saved screenshot/readback proves configuration; it does not by itself prove end-to-end enforcement.

| Control | Status | Evidence required |
| --- | --- | --- |
| Budget and alert recipient | $50 confirmed; recipient still required | User approval in this task; no notification address assumed |
| M1 Gateway limits | Manual — OAuth API returned 403 | Save/read back $1/day and $10/month rules in gateway wwm |
| M2 Billing backstop | Manual — active billing attribution not established | Gateway token exists; no direct Anthropic Worker secret; BYOK vs Unified requires owner inspection |
| M3 PostHog | Manual — billing access not available | Forwarding defaults paused until explicit operator attestation |
| M4 Cloudflare alerts | Manual — billing settings/recipient required | $25/$35/$40 account-wide thresholds; application snapshot/logs implemented |
| M5 Edge protection | Manual — ruleset API returned 403 | Zone Free Website plan verified; exact emergency expression/rehearsal in operator procedure |
| M6 Voice billing | Manual — provider subscription access required | CLI character cap and no retries implemented; no public TTS generation |
| Work packages 1–5 | Application implementation consolidated in one PR | Validation evidence in build log; no production deploy performed |
| Phone acceptance | No transport-cadence change | Local real WebSocket expiry test; physical phone acceptance remains a rollout check |
| Cost reconciliation | Manual before activation, then every UTC month | New ledger starts uninitialized and cannot enable without spend + storage inputs |

Implementation choices: fixed conservative debits replace reserve/settle/refund complexity; failures never refund. The $10 room pool binds at 20,000 minutes before the original 50,000-minute ceiling. UTC monthly rollover pauses rather than automatically granting a fresh allowance. Artifact caching is behind authoritative catalog checks. All new public preview APIs are closed, including rooms; static practice is the preview acceptance path. Threshold logs and dashboard states are implemented, but no email integration was configured.

Reference-aware orphan/history purging, production-sized D1 row-cost measurements and measured cleanup throughput remain operational follow-ups. They are not prerequisites to bounded new write admission: the 20 GiB storage ceiling and conservative no-credit counter stop growth until manual reconciliation. This PR preserves existing catalog/score history instead of introducing an unreviewed destructive migration. Provider/edge enforcement and end-to-end production acceptance remain manual rollout gates, not completed work. The Worker preview-list API returned no existing previews at inspection; recheck at rollout.

Only after this record is complete should we describe the site as protected by the new controls. Until then, communicate separately what is planned, locally tested, deployed, and verified at each provider.
