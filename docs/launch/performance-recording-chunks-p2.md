# Exact compact recording (#33)

The production recorder now retains lossless consecutive-value runs in lazy typed chunks. This qualifies as a long-session retention improvement on the measured Chromium host. It does not bound the total recording horizon: #26 still needs the overflow-policy decision. Replay availability, verification eligibility, score rules, wire schemas, physics version, and timer-start semantics are unchanged.

Each distinct run stores three Float64 values, a Uint32 repeat count and packed POWER/JUMP flags: 29 bytes, in chunks of 1,024 runs (29,696 backing bytes). `Object.is` preserves exact numeric values, including signed zero. A full count starts another storage run; it never truncates the recording. Existing gameplay sampling still creates its input objects; the recorder no longer retains those objects for each sampled frame. A completed replay stays compact until its first actual submission, then materializes the existing array envelope once and releases all compact references. Repeated submissions reuse that envelope. Debug exports are independent snapshots and preserve sharing within equal runs.

## Reproduce and evidence

From the repository root, with Chromium installed and port 4323 free:

```sh
node infra/perf/recording-chunks-p2.mjs
pnpm exec vitest run apps/web/test/input-recording.test.ts
pnpm check
```

The probe owns and closes its Vite server and headless Chromium. `AUDIT_OUT` selects another evidence directory. [Raw measurements](evidence/recording-chunks-p2/memory.json) contain source/game hashes, browser/system metadata, every repeat and errors; [summary](evidence/recording-chunks-p2/summary.json) reports medians. The final run used Chromium 153.0.8010.12, 126 paired triplets: seven horizons (120 through 360,000 ticks), three scenarios, two sampling rates, three alternating-order repeats. Every array, compact debug export and completed submission produced the same JSON SHA-256. No browser errors occurred.

Baseline reproduces the prior array push: a fresh sample every two simulation ticks for 60 Hz input, or every tick for 120 Hz input. The active scenario changes all numeric fields; idle creates fresh neutral samples at that cadence. A separate same-reference idle stress retains one neutral object for the whole run. Game sampling normally produces fresh objects, so this last case is a robustness stress rather than the established normal idle path.

Memory values below are decimal MB, measured as the sum of CDP `usedSize` and `backingStorageSize` deltas from the empty checkpoint. These are browser JS heap/backing-store measurements, not process RSS, GPU memory, or physical-device certification. Explicit GC precedes retained checkpoints; raw checkpoints do not force GC. Small retained/header differences between repeats remain in the raw data.

## Retention and export tradeoffs

| Scenario | Ticks | Prior retained MB | Compact retained MB | Reduction |
|---|---:|---:|---:|---:|
| Active, 60 Hz input | 36,000 | 1.433 | 0.546 | 61.9% |
| Active, 120 Hz input | 36,000 | 2.652 | 1.084 | 59.1% |
| Fresh idle, 60 Hz input | 36,000 | 1.433 | 0.041 | 97.1% |
| Fresh idle, 120 Hz input | 36,000 | 2.657 | 0.036 | 98.7% |
| Same-reference idle stress | 36,000 | 0.209 | 0.036 | 82.9% |
| Active, 60 Hz input | 360,000 | 13.786 | 5.277 | 61.7% |
| Active, 120 Hz input | 360,000 | 26.026 | 10.549 | 59.5% |
| Same-reference idle stress | 360,000 | 1.546 | 0.035 | 97.7% |

The first chunk has a fixed allocation cost: this does **not** improve every short recording. Same-reference idle at 120 ticks retains about 0.65 KB before versus 30.3 KB after. At 5,429 ticks it remains worse (26.8 KB versus 41.0 KB measured total); the next measured point, 8,192 ticks, improves (45.6 KB versus 41.0 KB). The break-even is bracketed by these measured points, not a universal exact tick count. Headers/JIT measurement noise aside, its backing buffer remains exactly 29,696 bytes until another distinct run/chunk is needed.

At 36,000 active ticks, the raw array-expansion checkpoint increases from 1.448 → 2.352 MB (60 Hz) and 2.667 → 3.718 MB (120 Hz). At 360,000 ticks it increases from 13.801 → 19.025 MB and 26.041 → 36.579 MB. These observed overlapping allocations are a real transient cost even though the compact references have been released.

At 36,000 active ticks, completed submission's **held array plus JSON after GC** is 5.567 → 5.508 MB at 60 Hz and 6.791 → 6.732 MB at 120 Hz. This checkpoint is a retained lower bound on the transient export peak, not the maximum. The raw serialization checkpoint **before GC** increases from 9.740 → 10.643 MB and 10.964 → 12.010 MB respectively. Releasing references cannot force immediate collection. These raw checkpoints include diagnostic digest encoding allocations in both variants; they are not a claim about peak serializer RSS.

Opt-in debug export retains its compact source, so its held array plus JSON costs more for changing input: 5.567 → 6.053 MB (60 Hz) and 6.791 → 7.816 MB (120 Hz) at 36,000 ticks. After actual submission, an independent debug snapshot holds two arrays and no compact chunks: approximately 2.737/5.187 MB without JSON at those cadences. Debug mutation never changes the retained submitted envelope. Repeated diagnostic snapshots should not be treated as free production telemetry.

At 360,000 ticks, completed active export's post-GC checkpoint is still approximately the original array cost (55.174 → 55.068 MB / 67.413 → 67.308 MB). Large serialization remains expensive and unbounded. This representation improvement does not resolve #26's long-run policy or server verification horizon.

## CPU cost and correctness

Local median wall time for the whole 36,000-tick synthetic capture is 0.8 → 1.2 ms at 60 Hz input and 1.7 → 1.5 ms at 120 Hz. First submission adds 1.9/2.3 ms of array expansion; JSON serialization is 3.0/3.1 ms in both baseline and candidate. At 360,000 active ticks, expansion adds 5.8/9.7 ms; serialization is 29.8 → 29.9 ms / 31.2 → 31.1 ms. Fresh idle at 36,000 adds 0.2–0.3 ms expansion and about 0.2–0.3 ms serialization. These short synthetic measurements support accepting a small conversion cost for the retained-memory reduction. They do not establish a whole-game CPU, FPS, battery, thermal, or physical low-end-device gain.

Eight unit tests cover exact doubles/flags, signed zero, chunk boundaries, mutable-source isolation, independent exports, release/reuse on submission, reset, over-72,000-tick availability, overflow splitting through a chunk boundary, fixture values and explicit/implicit timer offsets. The existing browser-to-workerd game test also compares every recorded sample to the reference, independently replays to the same goal/items/score, verifies the actual submitted 5,429-tick replay, and now checks debug mutation isolation plus compact-byte release after submission.

The first RLE full-suite attempt passed all recorder/game/worker/cards checks but failed the extension source-tab scroll restoration assertion (expected 420, observed 0). [First full log](evidence/recording-chunks-p2/full-check-first.txt) preserves the failure. An unchanged focused extension retry passed 5/5, then one unchanged full `pnpm check` retry passed **1,391 tests, 32 skipped** ([final log](evidence/recording-chunks-p2/full-check-final.txt)). No assertions were relaxed. The exact cause of the intermittent extension restoration failure remains unresolved; this is not a claim that test reliability was fixed.

## Rejected candidates and remaining boundary

Both earlier candidates remain available: [naive fixed-width](evidence/recording-chunks-p2/initial-naive/memory.json) and [sharing/release fixed-width](evidence/recording-chunks-p2/refined-fixed-width/memory.json). The naive export retained too many new objects; the second improved normal-path retention but regressed repeated-reference idle retention. Neither is the final implementation. No outliers or failure logs were deleted.

No production recorder cap, truncation, changed score/verification policy, wire-format migration, or disk spill was introduced. The total distinct-run horizon remains unbounded. Physical Android/iOS/low-tier desktop acceptance remains the separate #27 gate. The broad epic is not closed by #33.
