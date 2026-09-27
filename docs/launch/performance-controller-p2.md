# Controller presentation investigation (#29)

The isolated controller change is qualified by reduced synthetic session work and unchanged wire input, with physical-device acceptance still open. It caps periodic visual publication at 60 Hz and updates displayed send/sensor rates at 4 Hz. Orientation calculation, calibration detection, tilt-warning hysteresis, input sending/keepalive and immediate button/host events keep their original cadence. A private latest tilt supplies the sender even on frames whose visual snapshot is skipped; no input-rate or smoothing change was made.

The baseline is P1 staging `ebd368b`. `infra/perf/controller-p2.mjs` drives the actual baseline and candidate ControllerSession classes through identical synthetic sensor timestamps at 60/90/120 Hz, in active play, unsteady calibration (including its timeout), and hidden/reconnect scenarios. Five alternating before/after pairs per combination cover 45 pairs of 30-second virtual traces. All encoded input SHA-256 hashes, send-timestamp hashes and final screens match. These are CPU timings for executing the synthetic trace in Node, excluding React, layout, browser sensor delivery and real networking. They are not measured phone frame latency, battery or thermal gains.

| Hz / scenario | Baseline median session CPU | Candidate median session CPU | Baseline store publications | Candidate store publications |
| --- | --- | --- | --- | --- |
| 60 / play | 77.038 ms | 32.028 ms | 2,242 | 1,866 |
| 90 / play | 91.467 ms | 28.378 ms | 5,383 | 1,973 |
| 120 / play | 124.597 ms | 39.210 ms | 6,883 | 1,866 |
| 60 / calibration | 64.368 ms | 22.379 ms | 1,379 | 973 |
| 90 / calibration | 80.226 ms | 22.499 ms | 2,807 | 1,024 |
| 120 / calibration | 118.003 ms | 31.086 ms | 3,451 | 971 |
| 60 / reconnect | 66.244 ms | 27.131 ms | 1,945 | 1,635 |
| 90 / reconnect | 78.596 ms | 26.757 ms | 4,612 | 1,722 |
| 120 / reconnect | 109.191 ms | 36.386 ms | 5,963 | 1,636 |

Active-play full StreamStats summary invocations fell from 3,600 / 5,400 / 7,200 to 240 / 236 / 240. Each invocation constructs a summary object and a filtered rate array, plus two sorted array copies when interval history is nonempty. The count therefore directly establishes fewer such allocations; no allocation-byte or browser heap reduction is claimed. Store publication counts are subscription notifications, not React commit counts (React can batch notifications). The absolute session CPU saving is small: approximately 45–85 ms for a 30-second active trace, equivalent to 0.15–0.28 percentage points of one core if these Node costs held in real time. This does not establish a material weak-phone bottleneck. It is a reversible reduction in redundant work, with unchanged input traces.

Raw paired data, Node/host metadata and both session-source hashes are in `docs/launch/evidence/controller-p2/session.json`. The candidate session SHA-256 is `e5fb6b9b471683f132e7d3cbbe29633df935a7d30dd805986c619e6035bb230c`. The source hash binds the uncommitted measured source independently of the base commit shown in the report. Neither unrelated host activity nor CPU frequency was controlled; this is a paired laboratory qualification, not a hardware minimum benchmark.

Correctness: 12 controller unit tests pass, including a button press on a skipped visual frame using fresh tilt, a bounded 120 Hz publication count, calibration success/failure, immediate POWER/JUMP/MENU edges, host state/haptics, hidden release and reconnect. Forty-four existing net source/connection/tilt tests pass, covering stale/disconnected neutralization and filtering. Web typecheck and focused Biome checks pass. The parent owns combined full CI after integration. A read-only peer review found no controller semantic blocker.

The real ControllerPage browser smoke uses a mocked relay and synthetic sensors. Its first attempt failed before the enable screen because an unsafe formatter rewrite turned the mock WebSocket constructor into an arrow function; the harness now preserves a constructible native proxy. The corrected smoke passed in Chromium 153.0.8010.12 with zero page/console errors: automatic calibration, immediate POWER down/up, disconnect/reconnect, hidden button release and zero binary sends while hidden, then resumed sending. Its observed send rate was 60 Hz with p95 send interval 16.9 ms under synthetic 120 Hz sensor delivery. `browser.json` and the inspected 390×844 controller screenshot preserve the result. This single candidate smoke is correctness evidence, not a before/after render benchmark, live relay or physical phone acceptance.

Reproduce paired session work: `node --import tsx infra/perf/controller-p2.mjs`. Reproduce real-page smoke: `node infra/perf/controller-browser-p2.mjs` (owns port 4323, starts/stops Vite and headless Chromium). `AUDIT_OUT` selects a separate output directory. The smoke mocks only room sockets so Vite HMR remains native. No production diagnostic path or telemetry was added.

Physical follow-up remains required on representative Android Chrome and iOS Safari, including high-refresh models: compare active/calibration render/commit counts and main-thread tasks before/after, check immediate button input, tilt input-to-photon latency, warning timing, lock/unlock with held POWER and disconnect/reconnect, and measure sustained CPU/thermal/battery behavior. The current evidence supports reduced redundant laboratory work; it cannot certify that device matrix or claim measured React commit reductions.
