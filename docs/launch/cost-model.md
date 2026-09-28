# Cost model — ESTIMATES, not measurements

Every figure on this page is an **estimate** from list prices and assumptions. The original traffic tables below describe uncapped demand, not the protected allowance. They have not been reconciled with a provider invoice. Re-run `node infra/scripts/cost-model.mjs` after editing its
`ASSUMPTIONS`; replace them with real numbers from the dashboards after a week of staging/production traffic.

**Prices** (Cloudflare docs, Workers Paid, read 2026-09-25):
[Workers](https://developers.cloudflare.com/workers/platform/pricing/) $5/mo base, 10 M requests + 30 M CPU-ms
included, then $0.30/M requests and $0.02/M CPU-ms; static-asset requests free ·
[Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) 1 M requests + 400 k GB-s
included, then $0.15/M and $12.50/M GB-s; WebSocket messages billed 20:1; SQLite storage 5 GB included ·
[Browser Run](https://developers.cloudflare.com/browser-run/pricing/) 10 browser-hours + 10 concurrent browsers
(monthly average of daily peaks) included, then $0.09/hour and $2/browser ·
[R2](https://developers.cloudflare.com/r2/pricing/) 10 GB + 1 M Class A + 10 M Class B free, then $0.015/GB-mo,
$4.50/M A, $0.36/M B, no egress · KV 10 M reads / 1 M writes included, then $0.50/M and $5/M ·
D1 25 B rows read / 50 M rows written / 5 GB included, then $0.001/M, $1/M, $0.75/GB ·
[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) 20 M events included,
then $0.60/M, 7-day retention. (Cloudflare rounds billable usage up to the next unit; the model doesn't.)

## September 27 cost controls

The approved operating target is **$50/month**, including a minimum $5 fixed-cost reservation and $10 contingency. See [the operating procedure](cost-controls.md). `node infra/scripts/cost-model.mjs --protected` reads the committed admission policy directly. It prints conservative per-operation reservations and a denied-request flood scenario, assuming account free allowances have already been used elsewhere.

The admission ledger limits **new authorized work**, not Cloudflare's invoice. In-flight reservations are retained, provider accounting can lag, and denied Worker requests still incur charges. An unlimited request flood cannot be capped at $50 by application code alone. Verify provider billing limits and the zone emergency block before calling production fully protected.

- Docent: 5,500 UTF-8 bytes of serialized prompt plus bounded protocol overhead and 600 output tokens, pinned Haiku 4.5, no retries. $0.01 reserved per attempt. [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing): $1/$5 per million input/output tokens at verification.
- Moderation: $0.15 per attempt, up to 20 bounded images, 30,000 UTF-8 bytes of text/URL/title, 160 output tokens. Unreviewable/excess evidence stays pending. Same aggregate $10 AI pool and $1/day as docent and Jev.
- Room: $0.0005/minute, booked in ten-minute blocks. The $10 room pool binds at 20,000 minutes/month before the 50,000-minute unit ceiling. This includes headroom above two sockets each sending 150 messages/second and a room awake for the entire minute. [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).
- Build/upload/score/card: $0.01 each. The build reserve covers the current 300-second CPU ceiling, browser acquisition/capture and short warm lifetime; it is deliberately much higher than ordinary local timings. Failed admissions/work are not refunded.
- Reads: $0.000020 each from the $5 shared other pool, including budget enforcement. This bounds admitted volume but is an estimate of backend work, not a per-query upper price. Artifact cache hits still check current moderation policy. Large existing D1 datasets need usage reconciliation.
- Storage: reserve every attempted write, at most 10 GiB new per UTC month and 20 GiB retained; overwritten/failed/deleted bytes are not automatically credited. The operator must measure occupancy. Existing catalog metadata and audio are preserved, not automatically purged.
- Telemetry: off until an operator verifies the PostHog organization limit. 20,000/day, 500,000/month application limits and terminal drops provide additional protection. Voice generation is operator-only, requires an explicit 1–10,000-character allowance per invocation, and does not retry paid requests. It is outside the website ledger and must be included in reconciliation.
- Logs: 10% sampling. Build/card cleanup runs six times/day, up to 200 runs and 1,000 card objects examined per tick. The 1,200-run/day theoretical capacity exceeds the 300-build/day admission ceiling; this is not a production throughput measurement.
- New previews deny public dynamic APIs, isolate storage, mock AI and disable capture/telemetry. Existing previews require cleanup; changing configuration does not retrofit them.

## Estimated monthly cost (historical uncapped scenarios)
A "play" = one visit that plays about 3 stages over ~5 minutes; half of them pair a phone.

| Line item (per month) | 1k plays/day | 10k plays/day | 100k plays/day |
|---|---|---|---|
| Workers Paid subscription | $5.00 | $5.00 | $5.00 |
| Workers requests + CPU (API, replay checks, builds) | $0.00 | $0.56 | $26 |
| Durable Objects (Room relay, jobs, limiters) | $2.02 | $22 | $258 |
| Browser Run (captures) | $0.00 | $3.60 | $44 |
| R2 (stages, textures, captures, replays) | $0.00 | $1.17 | $26 |
| Workers KV (run cache, opt-outs) | $0.00 | $0.00 | $0.00 |
| D1 (runs, stages, scores) | $0.00 | $0.00 | $0.00 |
| Workers Logs | $0.00 | $0.00 | $33 |
| **Total (estimate)** | $7.02 | $32 | $392 |

| Driver | 1k | 10k | 100k |
|---|---|---|---|
| New builds / month | 1,500 | 15,000 | 150,000 |
| Browser hours / month | 5.0 | 50.0 | 500.0 |
| Peak concurrent browsers (assumed 4× average) | 1 | 1 | 3 |
| Room DO duration, GB-s / month | 36,864 | 368,640 | 3,686,400 |
| DO billed requests / month | 14,460,000 | 144,600,000 | 1,446,000,000 |
| R2 stored (30-day retention), GB | 8.8 | 87.9 | 878.9 |

**Pessimistic variant** (`--awake`: the Room DO is billed for the whole 5-minute play instead of only while
handling messages — this is what happens if it is *not* eligible for hibernation between 60 Hz frames):

| Line item | 1k | 10k | 100k |
|---|---|---|---|
| Durable Objects (Room relay, jobs, limiters) | $4.22 | $89 | $932 |
| **Total (estimate)** | $9.22 | $99 | $1,066 |

## What drives it
1. **The phone relay (Room Durable Object) is the largest usage line in every scenario** (≈ $0.00015 per phone
   play in the base case: 64 messages/s ÷ 20 in billed requests, plus ~1 ms of billed duration per message). The
   big uncertainty is duration: with the WebSocket Hibernation API an idle-but-eligible DO isn't billed between
   messages, but if the runtime keeps it billed for the whole play the DO line is ~4× higher (pessimistic table).
   **Measure it on staging** (DO metrics: GB-s per room-minute) before trusting either. Levers: send input at
   30 Hz, or move play-time input to a WebRTC DataChannel with the DO only for signalling (the brief's upgrade path).
2. **Browser Run** is cheap per build (~12 s of browser time, estimated from local timings) as long as the run
   cache works; every cache miss costs a capture. Concurrency above the 10 included browsers costs $2/browser/month.
3. **R2 storage** grows with unique builds × 30-day retention (≈ 6 MB per build: capture PNG, DPR-2 textures).
4. **Workers Logs** passes the free 20 M events only near 100k plays/day; lower `head_sampling_rate` then.

## Cache hit rates (assumed — measure them)
| Cache | Assumed | How to measure |
|---|---|---|
| KV run cache (`run:<url>…`, 7 days) | 50 % of URL submissions | Workers Logs: `msg = "cache hit"` vs `msg = "job queued"` |
| Browser HTTP cache for stages/textures (`immutable`) | per-player only | Worker requests on `/api/stages/*` |
| Edge cache in front of `/api/stages/*` | **none yet** | Follow-up: put immutable stage JSON/textures behind the Cache API or a Cache Rule to cut R2 Class B reads and Worker requests |

## Budget alerts
See docs/launch/runbook.md §7: alerts at $25 / $100 / $250 per month plus Browser Run hours and DO GB-s
thresholds. **Setting them needs the account owner** (checklist).
