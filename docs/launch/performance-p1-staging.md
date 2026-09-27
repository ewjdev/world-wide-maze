# Performance P1 staging review

## Scope and integration gate

Eric authorized sub-agents to implement epic #19's P1 issues, test each change, and merge only work with demonstrated performance improvement into a staging branch before starting P2. The branch is `codex/performance-p1-staging`; production and main are outside this integration step.

Starting point: current main `433943d` plus the September 27 audit evidence, combined as `d88697faed5a2f5791b7bd8ee0b22dd56add95aa`. Each implementation agent has an isolated managed worktree. Browser benchmarks and full suites are scheduled serially on the shared host. Ordinary host activity remains uncontrolled.

| P1 | Primary measured acceptance | Correctness acceptance |
|---|---|---|
| #20 adaptive timing | True active-play frame timing and reduced delay to appropriate quality reduction under sustained pressure | Hidden/pause intervals excluded; stable recovery; identical replay ticks/score |
| #21 GPU tiers | High→low actually releases unused targets and materially reduces retained bytes | Repeated recovery works; both backends render correctly; gameplay cues remain visible |
| #22 ghost preparation | Long replay no longer monopolizes the main thread; input/render responsiveness improves | Worker/reference pose parity, cancellation, same-stage retries, disposal and error state |
| #23 decoded cache | Multi-capture retention has a measured byte bound below the unbounded baseline | Same-page hits, correct eviction/rebuild, unchanged stage output, settled cancellation/error promises |
| #27 hardware budgets | Repeatable desktop/mobile matrix and proposed budgets accompany measured gains | Unavailable physical devices remain untested; no emulation presented as device acceptance |
| #28 regression evidence | Reproducible comparison identifies improvements and catches injected regressions with bounded collection overhead | Metadata, metric distinctions, replay invariants, explicit known P2 failures |

An improvement can be reduced GPU memory, shorter main-thread stalls or earlier useful adaptation; average FPS alone is insufficient. A passing unit test or changed statistic alone does not establish a runtime performance gain. Documentation and regression tooling support the performance evidence and do not count as runtime optimizations.

## Status

Ghost preparation #22 was admitted from `ff7eaa3`; #27 device-matrix documentation accompanies it. Cache #23 (`02e1e1c`) and reviewed regression tooling #28 (`1cd13a4`) were merged as `4882a6f`. The dispose conflict preserves both ghost and stage-build cancellation; the generated documentation corpus was rebuilt. Independent source review found no semantic conflict. Renderer qualification and combined staging verification remain in progress.

P2 issues #24–#26 and #29–#30 are deferred. In particular, the known per-retry attribute leak (#24) must stay visible in regression output; documenting or detecting it does not mean it is fixed.

## Qualified component evidence

| Change | Paired measured benefit | Tradeoff / limitation |
|---|---|---|
| Ghost worker, #22 | Native 36,000-tick preparation: 198–212 ms main-thread long task becomes no observed long task; maximum frame gap 183–200 → 17.5–17.6 ms | Total preparation rises from 198.5–212.1 to 256.6–263.8 ms because a new worker starts. Identical pose hashes, physics version and goal tick. Page CPU throttling does not throttle worker CPU. |
| Bounded screenshot cache, #23 | Two real-worker tours: 113,843,200 → 30,720,000 retained decoded bytes (−73.0%); worker backing storage 117,253,017 → 34,140,257 bytes | Evicted pages decode again. 32 MiB is the retained RGBA limit; one active oversized decode can temporarily exceed it. All 44 stage hashes match. |

These are isolated component results. Fresh combined-branch results will be recorded separately; component measurements do not certify the integrated build or physical lower-tier hardware.
