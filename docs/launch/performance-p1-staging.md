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

Ghost preparation #22 was admitted from `ff7eaa3`; #27 device-matrix documentation accompanies it. Cache #23 (`02e1e1c`) and reviewed regression tooling #28 (`1cd13a4`) were merged as `4882a6f`. The dispose conflict preserves both ghost and stage-build cancellation; the generated documentation corpus was rebuilt. Independent source review found no semantic conflict. Renderer #20/#21 (`566d9d6`) passed its component gates and full repository check, and was merged as `b03830a`. All qualified P1 runtime changes are now integrated. Combined native measurements are complete. The result is accepted for staging review; no P2 implementation has started.

P2 issues #24–#26 and #29–#30 are deferred. In particular, the known per-retry attribute leak (#24) must stay visible in regression output; documenting or detecting it does not mean it is fixed.

## Qualified component evidence

| Change | Paired measured benefit | Tradeoff / limitation |
|---|---|---|
| Adaptive timing, #20 | Minimum-tier response under identical injected 200 ms stalls: 13.303 → 7.868 s (40.9% sooner); reported FPS now matches real approximately 5 FPS | Simulation remains clamped and deterministic. This improves adaptation, not the imposed main-thread stall itself. |
| GPU resource ownership and tier cost, #21 | Paired WebGPU high→low: 217.02 → 37.41 MiB (−82.8%); fresh low 37.26 MiB. Medium retained bytes 267.44 → 132.47 MiB | Resource estimates, not physical VRAM utilization. GPU timing varied; no stable percentage GPU-time gain claimed. Both backends and desktop/mobile viewport cycles plateau exactly after warmup. |
| Ghost worker, #22 | Native 36,000-tick preparation: 198–212 ms main-thread long task becomes no observed long task; maximum frame gap 183–200 → 17.5–17.6 ms | Total preparation rises from 198.5–212.1 to 256.6–263.8 ms because a new worker starts. Identical pose hashes, physics version and goal tick. Page CPU throttling does not throttle worker CPU. |
| Bounded screenshot cache, #23 | Two real-worker tours: 113,843,200 → 30,720,000 retained decoded bytes (−73.0%); worker backing storage 117,253,017 → 34,140,257 bytes | Evicted pages decode again. 32 MiB is the retained RGBA limit; one active oversized decode can temporarily exceed it. All 44 stage hashes match. |

These are isolated component results. Fresh combined-branch results are recorded below; neither set certifies physical lower-tier hardware.

## Component validation and visual review

- Renderer: full `pnpm check` passed (1,333 tests passed; 32 skipped), including typecheck and lint. Reference replay at 6× page CPU stress finishes at tick 5,429, score 1,484, one saved replay while changing quality. Pending-compile quality/resize and synthetic device-loss fallback to WebGL2 pass without browser errors.
- Ghost: 14 focused unit/browser checks passed; pose hashes match reference output. Its initial full suite had two existing browser failures, both passing unchanged when rerun individually. The integrated full suite is checked by the staging workflow linked below; this component failure remains recorded here.
- Cache: 27 focused unit checks (including existing stage checks) and three browser cancellation/cleanup cases passed. Its full suite passed 1,348 assertions but failed an existing share-card teardown hook timeout. The integrated full suite is checked by the staging workflow linked below; this component failure remains recorded here.
- Regression tools: 22 controlled Node tests passed independently on staging. The collector retains page and console errors in every mode, and the comparator rejects them.
- Parent independently reviewed desktop low-quality gameplay/portals and mobile learning/portal screenshots. Ball, rails, collectibles and portals remain visible. The learning HUD overlaps the timer/life display at 390×844 in both high and low quality; this existing layout issue is not resolved or accepted as mobile usability.

Renderer measurements and rejected attempts are preserved in [its build log](../build-log/performance-render-p1.md) and [raw evidence](evidence/render-p1/). The qualified candidate is labeled `qualified-*`; earlier `graphics-*`, `final-*`, `accepted-*`, `verified-*`, and `release-*` data documents intermediate candidates and must not substitute for final acceptance.

## Combined staging evidence

Measured runtime commit: `b03830af177f54301a67027c0e0c4838885d7a42`. Runtime content SHA-256: `7ec6d5eb369258f8d58e47c31222bda8ad395505dfbc13597f3bfee45509ba1e`. The opt-in production build manifest verifies 382 served assets before each audit mode. Documentation/evidence-only changes do not alter this fingerprint. Host is Apple M5 Max, 128 GiB RAM, native Metal, headed Chromium 153.0.8010.12. Native runs are serialized; unrelated host activity is not controlled.

The parent independently measured the integrated production build, rather than using the agents' component files as combined acceptance. [Raw combined evidence](evidence/performance-p1-staging/) preserves timing samples, resource counters, replay results, browser errors and provenance. Page main-thread busy time is not whole-process CPU utilization; Three.js memory counters are not physical VRAM residency; render timestamp queries are not whole-GPU utilization.

The combined GPU probe reproduced 37.41 MiB after high→low versus 37.26 MiB fresh low, with two targets and seven textures in both cases. Medium retained 132.47 MiB and high 208.07 MiB. Browser error arrays were empty. This run's GPU p95 was 10.94 ms high, 6.03 ms medium and 0.46 ms low, but prior host variance precludes a stable percentage GPU-time claim.

All 12 combined frame scenarios completed without page or console errors. Six ordinary fixtures measured 59.26–59.93 FPS; 6× page CPU stress measured 59.31 FPS (p95 18.5 ms), and 20× measured 56.93 FPS (p95 18.6 ms). Normal frame p95 is approximately 1 ms higher than the historical 17.1–17.6 ms samples; this is within the triage threshold but is not a general frame-time improvement. The large 20× difference from the older baseline is historical/unpaired and cannot establish a causal speedup. An independent subagent verified all 382 current assets and source/manifest hashes, zero errors, and 99.75–100.03% frame-window coverage.

All three combined reference replays (1×/6×/20× page CPU stress) finish at tick 5,429, score 1,484, with one saved replay and no errors. The lifecycle run completed 15 retries and seven fixture loads without errors. Post-warmup retry retention is exactly the historical 44,800 attribute bytes and two attributes per retry; program counts and the other allocation counters checked by the gate do not grow. Three.js reports 89 additional shader-source characters across the 13 post-warmup intervals (63 in the historical baseline), while program count remains 61. Its `programsSize` counter uses `program.code.length`, not measured compiled GPU allocation. The comparator returns **exit 3 / known-p2-failure**, with no hard failures, missing evidence or timing-review gates. This preserves P2 #24 as an explicit unresolved failure.

The combined artificial-stall run observed 4.971 FPS and reported 4.954 FPS, reached tier 4 by approximately the eighth one-second sample, and recovered progressively to tier 1 during the 30-second recovery window. It recorded no browser errors.

The lightweight instrumentation probe completed three alternating ten-second pairs. Enabled-minus-disabled frame-p95 deltas were approximately 0, −0.2 and −0.1 ms; main-thread busy deltas were −1.35, −0.67 and −1.26 percentage points. These noisy negative deltas do not mean instrumentation speeds up the game or establish a universal overhead bound. CPU-profiler and GPU-query overhead were not measured by this probe. Production does not import the audit tools.

The independent worker-cache probe repeated two complete A/B tours (44 builds). All stage hashes matched. Retained decoded bytes again measured 113,843,200 → 30,720,000 (−73.0%); worker backing storage measured 117,253,752 → 34,140,967 bytes. Same-page hits, eviction/redecode and oversized non-retention passed.

The parent also rebuilt the diagnostic ghost entry from the integrated source and repeated three alternating reference/worker pairs at native speed and at 6× page CPU throttling. Native reference long tasks were 184–197 ms, with maximum frame gaps 166.6–183.4 ms; workers had no observed native long tasks and gaps 17.4–18.6 ms. Native total preparation increased from 184.2–197.5 to 229.3–237.4 ms. At 6× page CPU stress, reference gaps were 1,050–1,131.9 ms and worker gaps 18.5–67.2 ms. One worker trial recorded an unattributed 79 ms long task and 93.3 ms heartbeat gap; it is retained in raw evidence, not hidden or described as zero jank. All six pairs improved frame/heartbeat responsiveness and matched every pose hash, tick count, goal tick and physics version. Page throttling does not throttle the worker, so its total wall time is not a mobile CPU-speed claim.

The diagnostic ghost build has its own asset hashes and is not the production build used for the core frame/GPU/replay/lifecycle measurements. Temporary probe sources were removed and all audit browsers/previews stopped.

## Remaining acceptance before main or P2

- Review the staging branch and its measured tradeoffs. Staging integration does not authorize production deployment.
- [Physical device matrix](performance-device-matrix.md): named lower-tier desktop, Android, iOS and phone-controller runs, sustained/thermal behavior, and product budget approval remain open under #27. Desktop/mobile viewport tests and page CPU throttling do not certify those devices.
- Known P2 #24 adds 44,800 GPU attribute bytes and two attributes per retry in the original baseline. The comparator explicitly reports this as an unresolved nonzero result; any worse/new growth fails. P2 work is deferred.
- Race mode in PR #17 was not part of the audited main baseline or this staging integration. It requires separate integration acceptance.

## Reproduce and review

```sh
git switch codex/performance-p1-staging
pnpm install --frozen-lockfile
pnpm check
node --test infra/perf/p1-regression.test.mjs
node infra/perf/p1-build.mjs
pnpm --filter @wwm/web preview --host 127.0.0.1 --port 4318
```

Run native probes one at a time, using a fresh `AUDIT_OUT` directory as described in [performance regression checks](performance-regression.md). The intentional historical P2 result returns exit 3; exit 1, 2 or 4 is not accepted. Never overwrite this evidence or reuse it after a runtime change.

[Performance staging CI](https://github.com/ewjdev/world-wide-maze/actions/workflows/performance-staging.yml) checks the published branch head: full `pnpm check`, documentation index freshness, all 22 tooling tests and source-bound native evidence comparison. Its explicit P2 warning is not a passing memory budget or production approval. CI publishes the comparison and raw evidence artifact. It does not rerun native Metal measurements on Linux.
