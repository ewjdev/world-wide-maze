# Mobile tilt preview receipt

Date: 2026-10-07 (initial publication 2026-10-06). Branch: `codex/mobile-tilt-preview`.

Scope: isolated HTTPS candidate for user testing; production tilt remains disabled. Includes the earlier local lesson-review snapshot as requested. This receipt records software evidence separately from physical acceptance.

The 2026-10-07 permission-success/setup-failure follow-up is documented in [debugging.md](debugging.md). It corrects the gravity-convention assumption and adds local, visible sensor diagnostics. Its current publication receipt follows below.

## Published identity and readback

- Original: <https://wwm-preview-manual-mobile-tilt.ewjdev.workers.dev/play/practice?offline=1>.
- Race: <https://wwm-preview-manual-mobile-tilt.ewjdev.workers.dev/race/island-leap>.
- Current runtime source commit: `9a507029979d30ef0259851ffa740a1f95da720b`; `/api/health` and local UI reports show that identity. Mode remains `static`. Receipt-only commits do not change the candidate's runtime source. Current locally published Worker version: `a6bb42ac-adf2-445c-b486-88c7e28bb3d3`.
- The new [manual CI run](https://github.com/ewjdev/world-wide-maze/actions/runs/37670540165) targets `9a50702`. It was still running at this receipt's readback; no successful CI conclusion is claimed for it. The same tested source has already been built and published locally to the dedicated preview. Existing [PR #46](https://github.com/ewjdev/world-wide-maze/pull/46) tracks this branch.
- Initial publication CI: <https://github.com/ewjdev/world-wide-maze/actions/runs/37558881757> completed successfully for `d4d4dcf2b02e77b45e20d4fafbeb5f7c5281da73`. Full check, standalone education acceptance, static deployment, all eight policy smoke checks and exact-commit readback passed. The production job was skipped. Initial Worker version: `fcedf98e-b1b8-44ac-8f2f-47a6a3f25426`, deployed at `2026-10-07T02:00:15Z` (October 6 locally).

## 2026-10-07 follow-up validation and publication

All workspace typechecks passed. Repository lint passed with the same 54 warnings and 20 informational diagnostics, no errors. A clean full test run against frozen files passed **152 files / 1,637 tests**, with 5 files / 41 tests explicitly skipped, in 179.96 seconds. All eight tilt browser scenarios passed. Final motion unit coverage has 15 passing tests. An earlier full run was invalidated by development HMR during concurrent source edits; its four game-flow failures are not treated as acceptance evidence. The clean run includes those game flows and supersedes it.

The candidate build passed with mobile/Race/tilt enabled, telemetry disabled, and `VITE_PREVIEW_COMMIT=9a507029979d30ef0259851ffa740a1f95da720b`. The static-host configuration guard and whitespace checks passed. The local Wrangler publication used only the existing dedicated ASSETS host; production was not published.

Live health reports the exact source commit. HTTPS/CSP/sensor headers and all eight static-policy smoke checks passed. Four deployed Chromium checks (Original and Race, each with direct and inverted synthetic gravity) reached active tilt play, verified the convention and source commit in the UI report, paused on companion loss with blocker `motionLost`, and made no dynamic API requests. Both Original checks recorded one Jump from a released touch across zero simulation ticks. Browser error lists were empty. These checks remain synthetic software evidence; they do not confirm the user's physical iPhone result.

Reload the same preview and enable tilt. If it still stops, use **Motion details → Copy debug report**. The report separates each permission from received/usable data and includes raw readings, movement, agreement, grip/focus context, browser and build identity. Its values stay local until the user explicitly copies and shares them.

## Initial publication evidence

### Merge preparation, 2026-10-07

The subsequent manual run `37670540165` and PR-head run `37671394390` both failed only the diagnostic browser flow's aggregate 80-second timeout while loading three complete game viewports on the software-rendered GitHub runner. The PR run passed 1,630 other tests. Before merging, this flow was split into named portrait, landscape and desktop cases, each retaining the existing 80-second flow budget and every assertion. Each context now closes in `finally`, including on failure. No runtime behavior or production feature flag changed.

The targeted three-case run with `CI=true` (software rendering, WebGPU disabled) passed in 32.02 seconds locally. Web typechecks, scoped lint and whitespace checks passed. The replacement PR-head CI must pass before merging; its current result is available on [PR #46](https://github.com/ewjdev/world-wide-maze/pull/46). Historical publication evidence below retains its original scope.

Live readback confirmed HTTP 200 over HTTPS for home, Original, Race and health. HTML carries the strict existing CSP and self-origin accelerometer/gyroscope policy with magnetometer denied; API responses carry the API CSP. The static-policy smoke passed all eight checks, including extension ZIP/checksum, disabled dynamic work, pairing refusal and share refusal. Browser contexts on both live routes confirmed no permission request before Enable, synthetic granted tilt entry, denied-permission joystick fallback and no online API traffic. Original recorded exactly one Jump from a released CDP touch at zero simulation ticks; both games paused after readings stopped. These are software checks using Chromium and synthetic readings, not physical acceptance.

## Implemented behavior

- Original and Race select local tilt on phone-class touch devices, preserve explicit keyboard/joystick preferences, and require a deliberate Enable gesture plus responsive readings and a current grip calibration.
- The two-axis calibrated gravity source runs on the device. It reuses existing screen-angle math, clamps and deterministic simulation input; no controller room or raw-sensor analytics is introduced.
- The canvas fills the browser gameplay viewport. One playfield touch requests one tick of Jump; compact Pause, optional Jump and course-dependent Race Turbo remain separate actions. Normal post-release capture loss retains a completed tap; active cancellation removes only that contact's pending request.
- Denied, missing, blocked or unusable sensor readings display a reason and explicit joystick fallback. Returning joystick choices suppress motion setup until tilt is selected again.
- Interruptions neutralize controls and pause. Rechecking reaches ready; a separate resume gesture is required. Original preserves the interrupted countdown beat and fractional remainder. Race preserves countdown and its existing practice eligibility rules.
- Switching a loaded worker-driven Original stage to tilt requires checking sensors and confirming a stage restart into an actual lockstep driver. Obsolete driver, permission, intro and respawn work cannot arm a replacement attempt.
- Controls include Recenter, bounded sensitivity, input choice and optional visible Jump, with English/Japanese copy and protected setup focus.
- Saved attempts use the existing schema: local tilt maps to broad `touch` Race provenance and `unknown` analytics provenance. Converted input and replay formats are unchanged.

## Candidate policy for physical evaluation

These values are provisional, not qualified Safari/Chrome behavior:

| Check | Candidate |
| --- | --- |
| First usable orientation and motion data | 2.5 seconds after permission resolution |
| Prompted response | At least 4 degrees of gravity change, with up to 12 seconds to move |
| Companion heartbeat | At least 3 finite approximately-1g motion samples; no required fixed frequency |
| Automatic grip capture | 700 ms steady within 2 degrees, facing roughly upward (`gravity.z < -0.2`) |
| Lost usable motion heartbeat | Pause by 1.5 seconds plus the 100 ms check cadence |
| Frozen/invalid steering evidence | Sustained 800 ms of invalid orientation, gravity disagreement over 12 degrees, or pitch/roll movement without a recent orientation update |
| Sensitivity | 0.5–1.5; default 1; One Euro filter `minCutoff=3`, `beta=1.5` |
| Power hysteresis | Normalized engage 0.12 / disengage 0.08 |

A held neutral or nonzero steering pose can remain ready without new orientation events when companion gravity remains consistent. Synthetic tests hold each for 30 seconds. A browser freezing both streams while fabricating consistent heartbeats cannot be distinguished by these APIs; no such configuration is claimed qualified. Devices without usable companion data receive the explicit fallback warning.

## Validation

`pnpm check` passed: all workspace typechecks, repository lint (54 pre-existing warnings, no errors), and 151 test files passed / 5 skipped; 1,625 tests passed / 41 skipped in 166.72 seconds. All six new tilt browser scenarios ran: setup and single-tick tap, denied fallback persistence, protected focus/sensitivity, Original fractional countdown/retry, confirmed worker conversion and Race interruption/countdown. Existing mobile joystick, desktop/controller, recording and deterministic replay suites were included. Optional external-server/reference-fixture suites remain skipped; no physical test was substituted for them.

The final CI check on `d4d4dcf` passed 151 files / 6 skipped and 1,624 tests / 47 skipped in 569.29 seconds, including all six tilt scenarios and five new static-host boundary tests. Standalone education Chromium acceptance ran separately with 19 passed. CI retains explicit skips for optional external-server suites and GPU-only coverage; the five static-host tests were added after the earlier local run. Post-CI publication readback again confirmed the source commit, sensor/CSP headers, granted tilt/health-loss behavior and denied-permission joystick fallback on both HTTPS routes.

Both standard web builds passed with mobile/Race enabled and tilt explicitly false (rollback) and true (candidate). Built flag-off Original/Race smoke selected joystick, displayed no motion setup and requested no sensor permission. Built candidate smoke displayed tilt setup without requesting permission before a gesture, then handled a synthetic denial and entered joystick fallback on both routes. The candidate build uses `VITE_TELEMETRY_URL=''`. `pnpm build:education`, `pnpm docent:index --check`, `node infra/scripts/check-deploy-config.mjs all` and diff whitespace checks passed. Candidate HTTPS identity/readback is recorded above.

The fresh [UI review](ui-review.md) has final disposition **ship**, with all three material fixes resolved. Screenshots are retained in [screenshots/](screenshots/). Browser tests use synthetic motion plus Chromium/CDP touch; they do not establish hardware accuracy, iOS permission behavior, comfort or thermal performance.

The earlier lesson-review snapshot initially blocked repository lint. Its JSON/scripts were formatted and its dynamic template received meaningful initial headings/links, semantic question navigation and a fieldset. Generated gallery/guide were rebuilt from the existing authored lesson data. No lesson was integrated into gameplay.

The [first GitHub run](https://github.com/ewjdev/world-wide-maze/actions/runs/37557494872) passed its full check (1,619 tests / 47 skipped, including all six new tilt scenarios) and separate education acceptance (19 passed), but the Worker Preview deployment returned an empty URL list: the production Worker's preview hosts are deliberately disabled. The manual workflow now uses a dedicated static Worker (`wwm-preview-manual-mobile-tilt`) with only an ASSETS binding. Dynamic paths are denied before reading bodies or assets; health reports the exact deployed commit. The production host flags stay disabled, and automatic PR previews retain their existing policy. The dedicated host does not run migrations or bind preview/production databases, rooms, AI or capture services. Its targeted security/config suite passed 20 tests, alongside worker typechecks, config guard and Wrangler dry-run. The unused URL-less Worker Preview was deleted successfully after publishing the dedicated host.

## Testing the candidate

Open the preview directly in Safari or Chrome, rather than an embedded panel. Use Original `/play/practice?offline=1` and Race `/race/island-leap`. Enable tilt, allow motion if prompted, gently move both axes, then hold the desired grip still. Tilt to drive and tap empty gameplay space to jump.

Check portrait and both landscapes, all four directions, neutral stopping, tilt plus Jump, Race Turbo, sensitivity/recenter, pause/countdown, app switch and lock/unlock. After interruption, check tilt again and explicitly resume. Deny permission or block readings and choose joystick; reload to verify that preference. Pause → Controls also allows joystick for comfort even when sensors work.

Preview dynamic APIs, website capture, pairing and telemetry are intentionally disabled by the existing cost-control policy. Static practice and bundled Race courses are the testing targets. The workflow summary identifies the exact commit and preview URL. The global automatic-preview policy remains unchanged; this branch uses one explicit manual preview.

## Open acceptance gates

G1 software acceptance is evaluated by automated suites. G0, the physical portions of G2/G3, G4 and production G5 remain open until receipts exist for iPhone Safari, Android Chrome, sensor-blocked touch, and an iPad smoke before tablet support is claimed. Include OS/browser/build identity, permission conditions, both OS rotation-lock states, 30-second held poses, frozen/lost data, panel ownership, completed runs and at least 15 minutes of comparative joystick/tilt play with frame pacing and comfort observations.

No physical device was operated for this receipt. Production activation is not authorized by publishing this candidate. Rollback builds set `VITE_MOBILE_TILT_ENABLED=false`, retaining existing mobile joystick controls and readable saved attempts.
