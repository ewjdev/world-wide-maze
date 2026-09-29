# Mobile browser game: build log

Running log for [`plans/mobile-browser-game-execution.md`](../../plans/mobile-browser-game-execution.md). Evidence is labelled by kind: **source** (read in the checkout), **local** (run on this machine), **emulated** (mobile Chromium emulation), **device** (physical phone), **production**. Only source, local and emulated evidence exists so far. No physical device has been used, and nothing is deployed.

Status by gate:

| Gate | State |
| --- | --- |
| G0 baseline and contract | Source audit and interface freeze recorded below. Screenshots, device inventory and measured baselines are **pending**. |
| G1 reliable touch input | Implemented and unit/session tested. |
| G2 playable slice | Implemented and passes the emulated real-touch run. Physical G2 is **open** (no device used), so this slice is browser-qualified only. |
| G3, G4, G5 | Not started, apart from the pieces noted under "Landed early". |

## M0: route and state audit (source, 2026-09-29)

| Entry | Before this work | Now |
| --- | --- | --- |
| `/` | Title → (first run) how-to → **pairing** → select. Only a keyboard fallback avoided pairing. | On a coarse-pointer touch device (flag on): Start → how-to (touch copy) → select. No room, no calibration. |
| `/play/:stageId` | Deep link defaults to keyboard input. | Deep link picks touch when the device prefers it (capability + preference). |
| `/play/local`, `/p/:code` | Keyboard default / host joins a room. | Same default rule as deep links. `/p/:code` still creates a room. |
| `/race`, `/race/:courseId` | Keyboard or paired phone. | Touch is the default input on a touch-preferring device; "Use touch controls" on hybrids. |
| `/c/:code` | Separate phone controller. | Unchanged, still supported. |

Restricted-service behaviour (`?offline=1`, dynamic services off) is unchanged: bundled practice loads from fixtures, and touch adds no network calls (asserted by the e2e).

Screenshots of first visit, returning visit, direct links and restricted mode are **pending**.

## M0: frozen interface contract

Recorded here so later gates change them deliberately.

- **Feature switch:** `VITE_MOBILE_CONTROLS_ENABLED` (`apps/web/src/input/flags.ts`). Production requires an explicit `true`. Development defaults on unless `false`. Independent of `VITE_RACE_ENABLED`. It guards touch source creation, auto-selection, saved preference restoration, the CTA and the controls together. `pnpm check` covers the flag matrix in `apps/web/test/mobile-input.test.ts`.
- **Selection:** `preferTouch()` (`input/capability.ts`): flag on, touch points > 0, and either a coarse primary pointer or a saved `wwm.input.v1 = touch`. A saved `keyboard` choice wins on hybrids. Never viewport width or user agent.
- **Input ownership:** `TouchInputSource` (`@wwm/net`) owns pointers (one per control, capture, lost-capture/cancel release, unrelated releases ignored). `peek()` never changes state; `sample()` consumes the pending Jump and is called only from the fixed-step input callback (Original `#stepInput`, Race `advance` callback). `reset()` releases everything and ignores old contacts until they lift; `clearPending()` drops a press and suppresses a held Jump until re-pressed (used outside `play`/`racing`).
- **Driver:** touch forces the lockstep driver before stage creation (`Game.#setInputMode`, `#ensureDriver`). The optional worker driver keeps its old semantics for non-touch use; worker touch support is deferred, not claimed.
- **Stick:** adaptive origin by default (base follows the first contact up to 0.6 × radius from home; deflection is measured from the first contact, so no jump from an off-centre press), fixed origin selectable, radius/geometry read once per gesture, dead zone 0.12 unchanged, sensitivity bounded to 0.5–1.5. Initial sizes: 120 px stick, 220 px activation zone, 72 px Jump (tuning candidates, not validated).
- **Container measurement:** `observeSize` (`input/layout.ts`) owns engine sizing in both sessions: one callback per animation frame, skips unchanged and zero sizes, keeps the last positive size, and a collapsed host releases input and pauses. Orientation is `screen.orientation` (fallback: the layout-orientation media query), separate from resize.
- **Interruption policy (Race):** pause, focus loss and orientation-change pause keep the existing practice reasons (no replay/rules version change). A paused countdown resumes its countdown; racing resumes racing. Retry clears the mark. Touch pause copy: "This run is now practice. Restart to set a personal best."
- **Recordings:** unchanged formats. Race attempts gain `inputSource: 'touch'` (additive; the validator accepts it).
- **Telemetry:** not extended. The client reports touch as `unknown` until the client and server schemas change together (M5), so the server never sees an event it would reject.
- **Yaw convention:** unchanged; touch uses the same camera-relative `frameYaw` as keyboard. A directional device check is pending G4.

## Landed

- Hardened touch source and bound controls, with unit tests for peek/consume, held-vs-tap edges, coalescing, reset, dead zone, sensitivity, pointer theft, lost capture and dispose/remount (`packages/net/test/sources.test.ts`).
- Both sessions wired: Original (`game.ts`, machine `HOWTO_DONE{ready}`, `playOnDevice`) and Race (`session.ts`).
- Race session tests for zero-step frames, held/released Jump, 30/60/120/144 Hz render schedules, a press held into the countdown, pause releasing contacts, paused-countdown resume and practice/retry eligibility (`apps/web/test/race-session.test.ts`).
- Shared `TouchControls` (stick, Jump, contextual Turbo, top Pause) with a reserved portrait control deck and safe-area insets.
- Emulated real-touch E2E: `apps/web/test/mobile-play.e2e.test.ts`.

## Findings from the emulated run (emulated, mobile Chromium 390×844 and 844×390)

Screenshots were inspected by eye. They are layout evidence only, not iOS Safari or Android Chrome.

- The fixed "Online services are resting" notice (`main.tsx`) sat exactly on the Jump button, and `elementFromPoint` proved it swallowed the touch. On touch devices it now sits at the top, drops the "keyboard controls" wording, and is hidden while the touch controls are on screen.
- Pause at top-centre collided with the TIME digits and LIFE in portrait, and with the Race title. In portrait it now sits in the control deck above the right thumb. In landscape it stays top-centre (Race: beside the sound button, above the Race header).
- Turbo overlapped the stick ring when placed beside Jump, so it now stacks above Jump.
- The base `.wwm-stage-host` rule sets `height: 100%`, which beat `bottom`, so the portrait deck was ignored until the touch rule set `height: auto`.
- CDP `Input.dispatchTouchEvent` `touchEnd` ends exactly the points listed, not the remaining ones. The e2e helper is written for that.

## Landed early from later milestones

- The container observer and orientation pause (M3 §3).
- Paused-countdown restoration (M3 §7).
- Touch tutorial strings and the how-to copy (partial M3 §3).

## Not done yet

M0 screenshots, device inventory and baselines; settings (handedness, size, sensitivity UI, fixed/adaptive toggle) with persistence; panel ownership beyond releasing input; broader overlay/result/name-entry coverage; audio/renderer-loss handling; fullscreen and wake lock; accessibility review; physical-device qualification (G4); release wiring, four-way flag build matrix and rollback rehearsal (G5).
