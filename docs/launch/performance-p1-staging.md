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

Implementation and isolated measurements are in progress. Ghost preparation #22 passed its component improvement/correctness gate and was merged from `ff7eaa3`; #27 device-matrix documentation accompanies it. Renderer/cache candidates and combined staging verification remain pending. Final measurements, commits, tests and unresolved acceptance will replace this status before handoff.

P2 issues #24–#26 and #29–#30 are deferred. In particular, the known per-retry attribute leak (#24) must stay visible in regression output; documenting or detecting it does not mean it is fixed.
