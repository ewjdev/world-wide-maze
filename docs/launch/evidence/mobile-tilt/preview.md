# Mobile tilt preview receipt

Date: 2026-10-06. Branch: `codex/mobile-tilt-preview`.

Scope: isolated HTTPS candidate for user testing; production tilt remains disabled. Includes the earlier local lesson-review snapshot as requested. This receipt records software evidence separately from physical acceptance.

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

Both standard web builds passed with mobile/Race enabled and tilt explicitly false (rollback) and true (candidate). Built flag-off Original/Race smoke selected joystick, displayed no motion setup and requested no sensor permission. Built candidate smoke displayed tilt setup without requesting permission before a gesture, then handled a synthetic denial and entered joystick fallback on both routes. The candidate build uses `VITE_TELEMETRY_URL=''`. `pnpm build:education`, `pnpm docent:index --check`, `node infra/scripts/check-deploy-config.mjs all` and diff whitespace checks passed. Candidate HTTPS identity/readback is recorded after publication.

The fresh [UI review](ui-review.md) has final disposition **ship**, with all three material fixes resolved. Screenshots are retained in [screenshots/](screenshots/). Browser tests use synthetic motion plus Chromium/CDP touch; they do not establish hardware accuracy, iOS permission behavior, comfort or thermal performance.

The earlier lesson-review snapshot initially blocked repository lint. Its JSON/scripts were formatted and its dynamic template received meaningful initial headings/links, semantic question navigation and a fieldset. Generated gallery/guide were rebuilt from the existing authored lesson data. No lesson was integrated into gameplay.

## Testing the candidate

Open the preview directly in Safari or Chrome, rather than an embedded panel. Use Original `/play/practice?offline=1` and Race `/race/island-leap`. Enable tilt, allow motion if prompted, gently move both axes, then hold the desired grip still. Tilt to drive and tap empty gameplay space to jump.

Check portrait and both landscapes, all four directions, neutral stopping, tilt plus Jump, Race Turbo, sensitivity/recenter, pause/countdown, app switch and lock/unlock. After interruption, check tilt again and explicitly resume. Deny permission or block readings and choose joystick; reload to verify that preference. Pause → Controls also allows joystick for comfort even when sensors work.

Preview dynamic APIs, website capture, pairing and telemetry are intentionally disabled by the existing cost-control policy. Static practice and bundled Race courses are the testing targets. The workflow summary identifies the exact commit and preview URL. The global automatic-preview policy remains unchanged; this branch uses one explicit manual preview.

## Open acceptance gates

G1 software acceptance is evaluated by automated suites. G0, the physical portions of G2/G3, G4 and production G5 remain open until receipts exist for iPhone Safari, Android Chrome, sensor-blocked touch, and an iPad smoke before tablet support is claimed. Include OS/browser/build identity, permission conditions, both OS rotation-lock states, 30-second held poses, frozen/lost data, panel ownership, completed runs and at least 15 minutes of comparative joystick/tilt play with frame pacing and comfort observations.

No physical device was operated for this receipt. Production activation is not authorized by publishing this candidate. Rollback builds set `VITE_MOBILE_TILT_ENABLED=false`, retaining existing mobile joystick controls and readable saved attempts.
