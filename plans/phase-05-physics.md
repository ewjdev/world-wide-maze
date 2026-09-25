# Phase 05 — Physics & Ball Feel (packages/physics)

**Wave:** 1 · **Depends on:** 02 · **Blocks:** 08, 09

## Goal
A deterministic Rapier 3D simulation implementing `Simulation` (contracts §5), usable **headless in Node** (for the solver and tests) and **inside a Web Worker** (for the game). It should feel like a great marble-maze game.

## Read first
- `plans/contracts.md` §1, §3, §5
- `RESEARCH.md` Part 1.3 "Physics" and Part 4.4
- `docs/reference/bundle-notes.md` (Phase 01) for the original ball, jump and power parameters, if present

## Owns
`packages/physics/**`, `fixtures/replays/**`, `apps/web/src/dev/physics-sandbox.tsx` (a dev route `/dev/physics`, a simple debug-lines render; don't depend on `@wwm/engine`)

## Tasks
1. **Setup:** `@dimforge/rapier3d-compat` (or `rapier3d-deterministic` if cross-platform determinism is needed; evaluate and document). Use a fixed timestep of `1/SIM_HZ`. Initialize WASM once.
2. **World from `StageData`**, through `pageToWorld` only:
   - Island top and side collision as trimesh colliders (from the same triangulation approach the engine uses, but built independently in this package).
   - Bridges as boxes (flat) or oriented boxes (ramps).
   - Guardrails as thin capsules or boxes along the polylines.
   - Elevators as **kinematic position-based** bodies driven by a deterministic function of sim time.
   - Items and the goal as **sensor colliders** (the modern equivalent of the original's ghost objects, `collision_flags=1|4`).
   - Ocean detection: `ball.y < OCEAN_Y_M` emits `fell`.
3. **Ball:** a dynamic sphere of `BALL_RADIUS_M` with CCD enabled. Tune friction, restitution, rolling resistance and damping.
4. **Controls model (faithful):**
   - `power` held + tilt → **tilt the gravity vector** by (tiltX, tiltZ), clamped to ±`MAX_TILT` (0.44 rad). Add a small direct torque assist so control stays responsive.
   - `power` released → neutral gravity with gentle damping. **Check this against the Phase 01 fidelity spec.** If the evidence says otherwise, implement the evidenced behavior, and put the alternative behind a flag.
   - `jump` (edge-triggered) → an upward impulse only when grounded (contact normal y > 0.6) and outside a coyote time of 100 ms.
   - Keep all tunables in `params.ts`, each labeled evidenced, reconstructed, or chosen.
5. **Events:** item sensor overlap → `item` (each at most once), goal overlap → `goal`, fall → `fell` with the nearest restart point (restart points on the last grounded island first, then globally nearest). Also emit `landed` and `bump` with impact magnitude, for audio and haptics.
6. **`reset(to)`:** teleport the ball to a restart point with zero velocity. Callers handle the respawn delay.
7. **Worker build:** `createWorkerSimulation()` returns the same interface. Internally, the main thread posts `InputSample`s. The worker steps at `SIM_HZ` against its own clock and posts back the latest `BallState` plus events (transferable or SharedArrayBuffer ring if COOP/COEP is available). The main thread interpolates. Physics must hold 120 Hz even when rendering drops (as the original did at 60 Hz).
8. **Determinism and replays:**
   - `record(inputs)` → `InputSample[]`.
   - `replay(stage, inputs)` → final state and events.
   - Author `fixtures/replays/handmade-simple.keyboard.json` (hand-scripted, or recorded in the sandbox) that reaches the goal.
9. **Feel tuning sandbox** `/dev/physics`:
   - Top-down debug draw of colliders and the ball, keyboard input (arrows = tilt, Shift = power, Space = jump).
   - Live parameter sliders, and export of params to JSON.
   - A "feel checklist" to verify: rolls downhill, can crest a ramp at power, can't jump onto level +2, bounces off rails without trapping, doesn't tunnel at max speed, stops within reasonable distance.

## Acceptance criteria
- The same code passes headless (Vitest in Node) and in the Worker (a Playwright test on `/dev/physics`).
- The determinism test runs the replay 3 times and gets identical event streams and a final position within 1e-6.
- `handmade-simple.keyboard.json` reaches `goal`. Fall and restart work (test). Each item fires once.
- Tunneling test: at max achievable speed, into a guardrail and a bridge edge, 1,000 randomized trials give 0 tunnel-throughs.
- Performance: a stage with more than 100k triangles steps at 120 Hz using under 3 ms per step on the reference desktop (log it).
- The loaded `reference/aid-dcc.stage.json` (if Phase 01 produced it) is traversable in the sandbox.

## Out of scope
Rendering beyond debug lines, networking, and game rules like score, lives and timer (Phase 08).
