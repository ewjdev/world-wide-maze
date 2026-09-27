# Phase 21 — Durable URL catalog and content review

**Status:** proposal, September 26, 2026. Planning only; no migration, capture, provider integration, or production policy change is authorized by this document.

**Outcome:** a repeat visitor gets an existing approved maze without another browser capture; an operator can find every hosted URL and run, review uncertain content, and stop a blocked URL or maze from being served through any hosted route.

**Scope:** hosted URL builds, extension/bookmarklet uploads when shared, run/stage/texture reads, curated lists, portals, share pages/cards, retention, and the operator workflow. Local, unshared mazes stay on the player's device.

**Source of truth:** current code in `apps/worker/src/routes/stages.ts`, `routes/upload.ts`, `routes/share.ts`, `store.ts`, `builder.ts`, `ids.ts`, and `migrations/0001_runs_stages.sql`. `plans/contracts.md` remains the API contract; proposed changes below require a Contract Change Request before implementation.

## 1. Current behavior and gap

- R2 stores capture bundles, screenshots, slice textures, and stage JSON. D1 stores run and stage rows. KV maps a normalized URL, difficulty, builder version, and optional seed to a run for seven days. A KV miss does **not** query D1 for a prior run, although non-curated runs remain there until the 30-day sweep. Repeated visits after seven days can build again.
- Hosted runs are unlisted, but direct run, stage, texture, and share URLs are accessible by ID. The URL-submission path checks `optout:<domain>` before its KV hit; direct-ID reads do not enforce a content or opt-out decision.
- The moderation hook currently returns `ok` for every screenshot. Shared local captures pass through the same hook but are not indexed by URL. There is no operator review queue or decision history.
- Stage JSON and textures currently return `public, max-age=31536000, immutable`. A later takedown cannot recall a copy already cached by a browser. Production storage contents and traffic have not been audited for this plan.

## 2. Recommended policy and decisions

**Default proposal:** a URL with a confident safe verdict may become an unlisted shared maze automatically. An uncertain verdict remains `pending_review` and cannot be served by ID; a confident disallowed verdict is `blocked`. Featured/curated listing always needs its separate editorial approval. The operator can override an automated verdict with an auditable reason.

Decisions for the owner and policy reviewer before implementation:

1. Define disallowed explicit content and exceptions (for example, educational, health, or art pages). Agree on examples for the test set. A URL string or domain name alone is insufficient evidence of page content.
2. Set review coverage: the proposed confident-safe automatic path versus human approval for every unknown URL. This changes review workload and time to first play.
3. Set retention for approved non-curated mazes and for *pending* review evidence. The current 30-day sweep is a cost/privacy limit, while a durable catalog can outlive its artifacts. Specify when a recapture is allowed and how users request one.
4. Set a practical block propagation target and acceptable warm-load latency. Already downloaded browser copies cannot be revoked; public responses must not promise instant recall.

## 3. Data and cache contract

| Store | Owns | Rules |
|---|---|---|
| D1 | `url_catalog`: normalized URL identity, host, last capture time, refresh due time, availability; `url_variants`: difficulty/seed/builder version → current approved run; `capture_attempts`: result/error and timing; `moderation_cases`: verdict, evidence references, model/policy version and review state; `policy_rules`: exact URL/domain decisions; `moderation_events`: actor, action, reason, timestamp | Authoritative. Index URL hash, variant key, and host; avoid using a `LIKE '%domain%'` query for takedown. Preserve existing `runs`/`stages` as version records. Separate content decisions from site-owner opt-outs. |
| R2 | Versioned capture and maze artifacts, plus short-lived, access-controlled review evidence | No public bucket URLs. Keep immutable object *keys*; serve them only after a policy check. Delete blocked artifacts after evidence needs and any required hold are resolved. |
| KV | Hot `URL key → approved run ID + catalog revision`, in-flight dedupe, optional advisory policy hints | Cache only approved pointers. A miss falls back to D1. A hit still passes the authoritative serve check. Invalidate/repopulate after a D1 change; never rely on KV deletion alone for urgent blocks. |

Use a stable hash of the shared URL normalizer's output, with difficulty, seed policy, and builder version in the variant key. Preserve the exact canonical URL in D1 for display/review. Treat URL identity and artifact freshness separately: a page may change without changing its URL, and an older approved run can remain playable until an explicitly requested refresh succeeds. Never replace the current approved pointer with a failed or pending capture.

The D1 catalog row must survive artifact expiry so operators can still see that a URL was visited and whether it is blocked, but its retention must follow the privacy decision above. On a KV miss, return the approved variant from D1 if its artifacts exist and repopulate KV; otherwise queue one build using the existing BuildJob dedupe. A stale KV pointer must fall back to D1 rather than recapture immediately. Policy checks must read the latest committed D1 state; if D1 read replication is enabled, use a primary-constrained session for the block decision.

## 4. Request and moderation flow

1. **Submit:** normalize URL; run existing SSRF, DNS, redirect/subresource, and opt-out protections. Query authoritative exact-URL and domain policy before KV lookup. Return a neutral refusal for blocked content without disclosing private review details.
2. **Resolve:** read KV, then D1 on miss or stale pointer. If an approved run exists, return it. If a refresh is due, keep serving the approved run and schedule a single background refresh only when policy and capacity permit. An explicit user refresh can use the same dedupe and limits.
3. **Capture:** keep new screenshots and textures in a private pending state. Evaluate the final URL, title and extracted page text, analysis screenshot, and **every slice texture**. Record the classifier/policy version, structured reasons, and uncertainty. Account for bot walls, login pages, and pages that change after load. A provider outage or malformed verdict yields `pending_review`, not automatic publication. Do not send capture contents to a model provider until its data-handling and logging configuration is reviewed.
4. **Decide:** confident safe → approved unlisted run; uncertain → review queue; disallowed → blocked. Only after approval update the D1 current-variant pointer, then warm KV. Uploaded local captures follow the same decision gate before a shared ID can resolve; they remain separate from the canonical hosted URL cache unless capture provenance is verified.
5. **Serve:** one shared policy function checks run/stage ownership and the latest D1 policy state before serving `GET /api/runs/:id`, stage JSON, textures, share/card routes, curated entries, scores/ghost paths that reveal content, and portal destinations. A pending or blocked item returns a safe unavailable response. Recheck at job completion to close the race with an admin block during capture.

Keep unreviewed user-generated responses out of browser/CDN caches. For approved user-generated assets, choose a short, measured cache lifetime or another revocable access design; do not reuse the current one-year immutable response policy. Curated artifacts may receive a longer lifetime only with a documented emergency removal procedure. A cache-policy change must include an audit and purge of any previously cached public responses where supported. Cloudflare KV is eventually consistent, so a KV rule or pointer cannot be the only block gate. See [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/), [D1 primary/read-replica behavior](https://developers.cloudflare.com/d1/best-practices/read-replication/), and [Workers cache configuration and purge caveat](https://developers.cloudflare.com/workers/cache/configuration/).

## 5. Operator surface

Build a private `/admin` area behind the chosen identity provider, with server-side authorization on **every** API action. Do not put admin credentials in the web bundle. Start with one operator role; add reviewer/administrator separation only when more people actually need access.

- **Catalog:** search exact URL/host, list recent attempts, approved versions, cache state, review status, curated status, and artifacts retained. Show whether a result came from KV, D1, or a new capture.
- **Queue:** show minimal evidence needed to decide: normalized and final URL, title, screenshots/slice previews, signals and uncertainty, prior decisions. Mask sensitive query values in logs and analytics; restrict access to raw evidence.
- **Actions:** approve, reject/block one run, block exact URL, block domain and subdomains, request recapture, clear a rule, and remove artifacts. Require a reason; write an append-only audit event. Make reversal explicit and separate it from restoring deleted artifacts.
- **Operations:** show stuck pending jobs and moderation provider failures; count queue age, false positives/appeals, recaptures avoided, warm-hit latency, and artifact storage growth. Provide a safe emergency block path when the UI or model is unavailable.

The existing site-owner opt-out and takedown process remains a separate rule type. An operator must be able to find all affected runs using indexed host data, remove curated placement, and queue artifact deletion. Review legal-draft procedures before calling them published policy.

## 6. Delivery sequence and gates

| Step | Work | Gate to proceed |
|---|---|---|
| 0. Policy and measurement | Approve the four decisions above; measure current local/preview warm-hit and direct-ID latency, storage volume, and cache behavior. Inventory every content-serving route and current CDN/browser cache configuration. | Owner accepts content policy and retention; baseline measurements saved. |
| 1. Catalog foundation | Add additive D1 migrations and store methods; backfill existing D1 runs without publishing them automatically; add D1 fallback and KV repopulation. Keep current API shape. | A request after KV expiry returns the same stored run without Browser Rendering; failed/pending refresh leaves the approved run intact. |
| 2. Serve gate | Centralize policy lookup for all route families; add indexed exact URL/domain rules, blocked/pending responses, and response cache changes. Review already cached responses. | A block stops URL lookup and direct-ID serving for every route in integration tests and deployed preview. |
| 3. Moderation intake | Add private pending artifacts, multi-signal evaluation, three verdict states, and review-case records. Start in shadow mode on fixtures/owned test sites; compare verdicts with human labels. | No uncertain/provider-error case is auto-served; error and false-positive rates reviewed against the agreed test set. |
| 4. Admin | Add authenticated catalog, queue, decisions, audit trail, and emergency block. | Unauthorized requests cannot read evidence or mutate policy; each decision is attributable and reversible where artifacts remain. |
| 5. Rollout | Run migrations, backfill, and shadow evaluation in preview; deploy guarded reads before automatic moderation; enable automatic approvals gradually; inspect production read latency, queue, costs, and takedown drills. | Owner reviews preview evidence and authorizes production policy activation. |

The repository's `packages/schema` and `plans/contracts.md` are shared contracts. If new public response states or error codes are needed, submit and apply a Contract Change Request before code changes. Implement the storage/policy work in `apps/worker`, the operator UI in `apps/web`, and document operator procedures in `docs/launch`; coordinate those file owners before parallel work.

## 7. Acceptance and rollback

**Required acceptance cases:** same URL in a second region and after KV TTL; URL with a changed screenshot; simultaneous first requests; builder-version change; partial run; opted-out domain; blocked exact URL/domain; block during capture; block after KV warm-up; direct run/stage/texture/share/card access; upload and portal access; moderation timeout; rejected appeal and restored approval; artifact expiry; unauthorized admin request. Verify no blocked capture is emitted to the player, shared card, curated listing, or model-facing log.

**Performance target:** zero Browser Rendering launches for an existing approved variant. Set the actual p95 warm-hit and stage-load targets from the Step 0 baseline; compare KV hit, D1 fallback, and policy-check latency in at least two regions. Do not weaken the authoritative block check merely to improve the hot path.

**Rollback:** disable new hosted captures/automatic approvals with existing kill switches or a new moderation-mode flag; continue serving only previously approved runs through the policy gate. Revert the new read path to D1-only if KV pointers misbehave. Keep additive migrations in place and audit data intact. If a content incident occurs, apply the D1 block first, then invalidate KV, remove curated placement, purge reachable caches where possible, and delete R2 objects under the approved retention/takedown procedure. Never roll back by removing the serve gate while user-generated content remains accessible.

**Boundary:** this plan describes proposed behavior. It does not claim a production moderation service, admin, full catalog, or live deployment verification exists today.
