# Mobile tilt UI review

Date: 2026-10-06. Scope: Original and Race tilt controls for the isolated preview candidate. Production activation remains unauthorized. Candidate identity, deployment readback and software acceptance belong in [preview.md](/Users/ewj/Desktop/projects/wwm/docs/launch/evidence/mobile-tilt/preview.md).

This is an ordinary extension of the incumbent WWM interface. It records the built controls within this evidence boundary; it does not establish a new visual world or rewrite global product/design authority. Fresh default agents substituted for the unavailable shipped finish-reviewer and documenter roles, following their degraded workflows.

## Built visual contract

- **Palette:** paper panels over the game, ink action buttons with white text, yellow selected input choice, teal calibration progress and blue keyboard focus. Enable/recheck use the existing green primary button. These roles come from [game.css](/Users/ewj/Desktop/projects/wwm/apps/web/src/ui/game.css:12) and [tilt.css](/Users/ewj/Desktop/projects/wwm/apps/web/src/input/tilt.css:30).
- **Type and shape:** Unbounded headings and Figtree interface text retain the game identity. The compact actions use bold 14px labels and cut corners; setup reuses the existing paper panel and primary/ghost buttons. Focused action and mode buttons remove clipping so their complete outline remains visible.
- **Gameplay layout:** the playfield occupies the browser gameplay viewport. Tilt adds an absolute input surface and a bottom-right action strip, with safe-area offsets, wrapping and 48px minimum button height. Active play presents Pause, an optional Jump button and course-dependent Race Turbo. Race suppresses its duplicate bottom control/boost button and leaves the boost status above the strip. This viewport contract does not imply browser or OS fullscreen.
- **Setup layout:** a pale, nearly opaque cover protects setup and recovery over the game. Its centered paper panel is at most 480px wide, with full-width actions. Safe-area padding, vertical scrolling and a compact short-height treatment keep the task reachable. Settings retain the existing paused menu and scroll when needed.

## Built interaction contract

[TiltControls.tsx](/Users/ewj/Desktop/projects/wwm/apps/web/src/input/TiltControls.tsx:17) supplies the shared setup, action strip and settings used by [Original](/Users/ewj/Desktop/projects/wwm/apps/web/src/ui/Play.tsx:37) and [Race](/Users/ewj/Desktop/projects/wwm/apps/web/src/race/RacePage.tsx:270).

- **Entry and fallback:** “Tilt to steer” explains tilt, tap-to-jump and local motion processing. Enable is a deliberate action. Probing asks for left/right and forward/back motion; calibration asks for a still, comfortable grip and exposes progress plus “Use this position” when available. Denied, unavailable, insecure and interrupted states explain the reason and expose an explicit joystick choice. English and Japanese messages are defined in [motion.ts](/Users/ewj/Desktop/projects/wwm/apps/web/src/i18n/motion.ts:1).
- **Playfield ownership:** tap input is attached only while play is live and motion is ready. Buttons, links, inputs and surfaces declaring gameplay ownership are excluded. Original also suppresses live tilt actions while portals, travel, learning gates or motion-resume protection own the interaction. Pause and Turbo are separate actions; the optional Jump button uses the same jump request path.
- **Settings and recovery:** the Controls fieldset exposes Tilt, Joystick and Keyboard with pressed-state semantics. Tilt adds Recenter, sensitivity from 0.5 to 1.5 in 0.05 steps, and “Show a Jump button.” Sensitivity updates during adjustment; recalibration begins once the pointer/key gesture finishes or the slider loses focus. Recovery explains that play is paused and asks the user to check tilt before resuming. A loaded Original stage also exposes an explicit restart confirmation before changing its attempt to tilt.
- **Protected focus:** setup is a named modal dialog. Status/alert text distinguishes progress from warnings. Enabled setup buttons form the Tab loop; state changes recover focus when the previous action disappears, and outside focus returns to the dialog. The retained controls use visible blue keyboard focus indicators.

## Final finish review

**Disposition: SHIP for the preview UI.** The fresh reviewer supplied the following final verdict table verbatim:

| Material fix | Score | Evidence |
|---|---|---|
| Sensitivity adjustment interrupted immediately | Resolved | Corrected settings capture shows the usable slider; recenter capture shows the subsequent recheck. Source defers recalibration until release or blur. [TiltControls.tsx:224](/Users/ewj/Desktop/projects/wwm/apps/web/src/input/TiltControls.tsx:224) |
| Setup lost protected focus during state changes | Resolved | Probing capture visibly focuses “Use joystick.” Source refocuses after state changes and redirects outside focus into the dialog. [TiltControls.tsx:29](/Users/ewj/Desktop/projects/wwm/apps/web/src/input/TiltControls.tsx:29) |
| New buttons clipped their keyboard focus indicator | Resolved | Pause capture shows the complete blue focus outline. Shared action/mode selectors remove clipping while focused. [tilt.css:55](/Users/ewj/Desktop/projects/wwm/apps/web/src/input/tilt.css:55) |

The reviewer observed no regressions in the repair captures and no material review fixes remain. The final Race portrait after explicit recheck/resume was inspected: the gameplay viewport, status panels and separate Pause/Turbo strip remain legible.

Final `pnpm check` passed: 151 files passed, 5 skipped; 1,625 tests passed, 41 skipped; 166.72 seconds. All six mobile-tilt browser scenarios ran and passed.

## Evidence and limits

The documenter inspected these saved captures alongside the source:

| Surface/state | Saved capture |
| --- | --- |
| Original setup, portrait | [original-setup-portrait.png](/Users/ewj/Desktop/projects/wwm/docs/launch/evidence/mobile-tilt/screenshots/original-setup-portrait.png) |
| Motion denied, portrait | [motion-denied-portrait.png](/Users/ewj/Desktop/projects/wwm/docs/launch/evidence/mobile-tilt/screenshots/motion-denied-portrait.png) |
| Original tilt, portrait | [original-tilt-portrait.png](/Users/ewj/Desktop/projects/wwm/docs/launch/evidence/mobile-tilt/screenshots/original-tilt-portrait.png) |
| Original tilt, landscape | [original-tilt-landscape.png](/Users/ewj/Desktop/projects/wwm/docs/launch/evidence/mobile-tilt/screenshots/original-tilt-landscape.png) |
| Original tilt, desktop viewport | [original-tilt-desktop.png](/Users/ewj/Desktop/projects/wwm/docs/launch/evidence/mobile-tilt/screenshots/original-tilt-desktop.png) |
| Race tilt, landscape | [race-tilt-landscape.png](/Users/ewj/Desktop/projects/wwm/docs/launch/evidence/mobile-tilt/screenshots/race-tilt-landscape.png) |
| Race tilt after explicit recheck/resume, portrait | [race-tilt-portrait.png](/Users/ewj/Desktop/projects/wwm/docs/launch/evidence/mobile-tilt/screenshots/race-tilt-portrait.png) |
| Controls settings, portrait | [tilt-settings-portrait.png](/Users/ewj/Desktop/projects/wwm/docs/launch/evidence/mobile-tilt/screenshots/tilt-settings-portrait.png) |
| Recenter/recheck, portrait | [tilt-recenter-portrait.png](/Users/ewj/Desktop/projects/wwm/docs/launch/evidence/mobile-tilt/screenshots/tilt-recenter-portrait.png) |
| Probing with protected focus, portrait | [tilt-probing-focus-portrait.png](/Users/ewj/Desktop/projects/wwm/docs/launch/evidence/mobile-tilt/screenshots/tilt-probing-focus-portrait.png) |
| Pause with complete focus outline, portrait | [tilt-pause-focus-portrait.png](/Users/ewj/Desktop/projects/wwm/docs/launch/evidence/mobile-tilt/screenshots/tilt-pause-focus-portrait.png) |

These are Chromium captures using synthetic sensors and CDP touch. They support the recorded layout and focus observations; they do not qualify real-phone motion, permissions, comfort, rotation handling or sustained performance. Physical iOS Safari and Android Chrome acceptance remain unverified. Software and saved UI evidence are complete for this preview receipt; physical acceptance remains open.

No global design rule was inferred from this control strip, its setup veil or its one-off sizing. No known material defect was canonized; the three reported defects were repaired before the final review.

## 2026-10-07 diagnostic hardening follow-up

The original independent review above remains scoped to the first candidate. The parent-run [follow-up](debugging.md) adds a visible blocker, permission/event/movement rows and a local report disclosure after recovery controls. The focus loop now includes the disclosure summary and visible report button. A batched portrait/landscape/desktop inspection and one repair/confirmation round checked wrapping, scrolling, focus and recovery ordering. Final diagnostic captures are in [screenshots/debug/](screenshots/debug/). These captures and tests use synthetic sensors; the user's physical iPhone result is still needed.
