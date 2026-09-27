# Desktop and mobile performance acceptance matrix

Supports [performance epic #19](https://github.com/ewjdev/world-wide-maze/issues/19) and [P1 #27](https://github.com/ewjdev/world-wide-maze/issues/27). The user confirmed both desktop and mobile as audiences. Specific minimum devices and final numerical budgets have not been accepted. All thresholds below are **proposed**, and no purchase is required to use this protocol.

## Device rows

Record the exact machine, OS, browser version, power mode, refresh rate, viewport, device pixel ratio and renderer backend for every run. Select available representative hardware with Eric before treating any row as a supported floor.

| Role | Representative class to nominate | Current evidence | Acceptance |
|---|---|---|---|
| Desktop reference | Existing Apple M5 Max, 128 GiB | September 27 audit: headed Chromium 153, native Metal, DPR 1/2; approximately 60 FPS in the normal fixture tour | Baseline measured; not a lower-tier floor |
| Lower-tier desktop | Existing older laptop with integrated graphics and limited RAM | No physical sample yet | Open: nominate device, then run matrix |
| Desktop fallback | Same lower-tier laptop using supported WebGL2 path | No physical sample yet | Open |
| Direct mobile play, Android | Available older Android phone on current supported Chrome | No physical sample yet | Open: input usability and thermal run required |
| Direct mobile play, iOS | Available older iPhone on supported Safari | No physical sample yet | Open: Safari/WebGL2, orientation and lifecycle required |
| Phone controller | Android and iOS phones paired with desktop host | Existing synthetic controller correctness tests; no physical performance acceptance in this work | Open: motion/control latency, reconnect, wakeups and thermal run |

CPU-throttled desktop results are stress proxies. They do not reproduce mobile GPU capacity, memory pressure, browser scheduling, WebKit, battery policy or thermal throttling. Playwright mobile emulation is a viewport/input check, not an accepted physical device.

## Proposed budgets and quality contract

- Aim for 60 FPS where supported. A lower tier should sustain a useful 30 FPS fallback: after warm-up and adaptation, proposed p95 frame interval ≤ 33.3 ms, p99 ≤ 50 ms, with no sustained interval over 100 ms caused by avoidable replay/build/render work. Evaluate cold load separately from steady play. Report full distributions rather than treating average FPS as a pass.
- Preserve simulation frequency, deterministic replay, score, input semantics and collision geometry at every visual tier. Lower render resolution, postprocessing and decoration before affecting readability. All required gameplay objects, portals, locks and HUD must remain legible and usable.
- Proposed response target: local POWER/JUMP/pause response visible within 100 ms at p95. For a paired phone, report sensor-to-host latency and host-to-display separately; record connection type and RTT. Network delay must not be attributed to renderer work.
- Proposed resource target: repeated retry/stage/dispose cycles reach a bounded plateau after warm-up. Measure both JavaScript heap and renderer allocation counts/bytes; inspect worker/browser process RSS separately. A fixed universal MB ceiling requires evidence from the selected low-memory devices and is not accepted yet. GPU resource caps used during implementation are operational proposals, not total-device memory budgets.
- Proposed thermal target: the same fallback budget holds after 15 minutes of continuous use. Record battery percentage, charging state, brightness, ambient conditions and any OS thermal signal before/after. Battery drain cannot be inferred from desktop CPU percentages.
- A graphics setting should communicate its current tier. Automatic adjustments must use real elapsed frame time with hysteresis; observe downshift, recovery and transitions. Manual settings and preference persistence need explicit product validation.

## Repeatable scenarios

Use a production build on a local/staging host with analytics off and a fixed commit. Never compare development and production builds or different browsers as if they were an isolated code improvement. Keep other heavy processes idle and alternate baseline/candidate order. Run three trials per case and keep raw results, including failures. Reset cold/warm caches consistently.

1. Cold launch: practice and one large fixture, from navigation through first usable POWER/JUMP. Record download, decode, worker/build, shader preparation and first interaction separately. Repeat on the nominated network profile as well as local warm cache.
2. Normal play: practice, HN, GOV.UK, MDN, gallery and a Wikipedia slice. Use the same input/replay, camera path, viewport/DPR and settings for 60 seconds per stage. Check required visual objects at every tier.
3. Adaptation: sustained rendering/CPU pressure, then recovery. Record actual rAF intervals, engine tier transitions, drawing-buffer resolution, GPU timestamps when available, and draw/resource counts. Do not use the clamped simulation delta as the performance measurement clock.
4. Ghost load: 36,000 neutral inputs while the player uses POWER/JUMP and opens/closes pause. Measure main-thread long tasks and control/animation responsiveness separately from worker completion time. Retry the same stage, change stage, and unmount while preparation is pending; no stale ghost may attach.
5. Lifecycle: 15 retries, the full fixture tour, repeat first fixture, and route disposal. Sample post-GC heap where supported, texture/buffer allocations and worker/process memory. Do not claim `renderer.info` byte estimates equal physical GPU residency.
6. Idle: 60 seconds each on title, pause/map, hidden tab and resumed play. Confirm expected wakeups and resource behavior while timer and physics remain correct.
7. Correctness replay: handmade reference replay must end at tick 5,429 with the established score (1,484 in the audit). Compare goal tick, poses/physics version and scoring separately from performance. Include portal and learning gates/locks in usability checks.
8. Physical mobile: portrait/landscape changes, touch controls, background/resume, low-memory tab behavior, and a 15-minute thermal session. For controller use, also pair, stream motion, disconnect/reconnect and lock/unlock the phone. Direct gameplay and controller-only use are separate acceptance rows.

## Reproduction and evidence fields

Existing diagnostic entry points (run from repository root):

```sh
pnpm install --frozen-lockfile
pnpm --filter @wwm/web build
pnpm --filter @wwm/web preview --host 127.0.0.1 --port 4318
AUDIT_OUT=/tmp/wwm-staging-audit AUDIT_BASE=http://127.0.0.1:4318 node infra/perf/audit-2026-09.mjs frames
AUDIT_OUT=/tmp/wwm-staging-audit AUDIT_BASE=http://127.0.0.1:4318 node infra/perf/audit-2026-09.mjs lifecycle
AUDIT_OUT=/tmp/wwm-staging-audit AUDIT_BASE=http://127.0.0.1:4318 node infra/perf/audit-2026-09.mjs replay
```

The staging harness supports `AUDIT_OUT`; always set a fresh output directory so the published baseline is not overwritten. This override was integrated by the parallel P1 instrumentation work. Its launch flags assume macOS Chromium/Metal and must be adapted and documented for other hosts; they do not establish Safari acceptance. New automated baseline/candidate infrastructure is tracked in #28. The #22 targeted paired probe has its own output directory and build mode:

```sh
node infra/perf/ghost-p1.mjs build
pnpm --filter @wwm/web preview --host 127.0.0.1 --port 4322
AUDIT_OUT=/tmp/wwm-staging-ghost AUDIT_BASE=http://127.0.0.1:4322 node infra/perf/ghost-p1.mjs measure
```

Attach an evidence row for each scenario/trial containing: baseline and candidate SHA; exact hardware/OS/browser; flags; power/thermal state; viewport/DPR/backend; network/cache state; stage/input fixture; quality setting and tier history; start/end timestamps; frame p50/p95/p99 and missed-frame count; main-thread long tasks and control latency; CPU thread/process measurement definition; GPU timer support and values; renderer allocations; heap/worker/process memory; deterministic result; screenshots; errors; raw trace/JSON location; evaluator and verdict. Unsupported measurements must be marked unavailable, not zero.

## Staging gate

Only integrate runtime changes with a paired relevant gain, passing correctness tests, and no unexplained regression. Re-run combined scenarios after integration because individual wins can interact. Keep production/main unchanged until the staging evidence is reviewed. P2 work follows the P1 staging decision. #27 remains open until nominated physical desktop/mobile rows have recorded outcomes and Eric accepts the supported floor and budgets; the matrix itself makes no runtime speedup claim.
