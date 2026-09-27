# Performance P2 staging

September 27, 2026. Continues epic #19 on `codex/performance-p1-staging`, following the [qualified P1 checkpoint](performance-p1-staging.md). This branch is a staging review target; main and production remain unchanged. Both desktop and mobile remain in the acceptance scope.

## Qualified individual work

| Issue | Result | Evidence |
|---|---|---|
| #24 stage resources | Removes 44,800 bytes/two retained attributes per stage load. Fifteen retries plateau on native WebGPU and WebGL2; stage changes, culled motes and synthetic renderer recovery also plateau. Generated bitmap tiles close after texture disposal and on cancellation; caller-owned images survive. | [Resource report](../build-log/performance-resources-p2.md), implementation `8b387ac` |
| #29 controller presentation | Exact wire samples and send timestamps in all 45 paired traces; periodic visuals capped at 60 Hz, diagnostic summaries at 4 Hz. Active synthetic session work saves approximately 45–85 ms per 30-second trace. Browser calibration/buttons/visibility/reconnect smoke passes. | [Controller report](performance-controller-p2.md), implementation `a6d7aed` |

Each implementation was tested by its owning agent and independently reviewed before integration. CPU timings for controller traces exclude React and real phone hardware. Bitmap closure establishes explicit ownership/lifetime, not an absolute OS-memory reduction. Native resource estimates are Three.js accounting, not measured total GPU residency or utilization.

## Decision-ready research

- **#26 recording:** measurements confirm unbounded retention beyond the existing server verification limit. An exact typed representation uses 900,000 bytes for 36,000 ticks; all 5,429 reference inputs round-trip. The production recorder is unchanged pending the choice between score-only/unverified overflow and browser-storage spill for longer local replay. [Research and policy choices](performance-recording-p2.md).
- **#30 startup:** 18 production-build cold/warm traces attribute a first-input stall to audio initialization, including context creation and synchronous synthesis. A 12-run synthesis prototype preserves every sample and improves page responsiveness while native total worker preparation takes longer. This is a bounded proposal, with no production audio change. [Attribution and proposal](performance-startup-p2.md).

## Remaining acceptance

Physical lower-tier desktop, Android Chrome and iOS Safari devices have not been supplied or measured. Issue #27 still owns device-floor selection, accepted budgets, sustained thermal/battery tests, direct mobile gameplay and phone-controller latency. Page CPU throttling is stress testing, not device certification. The existing learning HUD overlap at 390×844 remains documented in the P1 evidence.

The current resource regression gate uses `--strict-resource-plateau` and rejects every retained-allocation increase after warmup, including intermediate peaks. Missing samples fail. The historical P1 leak waiver is disabled in current staging CI. Twenty-five controlled gate tests include deliberately injected resource regressions. See [regression instructions](performance-regression.md).

Combined native evidence and full-check results will be recorded here after the remaining qualified idle-work change is integrated. No gain is inferred solely from a passing build or a unit test.
