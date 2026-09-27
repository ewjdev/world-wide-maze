# Performance P1: real frame timing and graphics resource ownership

Date: 2026-09-27. Codex renderer sub-agent, coordinated by the performance-epic lead. Baseline: `d88697f` (current main plus the original audit). Worktree: `performance-render`; branch: `codex/performance-render-p1`. Issues: [#20](https://github.com/ewjdev/world-wide-maze/issues/20), [#21](https://github.com/ewjdev/world-wide-maze/issues/21).

## Result and scope

- Real active-play timing reduces the wait to minimum graphics under sustained 200 ms stalls from **13.303 to 7.868 seconds (40.9%)**. Glow turns off at 5.857 rather than 9.284 seconds. The exact same artificial stall still limits rendering to about 4.96 FPS; the ladder now reports that truthfully rather than 10 FPS. Recovery hysteresis remains unchanged. Physics stays at 120 Hz with its existing safe delta and score/replay contract.
- The final graphics candidate reduces high→low retained renderer accounting from **217.02 to 37.41 MiB (82.8%)**, approaching **37.26 MiB fresh low**, with the same **2 render targets / 7 textures**. Fresh low previously used 91.09 MiB. High itself drops 267.44→208.07 MiB by avoiding an unused startup framebuffer. These are renderer estimates, not OS VRAM residency.
- Three high↔low cycles plateau exactly in byte totals, programs, uniform buffers, attributes, targets and textures, on both backends and both desktop/mobile viewports. Shared-scene shader variants are bounded by one immutable MRT identity.

No P2 stage-attribute, idle scheduler or recording changes are included. No production telemetry is enabled or deployment performed.

## Implementation and ownership

`Game.#frame` passes real wall time separately from the unchanged clamped simulation/animation delta. Only consecutive visible gameplay frames contribute to adaptation. Loading, deliberate pause, phone disconnect, learning/portal prompts and visibility changes clear stale pressure/recovery history. Active stalls over one second are measurable; nonfinite intervals are rejected. `qualityStatus` exposes fixed/suspended/steady/minimum-tier states. FPS is sampled gameplay FPS and is zero while sampling is suspended. Minimum-tier pressure does not change gameplay fidelity or remove unavoidable CPU work.

Every post graph owns and disposes its scene pass, bloom resources, explicitly constructed FXAA RTT and pipeline material. Low uses one colour attachment. FXAA-off also rebuilds the graph to shed its RTT. Medium uses quarter-resolution bloom and a 2560×1440 pixel-area cap; lower tiers use 1920×1080, minimum 1280×1024. CSS layout, stage geometry and necessary visual cues remain intact. The small remaining high→low versus fresh-low difference is bounded scene/reflection/shader state, not unused full-resolution post targets.

Precompilation uses the public `PassNode.compileAsync` API against the actual target/MRT. Compiling the default sRGB canvas had created a full-size conversion framebuffer that this pipeline never used or resized. GPU drawing pauses during async compilation while CPU animation state continues. An outer `finally` restores target/MRT even on failure. Quality/resize requests defer graph rebuilding until the compiler releases its targets, then apply the latest setting. The engine shares one MRT node across graphs because Three keys persistent shared-scene shader variants by MRT identity.

## Paired evidence

Environment: headed Chromium 153, ANGLE/Metal on the same M5 Max host as the audit; production Vite build, 1440×900 DPR 2 desktop and 390×844 DPR 3 mobile viewport. API calls are stubbed and analytics off. Heavy builds, suites and probes were serialized across agents. Unrelated host activity was observed but not stopped.

Only `qualified-*` artifacts represent the final complete source. `timing-*` is the isolated #20 build retaining the original graph, and `baseline-*` is unmodified `d88697f`. Build manifests preserve asset SHA256s and exact implementation patches independently of changing worktree HEAD. [Raw evidence, manifests and screenshots](../launch/evidence/render-p1/).

| Backend | Quality path | Retained MiB | Textures / targets | Canvas pixels | CPU submit p95 ms | GPU p95 ms |
|---|---|---:|---:|---|---:|---:|
| WebGPU | high | 208.07 | 21 / 14 | 2880×1800 | 1.00 | 10.94 |
| WebGPU | high-to-low | 37.41 | 7 / 2 | 1821×1138 | 0.90 | 0.46 |
| WebGPU | medium | 132.47 | 21 / 14 | 2428×1517 | 0.90 | 8.59 |
| WebGPU | low | 37.26 | 7 / 2 | 1821×1138 | 0.70 | 0.79 |
| WebGL2 | high | 208.04 | 21 / 14 | 2880×1800 | 1.30 | unavailable |
| WebGL2 | high-to-low | 37.36 | 7 / 2 | 1821×1138 | 0.80 | unavailable |
| WebGL2 | medium | 132.43 | 21 / 14 | 2428×1517 | 1.20 | unavailable |
| WebGL2 | low | 37.22 | 7 / 2 | 1821×1138 | 0.60 | unavailable |

GPU timestamp timing varied substantially with uncontrolled host activity: equivalent earlier high samples ranged roughly 11–21 ms p95, and medium roughly 6–17 ms. Do not infer a stable GPU-time percentage gain from selected runs. The admission claim is reproducible resource reduction and bounded lifecycle, with raw CPU/GPU timings preserved rather than selectively omitted. WebGL2 timestamp support is unavailable here. Pixel caps and optional-pass reductions are software resource limits, not an accepted physical-device SLA.

## Correctness and visual checks

The isolated timing build's synthetic hidden/resume test preserves tier 0, suspends samples while hidden and resumes at about 60 FPS without a false transition. Pure tests cover real versus clamped 200 ms sequences (18.8→10.2 seconds from a cold ladder), severe stalls, finite intervals, suspension, hysteresis and fixed quality. Those absolute times differ from browser runs because startup warmup history differs.

Desktop low/portal and mobile low learning/portal images preserve the ball, rails, gems, gates, portals and HUD. Root independently inspected corresponding images. At 390×844 the existing learning overlay overlaps the timer/life HUD in both high and low images; this is an existing mobile layout limitation and physical/mobile acceptance remains open. Screenshots are settled samples, not exhaustive proof about every displayed frame.

The manual precompile race holds an actual pending compile, requests low quality plus resize, then releases it and verifies play/tier 3 with no page or console errors. The final 6× CPU-throttled replay completed at tick 5429 with score 1484 and one saved replay, matching the audit baseline while changing low → high → auto during play. `pnpm check` passed: all workspace typechecks and lint, 109 test files / 1333 tests passed, 3 files / 32 tests skipped (149.87 seconds). Lint reported existing warnings only. The focused engine suite passes 43 tests. Final product-source patch SHA256 matches the qualified build manifest.

The final synthetic device-loss callback probe rebuilt the renderer on WebGL2, resumed drawing, then changed to low with 2 render targets and zero page/console errors. This verifies the fallback lifecycle; it does not reproduce a physical driver reset.

## Rejected experiments and validation discipline

All raw intermediate evidence remains. `graphics-*` freed bloom/pass but missed FXAA's implicit RTT (156 MiB lowered versus 61 fresh). `final-*` disposed FXAA too but exposed a genuine unused default framebuffer (96.7 versus 61 MiB; `final-inspect` recorded its 2880×1800 dimensions after shrinking the canvas). `accepted-*` is a rejected intermediate despite its provisional label: premature async MRT restoration produced console validation errors. `verified-*` preceded the manual-compile guard. `release-*` fixed resource convergence and errors but failed cyclic program growth. Reusing a stable MRT identity fixes that last issue in `qualified-*`. None of these rejected candidates was committed or admitted.

An independent renderer review by the ghost sub-agent verified installed Three source semantics, identified async builder state dependence and traced program growth to MRT/context cache identity. Measured gates were retained through every iteration.

## Reproduction

Use `node infra/perf/render-p1.mjs <mode>` against production preview port 4321, with a unique `PERF_LABEL` and optional `PERF_BACKEND=webgl2`. `PERF_REQUIRE_IMPROVEMENT=1` makes `gpu` reject failure to converge to fresh-low targets/textures or a >2 MiB gap, and makes `transitions` reject growing resource totals/counts. `compile-race` checks pending precompile mutation; `recovery` invokes a synthetic loss callback and verifies WebGL2 fallback. `PERF_REPLAY_THROTTLES=6` selects the final stress replay. Other modes include `tiers`, `visibility`, `stall`, `frames`, and diagnostic `inspect`. Every frame wrapper forwards all arguments.
