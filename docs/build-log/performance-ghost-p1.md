# P1 classic ghost preparation

Issue: [#22](https://github.com/ewjdev/world-wide-maze/issues/22), under [performance epic #19](https://github.com/ewjdev/world-wide-maze/issues/19). Base `d88697faed5a2f5791b7bd8ee0b22dd56add95aa`; branch `codex/performance-ghost-p1`. Worktree `/Users/ewj/.codex/worktrees/performance-ghost/wwm`. Date: September 27, 2026. Implemented with Codex agent tools, pnpm/Vitest, Playwright, Chromium CDP and GitHub CLI.

## Change

Classic ghosts now prepare in a disposable worker using the one-job/transfer/terminate pattern inspected in pending Race PR #17. The classic deterministic recorder is extracted without changing simulation, restart flow or stop-at-goal semantics. Returned tracks include the physics version; the client rejects mismatches. Pose arrays transfer from the worker. Inputs remain the caller's property. No synchronous fallback runs on worker failure.

Cancellation rejects pending promises and terminates synchronous worker simulation. Request identity covers same-stage retries as well as new-stage changes, title/select and route disposal. Late fetches/results cannot attach a superseded ghost. Preparation and failure have accessible English/Japanese status text; gameplay continues while preparation is pending or unavailable.

This does not implement the Race PR or change scoring/physics contracts. Legacy `recordGhostTrack` remains available for headless/reference and showcase uses. The classic gameplay entry uses the worker client.

## Verification and measured gain

Paired evidence: [raw JSON](../launch/evidence/ghost-p1/paired.json). M5 Max, 128 GiB, Chromium 153, native Metal, 1440×900 DPR 1. Three repetitions per mode/condition:

| Condition | Reference main-thread long task | Worker main-thread long tasks | Reference maximum frame gap | Worker maximum frame gap |
|---|---|---|---|---|
| Native | 198–212 ms | None observed | 183.3–199.9 ms | 17.5–17.6 ms |
| 6× main-page CPU stress | 1,180–1,241 ms | None observed | 1,166.1–1,233.4 ms | 17.5–17.8 ms |

A 10 ms main-thread heartbeat's maximum gap dropped from 199.5–213.4 ms to 11.3–11.9 ms natively, and from 1,187.3–1,251.1 ms to 26.4–29.0 ms under main-page stress. Native completion wall time increased from 198.5–212.1 ms to 256.6–263.8 ms because a fresh worker initializes independently. The measured benefit is keeping gameplay responsive, not making total simulation computation faster. The worker receives no assertion of sixfold CPU slowdown.

SHA-256 position/quaternion hashes match for every 36,000-tick trial, with no goal, 1,008,000 pose bytes and physics version 0.2.0. The full reference replay also matches every pose/hash and the exact goal tick 5,429 across worker and reference. The independent real-browser test compares these worker output arrays to the Node headless reference arrays.

Validation: `pnpm check` completed typecheck and lint successfully (32 existing warnings, four informational diagnostics). The full test run reported 1,341 passed, 32 skipped and two failures in 177.91 seconds. The failures were existing extension scroll restoration (`expected 420, received 0`) and the game build-fallback URL button stability timeout. Both passed unchanged in isolated retries (11.84 s and 10.16 s). These are recorded as transient observed failures, not silently counted as a full green check; the combined staging branch still requires its final full check.

The 11 new unit tests passed. All three new real-browser cases passed across focused runs: complete worker/Node pose parity; preparation, pause, retry, worker failure and route disposal; and a late network result after retrying the same stage. The last added stale-network test initially waited through two countdowns and exceeded the existing six-second HTTP timeout, so the test was corrected to inspect the newly prepared track immediately (and accelerate countdowns only). It passed in 4.39 s. This was a test setup correction, not a product workaround. Browser tests use headless Chromium on CI; local native performance probes are headed.

See [validation record](../launch/evidence/ghost-p1/validation.json). `pnpm docent:index --check` and `git diff --check` passed after documentation finalization. No deployment or main-branch merge was performed; own preview/browser processes were stopped. Unit tests already cover deterministic reference poses/goal tick, version compatibility, supersession, late callbacks, abort, disposal, worker/error/message/clone failures and absence of a main-thread fallback. Real-browser tests cover worker/headless pose parity, a responsive pause during pending preparation, same-stage retry cancellation and route-unmount termination.

The paired probe is `infra/perf/ghost-p1.mjs`. It builds a temporary independent entry that exposes the shipped worker client and unchanged synchronous reference recorder. Both run on the same production gameplay page with the same 36,000 neutral inputs, three repetitions in alternating order, native and 6× main-thread CPU stress. It records wall time, long tasks, animation-frame gaps, 10 ms heartbeat gaps and SHA-256 pose hashes separately. The temporary source is removed after build. JS/WASM asset hashes identify the measured production build; the recorded parent commit alone is not claimed as optimized source identity. `AUDIT_OUT` directs an independent staging rerun to a new directory. Measurements use their own evidence folder and never overwrite the original audit.

The stress ratio applies to the main page and is not a physical mobile or worker CPU speed ratio. Main-thread responsiveness is the integration criterion; reduced worker wall time alone is insufficient. Physical lower-tier device and thermal acceptance remain open in #27.

## Device-budget support

`docs/launch/performance-device-matrix.md` supports P1 #27 with proposed budgets, exact evidence fields, independent direct-mobile/controller rows and repeatable scenarios. Both desktop and mobile audiences are confirmed; a specific hardware floor and final budgets are not accepted. All lower-tier physical rows remain open. Documentation is not claimed as a runtime optimization.
