# First-class mobile browser game — execution plan

**Date:** 2026-09-29

**Status:** Planned; implementation and device acceptance have not started.

**Outcome:** A player opens WWM on a phone, chooses a maze or race, learns the controls, completes a run, and plays again using that device alone.

This is the canonical plan for same-device mobile play. It extends the existing game identity and mechanics. Its mobile entry and orientation decisions supersede the older pairing-first and portrait-lock assumptions for same-device play only. The separate `/c/:code` phone controller remains a supported experience.

## 1. Product contract

### Release scope

- Original/website mazes, bundled practice, and Race, including stunt courses with Turbo.
- Every player-facing step: entry, catalog, loading/error recovery, instructions, countdown, gameplay, pause/map, learning and portal panels, results, retry, next stage, and return navigation.
- Direct links work on a phone without keyboard events, QR scanning, pairing, motion permission, installation, or fullscreen permission.
- Both portrait and landscape are playable. Landscape may be suggested once, but rotation is never a gate. This is a planning default because the orientation question remains unanswered.
- iOS Safari and Android Chrome are required physical-device targets. Add tablet/hybrid layouts to automated coverage and perform an iPad touch smoke before claiming tablet support.
- Desktop keyboard, gamepad, paired-phone control, deterministic recordings, race eligibility, and existing saved progress remain compatible.
- The complete production release includes both Original and Race. Race retains its independent release gate; enabling mobile controls does not implicitly enable Race. If Race cannot meet its existing release requirements, an Original-only rollout must be labeled partial and cannot close G5 for this plan.

### Interaction and appearance

- Left thumb: analog stick with a visible home position and a generous activation region. On press, its origin may shift a bounded distance toward the thumb; hold that origin fixed throughout the gesture. No initial acceleration from an off-center first contact. A fixed-origin option is available in control settings.
- Right thumb: labeled Jump; contextual Turbo only in race modes that provide it. No separate Power button: stick deflection beyond the dead zone engages Power. Release removes steering input; normal momentum remains.
- Initial tuning candidates: 110–130 CSS px stick footprint, 64–72 px Jump, at least 48 px other primary action targets, and the existing 0.12 radial dead zone. Validate these rather than treating them as universal constants.
- Preserve fog-white surfaces, ink text, teal input feedback, yellow Jump, Figtree/Unbounded typography, and cut-corner action plates. The stick remains round because its motion is radial. Provide readable labels and pressed/disabled states; do not rely on hue alone.
- Keep the ball and immediate route visible between the thumbs. In portrait, reserve a lower control region and fit the game view above it; in landscape, use corner zones and verify the camera keeps the route clear. Do not merely cover the existing camera view with translucent buttons.
- Compress the HUD at the top, move Pause out of thumb zones, and replace keyboard instructions with a short touch tutorial. Controls remain discoverable at rest.
- Control settings include handedness swap, fixed/adaptive stick origin, bounded sensitivity, and a larger-control preset. Persist defensively; storage failure must not prevent play.

### Deferred

Same-device gyro steering, new physics or automatic braking, multiplayer, service workers/offline installation, a PWA install campaign, mandatory fullscreen/orientation lock, and new analytics providers. Existing bundled practice under service restrictions remains in scope; that is not a promise of offline loading. Desktop-only capture tooling should be explained honestly and offer a mobile-playable alternative, not be ported in this feature.

## 2. Verified starting point and implementation map

Inspected in the local checkout on 2026-09-29; these are source findings, not production verification.

| Area | Current evidence | Planned ownership |
| --- | --- | --- |
| Touch input | `packages/net/src/sources/touch.ts` already supplies analog tilt, automatic Power, a latched Jump, and basic pointer binding; `packages/net/test/sources.test.ts` covers basic behavior | Input engineering: harden this source and its tests; avoid a second independent joystick engine |
| Input timing | Touch `sample()` clears the Jump latch; both game sessions sample before `LockstepDriver.advance()`, which can execute zero or multiple simulation ticks in a render frame | Input/game engineering: separate presentation reads from tick consumption and retain presses through zero-step frames |
| Original integration | `apps/web/src/game/game.ts` samples keyboard/gamepad/phone; `InputMode` lacks touch. `game/machine.ts` routes first-run how-to into pairing | Game engineering: input selection, lifecycle, state transitions, deep links, tutorial and recording compatibility |
| Race integration | `apps/web/src/race/session.ts` has its own input selection, lifecycle, Turbo request, and recording path | Game engineering: integrate the same touch source while keeping Race's session separate |
| Presentation | `ui/Screens.tsx`, `ui/Play.tsx`, `ui/game.css`, `race/RacePage.tsx`, and `race/race.css` own entry and HUD layouts | UI engineering: shared controls under a proposed `apps/web/src/input/` directory; mode-specific layout adapters |
| Overlays | `learning/gates.ts` source union excludes touch; `LearningGateCard.tsx` distinguishes phone from other input | Game/UI engineering: native tap interactions and explicit input ownership while panels are open |
| Attribution | `telemetry/observe-game.ts` and `packages/schema/src/telemetry.ts` do not represent touch selection | Integration owner: additive source typing and validation; preserve telemetry opt-out and disabled defaults |
| Rendering | `packages/engine/src/quality.ts` already contains adaptive quality and pixel-ratio limits | Performance owner: measure first; reuse the ladder, change camera/rendering only for demonstrated mobile requirements |
| Viewport | `apps/web/index.html` already declares `viewport-fit=cover`; both sessions listen to window resize, and `engine.resize(w, h)` updates the backing size and camera aspect | UI engineering: one shared container measurement/observer contract; control-size changes must resize gameplay even without a window event |
| Race interruptions | `race/session.ts` marks every accepted pause as practice and resumes directly into racing; `packages/race/src/attempt.ts` excludes attempts with practice reasons from personal bests | Game engineering: preserve eligibility rules, explain the consequence, and retain countdown state across pause/resume |
| Release flags | `race/flags.ts` requires `VITE_RACE_ENABLED=true` outside development; `.github/workflows/ci.yml` sets it for previews but not in its production build step | Release engineering: explicit mobile/Race flag matrix and production build wiring; preview success alone cannot establish production availability |
| Verification | Vitest, Playwright E2E, `infra/perf/`, replay fixtures, and `pnpm dev:phone` exist | QA/performance owner: extend harnesses and add a device receipt; emulator results do not certify phones |

Owners below are responsibilities, not authorization to launch parallel agents. One engineer can execute them in order. Coordinate shared schema/contracts through the integration owner, as required by the master plan.

## 3. Architecture contracts

### Input has separate presentation and simulation consumers

Extend the existing touch source with a non-consuming `peek()` for presentation/ownership checks and a consuming `sample()` used only from an eligible simulation input callback. Method names are proposed; the separation and consumption boundary are required. A DOM press records held state and one pending Jump. Reading the thumb position, checking source activity, or rendering a frame never acknowledges that pending press.

- Original consumes touch in `Game.#stepInput()` through the existing `#inputForStep` callback; Race consumes it inside its `#driver.advance()` input callback. Keep per-frame reads non-consuming. Do not consume a Jump while the tutorial disables Jump or a panel owns input; clear it when ownership changes, so it cannot become a delayed action after the panel/tutorial transition.
- The first eligible fixed tick consumes the pending Jump and records exactly the sample sent to physics. Subsequent catch-up ticks use current held state; releasing produces false, while a held finger remains true without new rising edges. Multiple complete taps before consumption coalesce into one pending action, matching the existing single-latch semantics rather than introducing a delayed jump queue.
- A zero-step render frame leaves the latch pending. Turbo retains its existing tick-consumed Race request path. Cancellation/phase changes clear both pending and held state; UI reads and recorded samples cannot disagree about an already-cleared action.
- Same-device touch uses the existing default lockstep driver. The optional Original worker driver supplies latest input per render update and cannot offer this tick-acknowledged guarantee; keep it available for existing non-touch/debug use, and make touch select lockstep before stage creation. Worker touch support is deferred, not silently claimed.
- Test 30/60/120/144 Hz render schedules against 120 Hz physics, including a short tap on a zero-step frame, multiple catch-up ticks, held/released Jump, ownership changes before consumption, and touch-recording replay. These are session/driver integration tests as well as touch-source unit tests.

### One layout owner measures the gameplay container

Add a shared layout hook/component under the proposed `apps/web/src/input/` surface, consumed by `ui/GameApp.tsx` and `race/RacePage.tsx`. It owns safe areas, control-region size, handedness, and visible viewport changes. It lays out the actual `.wwm-stage-host` above the portrait control region; the engine continues to fill that container. Use existing `engine.resize(w, h)` and camera aspect handling first, without introducing a second camera-projection API.

Observe the gameplay container with `ResizeObserver`, coalesce changed dimensions once per animation frame, and notify the owning game session to resize its engine. Window/visual viewport events update layout but are not independent competing engine-size writers. Initial mount, orientation, browser chrome, text/control-size settings, and portrait/landscape transitions all use this path. Skip unchanged or zero dimensions, retain the last positive engine size during transient collapse, and disconnect observers/cancel scheduled work on teardown. A full gameplay-host collapse releases input and pauses until the host is usable; it never sends zero dimensions to the engine.

Before changing active control geometry, cancel existing gestures and require new contacts. Ordinary positive-size browser-toolbar changes relayout and neutralize affected controls without pausing or marking a race as practice. A real orientation change pauses explicitly. Detect orientation independently of viewport height/aspect fluctuations, using screen orientation where available and a layout-orientation fallback; keyboard/visual viewport resizing alone is not an orientation signal. G3 verifies the behavior in automated layout tests; G4 must confirm the distinction on real mobile browser chrome.

### Interruption policy preserves competition rules

In Race, explicit pause, background/focus loss, and orientation-change pause retain the existing practice consequence. They make the current attempt ineligible for a personal best; they do not erase an existing best or history. Use the existing practice reasons rather than changing replay/rules versions for an orientation label. Explain in the pause UI: “This run is now practice. Restart to set a personal best.” Show a brief orientation suggestion on the ready screen, before a run starts.

Store the pre-pause Race phase and remaining countdown in session memory. Resuming a paused countdown restores its remaining countdown; resuming racing restores racing. Freeze simulation/timer/countdown while paused and require released controls before re-arming. Preserve the existing practice marking even when the interruption occurs during countdown. Retry starts a fresh attempt and clears the interruption metadata. Do not reuse the current unconditional `resume() → racing` transition for the new flow. Original retains its existing pause/scoring policy; do not apply Race's practice rule to it.

## 4. Delivery sequence

| Phase | Owner | Depends on | Reviewable output and exit gate |
| --- | --- | --- | --- |
| M0 — Baseline and contract | Integration + design + QA | None | Route/state audit, measured baseline, device inventory, control and viewport contract; G0 |
| M1 — Reliable touch input | Input engineering | M0 | Hardened input source, tick-consumption contract, shared feature switch, and isolated interaction harness; G1 |
| M2 — Playable vertical slice | Game + UI engineering | M1 | Shared controls wired into Original and Race, same-device entry and one full run per mode; G2 |
| M3 — Complete mobile experience | UI + game engineering | M2 | All screens, overlays, settings, audio, and lifecycle polished in both orientations; G3 |
| M4 — Device qualification | QA + performance engineering; Eric or another available device operator | M3 | Automated suite, real-device playtests, sustained-performance evidence; G4 |
| M5 — Release and readback | Integration/release owner | M4 | Exact candidate CI, production deploy/smoke, physical production smoke, rollback receipt; G5 |

Do not begin with a broad visual redesign. The first milestone worth demonstrating is one naturally played maze and one naturally played race on a phone, with working pause/retry.

### M0 — Inventory and freeze the contract

1. Recheck checkout status and current deployment separately. Use an isolated managed worktree for implementation if the checkout is shared or contains unrelated work. Preserve all unrelated changes.
2. Audit `/`, `/play/:stageId`, `/race`, `/race/:courseId`, practice, and the separate controller route. Record screenshots and blockers for first visit, returning visit, direct links, and restricted-service mode. Inspect existing source and live preview; older screenshots are references only.
3. Name the supported physical devices with model, OS/browser versions, screen size, and refresh rate: a smaller/older supported iPhone, a current iPhone, and a midrange Android. Device access is a required M4 dependency; it does not block coding.
4. Capture baseline startup, frame timing, input handling, memory where available, audio, and context-loss behavior with fixed fixtures and renderer settings. Record commit/build hashes and actual renderer backend.
5. Record implementation interfaces for the architecture contracts above: pointer ownership, non-consuming reads/tick consumption, cancellation, source switching, measured gameplay container, interruption policy, and settings defaults. Freeze the performance targets below. Confirm the existing physics yaw convention in both modes with a directional test.
6. Produce portrait/landscape control previews in the incumbent visual style. Validate ball/route visibility and text expansion before broad UI edits.

**G0:** Source map and implementation tasks are concrete; unknown device/performance evidence is explicitly pending. No unresolved design choice prevents the first slice. Numerical targets remain proposed until baseline review; any change is recorded with its reason.

### M1 — Make the input source dependable

1. Extend `TouchInputSource` with explicit reset/release semantics. Reset analog axes, held and latched Jump, and pending actions on cancellation, capture loss, disposal, route exit, pause, focus/visibility loss, and disruptive viewport/orientation changes.
2. Track one pointer per control. A second contact cannot steal the steering pointer; Jump/Turbo contacts cannot move the stick. Capture valid active pointers and recover safely when capture is unavailable or lost. Ignore unrelated releases.
3. Implement bounded origin placement, radial clamping, dead zone, and sensitivity. Read/cache geometry at gesture start and recompute after layout changes; avoid layout reads on every pointer move. Neutralize an active gesture before changing its geometry.
4. Implement the presentation/tick-consumption contract above. A quick Jump survives render frames with no simulation tick and is acknowledged only by an eligible fixed-step consumer; a held finger must not create extra rising edges. Turbo is an explicit race action routed through the current request/recording path, not overloaded onto Power or Jump.
5. Keep sampled values outside React render state. Update the visual thumb at most once per animation frame; do not add a broad game-store publication for every pointer move. Do not add a remote controller room, sensor subscription, or network hop for local input.
6. Define a single active input owner. Touch is selected by capability plus explicit preference, not viewport width or user-agent string alone. Preserve existing non-touch arbitration; switch into/out of touch at a neutral boundary or explicit paused selection, never by mixing vectors or held buttons from two sources.
7. Scope `touch-action`/selection suppression to gameplay controls. Keep menu scrolling and browser accessibility behavior usable. Use native buttons for actions and expose meaningful names and instructions.
8. Create the shared build-time `VITE_MOBILE_CONTROLS_ENABLED` switch in a proposed `apps/web/src/input/flags.ts`. Use the existing Race flag convention: development defaults on unless explicitly false; production builds require explicit true. Guard local-touch entry, auto-selection, and controls together. Saved touch preferences cannot bypass a disabled flag. Add tests for all mobile/Race flag combinations defined in M5; do not change the existing Race flag implicitly.

**G1:** Tests prove diagonal normalization, dead zone, camera-relative direction, two/three-finger use, quick taps surviving zero-step frames, catch-up/held-button behavior, pointer theft rejection, cancellation, teardown/remount, and source-switch release. Reset yields neutral input at the next eligible sample, with no latent Jump/Turbo. Non-consuming reads never clear pending actions. Flag-off preferences cannot activate touch. The interaction harness uses actual DOM pointer handlers; M2 adds both real session adapters.

### M2 — Deliver the first complete playable slice

1. Add touch as a real local mode to Original and Race views, selection, source attribution, and sampling. Wire non-consuming frame reads and consuming lockstep callbacks exactly as specified above; use the same consumed input for recording. Reuse existing `InputSample`/`RaceInputSample` semantics; preserve simulation and recording formats unless a separately reviewed compatibility requirement is discovered.
2. Add a shared touch control component with thin Original/Race adapters: steering, Jump, pause, and optional Turbo availability/charge. Gameplay phase determines enabled controls; countdown may show them, but it cannot accumulate a surprise action for Go.
3. Make “Play on this device” the primary phone path. First-run instructions, returning play, and direct links all reach touch gameplay without creating a relay room or waiting for calibration. Pairing remains an explicit alternative. Verify no room traffic occurs merely from choosing local play.
4. Integrate one bundled maze and one baseline race from entry through results, retry, and return. Validate audio unlock on the initiating gesture and respect mute.
5. Add automated touch runs that exercise the real UI path and session tests for zero-step/catch-up frames. Use deterministic solver/replay fixtures separately for physics equivalence; injected simulation samples are not evidence that the touch UI works. Verify touch selects lockstep even when a debug worker preference was present.

**G2:** An available physical phone completes a basic maze and race through the UI with simultaneous steer/Jump, pause/resume, and retry. If no device is available, label the slice browser-qualified only and keep physical G2 open. Desktop and paired-controller smoke checks still pass.

### M3 — Complete the mobile product

1. Implement the shared gameplay-container layout/observer contract above for browser chrome, notches, home indicators, short landscape heights, tablets, and larger text. Route both sessions' resizing through the measured container and existing engine API. Verify control-size/handedness changes without dispatching a window resize, zero-size transitions, and observer teardown. Keep camera framing, canvas dimensions, and input axes consistent after changes.
2. Reserve portrait control space and verify landscape thumb zones against easy mazes, narrow bridges, moving platforms, portals, dense learning stages, downhill courses, and stunt jumps. Keep the ball and next decision visible without manual camera work. No physics or route difficulty changes to hide control problems.
3. Complete touch instructions and contextual hints in supported locales. Teach steering first, Jump when needed, then Turbo in applicable courses. Show one concise hint at a time and dismiss after demonstrated use. Track touch onboarding separately from a previously completed keyboard tutorial.
4. Cover select/catalog, progress/loading, capture unavailable, unsupported rendering, error/retry, pause/map, result/ranking/name entry, next-stage, exhausted lives, and navigation. Handle the onscreen keyboard without covering inputs. Do not trap browser Back or falsely promise suspended-run recovery after a reload.
5. Establish exclusive panel ownership: learning cards, portal choices, confirmation dialogs, and menus release gameplay input immediately and prevent click-through. Prefer their native tap controls; do not translate one tap into both a panel selection and a Jump. Re-arm gameplay only after old contacts are released. Extend source unions and analytics classification consistently where touch is carried through.
6. Add handedness, origin mode, size, and sensitivity preferences with reset-to-defaults. Avoid storing raw pointer traces. Handle unavailable storage and malformed/older preference values without losing existing progress or ghosts.
7. Implement the interruption policy above: distinguish relayout from pause, show Race's practice consequence, and preserve the paused phase/countdown rather than skipping to racing. On backgrounding, screen lock, focus loss, or orientation change, release input and resume explicitly with fresh gestures. Handle audio suspension and renderer loss using recovery or a clear retry screen; do not silently advance a run or erase saved results. Browser reload starts/reloads according to existing persistence guarantees, not invented mid-run saving.
8. Fullscreen and wake-lock enhancements are optional, feature-detected, user-initiated where required, and failure-tolerant. Base play must pass with both unavailable. Do not request motion permission for joystick play.
9. Provide visible focus, readable labels/contrast, non-color Turbo readiness, reduced-motion feedback, and large touch targets. Screen-reader test menus/settings/results; do not imply the spatial game is fully nonvisual-accessible. Preserve keyboard alternatives on hybrid devices.

**G3:** Every required state is reachable and escapable with touch in portrait and landscape; no HUD/control collisions, clipped essential content, keyboard-only instructions, hidden action dependencies, or stuck controls. Container-only changes resize correctly, ordinary toolbar resizing does not mark practice, orientation pause does, countdown resumes without skipping, and retry restores eligibility. Two complete automated flow runs and one bounded visual review across the layout matrix pass before device qualification. Real-browser-chrome confirmation remains explicitly pending until G4 if no device was available at this phase.

### M4 — Qualify interaction, performance, and compatibility

#### Automated evidence

- Extend `packages/net/test/sources.test.ts`, game-machine/input tests, Race session/driver tests, learning interactions, and telemetry schema tests. Validate semantics at their boundaries rather than snapshotting implementation details.
- Add a mobile browser suite, proposed `apps/web/test/mobile-play.e2e.test.ts`, covering first visit, direct link, both modes, concurrent contacts, cancel/blur, pause, rotation, modal ownership, Turbo, results, retry, stored preferences, and unavailable storage. Include control-size changes without a window event, observer disposal, toolbar-resize versus orientation behavior, paused-countdown restoration, and Race practice/personal-best eligibility after interruption/retry.
- Separate real browser touch input from synthetic DOM event dispatch in reports. Use actual browser touch injection where supported; use synthetic dispatch for cancellation/ownership cases and label it. Neither substitutes for physical-device testing.
- Exercise Chromium and WebKit browser automation where the local renderer is supported; report backend/support limitations explicitly. Test CSS viewports around 360×640, 390×844, their landscape equivalents, and tablet size. Viewport emulation is layout evidence, not iOS Safari certification.
- Run existing deterministic recordings through the unchanged simulation and compare tick counts, outcomes, scores, race eligibility, and saved/reloaded ghost compatibility. Also record and replay a touch-driven attempt.
- Regression smoke: desktop keyboard, gamepad, paired phone, portal travel, learning rounds, static practice with dynamic services disabled, slow/failed stage loads, and no unintended room/API requests from touch controls.
- Run `pnpm check`, `pnpm docent:index --check`, and explicit production-mode builds for all four flag combinations below using the existing `pnpm --filter @wwm/web build` command. For the full mobile candidate, use `VITE_MOBILE_CONTROLS_ENABLED=true VITE_RACE_ENABLED=true pnpm --filter @wwm/web build`. Archive each build's flag values/artifact identity and smoke that artifact before the next build replaces it. Run relevant opt-in browser suites with their configured base URLs; report executed/skipped counts, because a green default test command can omit E2E coverage. The new mobile suite must have an explicit CI invocation before release, including a both-flags-on production-build smoke.

#### Physical-device script

On each named required device, run a production build over HTTPS in the normal browser, both orientations, with browser chrome visible. Record build SHA, device/browser/OS, backend, quality tier, stage hashes, network, duration, and pass/fail notes.

1. Fresh visit → choose local play → learn steering → complete an easy maze → results → retry/next. No desktop assistance or pairing.
2. Navigate a narrow path; steer while jumping; deliberately drag beyond the stick bounds; release fingers in different orders. Exercise Turbo while steering and verify charge/use feedback.
3. Pause/resume, switch apps while holding controls, lock/unlock, rotate during a gesture and countdown, open a learning/portal panel, and return. No phantom actions or unnoticed timer/countdown advancement during pause. Confirm Race shows practice/ineligibility after a true interruption, preserves existing bests, and offers a fresh eligible retry. Expand/collapse browser chrome separately: relayout must not count as an orientation pause.
4. Exercise normal browser Back, a name field/onscreen keyboard, large text, mute/audio recovery, permission denial for optional features, and failed/slow loading. Recover to another playable stage.
5. Run representative maze and stunt/race content continuously for 15 minutes, then repeat entry/retry/navigation ten times. Observe thermal degradation, memory/resource retention where inspectable, sound, battery conditions, crashes, and context loss. Battery observations are not a quantified energy claim.
6. Have five first-time players attempt the short onboarding without verbal coaching. Proposed usability gate: at least four can steer, jump, and finish the introductory task within two minutes; record all failures. Separately test narrow-path precision with experienced players. Small-sample results guide tuning, not population-wide claims.

#### Proposed performance budgets — freeze at G0

| Measure | Initial acceptance target | Measurement boundary |
| --- | --- | --- |
| Input correctness | Latest touch state consumed on the next eligible simulation tick; no dropped latched press or action after reset | Instrument dispatch/sample times; this is not physical input-to-photon latency |
| Touch UI response | p95 handler-to-next visual-control update ≤50 ms during representative active play | Browser trace, excluding hidden intervals; report physical touch latency separately if measurable |
| Sustained play | Midrange/current devices: median ≥55 FPS, p95 frame interval ≤33.3 ms after warm-up; selected older device: median ≥30 FPS, p95 ≤50 ms on an appropriate quality tier | 15-minute runs; report worst one-minute windows, tier changes and loading stalls separately |
| Added control overhead | p95 frame time no more than 10% worse than matched baseline at identical tier/backend; no new recurring control-caused long task >50 ms | Alternating baseline/candidate runs using equivalent scripted input; new real-touch runs test end-to-end behavior separately |
| First playable content | Bundled introductory stage interactive within 8 seconds cold and 3 seconds warm at 10 Mbps/100 ms RTT in the defined lab profile | Five runs per condition; report individual/max and median; remote URL capture has a separate loading/failure UX |
| Resource stability | No retained extra engines, contexts, listeners, or active loops after ten navigation/retry cycles; no crash/context loss in sustained run | Compare stable post-cleanup samples and resource counts; report memory APIs unavailable on a device rather than inventing a heap result |

If a target fails, tune presentation/quality or fix the bottleneck, then rerun the affected gate. Do not silently weaken thresholds, change physics, or use desktop throttling as phone acceptance. A device cannot be advertised as supported merely because it loads.

**G4:** Required real devices and all behavioral gates pass; performance budgets have evidence or an explicit documented scope decision. No blocking steering, visibility, crash, persistence, or accessibility-navigation defect remains. Save receipts under `docs/launch/evidence/mobile-browser/<build-id>/` and summarize in a proposed `docs/launch/mobile-browser-acceptance.md`.

### M5 — Release with a reversible switch

The M1 switch is build-time, so changing it requires rebuilding/deploying or restoring a known artifact. It is independent of `VITE_RACE_ENABLED`. Test explicit values rather than relying on development defaults:

| Mobile controls | Race | Expected production-build behavior |
| --- | --- | --- |
| false | false | Legacy Original controls; no same-device touch CTA; Race entry/deep links unavailable |
| true | false | Same-device Original/practice play; Race still unavailable; partial mobile release only |
| false | true | Existing Race with legacy controls and existing Original; no touch CTA in either mode |
| true | true | Complete planned release: same-device Original/practice and Race, plus existing control alternatives |

1. Verify the M1 switch guards entry, capability auto-selection, saved preference restoration, and controls consistently in both modes. Confirm all four build combinations, including disabled direct links and previously saved touch preferences. Document exact build variables and artifact hashes in the release receipt.
2. Explicitly set `VITE_MOBILE_CONTROLS_ENABLED=true` and `VITE_RACE_ENABLED=true` in the qualifying preview and the intended production build configuration in `.github/workflows/ci.yml`. The checked-in production step currently omits Race enablement; do not assume preview values carry across. Complete G4 and Race's existing release requirements before the enablement change is merged/deployed. If those requirements remain open, leave production Race disabled, record any Original-only rollout as partial, and keep full G5 pending. Verify exact commit CI and the production-build artifact. Keep paid capture/AI and telemetry provider settings unchanged. An unavailable hosted preview may be replaced by a local HTTPS production build for device testing, but record the difference and keep production acceptance pending.
3. Merge/deploy through the repository release workflow when execution is authorized. Recheck live workflow configuration: checked-in deployment is conditional on `WWM_DEPLOY_ENABLED`; merge alone is not release evidence.
4. Verify the exact production build/assets, touch entry and controls in both modes, a physical-device run, legacy control smoke, and existing service/cost gates. Record deployment and smoke URLs/IDs without secrets.
5. Roll back for stuck input, broken desktop/paired control, unplayable required-device performance, saved-result corruption, or touch entry leading to a dead end. For a controls defect, rebuild/deploy with `VITE_MOBILE_CONTROLS_ENABLED=false` while preserving the last qualified Race flag. For a Race-only defect, set `VITE_RACE_ENABLED=false` independently while retaining qualified Original touch play. Alternatively restore the previous known-good artifact and document both of its flag values. When touch is disabled, provide an honest mobile-unavailable/alternative message, not a misleading local-play CTA. Preserve saved settings/results and test both independent rollback paths and re-enablement in preview.
6. Extend existing input-selection/play/completion events with `touch` only if telemetry is already enabled and permitted; coordinate client/server schema compatibility before emitting it. Do not upload pointer coordinates or create a new analytics dependency. If telemetry remains disabled, use manual release receipts rather than enabling paid services for this feature.

**G5:** Exact production revision with both flags explicitly enabled and real-device smoke in both modes are verified, both independent rollback paths are rehearsed on a preview, and the acceptance report distinguishes local, CI, emulated browser, physical-device, and production evidence. Only then describe the complete feature as shipped; an Original-only rollout cannot satisfy this gate.

## 5. PR boundaries and compatibility

1. **Input contract and reliability:** hardened touch source, proposed shared input/preference interfaces, tests, and feature switch; production remains off by default, with development behavior as specified in M1.
2. **Playable mobile slice:** shared controls, explicit touch mode in both sessions, entry/deep links, schema/source attribution, and representative E2E flows.
3. **Complete mobile flow:** layout/camera fitting, tutorial, overlays, settings, audio/lifecycle, translations, accessibility and failure recovery.
4. **Qualification and release:** fixes from device evidence, CI mobile-suite wiring, measured performance changes only as needed, acceptance documentation, and enablement.

Each PR must be independently reviewable and keep the default build usable. These are review boundaries, not permission to publish an incomplete mobile experience. Any package/API changes must update downstream consumers together. Do not wipe old onboarding keys, settings, scores, or IndexedDB stores; add a versioned touch-preference key and safe defaults. No database migration or replay-format migration is expected. If one becomes necessary, stop that change until migration and rollback are explicitly specified.

## 6. Completion checklist

- [ ] G0: baseline, ownership, device inventory, and contracts recorded.
- [ ] G1: reliable pointer ownership, reset, tick-consumed actions, and independent feature gating.
- [ ] G2: a complete same-device maze and race through touch UI.
- [ ] G3: all screens/overlays, measured-container layouts, both orientations, settings, and countdown/eligibility-aware interruption recovery.
- [ ] G4: required devices, novice playtest, performance, compatibility, and executed automation evidence.
- [ ] G5: both-flags-on production revision, physical production smoke in both modes, and independent rollback verified.

The immediate next execution step is M0 followed by M1/M2. Device access and narrow-path steering feel are the leading uncertainties; collect that evidence early rather than waiting until every screen is polished.

## References

- Local contracts: [master plan](00-overview.md), [shared contracts](contracts.md), [game integration](phase-08-game-integration.md), [controller](phase-06-controller.md), [race](phase-24-race-mode.md).
- Existing performance evidence boundaries: [controller presentation investigation](../docs/launch/performance-controller-p2.md).
- Browser implementation references: [Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events), [pointer capture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture), [CSS safe-area environment variables](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env). Recheck optional fullscreen/wake-lock support against the actual device matrix during implementation.
