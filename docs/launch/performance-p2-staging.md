# Performance P2 staging

September 27, 2026. Continues epic #19 on `codex/performance-p1-staging`, following the [qualified P1 checkpoint](performance-p1-staging.md). This branch is a staging review target; main and production remain unchanged. Both desktop and mobile remain in the acceptance scope.

## Qualified individual work

| Issue | Result | Evidence |
|---|---|---|
| #24 stage resources | Removes 44,800 bytes/two retained attributes per stage load. Fifteen retries plateau on native WebGPU and WebGL2; stage changes, culled motes and synthetic renderer recovery also plateau. Generated bitmap tiles close after texture disposal and on cancellation; caller-owned images survive. | [Resource report](../build-log/performance-resources-p2.md), implementation `8b387ac` |
| #25 inactive work | Three paired native trials: median main-thread CPU reduced 64% paused, 90% hidden, 48% on title. Hidden scene submissions and inactive worker callbacks reach zero; actual active physics stays 120 Hz. | [Idle report](../build-log/performance-idle-p2.md), implementation `02ec024` |
| #29 controller presentation | Exact wire samples and send timestamps in all 45 paired traces; periodic visuals capped at 60 Hz, diagnostic summaries at 4 Hz. Active synthetic session work saves approximately 45–85 ms per 30-second trace. Browser calibration/buttons/visibility/reconnect smoke passes. | [Controller report](performance-controller-p2.md), implementation `a6d7aed` |

Each implementation was tested by its owning agent and independently reviewed before integration. CPU timings for controller traces exclude React and real phone hardware. Bitmap closure establishes explicit ownership/lifetime, not an absolute OS-memory reduction. Native resource estimates are Three.js accounting, not measured total GPU residency or utilization.

## Decision-ready research

- **#26 recording:** measurements confirm unbounded retention beyond the existing server verification limit. An exact typed representation uses 900,000 bytes for 36,000 ticks; all 5,429 reference inputs round-trip. The production recorder is unchanged pending the choice between score-only/unverified overflow and browser-storage spill for longer local replay. [Research and policy choices](performance-recording-p2.md).
- **#30 startup:** 18 production-build cold/warm traces attribute a first-input stall to audio initialization, including context creation and synchronous synthesis. A 12-run synthesis prototype preserves every sample and improves page responsiveness while native total worker preparation takes longer. This is a bounded proposal, with no production audio change. [Attribution and proposal](performance-startup-p2.md).

## Remaining acceptance

Physical lower-tier desktop, Android Chrome and iOS Safari devices have not been supplied or measured. Issue #27 still owns device-floor selection, accepted budgets, sustained thermal/battery tests, direct mobile gameplay and phone-controller latency. Page CPU throttling is stress testing, not device certification. The existing learning HUD overlap at 390×844 remains documented in the P1 evidence.

The current resource regression gate uses `--strict-resource-plateau` and rejects every retained-allocation increase after warmup, including intermediate peaks. Missing samples fail. The historical P1 leak waiver is disabled in current staging CI. Twenty-five controlled gate tests include deliberately injected resource regressions. See [regression instructions](performance-regression.md).

## Combined qualification

All three implementations are merged into staging commit `7eb2309`. The production build contains 382 verified assets and runtime content fingerprint `36bcaafb2c26d87ee779d57e7419e088c2c8d1f645de28225716aad557488669`. The frame batch completed all 12 scenarios without browser errors. p95 frame times are 18.5–18.6 ms and differ from the P1 historical checkpoint by 0.0–0.3 ms. These are sequential historical samples, not a claim of statistically significant active FPS improvement. Native WebGL2 fallback and low-tier cases completed. The high→low resource estimate is 37.41 MiB versus 37.26 MiB fresh low, with two render targets in both cases. Raw native GPU timings are retained, without a cross-run percentage-speedup claim.

All six collected modes have zero captured browser errors. Normal/6×/20× replay finishes identically at 5,429 ticks, score 1,484 and one saved exact replay. Fifteen combined retries stay flat at 65 attributes / 1,473,380 attribute bytes, followed by seven fixture transitions. The combined scene has a different warm retained set from the isolated resource probe; neither grows across retries. All 51 [strict comparison checks](evidence/performance-p2-comparison.json) pass, including every tracked allocation checkpoint, with no waived failure.

The 200 ms injected-stall sample reports roughly 5 real FPS and reaches minimum quality; recovery returns to roughly 60 FPS and raises quality gradually. Learning mode remains in play with p95 17.6 ms. Paused-map and learning screenshots were inspected for intact game cues and controls. [Raw source-bound batch](evidence/performance-p2-staging/).

Full repository check result will be recorded after completion. Published-head staging CI also runs `pnpm check`, docent validation, 25 comparator tests, three exact-recording research tests and the strict native comparison. The workflow validates committed native evidence; hosted software rendering is correctness evidence, not native GPU remeasurement.

Idle active-play CPU ranges overlap; its short paired-window median was 6.3% higher, so there is no general active CPU/FPS gain claim. The benefit is reduced inactive work. No gain is inferred solely from a passing build or a unit test.
