# Performance regression checks

Issue #28 adds repeatable evidence gates to performance epic #19. This tooling is opt-in: it runs outside the production module graph, collects bounded local sessions, stubs API requests, and switches analytics off. It does not add production telemetry, gameplay work, or schema fields.

## Reproduce and compare

Build and serve the candidate production web app, then run the existing audit with a distinct evidence directory:

```sh
AUDIT_BASE=http://127.0.0.1:4318 AUDIT_OUT=docs/launch/evidence/performance-p1-staging node infra/perf/audit-2026-09.mjs frames
AUDIT_BASE=http://127.0.0.1:4318 AUDIT_OUT=docs/launch/evidence/performance-p1-staging node infra/perf/audit-2026-09.mjs gpu
AUDIT_BASE=http://127.0.0.1:4318 AUDIT_OUT=docs/launch/evidence/performance-p1-staging node infra/perf/audit-2026-09.mjs replay
AUDIT_BASE=http://127.0.0.1:4318 AUDIT_OUT=docs/launch/evidence/performance-p1-staging node infra/perf/audit-2026-09.mjs lifecycle
node infra/perf/p1-regression.mjs docs/launch/evidence/audit-2026-09-27 docs/launch/evidence/performance-p1-staging /tmp/performance-comparison.json
node --test infra/perf/p1-regression.test.mjs
AUDIT_BASE=http://127.0.0.1:4318 AUDIT_OUT=docs/launch/evidence/performance-p1-staging node infra/perf/p1-overhead.mjs
```

Use one native browser workload at a time. Preserve raw files; `AUDIT_OUT` accepts absolute or cwd-relative directories. Wrappers forward every frame argument, including separate simulation and wall-time deltas. Never replace original audit evidence with new runs.

Each audit records commit, browser, hardware, date, headless state, viewport, scenario DPR/throttling, actual backend and framebuffer dimensions. Renderer bytes are library resource estimates. Worker cache evidence separately records worker `Runtime.getHeapUsage().backingStorageSize`, WeakRef-observed live RGBA buffers, page heap and aggregate renderer-process RSS; RSS is never attributed entirely to a cache. The cache probe compares exact stage JSON hashes for two baseline/candidate fixture tours, same-page slice hits and evicted revisits.

The September 27 audit is a historical reference, useful for resource/correctness checks and noisy timing comparison. It is not a paired experiment. Individual optimization acceptance must also review the renderer and ghost agents' paired evidence. The original `ghost` audit mode directly calls the old reference recorder and cannot establish the worker path's performance gain.

## Gates and interpretation

| Exit | Meaning | Required action |
|---|---|---|
| 0 | Complete supplied evidence passes these checks | Review paired gains and remaining device gates before any merge decision |
| 1 | Hard correctness or resource failure | Fix before staging acceptance |
| 2 | Missing evidence/metadata | Collect the missing cases; never treat absent metrics as zero |
| 3 | Known P2 #24 attribute retention still fails | Keep issue open; staging CI explicitly warns, and memory acceptance remains incomplete |
| 4 | Timing/environment review required | Repeat controlled paired trials and resolve before claiming a gain |

Hard gates require the reference replay to finish with 5,429 ticks, score 1,484 and one saved replay at normal/6×/20× CPU stress. High→low must retain no extra render targets compared with fresh low; a small byte allowance (larger of 8 MiB or 10%) accommodates non-target shader/geometry state. Optional cache evidence must preserve stage hashes and remain at or below 32 MiB in at least two nine-stage tours. Post-warmup retry attribute growth is explicitly reported as the unresolved P2 issue #24, not ignored or fixed in P1.

Timing compares scenario-matched p95 values; a candidate beyond baseline × 1.2 + 2 ms calls for review. This tolerance is a triage threshold, not a product frame budget. Browser/host/headless/backend changes also require review. Passing a high-end-machine test does not certify lower-tier desktop/mobile hardware, GPU utilization, battery life or thermal behavior. CPU throttling does not reproduce a weak GPU or worker CPU.

The controlled tooling tests inject wrong replay scores, extra render targets, retained bytes, missing evidence, timing regressions and a 44,800-byte-per-retry leak to prove failures cannot silently pass.

## Instrumentation cost

`p1-overhead.mjs` runs three alternating pairs of ten-second windows on the same idle practice scene. Both arms keep minimal rAF timing and endpoint CDP metrics; the enabled arm adds the audit's per-frame CPU timer wrapper, a long-task observer and once-per-second debug-state read. It reports frame-p95 differences and main-thread busy percentage-point differences for every pair. Keep raw positive and negative deltas; small differences are scheduler noise, not a guaranteed cost or gain. This experiment does not characterize CPU-profiler sampling or asynchronous GPU-timestamp resolver overhead. Those invasive modes remain explicitly opt-in. Production has no added diagnostics code from this issue, so disabled product overhead is zero by construction.

## Staging CI

`.github/workflows/performance-staging.yml` runs only on `codex/performance-p1-staging` pushes or manual dispatch on that branch. Node 24, frozen dependencies, Chromium and `pnpm check` mirror repository correctness checks. Linux browser tests use the existing headless WebGL2 software fallback and make no native GPU timing claim. CI compares committed native evidence, publishes a 14-day artifact, and explicitly warns on the known P2 retention failure. Other failures or missing evidence block the workflow. There are no deployment steps or production credentials.
