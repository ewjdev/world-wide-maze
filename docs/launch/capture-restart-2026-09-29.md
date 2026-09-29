# Capture restart receipt — September 29, 2026 UTC

Capture and R2 writes resumed with manual content review on September 28 Pacific time. This receipt records the applied dashboard settings and bounded production checks. The $50 monthly operating target is not an invoice ceiling.

## Saved controls

| Control | Verified state |
| --- | --- |
| WWM gateway spend limits | Enabled: $1/day Sliding and $10/month Fixed; no provider/model/metadata dimensions |
| Gateway payment routing | Require provider credentials ON; authentication ON; retries OFF; 50 requests/minute Fixed |
| Gateway billing inventory | Anthropic and ElevenLabs key aliases present; key values not accessed. Shared credits $8.03; auto recharge OFF. Actual Anthropic key workspace/cap not established |
| API edge rate limit | Active `wwm-api-rate-limit`: hostname wwm.ewj.dev, path starts /api/, IP counter, 100 requests/10 seconds, Block 10 seconds |
| Emergency edge stop | `wwm-emergency-dynamic-stop` saved, rehearsed, restored DISABLED |
| Alternate hosts | Worker workers.dev and Preview URLs OFF; preview inventory empty; direct checks on production and known pr-31 workers.dev hosts returned 404 |
| GitHub preview automation | `WWM_PREVIEWS_ENABLED=false`; production deployment switch remains true |
| Billing notifications | Added $25/$35/$40 account usage alerts using the account recipient prefilled by Cloudflare; existing $10/$20/$50 alerts retained |
| Budget ledger | September initialized and normal; reconciled upward to $10; build/write enabled; latest acceptance readback $10.02014 and 16,060,009 stored bytes |
| Features kept paused | Automated moderation, docent, Jev, telemetry, scores, cards; PostHog attestation unchecked |
| Content policy | `MODERATION_MODE=manual`: new captures await review before public serving |

Rate-limit rule ID: `87f0e91fc3d147359dd39202544d647d`. Emergency rule ID: `d6bc642404654d9db9c0754813d3449a`. The Free zone had an available rate-limit slot; no unrelated rules were replaced. No preceding custom Skip rules were present.

The API rule expression is:

```text
(http.host eq "wwm.ewj.dev" and starts_with(http.request.uri.path, "/api/"))
```

The emergency expression is:

```text
(http.host eq "wwm.ewj.dev" and (starts_with(http.request.uri.path, "/api/") or starts_with(http.request.uri.path, "/s/") or starts_with(http.request.uri.path, "/r/") or starts_with(http.request.uri.path, "/j/")))
```

Gateway and alert settings were saved and read back. No spend-limit exhaustion or notification email delivery was induced. Gateway estimates can overshoot, and account usage alerts do not stop billing. The API rate limit is per IP and was not load-tested against production.

## Reconciliation evidence

The Cloudflare billable-usage page showed $0 usage charges for the current September 20–October 19 period at inspection. This excludes fixed fees and is account-wide. WWM's gateway showed approximately $0.07 over the last 30 days; an unrelated default gateway had usage and was left unchanged.

`wrangler r2 bucket info` reported 62 stage objects / 14.3 MB and 193 learning-audio objects / 9.33 MB. The existing 16,000,000-byte stage reservation conservatively exceeded the rounded stage metric. Audio/storage uncertainty is included in the spend reconciliation. The $10 reconciliation retained the prior approximately $7.05292 ledger total and added approximately $2.95 uncertainty; it is not a statement of actual invoiced WWM spend. Failed attempts retain reservations.

## Production acceptance

The tested runtime was main `013c2872e4d7f5aa54a8c4320ba706d5f7592aad`, Worker version `3be8a9e7-b7e9-4793-9eae-ae325badf279`.

1. During the emergency rehearsal at 06:09 UTC, application services were paused and the edge rule enabled. `/`, `/log`, and `/play/practice?offline=1` returned 200; static practice rendered. `/api/health`, POST `/api/stages`, `/s/restart-check`, `/r/restart-check`, and `/j/restart-check` returned Cloudflare HTML 403 pages. Example Ray ID: `a428d1656900f436-MIA`. This establishes an edge response; Security Events and Worker invocation-metric comparison were not collected. The rule was restored disabled and health returned 200 before resuming eligible application services.
2. ESPN admission returned 202 at 06:11 UTC. Job `9287f44b-6c06-4ee1-a42b-8d602a35ba78` reached `capturing` and `extracting`, then failed `CAPTURE_BLOCKED: could not load the page`. The capture wrapper maps multiple extraction exceptions to this generic error; this does not establish that ESPN blocked navigation. Local capture success does not prove hosted compatibility. ESPN playback remains unresolved. No repeated paid ESPN retries were run.
3. Example Domain admission returned 202 at 06:13 UTC. Job `2680ecfc-43b3-4618-8b4b-6dd06eb0ca55` reached building, validating, storing, then the expected manual-review rejection. Its retained screenshot and slice were inspected and the ordinary documentation placeholder approved with a review reason.
4. Repeating the approved URL returned 200 with the cached run. Stage and texture returned 200, with private/no-store stage responses. The stage rendered in the browser, passed its intro, showed active gameplay and received keyboard input. This is desktop browser acceptance, not phone or complete-level acceptance.

Run: `541aa160caf6f84592118aa6ac7ac72857c96af16e73059de11c6edfa99070a5`.

[Play the approved control stage](https://wwm.ewj.dev/play/401f9098ddcdd40d44920b425f53f1541574b6ace71de3762995e988ddf9d117).

Sanitized API receipts are in [evidence/capture-restart](evidence/capture-restart). Dashboard screenshots containing account information remain local and are excluded from the PR.

## Operator steps and links

### New captures: manual review

1. Open [WWM admin](https://wwm.ewj.dev/admin) and sign in through Cloudflare Access.
2. Search the submitted URL or pending review entries; select the captured run.
3. Open its retained screenshot and slices. Approve only after checking the actual content, recording a reason and confirming the selected target. Rejected or uncertain content stays unavailable.
4. Retry the URL after approval to load the approved cached run.

### Next month: reconcile before reopening

At **October 1, 00:00 UTC (September 30, 5:00 PM Pacific)** the budget ledger pauses automatically. In [WWM admin](https://wwm.ewj.dev/admin), select **Load cost controls**, inspect the new month, enter current fixed/prior spend plus uncertainty and measured stage bytes, then save reconciliation and resume eligible services. Keep the unverified provider features paused. Never lower an existing month's reservations. No reminder automation was installed.

### Before enabling AI or telemetry

These are not prerequisites for the current manual capture mode.

1. Open [Claude Console](https://platform.claude.com/) → **Settings → Workspaces**. Identify the workspace owning WWM's active Anthropic gateway key. For a dedicated WWM workspace, set and read back **Spend limits → $10/month**. If shared, isolate WWM first; preserve unrelated projects. Any new credential must be entered by the owner through the secure provider/secret interface, never chat or source control.
2. Verify [WWM gateway settings](https://dash.cloudflare.com/927320d088a7c2ec3c070b43da0e85de/ai/ai-gateway/gateways/wwm/settings) still show both aggregate spend rules and required credentials. Then engineering can enable one AI feature and verify one bounded request and its billing attribution.
3. For telemetry, open [PostHog project 260845](https://us.posthog.com/project/260845) → organization **Billing → Product analytics → Set billing limit**. Save $0 only if supported and confirmed to mean free allowance only; inspect other enabled products and shared usage. Leave forwarding paused if this cannot be verified. Only afterward attest the provider limit in WWM admin and enable telemetry.
4. Before discretionary voice CLI runs, verify ElevenLabs billing/recharge and the actual payer. Existing public audio playback does not authorize new voice generation.

[Cloudflare billing alerts](https://dash.cloudflare.com/927320d088a7c2ec3c070b43da0e85de/billing/billable-usage) are already configured; no new recipient is needed. These account-wide notifications include other projects.

### Emergency stop and recovery

1. For a routine stop, use **Pause online services** in [WWM admin](https://wwm.ewj.dev/admin).
2. For a flood, open [Cloudflare security rules](https://dash.cloudflare.com/927320d088a7c2ec3c070b43da0e85de/ewj.dev/security/security-rules), enable `wwm-emergency-dynamic-stop`, and verify static practice still works. This also blocks admin API operations; disable the edge rule in Cloudflare to regain them.
3. Review usage, reconcile upward if necessary, then restore the edge rule to disabled and resume only verified services. Existing room leases can last up to ten minutes.
4. Preserve the Budget namespace and migration history. Keep alternate hosts disabled; reopening previews requires reviewed protection and an intentional config/CI change.

## Repository verification

`pnpm check` passed: typecheck, lint (existing warnings), 144 test files / 1,566 tests passed, 6 files / 43 tests skipped. Focused infrastructure tests passed (18 tests), and production/preview configuration checks passed. The new production deployment guard rejects enabled or unspecified alternate-host flags. No performance, phone, provider exhaustion, or paid load-test claim is made by this restart receipt.
