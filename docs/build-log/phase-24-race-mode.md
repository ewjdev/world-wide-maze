# Phase 24 — Race mode

Implementation date: 2026-09-26/27 America/Los_Angeles. Agent: Codex (GPT-6 family), desktop tools, with parallel course, domain/storage/replay and controller/browser workers. Work began from `feat/phase-23-lesson-limits` and is isolated in `codex/race-mode`; the original checkout and its unrelated plan remain preserved. This log records local implementation and review, not a deployment or human flow certification.

## Request and chosen release

The user requested a third gameplay mode beside Original and Education: HTML-derived flowing islands, familiar ball handling, and personal previous-run shadows. They authorized execution of the reviewed plan and parallel subagents, with a game review before handoff. The first release follows the plan's **straight-course path**. Curved slope-and-turn ramps (M4) remain an optional later experiment; no curved-geometry claims are made.

## Delivered

- `/race` course selection and `/race/:courseId` gameplay, countdown, pause/practice, exact tick timer, sectors, personal-best results, retry, history and ghost controls; English/Japanese shell strings and inherited WWM appearance.
- Three actual browser-captured HTML courses: Flow Sprint, Switchback and Longline. Broad turning islands and gently descending straight ramps preserve existing ball handling.
- Race builder consumes extracted terrain through a separate topology path; deterministic bounded route search scores heading, turns, width and approach clearance. Authored courses freeze their order. Structured failures replace silent fallback.
- `@wwm/race` supplies course/attempt contracts, ordered directional swept gates, input recording, compatibility, eligibility and independent real-Rapier replay. Original goal events do not finish Race.
- Optional post-step driver observer; every catch-up step is evaluated, and finish stops the batch. Retry reloads cached stage geometry into a fresh physics world. Shared load resets grounded/jump history to restore a genuinely fresh initial state.
- Atomic IndexedDB best/recent history, bounded session fallback, ten recent plus protected best per course, 50 MiB history budget, 72,000-tick recording cap and dedicated cancellable replay worker. At most two visual-only ghosts; secondary uses wireframe as well as color.
- Additive controller capability handshake and Race timer/sector/phase payload; contract `0.3.3`. Old hosts retain old messages. Race requires a compatible calibrated phone or keyboard fallback. No relay or backend storage change.
- `VITE_RACE_ENABLED` gates entry and deep links. Development defaults on; production requires explicit `true`. Flag-off preserves local history.

## Course evidence

| Course | Independent Race finish | Falls / jumps | Immutable ID |
| --- | ---: | ---: | --- |
| Flow Sprint | 5,669 ticks / 47.2417 s | 0 / 0 | `f46a6d44a8bb4ebb1339bed466646c529a013d1a211d34cc41b3e6e05cffa888` |
| Switchback | 5,705 ticks / 47.5417 s | 0 / 0 | `d1a4aed6fcfa065f5c0ca97f6753246f409d0b3b0fb9c876831fd981be8d6aff` |
| Longline | 4,383 ticks / 36.5250 s | 0 / 0 | `80ba08d1baee2f289fd2c24fcbd7f7f2ba7ccd97f54c91e17441e9d1bc2108dd` |

All solver traces were independently replayed and reproduced every sector and finish tick. Source HTML, capture recipe, input streams and JSON verification reports live in `fixtures/race`. Public JSON/textures total approximately 240 KiB. Longline is deliberately shorter than the provisional 45-second target. Automated completion does not establish human route readability or flow.

## Review and repairs

The first focused driver review exposed stale grounded/jump state after reload; fixed and verified repeated retries against a fresh simulation. Browser review found results comparing a new PB with itself; comparison history is now frozen at attempt start. Independent course review found the legacy goal tower displaced from the authoritative finish; Race hides that decoration and marks the exact plane with a checkered arch and floor stripe.

Lifecycle review added a pending-save barrier before retry/ghost selection, serialized clear/save, generation/read guards, controller checks after preparation and before GO, and per-attempt performance counters. Focus loss during asynchronous preparation is latched before GO. History-clear failure has a visible error. These were review findings fixed before handoff, not user interventions.

The first integration lint attempt failed on formatting and value-returning `forEach` callbacks; corrected only changed files. Race CSS descendant scopes were normalized to avoid new specificity warnings. The mechanical design detector reported no findings. Desktop and mobile screenshots were inspected; stage geometry, browser operation, renderer timing and human experience are recorded separately.

## Validation commands

```sh
pnpm check
VITE_RACE_ENABLED=true pnpm --filter @wwm/web build
VITE_RACE_ENABLED=false pnpm --filter @wwm/web build --outDir /tmp/wwm-race-rollback-dist
WWM_RACE_E2E_BASE=http://localhost:5199 WWM_RACE_SHOTS=/tmp/wwm-race-review pnpm vitest run apps/web/test/race.e2e.test.ts
```

The standard suite intentionally skips opt-in browser tests without their environment variables; their actual browser runs are reported separately. Controller protocol/timeout/calibration, driver frame schedules (30/60/144 Hz and catch-up), real replay, recording limits, storage concurrency/quota/unavailable IDB, worker cancellation, and session lifecycle have focused coverage. Original builder goldens and standard score/education suites are included in the whole-workspace check.

## Resource evidence and remaining gates

Exact maximum typed buffers: 1,800,000 bytes inputs; 2,088,029 bytes per ghost; 4,176,058 bytes for two. This excludes Rapier, textures, renderer and browser heap. Ghost generation runs off the active render loop and is cancellable.

M0–M3 code is implemented. M5 automated desktop/mobile-layout and regression checks are complete subject to the final results below; physical iPhone tilt/lock/reconnect, Android support, reference-device performance and human course acceptance remain open. M6 local production-build/rollback rehearsal is separate from any hosted preview or deployment. No production deployment, account, leaderboard, analytics upload or cloud history was added.

For human review: use Flow Sprint for familiarization, then five repeat attempts with shadows on/off. Observe forced stops, route hesitation, falls and voluntary retries. Curves should be judged only after this baseline feels good. Physical phone testing needs the existing secure phone/relay development setup; a static local preview only exercises keyboard gameplay.

## Final verification results

- Whole workspace `pnpm check`: passed; **97 files passed, 4 skipped; 1,242 tests passed, 36 skipped**. This run preceded the last three focus-latch regression tests, which then passed in the complete **7/7** focused lifecycle suite with current web typecheck and scoped lint. Existing story CSS warning and dev-phone style advice remain unchanged.
- Both production builds (Race enabled and disabled): passed. Existing large Three.js chunk warning remains.
- Final development browser suite: **4/4 passed** after final lifecycle fixes (56.3 seconds). Real solver completion, first-run result comparisons, saved best reload, worker ghost identical physics, pause/retry/cleanup, mobile sizing, Race/learn conflict and ordinary keyboard controls passed. No page errors.
- Independent Switchback and Longline browser runs: exact expected finish and sector ticks, no falls/practice flags/page errors. Sampled ramps and turns show aligned decks and open mouths. Checkered finish correction verified.
- Fresh independent visual reviewer (general reviewer substituted for the unavailable dedicated skill role): **ship for visual handoff**, no material fixes. TYPE/MATERIAL matched incumbent WWM. Its verdict covers supplied screenshots only, not phone handling or human flow.
- Persisted representative images and course review readback: [catalog](race-review/catalog.png), [mobile ready](race-review/mobile-ready.png), [finish](race-review/finish.png), [course evidence](race-review/course-review.json).

- Production-preview browser test: **1/1 passed** (27.5 seconds), bringing final browser acceptance to **5/5**. Enabled build on port 5200 supports keyboard gameplay and Original/Education entries. Disabled build on 5201 was served at the same 5200 origin: Race navigation disappeared and deep links became unavailable, while a saved actual attempt remained. Restoring the enabled build read back that history. Zero page errors.
- Final protocol/driver regression batch: **59/59 passed** (Race + Original controllers, connection/input sources, binary codec, driver).
- Final whole-workspace typecheck and lint passed after all review fixes; **7/7** lifecycle regressions passed again. Only the two pre-existing lint advisories remain.
- `git diff --check`: passed. No physical-device or human intervention occurred during automated acceptance.

### Native desktop renderer measurement

Headed Chromium on **Apple M5 Max**, Metal adapter, actual **WebGPU**, high quality (tier 0), 1440 × 1000, focused/visible. One whole-course warmup preceded the three comparable 15-second Flow Sprint samples; identical solver inputs, normal time during samples. History seeding outside the windows used accelerated time.

| Shadows | Samples | Simulation ticks reached | Mean frame | p95 | p99 | Geometries / textures |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 0 | 890 | 1799 | 16.666 ms | 17.6 ms | 17.7 ms | 17 / 24 |
| 1 | 890 | 1800 | 16.667 ms | 17.6 ms | 17.7 ms | 18 / 24 |
| 2 | 878 | 1776 | 16.667 ms | 17.6 ms | 17.7 ms | 19 / 24 |

Approximately **60 fps**, effectively **0% p95 regression** in this sample, with correct 0/1/2 ghost counts and no page errors. The two-ghost window is about 0.2 seconds shorter; this is a bounded reference-desktop measurement, not universal-device or full-course performance proof. [Native report](race-review/ghost-performance-native.json).

An earlier headless WebGL run was slow (p95 250/200/50 ms), with warmup and unequal course progress confounding comparison. It is retained transparently as [headless evidence](race-review/ghost-performance-headless.json), excluded from native-desktop qualification, and not claimed to be verified software rendering because its unmasked renderer was not recorded. Supported mobile rendering/heap and physical phone interaction remain open.

Review finished: 2026-09-27 approximately 06:38 UTC (2026-09-26 23:38 PDT). Exact implementation start time was not captured; this was the same authorized execution session. Local production preview: `http://127.0.0.1:5200/race`; developer preview: `http://localhost:5199/race`. No hosted/production deployment was performed.
