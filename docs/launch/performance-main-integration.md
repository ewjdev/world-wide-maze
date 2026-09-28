# Performance evidence after integrating main

September 27, 2026. PR #34 integrated main at `fedb9bc`, then quarantined three browser tests at `a022bde`. Both required repository checks passed at `a022bde`, and the PR preview deployed successfully. Performance staging correctly rejected the previous candidate measurements because they described a different runtime. This batch collects new evidence; it does not disable that check.

## Build and scope

Measured source: `a022bdeda3238507b3d8549371a1be58735bc422`, runtime fingerprint `b420b32e2c08409ee28e057cfda81c6e622548f29eb4f69a1ade05dc0d723584` (1,036 files). The production build has 418 verified assets. It explicitly uses `VITE_RACE_ENABLED=true` to match the PR preview and disables telemetry. [Build settings](evidence/performance-main-integration/build-settings.json).

Native measurements use the same Apple M5 Max host and headed Chromium/Metal as the earlier evidence. Workloads run one at a time. These scenarios cover classic gameplay and learning with the race entry enabled; they do not benchmark racing itself or certify lower-tier hardware, thermal behavior, battery life or input-to-photon latency. Library allocation estimates are not physical GPU utilization or VRAM residency.

## Audio comparison

The initial race-disabled collection and an unisolated race-enabled collection were rejected for extra unlock calls before the intended Space presses. Both complete collections remain under `rejected-race-disabled-startup/` and `rejected-unisolated-startup/`; no individual samples were removed to obtain a pass.

The headed collector now admits its explicitly armed Space presses and suppresses unrelated key/pointer gestures before they reach the product. It records gesture categories/times, without typed text. A suppressed Space or any suppressed gesture inside an input-to-next-frame window invalidates collection. Both press/release pairs must complete; the existing exact-two-input/two-unlock gate remains. The admitted event follows the normal game audio path. The preserved raw v1 metadata describes the planned Space presses as unmodified; the guard itself does not inspect modifier flags, so no separate modifier-exclusion guarantee is claimed. The collector’s label is corrected for future runs; dispatch logic and captured values are unchanged.

Because this changed the measurement harness, the old audio implementation was rebuilt in an existing isolated worktree at `7eb2309`. Its source fingerprint matches the historical `36bcaafb…` baseline, with 382 verified assets. All 18 baseline trials were recollected using the same isolation/profiling harness as all 18 candidate trials. Original baseline evidence remains untouched. [New baseline](evidence/performance-main-integration/audio-baseline/startup.json), [candidate](evidence/performance-main-integration/startup/startup.json), [comparison](evidence/performance-main-integration/audio-comparison.json).

| Scenario | Baseline first-key → next-rAF median | Candidate | Reduction |
| --- | --- | --- | --- |
| Native | 44.90 ms | 14.75 ms | 67.1% |
| 6× page CPU stress, constrained network | 273.05 ms | 16.00 ms | 94.1% |
| Learning, 6× page CPU stress | 266.40 ms | 18.15 ms | 93.2% |

All 36 trials have two trusted inputs and two unlocks, complete release observations and no browser errors. Two unrelated keys suppressed in the candidate occurred outside its measured windows. All cold outliers remain: candidate native maximum is 133.8 ms. Cold AudioContext stalls are not eliminated. The unchanged comparison thresholds pass. These sequential laboratory batches are not a physical mobile forecast or field INP measurement.

## Core and repository validation

The complete candidate batch has 12 frame scenarios, four GPU cases, three replay cases, 15 lifecycle retries/seven fixture loads, and separate stall/learning probes. No nested browser errors were found. All three replays reach result at 5,429 ticks and score 1,484 with exact recording and one saved replay. The artificial-stall probe goes from tier 0 to 4, then recovers to tier 1 within 30 seconds; learning stays active/play with p95 17.6 ms. Both extra modes' source and all 418 served asset hashes were independently verified.

Gate-covered allocation counters remain flat across 15 retries. Shader-source byte accounting increases by 89 bytes while program count stays 61; this is not measured compiled GPU allocation. Returning to the original fixture reproduces every resource counter exactly. This is not a claim that every byte-valued diagnostic is perfectly constant.

The original timing comparison returned review (exit 4) for 20× practice and 20× replay, at p95 34.2/33.4 ms versus the historical 18.6/17.7 ms. The [unmodified result](evidence/performance-main-integration/historical-comparison.json) is retained. Three alternating same-host 20× practice pairs then reproduced the slower timing on the old source too:

| Pair | Order | Old source p95 | Merged source p95 |
| --- | --- | --- | --- |
| 1 | Old, merged | 34.1 ms | 34.1 ms |
| 2 | Merged, old | 33.7 ms | 34.1 ms |
| 3 | Old, merged | 34.3 ms | 34.0 ms |

All six partial diagnostic runs remain in [stress-pairs](evidence/performance-main-integration/stress-pairs/). They are not substituted into the complete candidate file. They show that the historical timing shift is reproducible on the old build under current measurement conditions; they do not identify the underlying host/throttling cause or demonstrate a new speedup.

The timing reference is therefore refreshed with **all 12 frame scenarios and all three replay cases** from the original `36bcaafb…` source. The GPU and lifecycle reference files are retained byte-for-byte from `performance-p2-staging`; those historical comparisons already pass and their provenance remains explicit. [Baseline provenance](evidence/performance-main-integration/comparison-baseline/provenance.json). No threshold was increased, and the candidate's original full runs remain unchanged.

The final comparison passes **all 51 gates** against that documented baseline. The refreshed 20× replay baseline is 33.4 ms p95, matching the candidate; the full frame baseline is 35.1 ms versus candidate 34.2 ms. All baseline replays also preserve the required endpoint. Repository validation passed typecheck, lint and 1,560 tests (47 skipped) on one unchanged full-suite retry. The first attempt timed out in the Grown-ups hold-to-open browser check; its focused retry passed 4/4. Both logs are preserved and [P1 #37](https://github.com/ewjdev/world-wide-maze/issues/37) tracks the intermittent failure without adding a skip. The source-bound core comparison retains strict resource plateau requirements and no historical leak waiver. The three explicitly authorized browser quarantines remain tracked by #35/#36; fresh performance evidence does not close those issues.
