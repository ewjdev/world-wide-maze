# Mobile tilt steering and tap-to-jump — execution plan

**Date:** 2026-10-06

**Status:** Planning only. The four system-design-review findings have been incorporated; T0 physical feasibility and health-policy decisions remain open. No tilt implementation or physical-device qualification is claimed by this document.

**Outcome:** On a supported touch device, the player tilts the device to steer and taps the playfield to jump. Gameplay fills the available viewport. When tilt is unavailable or permission is denied, a clear warning offers the existing joystick as an explicit fallback.

This plan supersedes the joystick-first interaction, reserved control deck, and deferred same-device gyro decisions in [the mobile browser game plan](mobile-browser-game-execution.md). Its complete mobile journey and release requirements continue to apply. The user confirmed on October 6 that the warning should offer an optional joystick fallback. Scope covers Original/website mazes, bundled practice, local-play entry points, and Race. Desktop keyboard/gamepad and the separate paired-phone controller remain supported.

## 1. Player experience

### Entry and permission

1. A phone-class touch device defaults to **Tilt controls**. Hybrids retain the existing capability/preference rules and an explicit control choice. Detect capabilities, not a viewport width or user-agent string.
2. Before countdown, show: **“Tilt to steer. Tap the game to jump.”** Explain that motion readings are processed on the device, then offer **Enable tilt** and **Use joystick**. Opening a route must not itself prompt for permission.
3. The Enable tilt gesture invokes the browser's permission API when present, checks for usable readings, and opens a short calibration step. An absent permission method is not an unsupported-device verdict. Permission granted is not proof that readings exist.
4. Ask the player to hold the device comfortably and still. Show calibration progress and **Use this position**. Include a brief left/right and forward/back check; verify the readings respond before marking tilt ready. Start only after this check. A flat reading with zero-valued angles is valid.
5. Offer joystick controls throughout setup, including after a denied request or failed check. Do not start an uncontrolled run or switch controls silently. Retry is deliberate; a denied permission must not create a repeated prompt loop.
6. Returning players keep their control preference and sensitivity, but a new session verifies permission/readings and captures the current grip. Saved permission or a previous neutral pose never authorizes a new sensor session.

### During play

- Tilt controls both steering axes: toward the visible top moves forward in the existing camera frame; lowering the right edge moves right. Portrait and both landscape directions must work.
- Power engages automatically beyond a small neutral dead zone. Returning to neutral releases Power using the existing damping and momentum behavior. Jump does not require Power. There is no hold-to-drive gesture in this mode.
- A fresh touch on the playfield requests one Jump immediately. Holding a finger does not repeat Jump; dragging does not steer; additional simultaneous contacts do not add jumps. A short tap survives release before the next simulation tick.
- Keep a compact, safe-area-aware Pause control. Race retains a small, labeled Turbo control when the course provides it; pressing it uses the existing Turbo request path and never also jumps. The plan does not introduce a hidden double-tap gesture or change automatic ramp launches.
- Teach tilt first and Jump next, with one short fading hint. Preserve Original's tutorial/timer rules and Race's countdown. Contacts made during setup/countdown cannot jump at Go.
- Controls/settings offer **Recenter**, bounded sensitivity, **Tilt / Joystick / Keyboard** where applicable, and an optional visible Jump button. Joystick also remains available for comfort and accessibility when sensors work.
- “Full screen” means the canvas occupies the available browser gameplay viewport, without a joystick deck or permanent Jump panel in tilt mode. Browser Fullscreen API access is an optional enhancement; fullscreen permission and orientation lock are not prerequisites.

### Warning and recovery copy

Use supported English/Japanese localization and accessible status/focus handling. Present the reason before the actions.

| Situation | Suggested message | Actions |
| --- | --- | --- |
| No API, known policy block, or failed responsive-reading check | “Tilt controls aren't available on this device or in this browser.” | **Use joystick**, **Try again**, optional **Open in browser** guidance for embedded views |
| Permission explicitly denied | “Motion access is blocked. Allow it in your browser settings to use tilt controls.” | **Use joystick**, concise settings help, deliberate **Try again** |
| Insecure deployment/context | “Tilt controls need a secure connection. Open the HTTPS game link or use joystick controls.” | Link to the configured canonical HTTPS route, **Use joystick** |
| Unsteady or unsuitable calibration pose | “Hold your device still in a comfortable position.” | **Use this position** when valid, **Try again**, **Use joystick** |
| Readings interrupted during play | “Tilt controls stopped responding. The game is paused.” | **Check tilt again**, **Use joystick**, exit/retry |

Do not claim that hardware lacks a gyroscope based only on a timeout. Browsers and embedded views can block delivery. Successful fallback dismisses the blocking warning; keep the chosen control mode visible in settings. Switching during a Race attempt follows its existing practice/eligibility policy.

## 2. Verified starting point

Inspected on 2026-10-06 in local branch `codex/mobile-controls-polish`, HEAD `008c140`. These are source findings, not a production readback or physical-device receipt.

| Area | Existing implementation | Planned change |
| --- | --- | --- |
| Tilt math | [net/tilt.ts](../packages/net/src/tilt.ts) converts orientation to calibrated gravity, rotates into the screen frame, removes compass-heading dependence, and clamps axes | Reuse these pure functions and their tests; implement a local source rather than relay local samples through a room |
| Sensor setup | [controller/session.ts](../apps/web/src/controller/session.ts) contains permission, a 2.5-second first-reading timeout, calibration and sensor cleanup | Reuse proven concepts; a small browser sensor adapter serves local play. Do not instantiate the paired controller session, which also creates network transport |
| Input timing | [net/sources/touch.ts](../packages/net/src/sources/touch.ts) separates non-consuming `peek()` from tick-consuming `sample()` | Give local tilt the same timing contract with a one-tick Jump pulse and a neutral tick between successive pulses |
| Original | [game/game.ts](../apps/web/src/game/game.ts) already selects touch and consumes it within fixed ticks, with panel/lifecycle guards | Add tilt selection, setup readiness, tick consumption, tutorial and release/re-arm handling |
| Original driver lifetime | `Game.#ensureDriver()` caches `#driverLoad`; `#setInputMode()` changes the requested kind without replacing an existing driver | Select lockstep before initial load, or explicitly restart the stage and replace a cached worker before activating tilt |
| Original countdown | [game/machine.ts](../apps/web/src/game/machine.ts) resumes every paused phase into `play`; `Game.#send()` drops phase-scoped countdown callbacks | Store the interrupted phase and fractional next-beat time; extend the local resume event and replace the disposable countdown callback chain |
| Race | [race/session.ts](../apps/web/src/race/session.ts) has touch integration, Turbo latching and countdown-aware pause/resume | Integrate the same local tilt source; retain Race-specific timing, practice marking, recording and Turbo behavior |
| Controls/layout | [input/TouchControls.tsx](../apps/web/src/input/TouchControls.tsx) and [touch.css](../apps/web/src/input/touch.css) render a joystick/action column and reserve portrait space | Retain as fallback; add a minimal tilt layer and scope the portrait deck exclusively to joystick mode |
| Resize/orientation | [input/layout.ts](../apps/web/src/input/layout.ts) provides shared container sizing and orientation notifications; paired [browser-env.ts](../apps/web/src/controller/browser-env.ts) reads screen angle with a legacy fallback | Reuse one resize owner. Extend angle handling to detect 90/270-degree changes reliably, including landscape-to-landscape rotation |
| Preferences | [input/capability.ts](../apps/web/src/input/capability.ts) stores `wwm.input.v1` touch/keyboard preference | Preserve its broad local/keyboard choice; add a separate versioned motion-settings record |
| Saved Race attempts | [race/types.ts](../packages/race/src/types.ts) and [attempt.ts](../packages/race/src/attempt.ts) accept `keyboard`, `phone`, `touch`, `mixed` provenance | Keep same-device tilt serialized as `touch` initially; avoid adding a value older builds reject |
| Analytics | [observe-game.ts](../apps/web/src/telemetry/observe-game.ts) reports touch as `unknown`; [schema/telemetry.ts](../packages/schema/src/telemetry.ts) lacks touch/tilt labels | Map local tilt to `unknown` too; distinct analytics labels are a separate coordinated contract change |
| Hosting | Worker [security.ts](../apps/worker/src/security.ts) and static [_headers](../apps/web/public/_headers) permit self-origin accelerometer/gyroscope and deny magnetometer | Verify these on candidate routes; keep the existing narrow policy |
| Builds | [.github/workflows/ci.yml](../.github/workflows/ci.yml) explicitly enables existing mobile controls and Race in preview and production build configuration | Add an independent tilt switch; verify built/deployed values instead of inferring deployment from source |
| Coverage | Existing net tilt/source tests, mobile input/E2E tests and Race session/recording tests | Extend those suites and add a focused local-motion session suite; real sensor/browser permissions still require device acceptance |

## 3. Browser constraints and feasibility gate

The browser API is Device Orientation, backed by motion sensors; “telemetry” here means local control readings. HTTPS, permission/policy handling and nullable sensor values need explicit checks. A permission request that needs a prompt must originate in a user gesture. Orientation can be change-driven, whereas motion events have an implementation-defined interval; a motionless phone is not automatically a failed sensor. See the [W3C Device Orientation and Motion specification](https://www.w3.org/TR/orientation-event/) and [WebKit's permission guidance](https://bugs.webkit.org/show_bug.cgi?id=201676).

Device axes do not rotate with the displayed screen; apply screen angle explicitly. Natural orientation can differ across phones and tablets. See the [W3C Screen Orientation specification](https://www.w3.org/TR/screen-orientation/).

The first milestone must resolve **usable steering and reliable interruption handling on physical iOS Safari and Android Chrome**. Do not assume that the paired controller's stream timeout can be copied: its host receives recurring network frames, while local orientation events may arrive only when values change.

- Steering uses relative `deviceorientation` through the existing gravity math. Do not require compass/magnetometer, location, or Generic Sensor APIs. If the browser cannot provide usable orientation under the existing policy, show the warning/fallback.
- Probe first data while the page is visible; start a bounded initial deadline after permission resolves, never while a native permission dialog is open. Begin with the existing 2.5-second deadline as a candidate, with an explicit prompted-movement retry.
- Validate finite `beta`/`gamma`, including valid zeros, and verify a small prompted movement changes gravity. Do not require non-null `alpha`, a fixed sample rate, or angular movement during the subsequent steady calibration hold.
- Immediately neutralize and pause on visibility/focus loss, known revocation/blocking, sustained invalid data, or a confirmed stalled stream. Clear Jump/Turbo and reset filter history.
- Establish a health policy in T0. Prefer measured periodic orientation delivery where available; investigate periodic `devicemotion` only as a liveness companion for change-driven orientation delivery. If its permission API is required, invoke needed requests in the same initiating gesture, without awaiting another request first. Do not add acceleration-based steering or integrate gyro rate in this feature.
- A companion event alone must not certify a frozen orientation stream. The spike must test movement with frozen/invalid orientation, not merely loss of all events. Record the limits of what the browser exposes.
- Do not impose a universal 250 ms orientation watchdog. Select and document bounded loss behavior from observed target-browser cadence, with tests for both a held neutral pose and a held steering pose. If a configuration cannot distinguish ordinary stillness from interruption well enough for reliable play, warn and offer joystick rather than claim it is qualified. This is an open T0 gate, not an already solved property.

## 4. Implementation contracts

### Sensor adapter and input source

Proposed files: `apps/web/src/input/motion-session.ts` for browser permission/probing/lifecycle and `packages/net/src/sources/tilt.ts` for testable local input. Add the net export and internal source kind `tilt`; keep sensor browser globals behind an injectable environment.

- The adapter owns one sensor subscription per local play session, a monotonic clock, screen-angle resolution, setup progress, permission result and health status. Use an attempt/generation token so a late permission response cannot attach listeners after fallback, navigation, retry or disposal. All listeners/timers/optional health observers have cleanup.
- The local source owns calibrated zero, normalized/clamped steering, smoothing history, dead zone/Power hysteresis and pending Jump. Reuse `orientationToTilt`, calibration primitives and the One Euro filter where suitable. Filter once per new reading, not separately for every HUD/render/tick read; reset after interruption/recenter. Avoid stacking filters that make steering lag.
- Capture the current grip in the device frame per session. Keep automatic steady calibration and manual capture within a usable pose; existing near-neutral restrictions are candidates to validate for both landscape directions. Do not silently calibrate a tilted steering pose while a run continues.
- Apply sensitivity and a small dead zone with hysteresis, then clamp to existing `MAX_TILT_ROLL` / `MAX_TILT_PITCH`. Tune physical comfort first; no physics, gravity, jump-height or damping changes are included. Recenter/settings changes pause the run and use fresh readings before explicit resume.
- `peek(now)` reads without consuming actions. `sample(now)` is called only by the selected source's eligible fixed-tick callback. It emits a pending tap for one tick, then emits `jump: false` before another pulse so the simulation can detect another rising edge. Multiple taps before consumption coalesce to one pending request; no unbounded action queue.
- A zero-step render retains the request. Catch-up ticks cannot repeat it. Switching source, opening a panel, countdown, fall/respawn, time-up, focus loss and disposal clear pending taps. Unlike joystick holds, a tap made while falling must not wait for landing and become a surprise jump.
- Local tilt requires an actual lockstep driver, including when a worker-driver debug preference exists; apply the driver-conversion contract below. Record the exact `InputSample` consumed per tick and the existing `frameYaw`; replay never accesses sensors. The existing binary paired-controller protocol and replay physics formats do not change.

### Shared readiness and advancement gate

`motion-session.ts` exposes `subscribe/getSnapshot`, gesture-initiated `enableTilt`, `captureHere`, deliberate `checkAgain`, `suspend(reason)` and `dispose`. Its snapshot carries the setup state below, attempt generation, permission result, calibration progress/identity and sensor-health result. The adapter reports readiness; Original and Race own gameplay phase, pending start/resume intent and whether gameplay is armed. Permission completion or a sensor event never writes gameplay phase directly.

| Motion state | Meaning | Start/resume permitted |
| --- | --- | --- |
| `idle` | Tilt selected; no sensor request active | No; offer Enable tilt or joystick |
| `requesting` | Permission request pending | No; native prompt time is excluded from the probe deadline |
| `probing` | Waiting for usable, responsive readings | No; allow deliberate retry/fallback |
| `calibrating` | Readings verified; current grip not yet captured | No; offer capture progress/manual position |
| `ready` | Current calibration valid and sensor health passes T0's policy | Eligible for the shared gate; readiness alone does not resume a run |
| `interrupted` | Visibility/focus, health, rotation or recenter invalidated readiness | No; check/recalibrate, then explicit resume |
| `denied` / `unavailable` | Permission denied or no usable sensor configuration | No; warning and explicit fallback |
| `disposed` | Session retired | No; ignore every late callback |

- Add shared, non-consuming `canStart(context)`, `canResume(context)` and `canAdvance(context)` predicates alongside the adapter. For selected tilt, base readiness requires `ready`, a current generation/calibration, valid health, a visible/focused page and `driver.kind === 'lockstep'`. Other input modes retain their existing readiness rules and do not consult motion permission.
- `canStart` also requires an explicit Start/Enable-tilt/fallback intent for the current run generation. Loading and the camera intro may finish while setup is visible; hold their completion as one generation-scoped continuation. Run it once after setup and driver readiness satisfy the pending start intent. Do not start the tutorial, countdown, game timer or playable physics behind setup. Navigation, replacement/retry and source change discard old continuations; deliberate fallback creates a new continuation for the still-loaded stage.
- `canResume` requires a new deliberate resume intent and release of old gameplay contacts. A normal **Roll on**, **Skip gate** or **Stay here** click can supply that intent after its contact is released, provided tilt is still ready; no extra Resume screen is required in this healthy case. After a sensor/lifecycle interruption, completing the check only reaches `ready`: keep the run paused until a subsequent Resume gesture.
- `canAdvance` requires base readiness, an armed run and exclusive gameplay ownership. Evaluate it at every countdown/play transition and before advancing physics or gameplay time, not only when drawing controls. On loss, synchronously disarm, neutralize, clear Jump/Turbo, pause the driver and stop the game timer. Original's gameplay-advancing delayed callbacks, including tutorial steps, retain their remaining active time while blocked; unrelated presentation delays and adapter setup progress may continue. A stale render-frame sample cannot advance a later fixed tick after ownership changes.
- Original routes `#introDone`, `#afterGate`, countdown Go, `resume`, `stayHere`, `#closeGate`, respawn completion and travel/next-stage start through this gate. Replace direct driver/timer unpauses in panel-close paths with a gated continuation. Original's first-game tutorial still skips its ordinary countdown, but entering tutorial play requires readiness.
- Race applies the same gate in `start`, after asynchronous course/ghost preparation, at countdown Go and in `resume`; preserve its current focus/paired-phone checks. Loss during countdown/racing uses the existing pause/practice path and retains the interrupted phase. Readiness notifications cannot bypass practice marking or countdown restoration.
- `suspend`, retry, fallback and disposal invalidate the adapter generation before cancellation/cleanup. Subscribers cancel matching pending intents, preventing a late permission response or old intro/load promise from arming a different attempt. Fresh healthy readings use the T0 freshness policy, not a requirement to move a motionless phone on every panel close.

### Driver selection and conversion

Implement this in `game/game.ts` around `#setInputMode` / `#ensureDriver`, using the existing [sim-driver.ts](../apps/web/src/game/sim-driver.ts) interface. Race already uses lockstep; it verifies the same invariant before arming.

1. For a new tilt attempt, resolve the selected local mode before the first driver request and create lockstep even if `?physics=worker` was requested. Check the returned instance's `kind` before satisfying `canStart`; changing `#driverKind` alone is insufficient.
2. If a worker has already been created or its creation is pending, selecting tilt during an active attempt pauses that attempt and offers **Restart stage with tilt** / **Keep current controls**. Keep the old source selected and gameplay paused until the player chooses. Complete tilt setup before discarding the old attempt. Permission denial or canceled setup retains the paused attempt and its current controls. Do not attempt an in-place worker-to-lockstep state migration.
3. On an accepted restart, invalidate the driver-load generation, retire the old driver, clear both `#driver` and `#driverLoad`, and create/load a new lockstep driver through the existing stage-retry path. Clear old input, phase continuations, countdown, recording and ghost state according to existing retry semantics; retain the stage/run selection and use existing score-reset behavior. Only arm after the new load and motion setup are both current and ready.
4. If there is no active attempt, replace a cached worker before the next attempt without a mid-run restart prompt. An obsolete driver promise must dispose its result and must not install it, clear the newer cache or resume a stage. Driver replacement is serialized with stage loading and protected by its own generation.
5. Once local controls select lockstep, later joystick/keyboard choices may continue using it. Never swap back to worker inside an attempt. This changes neither simulation parameters nor recording formats; verification inspects the actual instance and exact per-tick recordings.

### Tap surface and exclusive ownership

Proposed files: `apps/web/src/input/TiltControls.tsx` and `tilt.css`, with thin adapters in `ui/Play.tsx` and `race/RacePage.tsx`.

- Bind Pointer Events to the gameplay surface, not the document. An eligible touch `pointerdown` creates a unique contact token and requests Jump; `pointerup` marks that contact completed and releases ownership while retaining its unconsumed request. One eligible contact owns the surface until release; simultaneous contacts are ignored.
- Distinguish completion from cancellation. Normal `lostpointercapture` following `pointerup` is ignored for the completed contact. `pointercancel`, or unexpected capture loss while a contact is still active, cancels only an unconsumed request owned by that contact token. Cancellation of a later contact must not erase an earlier completed tap with which it coalesced. An already consumed Jump is not rewound. This follows the [Pointer Events implicit-release ordering](https://www.w3.org/TR/pointerevents3/#implicit-release-of-pointer-capture).
- Global reset, unmount, source change and loss of gameplay ownership clear all pending requests and retire their contact generation. These remain cancellation boundaries even for completed-but-unconsumed taps. Release bookkeeping is idempotent, so `pointercancel` followed by `lostpointercapture` cannot cancel a newer contact.
- Gameplay enablement is explicit: live play/racing only. Calibration, hints requiring confirmation, countdown, pause, results, recovery, learning cards, portal/travel and confirmation dialogs own input when visible. Bind eligibility to session state as well as visible controls.
- Interactive controls/HUD links and overlays are excluded using the event's composed path/explicit ownership markers. Pause, Turbo, sound, ghost toggles and a panel-close gesture never also Jump. Do not also bind `click`/`touchstart` as a duplicate gameplay action.
- Suppress scroll, browser long-press menus and double-tap zoom on the active gameplay surface with scoped CSS/handlers. Keep normal scrolling, forms and accessible control interaction elsewhere. Touch cancellation/navigation gestures must release ownership.
- After resume/closing a panel, old contacts must lift before a new gameplay contact is accepted. Use the shared readiness/resume-intent contract above; the joystick's “all controls released” check cannot be copied literally because a tilted phone is continuous input.

### Layout, flow and lifecycle

- Restore the full gameplay-container height in tilt mode, removing the existing portrait deck reservation. Keep joystick CSS scoped to fallback only. Reuse `observeSize` for engine/camera sizing, zero-size handling and browser toolbar/keyboard changes; do not add a second writer.
- Keep existing typography, surfaces and HUD identity. Pause/Turbo/optional Jump use readable labels and at least 48 CSS px hit targets; verify they do not obscure the next route decision. Both tilt and joystick modes have clear instructions/settings.
- A real orientation change pauses first, clears actions, updates screen angle and size, then offers a brief recenter/check and explicit resume. Preserve countdown state using the contract below. Browser-toolbar resizing alone must not trigger calibration or mark Race practice. Legacy fallback must detect landscape-to-landscape rotation; a portrait media query alone cannot.
- Backgrounding, screen lock, focus loss and renderer loss follow existing pause/recovery behavior. Never advance time while suspended. On return, verify readings and explicitly re-arm; there is no automatic resume on the first sensor event.
- Learning/portal panels use their native taps; gameplay tilt does not select learning answers in this feature. Review source unions/device capability advertising accordingly so the feature does not accidentally enable tilt-answer policies. Jev/replay automation continues to use its own deterministic inputs.
- Selecting tilt/joystick or recentering during racing invokes existing pause/practice rules and marks mixed input when appropriate. Explain **“This run is practice after pausing. Retry for a personal best.”** An uninterrupted tilt run remains eligible under current rules.

### Original countdown restoration

Modify `game/game.ts` and the local transition table in `game/machine.ts`; the shared `GamePhase`/paired-phone wire contract does not need a new phase. Race retains its existing `#pausedFrom` / `#countdown` behavior and adds readiness guards only.

- Original stores `pausedFrom: 'countdown' | 'play'` plus a countdown record containing the displayed beat and fractional time remaining until the next beat. Capture these before `MENU` leaves countdown. Preserve them during pause/setup; Retry, Quit, source-replacement restart and a new stage clear them.
- Replace the countdown's nested phase-scoped `#after` chain with an explicitly advanced countdown record. A fresh countdown initializes display 3 and `COUNTDOWN_BEAT_SEC` (currently 0.6 seconds). Decrement only by active, readiness-gated frame time; pause/focus loss cannot consume the remainder. Each beat updates display/audio once, and the final Go transition still passes the shared gate.
- Extend the local `RESUME` event with its destination (`countdown` or `play`, defaulting legacy callers to `play`). The machine chooses that destination rather than hard-coding `play`. `Game.resume()` supplies the saved phase only after `canResume` succeeds. Entering countdown from resume retains the record instead of resetting it to 3; entering it from a new intro initializes it.
- Resume resets the last-frame timestamp before advancement, retains the fractional next-beat remainder, and leaves the driver/game timer stopped until Go. Preserve Original's first-game timer-on-Power rule. Do not replay an already displayed tick sound, skip remaining beats, advance while motion is being checked, or reuse a discarded timer callback to issue a second Go.
- Test interruption partway between every countdown beat, repeated pause/resume and tilt loss/recheck while paused. The remaining countdown duration is identical before/after the interruption; current readiness plus a new resume intent is required, pre-Go taps remain cleared, and a Retry initializes a fresh countdown.

### Preferences, compatibility and privacy

- Leave `wwm.input.v1` and existing saves intact. Add a defensively parsed `wwm.motion.v1` record for local mode (`tilt`/`joystick`), bounded sensitivity and optional Jump-button preference. Missing/malformed records use defaults; storage denial must not block play.
- An older saved `touch` choice means local play and adopts the new tilt default when enabled; an explicit legacy keyboard choice still wins. A newly explicit joystick preference suppresses motion prompts until the player selects tilt again. Persist a fallback choice, not a failed capability verdict; a later browser may support sensors.
- Store calibration in session memory initially, separate from the paired controller's storage key. A reload/new grip recaptures zero. No save/ghost migration is needed.
- Runtime/UI selection distinguishes `tilt` from paired `phone` and joystick `touch`. For published Race attempt metadata, map local tilt to existing `touch` and retain `mixed` on switching sources; use “On-device controls” for the broad saved provenance label. Old readers and a rollback build must still load new attempts.
- Do not emit raw sensor readings or calibration vectors to analytics. Existing replay recordings retain ordinary converted simulation input under current policy. Existing analytics uses `unknown` for local tilt, preserving opt-outs and server validation. Separately identifying tilt funnels would need a coordinated schema/client/server change and is deferred.

## 5. Sequence, responsibilities and gates

Dependencies run T0 → T1 → T2 → T3 → T4 → T5. Responsibilities describe work ownership; this plan does not dispatch agents or authorize implementation.

| Milestone | Responsibility and deliverable | Exit gate |
| --- | --- | --- |
| **T0 — Physical feasibility and behavior contract** | Input owner: small isolated sensor probe on HTTPS; verify permission, live response, comfortable grip, both landscape directions, stillness, interruption/revocation and the health-policy options above on iOS Safari/Android Chrome. Record chosen thresholds/limitations. UI owner reviews setup/warning copy. | **G0:** Both target browsers demonstrate responsive steering data and a credible bounded interruption policy without repeated false stillness failures. Unqualified configurations route to warning/fallback. No sensor-based release claim without device evidence. |
| **T1 — Shared input foundation** | Input owner: injectable sensor session and readiness predicates, pure local source, calibration/filter/dead-zone logic, one-tick tap pulse, contact-token completion/cancellation and generation-safe cleanup. Keep the paired flow independent. | **G1:** Focused unit tests cover null/non-finite/zero readings, direction/wrap/screen-angle math, gain/clamps, stable pose, readiness/intent gates, loss/re-arm, late permission resolution, zero-step/catch-up frames, normal post-up capture loss, active cancellation and neutral ticks between Jump pulses. |
| **T2 — Original vertical slice** | Game/UI owner: direct practice link → Enable tilt → check/calibrate → countdown → full-viewport play → pause/results/retry. Integrate every start/resume boundary with the shared gate, worker-driver replacement/restart, and Original's saved-phase/fractional-countdown restoration. Add warnings/fallback, tutorial and preferences. | **G2:** One real-phone Original run completes through the UI with steering, tap Jump and fallback/retry. Automated tests verify cached/pending worker conversion, actual lockstep recording, no startup behind setup and exact countdown restoration. No room traffic. If hardware is unavailable, report browser evidence and leave G2 open. |
| **T3 — Race and complete mobile flows** | Game/UI owner: Race readiness-gated start/countdown/resume, compact Turbo, pause/practice and recording/ghosts; Original website/local-play paths, gated portal/learning closure, settings/locales and both orientations. | **G3:** Both modes complete from direct link to retry; neither a sensor callback nor panel closure bypasses readiness. UI taps never leak into Jump. Replay equality, unchanged old ghosts, interruption eligibility, countdown preservation and fallback pass. |
| **T4 — Device qualification** | Validation owner: automated failure/compatibility suites and sustained physical play on target devices, with comparative joystick evidence for comfort/accuracy and full-viewport performance. | **G4:** Required matrix below passes with device/build receipts; resolved tuning is committed. No skipped device test is represented as passed. |
| **T5 — Candidate and release** | Release owner: explicit flag builds, candidate HTTPS header/browser checks, reviewable change and release evidence, approved activation, production readback and rollback verification. | **G5:** Approval authorizes activation; exact deployed candidate and post-deploy flow are verified. Original-only or emulation-only delivery is partial. |

**Planning boundary:** Review this plan before feature implementation. This request authorizes the plan and its documentation links; implementation and production activation require a subsequent instruction. Physical/browser acceptance is an additional release gate, not something planning checks can satisfy.

## 6. Validation and success measures

### Automated acceptance

- Extend `packages/net/test/tilt.test.ts`, `packages/net/test/sources.test.ts`, `apps/web/test/mobile-input.test.ts`, `apps/web/test/machine.test.ts`, `mobile-play.e2e.test.ts`, Race session/driver/recording tests and Original input-recording tests. Add `apps/web/test/mobile-motion.test.ts` for the adapter state machine and mocked browser environment; add focused Original session coverage for driver conversion and countdown timing if the current unit harness cannot exercise those boundaries.
- Cover permission method present/absent, granted/denied/rejected, known policy denial, API absent, null/NaN/Infinity, first-data timeout, valid zeros, frozen orientation with a live companion, hidden-page timeout suspension, simultaneous retries, and navigation/fallback before a permission promise resolves.
- Verify screen angles 0/90/180/270, natural-landscape configurations, wrap boundaries, recenter and camera yaw. Test stillness and deliberate steady steering independently of event-count thresholds.
- Exercise real browser touch injection for the playfield and Turbo/Pause, with synthetic sensor input explicitly labeled. Assert one Jump pulse per eligible contact, retention through zero-tick frames, no replay at Go/resume/landing, and no action from overlay dismissal. Test `pointerdown → pointerup → lostpointercapture` before any tick: exactly one Jump survives. Separately test active `pointercancel` / unexpected capture loss: no pending Jump survives. Cancellation of a later contact cannot delete an earlier completed tap; consumed jumps are not rewound. Verify no duplicate click action.
- At every Original/Race start/resume boundary, keep tilt in each non-ready state and assert no countdown, tutorial, playable physics or game-timer advancement. Complete an obsolete permission/intro/load promise after fallback/retry/navigation and assert it cannot arm or resume the new attempt. A current `ready` notification alone cannot resume an interrupted run; healthy panel closure can resume only through its explicit intent and released-contact gate.
- Begin Original with `?physics=worker`, load a keyboard-driven stage, then choose tilt from settings. Keeping current controls leaves the old attempt paused and unchanged; accepting restart yields an actual lockstep instance, a fresh recording and existing retry score semantics. Repeat with worker creation pending: its late resolution is disposed and cannot overwrite the replacement. Verify a tilt tap remains one recorded tick, and fallback/keyboard switching does not replace lockstep mid-attempt.
- Pause Original partway through each 0.6-second countdown beat, lose/recheck tilt and resume. Assert the displayed beat, fractional remainder, tick-sound count and single Go transition; no time elapses during the interruption. Race retains its remaining countdown and practice status. Retry resets countdown, readiness is required at Go, and pre-Go taps never replay.
- Test viewports 360×640, 390×844, corresponding short landscapes and tablet size; canvas uses the full available container in tilt mode, joystick fallback restores its deck, and notches/home indicator/browser keyboard do not hide essential actions.
- Run old recordings and new tilt-driven recordings through unchanged simulation; compare tick counts, score/outcome, Race eligibility and save/reload/ghost compatibility. Test a new saved attempt with the prior rollback build.
- For implementation, run focused tests, `pnpm check`, the explicitly enabled browser suites and candidate production builds. Report skipped tests. Check `pnpm docent:index --check` when required; plans are outside the current corpus roots, so this planning-only change needs no corpus regeneration.

### Physical matrix and evidence

Required devices: an iPhone running Safari, an Android phone running Chrome, and a sensor-unavailable or sensor-blocked touch configuration. An iPad Safari smoke is required before claiming tablet support; hybrid coverage verifies that keyboard preference remains usable.

On each supported phone, verify a fresh permission grant, denial/recovery, returning visit, portrait and both landscape directions, both OS rotation-lock settings, natural grip calibration, four steering directions, neutral stopping behavior, tilt plus tap Jump, Race Turbo, all panels, fallback, source switching and retry. Include lock/unlock, tab/app switching, incoming interruption, 90/180-degree rotation, paused countdown and held contact during resume.

Play at least 15 minutes across Original and Race, including a narrow bridge, fall/respawn and a stunt course. Compare neutral jitter, overshoot, tilt comfort, tap-induced phone movement, response and fatigue against the current joystick. Hold both neutral and nonzero steering still for at least 30 seconds to expose a false watchdog. Simulate or reproduce a stream interruption and verify neutral/pause within the T0 health budget. Performance measurement must include the larger portrait canvas area, frame pacing and thermal behavior, using existing renderer budgets.

Receipts belong in a proposed `docs/launch/evidence/mobile-tilt/` folder and identify date, device, OS/browser version, source/build identity, flags, permission/policy conditions, orientation, selected tuning, scenario, result and limitations. Raw sensor traces, if needed for debugging, stay local/temporary and are not automatically committed. Browser emulation verifies software/layout; it does not certify sensor accuracy or Safari permission behavior.

**Release success:** Both target phones complete an Original and Race run with tilt and tap Jump; tilt mode reserves no control deck; fallback completes a run after denied/unavailable sensors; there are no duplicate/lost/late Jump actions, reversed axes, stuck steering or silent resumes; existing paired/desktop inputs and saved ghosts pass regression checks. T0's interruption budget and existing mobile rendering targets must be met on the qualified devices.

## 7. Rollout and rollback

Add `VITE_MOBILE_TILT_ENABLED`, requiring explicit `true` for candidate activation. Existing `VITE_MOBILE_CONTROLS_ENABLED` remains the outer gate and `VITE_RACE_ENABLED` remains independent.

| Mobile controls | Tilt controls | Local mobile behavior |
| --- | --- | --- |
| Off | Either | Existing feature-disabled behavior; no motion prompt/listeners |
| On | Off | Current joystick behavior; no motion prompt/listeners |
| On | On | Tilt default after setup, explicit joystick fallback/preference |

Race on/off combinations must be checked too. Turning tilt off ignores motion settings for source selection and immediately yields the joystick experience on the next loaded build; legacy input preference/save formats remain readable. These are build-time switches: rollback requires a rebuild/deploy, not a live settings toggle.

1. Implement and review behind the opt-in tilt flag; the existing joystick build is the comparison/rollback baseline.
2. Build a candidate with mobile, tilt and Race explicitly enabled. Test actual HTTPS routes and both response-header paths at top level; embedded previews may have different permission behavior. Keep existing self-origin sensor allowances and the magnetometer deny rule.
3. Complete G0–G4 and archive the candidate's identity/flags and physical receipts. Present the concrete candidate for activation approval. Do not treat a merge as deployment.
4. After authorized deployment, read back the exact build and verify Original/Race setup, full-viewport play, denied/unavailable warning, joystick fallback and returning preference behavior.
5. Roll back the tilt flag and redeploy if permission/setup blocks entry, axes reverse, watchdogs interrupt still play, taps repeat/leak, recordings diverge or larger-canvas performance fails existing budgets. Read back the rollback and smoke saved attempts plus joystick. Do not disable all mobile controls just to disable tilt.

## 8. Decisions still requiring evidence

- T0 must establish browser-specific health detection and its limits. A fixed orientation timeout is insufficient evidence.
- Physical playtests must choose comfortable gain/dead-zone/filter defaults and calibration capture bounds; the existing paired-phone limits constrain output but do not establish same-device comfort.
- Larger portrait rendering and tap-induced grip movement may offset the visibility benefit. Qualify them before making tilt the production default; the explicit joystick option remains available after release.

The product choice is settled: tilt is the intended default and joystick is an optional fallback. These open items determine whether the implementation is ready to activate.
