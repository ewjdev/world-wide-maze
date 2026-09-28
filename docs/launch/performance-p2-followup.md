# Performance follow-up staging

Historical pre-main checkpoint. Current merged-runtime qualification is in [main integration evidence](performance-main-integration.md).

September 27, 2026. Continues [the accepted P2 checkpoint](performance-p2-staging.md) at `2629523` on `codex/performance-p1-staging`. Three agents worked in separate worktrees; benchmark, build and full-suite activity was serialized on the measurement host. This batch targets staging only. Both desktop and mobile remain in scope.

## Individual results

| Work | Measured result | Qualification |
|---|---|---|
| #32 audio preparation | Sound-enabled first-key to next-rAF median: 46.45 → 14.00 ms native; 248.55 → 16.20 ms under 6× page CPU stress; learning 250.75 → 17.05 ms. | `81cb3a6`; 18 actual-product trials per arm, exact 18 cue and rolling-loop PCM, failure/resume/disposal checks, 1,394 passing repository tests. |
| #33 recording storage | At 36,000 ticks, active retained storage: 1.433 → 0.546 MB at 60 Hz sampling and 2.652 → 1.084 MB at 120 Hz. Repeated identical idle input uses one 29 KiB backing chunk. | `44f45dc`; final lossless run encoding measured in 126 comparison triplets; exact exported JSON, independent review and 1,391 passing repository tests. |
| #27/#28 device capture | Opt-in local, source-bound capture and JSON export for browser frames, engine calls, quality/resource snapshots and sustained trends. No production runtime change. | `ec7e53c`; 20 integrity tests, automated browser/download smoke and 1,383 passing repository tests. |

Timing and memory numbers above are laboratory measurements, not accepted minimum-device budgets. No overall FPS or total-device CPU/GPU utilization gain is inferred from them. See the [audio handoff](../build-log/performance-audio-p2.md), [recording report](performance-recording-chunks-p2.md) and [device guide](performance-device-capture.md).

## Tradeoffs and rejected attempts

Audio prepares 2,450,188 bytes of PCM before the first gesture, then releases each transferred cue after its AudioBuffer copy. Normal prepared audio remains exact; early/failure feedback uses bounded approximate tones. Cold AudioContext creation still produced an approximately 119 ms first-input outlier. All trials remain in the evidence; page CPU throttling does not throttle synthesis workers and is not a mobile-device forecast. Ten native disposal cycles returned to zero workers and contexts. An injected delayed-cue negative control failed as intended.

The initial recorder increased export memory and was rejected. A fixed-width refinement still retained too much memory for long identical-input runs; it was replaced by exact consecutive-value runs. Final active recording adds approximately 0.4 ms of append work over 36,000 ticks in the 60 Hz laboratory case and approximately 2 ms for first submission expansion. Completed submission releases compact storage, but pre-GC serialization checkpoints still show roughly 0.9–1.0 MB of extra transient memory at 36,000 ticks. Debug snapshots deliberately retain the compact source. A tiny recording can cost more than an array because of the first 29 KiB chunk; the same-reference stress case first wins at the measured 8,192-tick checkpoint. These are tradeoffs, not a claim that every memory metric improves.

Recordings retain every tick and preserve score, timer offsets, physics version and replay wire values. There is no new recording horizon, silent truncation, score-only overflow or browser-storage policy. #26 remains open for that decision and for worst-case long-session memory bounds.

The recorder’s first full run failed an unchanged extension source-page scroll assertion (expected 420, observed 0). The unchanged extension suite then passed 5/5 and the full suite passed 1,391 tests. The exact cause remains unresolved; no assertion was relaxed, and both outcomes are retained. Earlier fixed-width trial Worker timing/cleanup failures also passed focused retries. These failures are not presented as repaired product defects.

## Combined qualification

All three changes are integrated in `16e7992`. The fresh combined build contains 383 verified assets and runtime fingerprint `bc217847a194d757e51274653397bc09365f0570b4764390fd61ec73eafebe43` (428 files). All six core native modes completed without captured browser errors. All 51 strict [comparison gates](evidence/performance-p2-followup/comparison.json) pass. Twelve frame scenarios have p95 18.3–18.6 ms; these small differences from the accepted baseline are not an active-FPS improvement claim. Normal/6×/20× reference replays each finish at 5,429 ticks, score 1,484 and one saved replay. Post-warmup retained resource counters stay flat; downshift and fresh-low scenes each retain two render targets. The combined sound-enabled batch also passes its source-bound gate: first-key to next-rAF medians are **46.45 → 14.30 ms native (69.2% lower)**, **248.55 → 17.30 ms at 6× page stress**, and **250.75 → 17.15 ms in stressed learning mode**. All eighteen runs have valid trusted inputs and no browser errors. The native maximum remains 114.6 ms, so cold context stalls are not eliminated. [Combined audio comparison](evidence/performance-p2-followup/audio-comparison.json).

All 59 dedicated regression, audio-gate, recording-research and device-tool tests pass. Final combined `pnpm check` passes: **120 files / 1,402 tests passed; three files / 32 tests skipped**, 149.44 seconds. [Full output](evidence/performance-p2-followup/full-check.txt). Generated documentation validation also runs before publication. The [staging workflow](https://github.com/ewjdev/world-wide-maze/actions/workflows/performance-staging.yml) validates the published head; epic #19 records its exact accepted commit and CI run. Hosted software rendering checks correctness and the committed native evidence, not native GPU timing. The staging workflow requires current-runtime audio evidence, strict resource plateau checks and device-tool integrity tests. Eleven audio-gate tests reject missing identity or asset provenance, altered manifests, incomplete/duplicate trials and invalid timings before calculating improvement. A stale audio report is rejected by a controlled negative test. No historical P1 resource-leak waiver is enabled.

## Remaining acceptance and integration

The physical lower-tier desktop, Android Chrome and iOS Safari matrix, accepted budgets, thermal/battery behavior and input-to-photon measurements remain open under #27/#28. A paired physical iPhone was listed locally but was not reachable; it was not used as test evidence. Automated or emulated device captures cannot pass as physical acceptance. CPU/GPU utilization and worker memory require independent profiling; network RTT is not input-to-photon latency.

Main advanced independently through cost-controls PR #31 to `1947496` during this work. This performance batch remains based on the accepted staging checkpoint; integrating current main and repeating the relevant acceptance checks is a later promotion gate. This batch does not merge to main or deploy.
