# Game performance audit — September 27, 2026

## Outcome and scope

The current game is smooth on the available high-end machine, but lower-tier readiness is **not established**. The audit reproduced CPU stalls during ghost preparation, retained GPU allocations after quality reduction, per-retry buffer growth, and avoidable paused rendering. Automatic graphics adjustment exists, but needs more reliable timing and broader resource controls.

**User requirement:** performance is high priority; support both lower-tier desktop **and mobile** hardware. This includes direct mobile rendering and phones acting as controllers. Epic: [#19](https://github.com/ewjdev/world-wide-maze/issues/19).

This is an audit and execution backlog, not an implementation release. Game/source behavior was not changed. A dedicated managed worktree and `codex/game-performance-audit` branch hold the report, diagnostic harness and raw evidence.

## Environment and method

- Baseline: `0b33c14cef45c34905d202bbc760b956cb573362` (main at audit start). Race PR #17 is separately reviewed pending work.
- Apple M5 Max, 128 GiB RAM, macOS 26.6.2; headed Chromium 153; native ANGLE/Metal, WebGPU by default; an explicit WebGL2 fallback case.
- Production Vite build, served by `vite preview` on loopback, viewport 1440×900, DPR 1 or 2, approximately 60 Hz. No production/edge-network measurements or real-user field sample.
- Fresh browser context per frame case; intro skipped; ordinary countdown retained. Wait 1.5 seconds after play before recording. Keyboard arrow cycles plus a held jump input exercise movement; phase changes are retained in raw samples. These are scripted samples, not a human difficulty assessment.
- 12–20 second frame windows; full 60-second deterministic replay windows; 15 retries with forced GC; one same-session tour of all six ordinary fixture screenshots. GPU timing uses separate opt-in timestamp-query samples of 8–10 seconds per tier. No other audit benchmark/test suite ran concurrently with these browser samples; unrelated host activity is uncontrolled.
- CPU throttles of 6× and 20× are uncalibrated stress proxies. Chrome throttling does not slow the GPU and has limitations for worker/native work. [Chrome's description](https://developer.chrome.com/blog/devtools-grounded-real-world).
- Telemetry preference is Off; `/api` calls return local diagnostic stubs; boards are in offline mode. No captured URLs, score submissions or production load tests were created. API/controller networking is consequently not accepted by these measurements.
- The harness wraps `engine.frame` for CPU timing, observes raw rAF intervals/long tasks, reads CDP metrics and process counters, and samples the existing debug API. GPU readback and CPU sampling have overhead; their runs are separate from the ordinary frame baseline.

**Metric meanings:** main-thread busy percentage is CDP TaskDuration / measured wall duration, not total-machine CPU utilization. Renderer and GPU-process CPU times measure CPU work in those processes. GPU timestamp queries measure GPU render work, not whole-device utilization. Three's resource bytes are renderer-accounted estimates, not physical VRAM residency. Main JS heap excludes worker heaps and much backing/native memory; process RSS includes more than the page. [Three Info fields](https://threejs.org/docs/pages/Info.html).

## Gameplay and frame pacing

| Scenario | DPR | CPU throttle | Mean FPS | p95 / p99 ms | Main-thread busy | End tier | Renderer MiB |
|---|---:|---:|---:|---:|---:|---:|---:|
| practice | 1 | 1× | 58.9 | 17.4 / 17.6 | 9.0% | 0 | 77.4 |
| fixture-hn-front | 1 | 1× | 59.9 | 17.1 / 17.6 | 7.6% | 0 | 89.3 |
| fixture-govuk-card-grid | 1 | 1× | 59.9 | 17.4 / 17.6 | 7.2% | 0 | 89.3 |
| fixture-mdn-dark-docs | 1 | 1× | 59.9 | 17.3 / 17.6 | 7.8% | 0 | 82.4 |
| fixture-image-gallery | 1 | 1× | 59.9 | 17.4 / 17.6 | 7.6% | 0 | 88.2 |
| fixture-wikipedia-article~3 | 1 | 1× | 60.0 | 17.6 / 17.7 | 7.4% | 0 | 86.7 |
| fixture-wikipedia-article~3 | 2 | 1× | 59.9 | 17.6 / 17.7 | 7.4% | 0 | 277.0 |
| fixture-wikipedia-article~3 | 1 | 6× | 58.9 | 17.6 / 17.7 | 41.8% | 0 | 86.7 |
| practice | 1 | 20× | 36.1 | 49.1 / 50.8 | 99.3% | 2 | 60.2 |
| practice WebGL2 | 2 | 1× | 59.9 | 17.6 / 17.7 | 6.1% | 0 | 267.7 |
| practice fixed low | 2 | 1× | 60.0 | 17.5 / 17.6 | 4.7% | 3 | 91.4 |

Six unthrottled fixture stages stay at tier 0. Five have no >50 ms frame in the short measured window; practice has one, so averages alone should not be the acceptance gate. The GOV.UK sample includes falling/restarting; the raw phase records distinguish it from uninterrupted play. At 20× CPU, p95 reaches 49.1 ms and the main thread is nearly fully busy despite downshifting. A graphics-only policy cannot assume it has solved CPU saturation.

### Deterministic gameplay completion

| CPU stress | Final phase | Physics ticks | Score | Saved replays | p95 frame ms |
|---|---|---:|---:|---:|---:|
| 1× | result | 5429 | 1484 | 1 | 17.4 |
| 6× | result | 5429 | 1484 | 1 | 17.6 |
| 20× | result | 5429 | 1484 | 1 | 33.3 |

The reference input stream has 5,429 ticks. Matching tick/score results support this one deterministic scenario, not general human playability or every stage. The 60-second frame distribution includes the goal/fireworks/result sequence. Existing integration tests cover additional keyboard/controller, portal, learning and backend-recovery behavior; their run result is recorded below.

### Adaptive timing

Confirmed source: `Game.#frame` clamps wall delta to 0.1 seconds before passing it to `engine.frame`; `QualityLadder.sample` sees that clamped value. In a controlled 200 ms main-thread-stall experiment, raw rendering averaged **4.97 FPS** while engine stats reported **10 FPS**. The ladder did reach tier 4; it is not completely disabled, but its estimate and hold clocks are wrong under severe stalls. After removing the stall, rendering recovered to ~60 FPS and tier 1 within the recorded 30-second recovery window. Tier 0 was not yet observed in that window.

Auto starts at full quality and descends through reflection updates, 0.7 scale/FXAA, glow and rich background. Fixed `low` is tier 3, not the minimum auto tier 4. No game settings UI exposes the engine quality API. The 45/40/30/24 FPS downward thresholds can settle below the plan's 60 FPS desktop target. Calibrate a new policy on the agreed desktop/mobile floor rather than inferring hardware capability solely from DPR or CPU count.

Separate wall/render timing from safe simulation delta; preserve the 120 Hz deterministic simulation, replay version and score contract. The optional existing free-running worker is not an automatic substitute: its recordings are approximate and not ranked as exact.

## CPU and long tasks

Native DPR-1 fixture samples use approximately 7–9% main-thread busy time. Engine submission p95 is about 0.8 ms. CDP process CPU deltas for those samples are roughly 14–16% of one core across renderer processes and 17–18% of one core in the GPU process; that latter number is **CPU overhead**, not GPU utilization. Under throttling the percentages also reflect the stress machinery and cannot be treated as actual mobile-device CPU percentages.

The 6× CPU profile's prominent non-idle samples are render submission, buffer writes and Three render/cache/update paths. This supports reducing passes and render work before blindly moving the small normal physics workload. The profile is sampling evidence from one run, not an attribution of every frame to a single root cause.

### Ghost preparation

| CPU stress | Wall preparation | Long task | Replay ticks | Pose output bytes |
|---|---:|---:|---:|---:|
| 1× | 200.2 ms | 200 ms | 36000 | 1,008,000 |
| 6× | 1250.6 ms | 1242 ms | 36000 | 1,008,000 |

This calls the actual built classic-game ghost function with 36,000 neutral practice ticks, the server's existing verification cap. It is a synthetic valid replay workload, not an observed user's run. `recordGhostTrack` is async, but `runInputs` executes its loop synchronously after initialization. Move that preparation to a cancellable worker, reusing the pending Race implementation where compatible. Retain exact physics/version checks.

## GPU workload and quality tiers

Practice, 1440×900 CSS pixels, DPR 2, timestamp-query supported. These are short local GPU query samples; do not interpret single-run high-versus-medium differences as a robust speed ordering.

| Quality path | GPU mean / p95 ms | Draws at end | Canvas pixels | Renderer MiB | Textures / targets |
|---|---:|---:|---|---:|---:|
| high | 9.04 / 10.88 | 44 | 2880×1800 | 267.4 | 23 / 15 |
| high-to-low | 0.43 / 0.52 | 20 | 2015×1260 | 217.0 | 23 / 15 |
| medium | 10.56 / 12.39 | 33 | 2880×1800 | 267.4 | 23 / 15 |
| low | 0.46 / 0.52 | 20 | 2015×1260 | 91.1 | 10 / 3 |

High→low reduces current GPU work dramatically, but retains **~126 MiB more** than fresh low. The full post-processing graph is created once; switching its output does not dispose the disabled bloom targets. This matters on low-memory integrated/mobile GPUs. Rendering uses merged stage meshes, instanced items and an analytic particle pool already; those are strengths to preserve.

Full quality normally spends 14 draw calls on post-processing and ~11–12 on reflection views in these scenarios. The first quality reduction disables reflection updates but leaves the expensive full-resolution post chain. Test lower-resolution bloom and an absolute pixel budget, make disabled resources reclaimable, and consider reflection cadence/anisotropy/effect density. Do not reduce physics fidelity or obscure navigation, portals or lesson cues. Minimum renderScale 0.7 can still leave a very large framebuffer on high-DPR displays.

## Memory and resource lifecycle

### Repeated retry

Fifteen practice retries, each followed by forced JS GC: attributes **65→93**, attribute bytes **1,518,020→2,145,220**, or **two buffers / 44,800 bytes per additional load**. Geometry count remains 18 and texture count 23. Counts alone therefore miss the leak. Post-GC main heap grows roughly 13.5→14.9 MiB; that does not isolate all owners.

Likely owner, not yet a patched/proven root cause: `world/background.ts` creates two mote vec4 attributes for 1,400 instances, exactly 44,800 bytes, directly through TSL attribute nodes. Verify the disposal lifecycle, including node-only buffers and engine-created tile ImageBitmaps. Stable texture/geometry counts are not sufficient evidence of complete cleanup.

### Decoded screenshot cache

`builder.worker.ts` retains full decoded RGBA screenshots by URL until the entire pool is disposed. The six normal catalog screenshots total **108.6 MiB** by image dimensions alone. During a same-session tour, the largest renderer-process RSS grew from about **406 to 572 MiB**; this includes more than the cache, and cannot be assigned entirely to it. Main-page heap stayed about 16–17 MiB, showing why main heap alone misses the pressure.

Use a byte-bounded cache with useful same-page slice reuse. Settle pending requests on worker error/disposal and cancel obsolete generations. Existing pool disposal simply clears callbacks, leaving awaiting promises without a resolution.

### Recording

The game records every physics tick, including the pre-POWER period where the gameplay timer is not running. The idle lifecycle sample reached 1,394 recorded ticks. The client array is not capped, while server verification stops at 36,000 ticks and the request body has a 12 MiB limit. A design spike should choose a bounded representation/overflow policy without silently truncating an exact replay or losing a valid score.

## Pause, idle, audio and controller

Pause was verified to keep the physics tick at 1,394, but still rendered ~60 FPS and consumed 5.3% main-thread busy time. The map is intentionally animated, so optimize cadence/on-demand work while retaining a usable map; a static replacement is not presumed. Explicitly suspend hidden rendering, stop paused worker polling (currently a 2 ms timer in the optional worker), and reset time baselines safely on resume.

The corrected title sample rendered 60.0 FPS with 6.7% main-thread busy time and 89.2 MiB renderer-accounted resources.

WebAudio synthesizes its initial sound buffers synchronously at unlock and runs music scheduling until stopped/disposed. This is a startup profiling candidate, not a separately proven dominant bottleneck. Keep sound/rolling state correct across pause, disconnect and resume.

Controller code already caps input transmission near 60 Hz and stops its rAF loop when hidden. However, visible rAF publishes fresh tilt/dot state and rate summaries to React, including at high display refresh rates. Profile actual iOS/Android CPU, thermal and input latency before optimizing those UI publications. Preserve immediate button edges, filtering and neutralization; do not reduce the input send rate as a shortcut.

## Loading and first control

First fixture runs reached phase play in roughly 4.3–6.8 seconds on loopback, with intro skipped and the normal countdown retained. This is **not** pure asset/build latency and **not** the five-person time-to-first-control acceptance test. WASM is already a separate lazily loaded asset; routes already use lazy loading and stable vendor chunks.

| Cold CPU stress | Navigation→play (countdown included) | Lab LCP | Startup long tasks | Largest task |
|---|---:|---:|---:|---:|
| 1× | 4205 ms | 244 ms | 0 | 0 ms |
| 6× | 4881 ms | 1088 ms | 7 | 246 ms |

These LCP observations are loopback desktop lab readings, not mobile field Core Web Vitals. INP, slow-network startup and production cache behavior are not measured here. Separate countdown, network, build, physics load and first-frame shader work in future diagnostics before choosing a startup optimization. The build's large Three chunk alone is not evidence to rewrite the renderer.

## Learning and pending Race mode

The built-in compare-groups learning scenario was sampled at DPR 2: 58.6 FPS, p95 17.6 ms, 10.6% main-thread busy time. The first scripted interaction produced a 233 ms long task; its owner still needs attribution. Phases/learning state and a screenshot are saved. This is a short scenario, not completion of every lesson or voice path.

Race remains in [PR #17](https://github.com/ewjdev/world-wide-maze/pull/17), inspected at `0832b4c66900d59ba5902744ad3cf32f055fb76b`. Its source uses the shared quality engine, a clamped frame delta, always-on rendering and periodic state publication. It already has a ghost worker and bounded recorder, so those must not be rediscovered as missing Race features. Its own saved native GPU report uses M5 Max and roughly 97 draws without ghosts; it is prior PR-author evidence, not independently remeasured here. Rerun the same low-tier matrix against the final merged Race head, with zero/one/two ghosts, turbo, falls and retries. Do not infer Race performance from the classic fixture measurements.

## Required desktop/mobile acceptance and proposed budgets

Confirmed audience: both desktop and mobile. Name an older integrated-GPU laptop/Chromebook, a midrange desktop, and constrained Android/iOS rendering devices. Test phones separately as controllers. Record browser/backend/OS, refresh rate, DPR, power mode, sustained heat and battery state. The available M5 Max cannot certify those devices.

Existing reference-desktop goal: 60 FPS. **Proposal for Eric to approve after calibration:** pursue 60 FPS and test a stable 30 FPS lower-tier fallback before spending budget on optional effects. Frame-time tail thresholds, memory caps, device floor and allowed low-quality appearance remain decision items, not accepted promises. A 30-minute thermal soak is a suggested test design, not a completed measurement or agreed SLA. Filmed controller-to-visible-motion latency remains distinct from relay RTT.

## Prioritized implementation queue

| Issue | Readiness |
|---|---|
| [#20](https://github.com/ewjdev/world-wide-maze/issues/20) [P1] Drive automatic quality from real frame timing without changing gameplay | Ready |
| [#21](https://github.com/ewjdev/world-wide-maze/issues/21) [P1] Make lower graphics tiers shed GPU work and retained render targets | Ready |
| [#22](https://github.com/ewjdev/world-wide-maze/issues/22) [P1] Prepare classic-game ghost replays without blocking interaction | Ready |
| [#23](https://github.com/ewjdev/world-wide-maze/issues/23) [P1] Bound decoded screenshot retention and cancel obsolete stage builds | Ready |
| [#24](https://github.com/ewjdev/world-wide-maze/issues/24) [P2] Release per-stage GPU attributes across retries and stage changes | Ready |
| [#25](https://github.com/ewjdev/world-wide-maze/issues/25) [P2] Reduce rendering and wakeups while paused, hidden or inactive | Ready |
| [#26](https://github.com/ewjdev/world-wide-maze/issues/26) [P2] Bound replay recording memory during long and pre-input sessions | Research spike ready |
| [#27](https://github.com/ewjdev/world-wide-maze/issues/27) [P1] Set and validate desktop and mobile performance budgets | Research spike ready |
| [#28](https://github.com/ewjdev/world-wide-maze/issues/28) [P1] Make CPU GPU frame and memory regressions observable and repeatable | Ready |
| [#29](https://github.com/ewjdev/world-wide-maze/issues/29) [P2] Profile and reduce phone-controller presentation work | Research spike ready |
| [#30](https://github.com/ewjdev/world-wide-maze/issues/30) [P2] Attribute and reduce startup and first-interaction stalls | Research spike ready |

Sequence: fix truthful timing, GPU target retention and ghost stalls first; bound cache/lifecycle allocations; add structural regression checks alongside fixes. Run device-budget calibration in parallel with implementation. Paused resource use, long recording policy and controller presentation follow with their own evidence. No existing issue duplicated this queue; the learning voice issue is unrelated. Coordinate shared engine work with Race PR #17.

## Verification and limits

- Production web build completed successfully on the audited main baseline.
- All ordinary frame cases completed; saved pageerror arrays are available for inspection.
- One initial title-case harness wait timed out because the initial title does not set the body phase attribute. The harness was corrected to read game debug state and the title was rerun separately (`idle.json`); the original failure is preserved in `frames.json`.
- `pnpm check` passed: 108 test files / 1,328 tests passed, 3 files / 32 tests skipped; workspace typechecks and lint passed with existing advisory findings. Details are in the [audit build log](../build-log/performance-audit-2026-09-27.md). There was no game fix, deployment or production load test.
- Physical low-/mid-tier hardware, thermal/battery behavior, production-network startup, filmed controller latency, and independent pending-Race performance remain open. Browser emulation and automated correctness checks do not satisfy those gates.

## Reproduce and evidence

From the audit worktree:

```sh
pnpm install --frozen-lockfile
pnpm --filter @wwm/web build
pnpm --filter @wwm/web preview --host 127.0.0.1 --port 4318
# In another terminal; run one measurement at a time:
node infra/perf/audit-2026-09.mjs frames
node infra/perf/audit-2026-09.mjs lifecycle
node infra/perf/audit-2026-09.mjs gpu
node infra/perf/audit-2026-09.mjs ghost
node infra/perf/audit-2026-09.mjs stall
node infra/perf/audit-2026-09.mjs replay
node infra/perf/audit-2026-09.mjs cold
node infra/perf/audit-2026-09.mjs idle
node infra/perf/audit-2026-09.mjs learning
```

Raw data, profiles and screenshots: [evidence/audit-2026-09-27](evidence/audit-2026-09-27/). Harness: [audit-2026-09.mjs](../../infra/perf/audit-2026-09.mjs). Local preview/API stubbing is intentional; use a separate real-API harness for controller/network acceptance. GPU timestamp support is checked, not assumed; unsupported backends need an explicit unavailable result. Raw evidence includes individual samples, renderer byte fields, process CPU/RSS and main heap/backing storage so the claims can be checked without relying on the prose.
