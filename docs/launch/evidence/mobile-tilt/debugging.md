# Tilt permission succeeds, but setup does not finish

Date: 2026-10-07. Branch: `codex/mobile-tilt-preview`. This follow-up addresses the user's iPhone report: the OS motion prompt was allowed in Chrome and Safari, but setup remained at the reading check. The screenshot establishes the setup stage, not the device's actual sensor values.

## Diagnosis and correction

The previous companion-health check unconditionally negated `accelerationIncludingGravity` before comparing it with orientation-derived downward gravity. [WebKit's iOS implementation](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/ios/WebCoreMotionManager.mm) sends CoreMotion `userAcceleration + gravity` directly. A matching iOS gravity vector therefore became an approximately 180-degree mismatch in our check. This is a confirmed compatibility defect in the code and a likely explanation for this report; physical-device confirmation still requires a new reading receipt.

Setup now learns direct versus inverted gravity from three agreeing, recent paired samples. The convention stays fixed until an explicit recheck; it cannot flip during play to conceal a frozen stream or a reversed reading. Movement, stable grip, usable companion heartbeat, health loss, permission generation and explicit resume requirements remain enforced. The paired controller's sensor pipeline is unchanged.

## Visible diagnostics

- Separate direction and motion permission results: allowed, blocked, API request failed or no prompt required. Synchronous failures from one API still allow the other API to be requested in the original gesture.
- Received and usable event counts, age at the latest check, and maximum movement against the existing 4-degree setup threshold.
- A plain-language blocker distinguishes no direction events, invalid angles, no motion events, invalid gravity, stale motion, mismatched streams, frozen direction, insufficient movement, unsuitable grip, focus loss and rotation.
- Failure evidence remains visible after listeners stop. A new explicit check clears the prior attempt. The report includes raw angles/gravity, magnitude, chosen convention, agreement angle, context/focus/orientation, browser, page path and compiled preview source commit.
- “Motion details” follows the retry and joystick controls so expanding a long report does not bury recovery actions. The report is selectable when clipboard access fails. Diagnostic values are polled at 250 ms; state/progress updates can publish immediately, using a separate subscription from gameplay readiness.
- Diagnostics remain local. Copy requires an explicit button press; no sensor report is sent to telemetry. Report page identity excludes query parameters. English and Japanese strings are included.

The short-height panel scrolls within the setup cover. Phone (390 × 844), landscape (844 × 390) and desktop (1280 × 900) renders were inspected together. One repair batch moved the disclosure below recovery and clarified setup-failure/waiting copy. The confirmation captures show readable status, complete visible focus, no horizontal overflow and recovery before report content. This was a parent-run hardening/polish follow-up, not a new independent-agent review.

## Software evidence and remaining acceptance

Regression fixtures cover both gravity conventions reaching ready, actual steering, a locked convention rejecting reversal during play, incompatible streams never arming, invalid/no data diagnostics, retained timeout evidence and individual permission failures. Chromium browser coverage exercises both conventions on Original/Race and missing-event warnings plus report copying and focus wrapping at three viewport sizes. All evidence uses synthetic sensors.

Final suite, published commit, live readback and CI results are recorded in the [preview receipt](preview.md). Real iPhone Safari/Chrome confirmation is still open. The next user receipt should contain the new blocker and the copied debug report if the updated candidate still cannot complete setup. Production tilt remains disabled.
