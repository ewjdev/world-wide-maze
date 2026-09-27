# Cost controls for a sudden traffic spike

Status: initial audit from September 27, 2026; Eric subsequently approved the $50 target. Implementation is tracked in [the operator procedure](../docs/launch/cost-controls.md) and execution plan. The findings below describe the pre-change checkout. This pass inspected local source/configuration and current provider documentation. It did not inspect live billing, deployed settings, or provider limits, and it did not change runtime behavior. The working tree already contained other planning changes; those are outside this proposal.

Execution sequence and owner setup instructions: [Cost-control execution plan](cost-controls-execution.md). Use that checklist for implementation and manual configuration; this document records the initial audit and policy proposal.

## Objective and budget

Use **$50/month as the approved WWM operating target**. Degrade optional services automatically and retain a static, keyboard-playable practice experience when paid services pause. A growing audience must not automatically raise this budget.

Proposed allocation: $5 base subscription, $10 AI, $10 capture/build/storage, $10 phone relay, $5 other API/logging operations, and $10 contingency. PostHog should stay within its free allowance initially. Include production and all previews in the same WWM envelope. Existing domain fees, unrelated projects, and discretionary development/TTS generation need separate attribution, not silent inclusion in free allowances.

This is an operating target, **not a guaranteed maximum invoice**. Requests rejected inside a Worker have already invoked it; connected WebSocket messages, storage, and enforcement machinery also cost money. Provider reporting lags, provider limits can overshoot, and account allowances can be consumed by other projects. A strict financial ceiling requires verified provider enforcement and a tested way to stop dynamic traffic before Worker execution. Reserve headroom for in-flight work and ongoing storage.

## Findings from this checkout

| Surface | Existing protection | Remaining exposure |
| --- | --- | --- |
| New URL builds and extension uploads | 10 builds/hour/IP, 600/hour globally; capture kill switch; browser semaphore of 2; capture timeout 20 seconds | No daily/monthly quota or aggregate byte budget. 600/hour permits 432,000 admissions in 30 days before throughput constraints. Upload parsing/PNG validation precedes build admission. |
| Browser sessions | Capture work is bounded and sessions are reused | Browser Run sessions remain warm for 120 seconds. Budget session lifetime, acquisition, and failures, not only capture time. The semaphore describes active capture jobs, not necessarily all surviving provider sessions. |
| AI docent | 20 calls/hour/IP, 500/day globally, 600 output tokens, cache, `kill:docent` | No monthly dollar ceiling or explicit total prompt-token budget. The SDK permits one retry per admitted call. Production and each preview have distinct DO counters; preview allowance is 50 calls/day each. |
| Phone rooms | 30 creations/minute/IP; 120 upgrades/minute/IP; frame-size caps; 150 messages/second/socket with flood disconnect | No global room/minute quota, total session lifetime, or monthly relay budget. The 30-minute expiry only cleans up rooms without sockets. Connected rooms reschedule alarms every 5 seconds and refresh last-active time. |
| PostHog telemetry | General 100 API requests/minute/IP limiter; schema/body limits; max 50 events/batch; forwarding timeout | No global event-volume cap. One request can create 50 billable events. Origin checks do not stop scripts/bots. Disabling collection must not cause client retries. |
| Scores and replays | 20 submissions/10 minutes/IP; 12 MiB body cap; at most 36,000 replay ticks | No global verification/CPU quota or replay storage budget. Body parsing precedes the submission limiter. Leaderboard ranking queries can examine far more rows than their result LIMIT. |
| Share cards | R2 cache; 30 renders/10 minutes/IP; 1,200 renders/hour globally | No daily/monthly render budget; simultaneous identical misses can render repeatedly. Cache hits still involve API/storage work. |
| D1/R2/KV retention | Daily sweep, 30-day run retention; curated exemptions | Run sweep removes at most 200 runs/day, below the allowed creation volume. Run cleanup does not delete replay objects or score rows. Card cleanup scans its prefix. No aggregate stored-byte ceiling. |
| Static pages, assets, logs | Most assets use asset-first delivery | `/`, `/log`, `/j/*`, `/s/*`, `/r/*`, and APIs invoke the Worker. Production and previews sample 100% of Worker logs. Browser cache headers alone do not establish CDN cache hits. |
| Learning voice | ElevenLabs generation is a local build-time CLI; public playback uses immutable R2 audio | Visitors do not trigger paid TTS in this code. Protect that boundary; audit audio cache behavior and give generation a separate character/spend cap. |

Evidence: `apps/worker/wrangler.jsonc`; `src/routes/{stages,upload,docent,telemetry,scores,share,rooms}.ts`; `src/{limiter,room,store}.ts`; `src/capture/browser-run.ts`; `src/docent/providers.ts`; `tools/learning-voice/README.md`. Worker paths are relative to `apps/worker`.

The existing `docs/launch/cost-model.md` is a pre-deployment estimate. It omits PostHog and the docent, assumes browser capture time rather than full warm-session lifetime, and does not fully model alarms, limiter storage, retention backlogs, previews, or hostile traffic. Its $392–$1,066/month examples at 100,000 plays/day are scenarios, not a ceiling or a current bill.

## 1. Put provider controls in place first

1. Read back the deployed Worker config, active previews, Cloudflare usage/plan, AI Gateway credential/billing mode, Anthropic workspace, PostHog organization allowance, and current balances. Record settings without exposing secrets. Shared accounts require WWM attribution; do not change unrelated applications' limits.
2. Set AI Gateway spend rules to **$1/day and $10/month** for WWM AI, with blocking on exhaustion and no paid fallback. Use trusted server metadata to distinguish production, previews, and build-time voice; retain an aggregate ceiling so creating new previews cannot multiply the allowance. Verify the selected providers/models have supported cost tracking. Gateway spend enforcement is eventually consistent, so retain application reservations and concurrency limits. [AI Gateway spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/).
3. Where Anthropic bills directly/BYOK, use a WWM-specific workspace/key with a matching monthly spend limit. If Unified Billing is active, inspect credit auto top-up and disable it for the WWM allocation where isolation permits. Do not assume which billing mode is live. [Anthropic workspace limits](https://platform.claude.com/docs/en/manage-claude/workspaces), [Gateway billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/).
4. Set PostHog's product analytics billing limit to **$0 paid overage** initially; verify the UI accepts this and confirm organization-wide effects. Keep replay/autocapture and other paid products disabled. If a shared organization cannot isolate WWM's budget, create an isolated project/organization strategy before claiming a WWM-only cap. Public ingest credentials are not a security boundary. [PostHog billing limits](https://posthog.com/docs/billing/limits-alerts).
5. Configure Cloudflare budget notifications corresponding to 50%, 70%, and 80% of the WWM target, accounting for account-wide scope and fixed fees. Notifications only report spend; they are not automatic service shutoffs. [Cloudflare budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/).
6. Default public PR previews to mock AI and no remote capture. Explicitly enabled integration previews share a small aggregate allowance, expire, and cannot access production resources. Verify alternate preview/version URLs do not bypass protection.

## 2. Enforce admission budgets before expensive work

Add a durable, server-owned budget controller for expensive operations. Keep fast per-session/IP limits ahead of it, before large body reads, PNG decode, solver work, provider calls, and storage writes. IP limits are a backstop; signed sessions help avoid penalizing a whole school/network, but neither proves identity nor replaces a global ceiling.

Cloudflare's rate-limit binding is local and eventually consistent; it is unsuitable for exact billing accounting. Use atomic durable reservations for daily/monthly quotas and concurrency. Do not place a central durable write on every asset fetch, animation frame, or telemetry event. [Rate limiter accuracy](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

| Operation | Proposed initial limits | Budget-exhausted behavior |
| --- | --- | --- |
| Remote builds/uploads | Keep 10/hour/IP; reduce global rate to 60/hour; 300/day and 3,000/month combined; 2 capture slots and separately bounded build/solver concurrency | Reuse cached approved runs; offer curated/practice stages and local extension play |
| AI | 10/hour/session with IP backstop; 100/day and 1,000/month; max 2 simultaneous provider attempts; 600 output tokens; hard total input-token ceiling provisionally 6,000 | Cached answers or source links; pause generation |
| Phone relay | 5 creations/minute/session with broader IP backstop; 20 active rooms; 10,000 room-minutes/day and 50,000/month; renewable 10-minute budget leases; 30-minute maximum session | Pause and offer keyboard/gamepad; explicit reconnect must reserve more budget |
| Analytics | 120 events/minute/session; 20,000/day and 500,000/month, additionally constrained by remaining provider allowance | Discard without forwarding or retry; show sampling/drop coverage in analytics |
| Replay verification | Keep 20 submissions/10 minutes/IP; 2 simultaneous verifications; 1,000/day and 10,000/month | Keep local score; stop verified leaderboard submission rather than marking unchecked work verified |
| New card renders | 60/hour globally; 300/day and 3,000/month; deduplicate identical in-flight renders | Serve a pre-rendered generic card |
| Storage growth | Provisionally 10 GiB of new non-curated data/month; separate 20 GiB total ephemeral ceiling, adjusted for measured existing occupancy | Stop new writes/builds before exceeding reserved bytes; continue reads subject to traffic controls |

These are starter settings, not usage-derived promises. The monthly unit allowance and the dollar allowance both apply; whichever is reached first stops work. Validation may require tighter values, especially solver CPU, prompt cost, and artifact bytes. Do not loosen the dollar target automatically to satisfy unit quotas.

Reservations must include maximum input/output model cost, retries, browser warm time, multi-slice builds, replay size, and storage writes. Assign idempotency keys and expiry to reservations; handle restart, disconnect, alarm retry, timeout, and billing-period rollover without duplicating allowance. Reconcile only known usage; retain conservative charges for ambiguous provider outcomes. Reject paid work if budget state cannot be read. Cache hits bypass generation budgets but retain cheap read controls.

For high-volume analytics and relay admission, allocate small bounded quota leases from the central budget. Outstanding leases count as spent/reserved, so they cannot overshoot the global allocation; expired unused leases are reconciled safely. Check every actual provider retry against the same reservation, or disable SDK retries initially. Fail closed on missing, negative, NaN, or unexpectedly large production limit settings.

## 3. Close the amplification paths

- **Rooms:** enforce heartbeat response deadlines and session/lease expiry even when sockets remain connected. Stop server keepalive traffic from extending an idle user's allowance. Reduce controller input to 30 Hz only after physical phone testing; send state changes immediately and coalesce redundant tilt updates. Bound host traffic too. Rapidly close flooders because messages dropped after arrival may already be billable. Budget DO alarms/storage and conservative fully-awake duration, not hoped-for hibernation.
- **Builds:** acquire budget before decoding uploads. Use strong per-normalized-URL/difficulty/version in-flight deduplication; KV's eventual consistency must not launch duplicate jobs. Bound queue depth, total queued lifetime, SSE connections per job, and invalid job lookups. Bound all slices and retries, not only slice zero. Track provider sessions and terminate/reclaim warm sessions when shutting down capture.
- **CPU:** the entire Worker currently permits 300,000 ms CPU per invocation. Move capture/build/replay/card workloads behind separate bounded execution paths so normal requests can use a low CPU ceiling. Choose caps from measurements and verify DO-specific limit semantics; simply lowering the shared setting could break valid builds. Apply a safe interim cap only after measuring representative worst cases.
- **Caching:** cache immutable stage JSON, textures, cards, and audio at the CDN; normalize cache keys so arbitrary query parameters cannot multiply work. Pre-render home/log metadata so these routes can use static delivery. Short-cache curated lists and leaderboards, retaining opt-out/takedown behavior and cache invalidation. Never cache private mutations or WebSocket upgrades.
- **Storage:** make cleanup bounded, resumable, and more frequent, with capacity above maximum admitted growth. Clean replays, orphaned uploads, obsolete score data, cards, failed captures, and abandoned jobs; preserve curated assets, referenced ghosts/share links, and published voice clips according to explicit retention policy. Add lifecycle rules only for safely segregated ephemeral prefixes. Stop admissions if cleanup backlog/bytes exceed bounds; cleanup itself gets an execution budget.
- **Reads and D1:** inspect query plans and actual rows read on populated fixtures, especially global ranking/window queries. Cap request cardinality and aggregate read rates; use cached/precomputed standings where needed. A SQL LIMIT does not bound rows scanned.
- **Logs:** begin with 10% routine request sampling and aggregate repeated denials/failures. Preserve cost counters and a bounded error channel independently of log sampling. Audit Gateway log retention as well. Do not send a paid analytics event for every rejected request.
- **Edge protection:** inventory the current WAF plan and available rule quotas. Block/challenge obvious floods before Worker execution, including alternate hostnames. Consider Turnstile for suspicious build/upload/room creation, not every game interaction. Price any paid WAF upgrade before adopting it. Protect telemetry and read routes as well as generation routes.
- **Voice/development:** keep ElevenLabs generation private and build-time, add maximum characters/cost to CLI writes/auditions, and bound CI retries/concurrency. No public route should gain runtime TTS or a new paid integration without a budget owner and admission rule.

## 4. Automatic degradation and emergency operation

Use committed reservations plus a conservative usage ledger, reconciled with provider metrics. At **$25**, notify and inspect trend. At **$35**, reduce optional quotas and analytics sampling. At **$40**, stop new paid work and relay lease renewals, reserving the remaining $10 for in-flight operations, fixed/storage charges, enforcement, and delayed billing. The thresholds are provisional and must account for actual billing-period boundaries.

Provide switches for capture/uploads, docent, telemetry forwarding, new rooms/renewals, score verification, and card rendering, plus a static-only mode. Existing KV kill switches are useful manual controls but are not instant, strongly consistent budget enforcement. A budget exhaustion decision must take effect through admission/lease checks; use KV only as a supplementary operator flag.

Static-only mode serves bundled practice assets without D1/R2/DO/AI/PostHog dependencies and disables background API polling. Already-loaded/local gameplay can continue. Dynamic stored mazes are available only while their read budget remains. Rehearse a pre-Worker edge block/static routing change: rejecting inside the Worker alone cannot halt Worker request charges under an unbounded flood. If the account's plan cannot support that control, document the last-resort API shutdown and the remaining unavoidable costs explicitly.

## Delivery sequence and acceptance

1. **Provider safeguards and inventory:** confirm billing scopes, limits, previews, balances, and emergency controls. Deliver read-back evidence of saved settings, not merely screenshots of a proposed form.
2. **Budget admission and relay fixes:** implement shared reservations, feature switches, limits, early upload/score rejection, session expiry, and retries. Own changes across Worker config/services/routes and the controller/client fallbacks; propose shared-contract changes explicitly when required.
3. **Caching, cleanup, and cost model:** repair retention, account for every paid surface, and publish base/viral/abuse scenarios. Measure representative actual browser-session seconds, CPU, room duration/messages/alarms, stored bytes, and analytics events. Treat shared free allowances as unavailable in the conservative estimate.
4. **Verification before rollout:** concurrent requests from many IPs cannot multiply global budgets; multiple previews cannot multiply provider allowances; restart/retry/timeout/rollover tests preserve reservations; exhausted budgets make zero new paid provider calls/writes beyond documented in-flight reservations; telemetry saturation causes no retry loop; relay lease exhaustion closes existing sockets; retention drains a backlog faster than allowed growth; cache-hit tests confirm origin/provider work is avoided.
5. **User-visible acceptance:** browser test generation limits, cached/practice play, analytics-off behavior, local score fallback, and static-only mode. Physically test phone latency/reconnection if reducing send frequency. Rehearse low test thresholds in an isolated environment, then deploy conservatively and reconcile a day of provider usage. Run repository checks and corpus checks when implementation touches indexed documentation. Do not load-test production with paid requests to prove a cap.

No implementation, provider-setting change, deployment, or new scheduled automation was performed by this planning pass.

## Pricing references checked for this proposal

- [Workers pricing and CPU limits](https://developers.cloudflare.com/workers/platform/pricing/): paid base $5/month; request and CPU usage are separate; asset-only delivery is free while Worker execution is metered.
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/): inbound WebSocket messages have a 20:1 billing ratio, and duration/storage/alarms also matter. Closing or dropping application messages does not make prior inbound traffic free.
- [Browser Run pricing](https://developers.cloudflare.com/browser-run/pricing/): session hours and average daily peak concurrency are separate cost drivers.
- [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing): model, token type, and execution mode determine cost. Re-read the selected standard synchronous model price before setting reservations; do not use batch rates for interactive calls.

The budget controller's own overhead, account-wide free-tier consumption, provider rounding, and safety margin belong in the updated cost model. A configured count limit is only a cost ceiling after the maximum cost per admitted unit is bounded and verified.
