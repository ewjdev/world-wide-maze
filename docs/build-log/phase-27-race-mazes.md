# Phase 27 — ten authored race mazes

Implemented the ten reviewed 2D layouts as selectable Race courses, each assigned to a separate maze agent. Original, Education and the four existing Race courses remain available. Layout changes were made where the 2D proposals produced invalid slopes, overlapping approaches, poor gate directions or excessive shortcut savings.

The authoring script writes explicit multi-route island geometry from `maze.json`, captures an owned HTML/SVG texture, hashes its frozen course identity, validates stage/gates/stunts, and copies identical public artifacts. Generated catalog entries use those identities. This is an authored course pipeline, not automatic arbitrary-page reconstruction.

Shared geometry now supports optional rail-free bridges and quadratic curved/banked decks. Physics and render meshes consume the same tessellation, with endpoint aprons. Directed flight links express reachable jump destinations without invisible walkable bridges. Actual inclined launch ramps lead to raised takeoff islands; the existing automatic vertical assist remains in use.

The chase-camera heightfield follows curved decks and retains lower slabs at overpasses. Sky Weave uses a dedicated descent before its flat lower crossing; all restart locations were checked to avoid selecting an upper layer. A rendering review found missing bank-deck UVs, which made the entire curve look like its white edge; corrected and regression-tested.

## Verification

Every authored route is driven through real 120 Hz Rapier with ordinary bounded tilt/power samples, no teleportation or injected velocity. Runs require ordered gates, no falls, expected launches and clean landings. A second independent simulation must reproduce each recorded position/rotation and finish progress exactly. Each course then runs ground and feature routes through the playable browser, compares final pose and progress, checks page errors, and captures ready/traversal/feature/finish screenshots. Bankshot and Sky Weave have additional bank/underpass evidence.

The generated [maze evidence](../../fixtures/race/maze-verification.json), [screenshot gallery](../../fixtures/race/review.html), and per-course reviews contain final identities and measured times. Most main routes target 55–65 seconds; intentional bailout routes may take longer. Bankshot and Needle Garden additionally prove controlled recovery-island-to-finish traversals. All authored restart points select their intended layers. These are local scripted runs, not human acceptance or deployment.

Local validation: 390 existing/shared tests passed, followed by 10 course artifact/evidence checks and focused renderer/camera rechecks; affected package typechecks and scoped lint pass. Web production build succeeds with `VITE_RACE_ENABLED=true` (the existing production default disables Race). The catalog was checked at desktop and 390px mobile widths, including selecting the last new course. The Race-enabled production build also passed a real-keyboard smoke test (ArrowUp, 120 simulation ticks, 3.60m movement, no page errors); full recorded-input replays use the development-only hooks.

## Limits

- Exponential human difficulty and approximately one-minute practiced human times are not established by the controller.
- Shortcut risk/reward and optimal turbo strategy still need perturbed-input and human trials. Turbo is available but unused in the reference runs; no artificial turbo requirement was added.
- Most lower catches were not deliberately hit by a missed jump. Their existence does not prove reliable interception.
- Sky Weave is physically layered and camera-clear, but its overhead level cue is faint in the existing fog/lighting.
- General bridge-to-bridge clearance is not automatically validated by StageData; authored Sky Weave crossing clearance is separately measured.
- Desktop Chromium evidence does not certify phone controls or broad-device performance.

Reproduce using `scripts/race-maze-build.ts`, `race-maze-verify.ts`, `race-maze-catalog.ts`, `race-maze-browser.ts`, and `race-maze-report.ts`; see `fixtures/race/README.md`.
