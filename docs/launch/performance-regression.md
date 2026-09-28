# Performance regression checks

Issue #28 adds repeatable evidence gates to performance epic #19. This tooling is opt-in: it runs outside the production module graph, collects bounded local sessions, stubs API requests, and switches analytics off. It does not add production telemetry, gameplay work, or schema fields.

## Reproduce and compare

Build the candidate with the audit wrapper, serve that production dist, then collect evidence into a distinct directory:

```sh
node infra/perf/p1-build.mjs
pnpm --filter @wwm/web preview --host 127.0.0.1 --port 4318
# Run collectors in another terminal while that preview remains running.
PERF_CANDIDATE="$(mktemp -d /tmp/wwm-perf.XXXXXX)"
AUDIT_BASE=http://127.0.0.1:4318 AUDIT_OUT="$PERF_CANDIDATE" node infra/perf/audit-2026-09.mjs frames
AUDIT_BASE=http://127.0.0.1:4318 AUDIT_OUT="$PERF_CANDIDATE" node infra/perf/audit-2026-09.mjs gpu
AUDIT_BASE=http://127.0.0.1:4318 AUDIT_OUT="$PERF_CANDIDATE" node infra/perf/audit-2026-09.mjs replay
AUDIT_BASE=http://127.0.0.1:4318 AUDIT_OUT="$PERF_CANDIDATE" node infra/perf/audit-2026-09.mjs lifecycle
node infra/perf/p1-regression.mjs docs/launch/evidence/performance-main-integration/comparison-baseline "$PERF_CANDIDATE" /tmp/performance-comparison.json --strict-resource-plateau
node --test infra/perf/p1-regression.test.mjs
AUDIT_BASE=http://127.0.0.1:4318 AUDIT_OUT="$PERF_CANDIDATE" node infra/perf/p1-overhead.mjs
```

Use one native browser workload at a time. Preserve raw files; `AUDIT_OUT` accepts absolute or cwd-relative directories. Wrappers forward every frame argument, including separate simulation and wall-time deltas. Never replace original audit evidence with new runs.

The build wrapper fingerprints runtime inputs before and after the production build and refuses a manifest if they changed. It writes an opt-in `performance-build.json` alongside dist with the source fingerprint and every built asset hash. Collectors require that manifest and verify actual HTTP-served bytes before timed windows, using a separate Node cache; a stale preview cannot be stamped with a new source hash. This does not change game code or its startup imports.

Each audit records commit, browser, hardware, date, headless state, viewport, scenario DPR/throttling, actual backend and framebuffer dimensions. Renderer bytes are library resource estimates. Worker cache evidence separately records worker `Runtime.getHeapUsage().backingStorageSize`, WeakRef-observed live RGBA buffers, page heap and aggregate renderer-process RSS; RSS is never attributed entirely to a cache. The cache probe compares exact stage JSON hashes for two baseline/candidate fixture tours, same-page slice hits and evicted revisits.

The September 27 audit is a historical reference, useful for resource/correctness checks and noisy timing comparison. It is not a paired experiment. Individual optimization acceptance must also review the renderer and ghost agents' paired evidence. The original `ghost` audit mode directly calls the old reference recorder and cannot establish the worker path's performance gain.

## Gates and interpretation

| Exit | Meaning | Required action |
|---|---|---|
| 0 | Complete supplied evidence passes these checks | Review paired gains and remaining device gates before any merge decision |
| 1 | Hard correctness or resource failure | Fix before staging acceptance |
| 2 | Missing evidence/metadata | Collect the missing cases; never treat absent metrics as zero |
| 3 | Historical P1 mode only: known #24 attribute retention still fails | Current P2 CI uses strict mode and accepts no leak waiver |
| 4 | Timing/environment review required | Repeat controlled paired trials and resolve before claiming a gain |

Hard gates require the reference replay to finish with 5,429 ticks, score 1,484 and one saved replay at normal/6×/20× CPU stress. High→low must retain no extra render targets compared with fresh low; a small byte allowance (larger of 8 MiB or 10%) accommodates non-target shader/geometry state. Optional cache evidence must preserve stage hashes and remain at or below 32 MiB in at least two nine-stage tours. Current P2 staging uses `--strict-resource-plateau`: every post-warmup checkpoint must stay at or below the warm retained set for attributes and all other tracked allocation counters. Any growth, including an intermediate peak that later recovers, fails; a missing checkpoint is incomplete evidence. The historical P1 default retains its explicitly unresolved 44,800-byte/two-attribute waiver solely for reproducing the older checkpoint. It is not used by current staging CI.

Timing compares scenario-matched p95 values; a candidate beyond baseline × 1.2 + 2 ms calls for review. This tolerance is a triage threshold, not a product frame budget. Browser/host/headless/backend or native GPU identity changes also require review. Every successful baseline frame scenario must have positive candidate timing, at least 30 samples covering the measured window, at least 80% of its baseline duration, matching CSS viewport/DPR/workload, and backend metadata. Intended framebuffer-resolution changes remain measurable optimizations. Passing a high-end-machine test does not certify lower-tier desktop/mobile hardware, GPU utilization, battery life or thermal behavior. CPU throttling does not reproduce a weak GPU or worker CPU.

Twenty-five controlled tooling tests inject wrong replay scores, extra render targets, retained bytes, missing evidence, timing regressions a 44,800-byte-per-retry leak, smaller leaks, recovered intermediate peaks and missing resource checkpoints to prove failures cannot silently pass.

## Instrumentation cost

`p1-overhead.mjs` runs three alternating pairs of ten-second windows on the same idle practice scene. Both arms keep minimal rAF timing and endpoint CDP metrics; the enabled arm adds the audit's per-frame CPU timer wrapper, a long-task observer and once-per-second debug-state read. It reports frame-p95 differences and main-thread busy percentage-point differences for every pair. Keep raw positive and negative deltas; small differences are scheduler noise, not a guaranteed cost or gain. This experiment does not characterize CPU-profiler sampling or asynchronous GPU-timestamp resolver overhead. Those invasive modes remain explicitly opt-in. Production has no added diagnostics code from this issue, so disabled product overhead is zero by construction.

## Scope of automated acceptance

A passing comparator covers the supplied historical frame/resource/reference-replay subset. It does not by itself accept every P1 change. Classic ghost responsiveness and automatic-quality timing use the agents' separate paired probes; cache evidence is an optional supplemental input. Review those individual paired results and the combined staging batch before deciding to merge. The workflow's name means staging validation, not complete device or production performance acceptance.

## Staging CI

`.github/workflows/performance-staging.yml` runs only on `codex/performance-p1-staging` pushes or manual dispatch on that branch. Node 24, frozen dependencies, Chromium and `pnpm check` mirror repository correctness checks. Linux browser tests use the existing headless WebGL2 software fallback and make no native GPU timing claim. CI requires source-bound served-build proof and verifies candidate native evidence matches a SHA-256 fingerprint of current runtime source bytes, then compares it. Runtime code, shaders, entry HTML, public assets, build-plugin dependencies, extension build inputs, compiler/workspace configuration, fixtures, package manifests and the lockfile are included; docs/evidence-only commits are excluded. It does not remeasure native GPU performance on the hosted runner. CI publishes a 14-day artifact. Every nonzero comparison result blocks the workflow; the former P1 resource-leak warning path is removed. It also runs the exact packed-recording research tests, 20 device-tool integrity tests, and 11 sound-enabled comparison tests. The main-integration batch compares its documented `comparison-baseline` with `performance-main-integration`; the audio comparator separately requires fresh combined startup evidence via `--current-runtime`. That gate validates unique cold/warm trials, finite paired input/unlock timings, host/build metadata and recomputed asset-manifest hashes before calculating gains. There are no deployment steps or production credentials.

## Portable device collection

Use [the opt-in device capture guide](performance-device-capture.md) for source-bound local exports and incomplete/invalid-evidence checks on desktop or phone. The tool never certifies physical hardware or selects accepted budgets.

## Sound-enabled first-input comparison

After collecting the core modes in the same unused directory, run:

```sh
AUDIT_BASE=http://127.0.0.1:4318 AUDIT_OUT="$PERF_CANDIDATE/startup" AUDIT_MUTED=0 node infra/perf/startup-p2.mjs
node infra/perf/audio-p2-summary.mjs docs/launch/evidence/performance-main-integration/audio-baseline/startup.json "$PERF_CANDIDATE/startup/startup.json" /tmp/performance-audio-comparison.json --current-runtime
node --test infra/perf/audio-p2-summary.test.mjs
```

Its 50% unlock and 20% first-key-to-rAF improvement thresholds qualify this specific audio change against the measured baseline. They are not physical-device budgets or field INP targets. All eighteen samples and cold-context outliers remain in the evidence.

The current audio baseline was recollected from runtime `36bcaafb…` using the same scripted-input isolation as the merged candidate. The headed collector admits one explicitly armed Space per measured press and logs suppressed pointer/other-key categories without typed content. Suppressed Space or interference during an input-to-rAF timing window invalidates collection. Both press/release pairs must complete; the exact-two-input/two-unlock comparison remains unchanged. Seven Node tests exercise dispatch and rejection paths. See [main integration evidence](performance-main-integration.md).
