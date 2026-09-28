# Performance #25: inactive rendering and sleeping physics worker

Branch: `codex/performance-idle-p2`, based on final P1 staging `ebd368b`.

## Scope

The game keeps its foreground input, UI, timer and simulation scheduling at display cadence. After one second of a phase transition, map view submits scene frames at 15 Hz and title/select/other inactive views at 30 Hz. The first second preserves the existing 0.9-second camera transition. Animation receives the accumulated elapsed time so it does not run slowly. Active play keeps the P1 raw frame timing for adaptive quality and the existing safe simulation delta.

A hidden document cancels the application's animation callback and pauses the physics driver. Visibility resume resets elapsed-time and adaptive-quality history. Keyboard held/latched state is reset, repeat events cannot re-arm it, and late releases cannot restart POWER grace. Gamepad and phone held buttons require neutral input before play accepts a new press; a disconnected or stale phone does not prematurely clear this gate. Existing foreground controller sampling/send cadence is unchanged.

The optional physics worker now parks with no timeout when unloaded, paused or past its existing 150 ms input-stall guard. A fresh input starts one timer chain; resume waits for that fresh input and clears old jump edges. Active stepping still uses its existing 2 ms timer and 120 Hz simulation clock.

## Verification and measured gain

- 24 initial focused unit tests passed, including cadence, worker fake-clock sleep/wake/catch-up/jump cancellation, existing input sources, and keyboard reset/repeat/release behavior.
- Final net + physics unit run: **128 passed, 2 skipped** (14 files passed, one skipped), 754 ms. Cadence: **4 passed**, 93 ms.
- CI headless new lockstep/worker visibility tests plus the existing real-worker deterministic replay/live-clock test: **3 passed**, 17.01 s. The worker replay remains bit-identical to Node; live stepping stays within the existing 100–140 Hz acceptance band.
- CI headless real phone pairing, new host-hidden held-POWER release, and disconnect/freeze/reconnect tests: **3 passed**, 22.57 s (seven unrelated cases skipped by the focused filter). The new phone test uses consumed input as its release barrier, without a transport delivery sleep.
- Web, physics and net typechecks passed; changed-file Biome and diff whitespace checks passed. The parent owns the combined staging full suite/CI gate.
- Cache specialist independently reviewed visibility input/worker lifecycle. OS-repeat and late-release findings were repaired and re-reviewed. Parent independently reviewed the final Game/cadence/worker changes with no blocker.

The first native attempt was rejected: the newly added pause acknowledgement queried simulation state before any stage was loaded. The normal driver pauses immediately after initialization. `postState` now checks `loaded`; an explicit pre-load-pause regression asserts no world-state publication. The failed source fingerprint `f20e33f6…` and console errors remain in [rejected-initialization.json](../launch/evidence/idle-p2/rejected-initialization.json). These measurements are excluded from the table. Peer review rechecked initialization, pending/rejected loads and wake/cancel lifecycle after the repair.

Three clean alternating baseline/candidate pairs are in [paired.json](../launch/evidence/idle-p2/paired.json). Every served asset was verified. Baseline runtime: `7ec6d5eb369258f8d58e47c31222bda8ad395505dfbc13597f3bfee45509ba1e`; accepted candidate runtime: `868e1824d06cc502fde7e11dabf0d0189317c3abcede8568ec8d3419c7609a50`. Native Apple M5 Max, Chromium 153.0.8010.12, WebGPU/Metal, 1440×900 CSS viewport, DPR 2, high quality, four-second windows after identical excluded warm-up. No page/console errors in any accepted window.

| Four-second window, ranges across three pairs | P1 baseline | Candidate |
| --- | ---: | ---: |
| Paused scene submissions | 240–241 | 55–56 |
| Paused main-thread CPU ms | 333–490 | 148–189 |
| Paused queried GPU ms, sum | 2,361–2,576 | 501–526 |
| Hidden scene submissions | 240–241 | 0 |
| Hidden main-thread CPU ms | 327–434 | 36–40 |
| Hidden queried GPU ms, sum | 2,294–2,634 | 0 |
| Title scene submissions | 240 | 103–110 |
| Title main-thread CPU ms | 370–511 | 179–266 |
| Title queried GPU ms, sum | 2,278–2,482 | 972–1,117 |
| Inactive physics timeout callbacks | 706–719 | 0 |
| Active physics ticks | 480–481 | 480–481 |
| Active scene submissions | 240–241 | 240–241 |

Independent foreground browser rAF callbacks remained 240–241 during hidden measurements, proving that zero game submission comes from application scheduling, not browser background throttling. The nominal 15/30 Hz caps quantize against display callbacks; observed map/title cadence was about 14/26 Hz. Main-thread median CPU fell 64% in map view, 90% hidden, and 48% on title. The corresponding queried GPU-work sums fell 79%, 100%, and 58%.

Active main-thread CPU ranges overlap (baseline 433–476 ms, candidate 429–520 ms); its median increased from 445 to 473 ms, about 6.3%. These short windows do **not** establish an active CPU/FPS improvement, and the inactive gains must not be described as a general gameplay speedup. Active frame counts and actual physics tick rate were preserved. Candidate map/title screenshots were inspected: map controls, platforms, route markers, goal/portal cues and title actions remain legible. Screenshots are saved alongside the paired evidence.

Worker callback CPU excludes message processing. The legacy client can retain a stale nonzero diagnostic steps-per-second value after an input stall; the zero-wakeup claim uses actual instrumented callbacks and ticks, not that displayed statistic. Physical lower-tier desktop/mobile battery, thermals and device acceptance remain open.

## Reproduction

Preserve the entire clean P1 production `apps/web/dist`, including its `performance-build.json`, at `/tmp/wwm-idle-p1-baseline-dist` (or set `IDLE_BASELINE`). Its runtime fingerprint is `7ec6d5eb369258f8d58e47c31222bda8ad395505dfbc13597f3bfee45509ba1e`.

```sh
node infra/perf/p1-build.mjs
AUDIT_OUT=/tmp/wwm-idle-paired node infra/perf/idle-p2.mjs
CI=true pnpm exec vitest run --project @wwm/web apps/web/test/idle.e2e.test.ts --project @wwm/physics packages/physics/test/worker.browser.test.ts
CI=true pnpm exec vitest run --project @wwm/web apps/web/test/game.e2e.test.ts -t 'pairing with|host visibility|disconnect →'
pnpm exec vitest run --project @wwm/net --project @wwm/physics --exclude '**/*.browser.test.ts'
```

The opt-in probe verifies every served baseline/candidate asset against source-bound build manifests, alternates order across three pairs, and uses the same native GPU, viewport, DPR and pinned high quality. It records main-thread TaskDuration, scene frame submissions, independent foreground browser rAFs, actual worker timeout callbacks/ticks and submitted GPU timestamp-query cost. Synthetic document visibility keeps the browser foreground to demonstrate application-level exclusion independently of browser background throttling. Worker callback CPU excludes message processing; queried GPU milliseconds are submitted work measurements, not device utilization or power consumption. This host does not establish physical lower-tier desktop/mobile acceptance.
