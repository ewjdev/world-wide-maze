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


---

## G0 updates (2026-09-25). Where these conflict with the text above, these win.
Sources: `docs/reference/fidelity-spec.md` (E = evidenced from the 2013 build) and contracts v0.2.0.

- **Model (E):**
  - Tilt **rotates gravity** by (tiltZ pitch, tiltX roll) in the `frameYaw` heading frame, only while `power` is held. The target tilt eases back to 0 on release.
  - Tilt smoothing τ ≈ 0.18 s (α = 0.0461 per 120 Hz tick). This is sim-side smoothing of the *target* gravity, separate from the host's One Euro filter.
  - Gravity 46.3 m/s², doubling to 92.6 over 1 s while falling.
- **Ball (E):**
  - r 0.5 m, 1 kg, never sleeps.
  - Friction 0.95, restitution 0.35. Island and bridge surfaces 0.95 / 0.7. Rails 0.5 / 0.7. Combine rule **Multiply** for both.
  - Linear damping 1.20/s. Angular damping 1.20/s with POWER, **4.61/s without** (brakes).
- **Jump (E):** Δv 16.7 m/s up, only if there was *any* contact within the last 100 ms (`JUMP_GRACE_SEC`). POWER isn't required.
- **Sensors (E):** item spheres r 0.926 m centered 0.5 m above the surface. Goal cylinder r 0.926 m, h 1.85 m.
- **Rails:** colliders 0–0.56 m tall (R).
- **Elevators (E):**
  - Kinematic platforms, **trigger-activated** by touching the sensor at either end.
  - Travel `travelSec`, cubicInOut. The ball's velocity is zeroed during the ride. Cooldown `cooldownSec`.
  - Emit `elevator` start/end. Return platform heights in `step().elevators`.
- **Falls (E):**
  - `fell` when ball y < lowest island top − `FALL_DEPTH_M`. From then on, input is ignored and gravity is doubled.
  - `lost` is emitted `FALL_LOST_DELAY_SEC` later.
  - `restartAt` = the restart point on the **last-touched island** nearest the last contact position (fallback: start).
  - Emit `island` on first contact with a new island.
- **Keyboard mapping lives in Phase 06.** Headless tests use raw `InputSample`s, including `frameYaw`.
- **Feel checks** (tolerances in `params.ts`): jump apex ≈ 2.3 m (4.7 ball radii) with damping, and max downhill acceleration at 45° ≈ 23 m/s².
- `SIM_HZ` 120, with per-second constants. Document a 60 Hz parity mode switch for A/B feel comparison.
