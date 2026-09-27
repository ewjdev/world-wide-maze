# Phase 22 L1: runtime locks in physics and the engine (M0 spike 1–2, M2)

September 26, 2026. A Claude Code sub-agent (Claude Opus 5.5) in its own worktree, working from the approved plan
`plans/phase-22-learning-mechanics.md` (§4, §5, M0, M2) and contracts §10.4 (CCR-GAME-01). It started from
`feat/learning-mechanics-phase-22` at `40ca0be` (about 00:50 UTC on September 27) and finished at about 01:25 UTC.
Everything here is **N** (new, not a 2013 feature).

## M0 spike

### 1. A gate across a bridge mouth holds (`packages/physics/scripts/lock-spike.ts`, `test/locks.test.ts`)
The setup is the handmade fixture, with all three island 0 → 1 bridges locked at island 0 (a cut). The gate under
test is bridge 1's.

The pilot starts 12 m back, or 9.5 m where the island is too small. It steers every tick at a point 1 m *past* the
gate, with POWER held, full phone tilt (0.785 rad) and JUMP pressed every 0.15, 0.3 or 0.6 s. Each run lasts 8 s,
from approach angles of 0°, ±15°, ±30°, ±45° and ±60°.

| | result (27 bridge runs, 6 lift runs) |
|---|---|
| approach speed | 12.9–17.3 m/s (terminal speed is 19.4 m/s) |
| got past the gate | **0 of 33**. The deepest reach past the gate's face was 0.11 m, which is contact softness; the gate is 0.30 m thick. |
| highest ball bottom | 3.42 m (the gate is 4.5 m tall) |
| `locked` events | 7 per 8 s run, always ≥ 120 ticks apart |
| control, lock opened at tick 1 | reaches island 1 |

Two things the spike changed in the design:
- **Lock contacts don't re-arm the jump.** In this simulation any contact counts for the jump grace, so a ball
  pressed against a wall can jump again and again.
- **Lift gates stand in front of the platform, not on it.** The first lift gate stood on the platform's entry end,
  flush with the end face of the platform above it. The ball touched that face mid-jump, which re-armed the jump, and
  it climbed 6.3 m onto the upper island. The gate now stands 0.1 m in front of the platform end.

**Jump envelope** (`scripts/jump-envelope.ts`, the real sim):
- **Height:** the ball's bottom reaches 2.36 m on a level jump and **3.30 m** with full forward tilt plus roll, because
  a tilted gravity has a smaller vertical part.
- **Reach D(Δh):** the farthest gap crossed while clearing a 0.556 m rail at both edges.

| run-up | take-off speed | Δh +2 m | Δh 0 | Δh −2 m | Δh −8 m |
|---|---|---|---|---|---|
| none (standing hop, tilt in the air) | 0 m/s | – | 3.9 m | 6.2 m | 12.8 m |
| 1 s | 12.2 m/s | 9.1 m | 14.0 m | 17.7 m | 26.3 m |
| 8 s (top speed) | 19.4 m/s | 11.9 m | 17.5 m | 21.6 m | 30.9 m |

### 2. Bypass risk (`scripts/bypass-spike.ts`)
**Method:**
- **Stages:** 50 stages from the batch-eval capture set (`fixtures/captures`), built with the real builder at
  difficulty normal and seed 1, taking slice 0 of all 28 captures and then slice 1.
- **Hops:** for every ordered island pair, the plan-view gap is the minimum distance between their outlines.
  A → B is a *hop* when the gap ≤ D(level_B − level_A). There are three skill tiers: standing, a 1 s run-up, and top
  speed.
- **What the hop model ignores:** obstacles and run-up room. It also ignores wall-jump climbing (below), so it is an
  upper bound in one way and a lower bound in another.
- **Lock positions:** connectors on the start → goal BFS path whose removal disconnects the goal. A cut is
  *bypassable* if hops, with the remaining connectors, reach the goal island.

**Results:**

| tier | stages with a hop between islands that have no direct connector | cuts bypassable to the goal | escape gap median / p90 |
|---|---|---|---|
| standing hop | 49 / 50 (26.6 pairs per stage) | **406 / 451 (90 %)**, in 50 / 50 stages | 0.89 m / 2.44 m |
| 1 s run-up | 50 / 50 (110 pairs per stage) | **447 / 451 (99 %)** | 0.89 m / 4.22 m |
| top speed | 50 / 50 (137 pairs per stage) | 447 / 451 (99 %) | 0.89 m / 4.22 m |

**What this means:**
- On real sites, islands are page blocks with small margins between them. Half of all escape gaps are under 0.9 m,
  and 342 of 451 are under 2 m.
- The builder makes spanning trees: connectors = islands − 1 on every stage, so every path connector is a cut.
- A physical gate therefore stops the *route*, but almost any lock can be skipped by hopping a guardrail to a
  neighbouring island. A standing hop is enough.
- **The region guard (L2) is not a rare backstop; it is the main enforcement.** It will fire whenever a child hops.
- A future option (not built): in lock mode, raise the guardrails on the islands along a cut to gate height.

## M2: what was built

### Physics (`packages/physics`)
- **Loading and opening:**
  - `RapierSimulation.load(stage, options?: SimLoadOptions)` places every `LockSpec` closed. It throws on a spec
    that doesn't match the stage or on a duplicate id.
  - `setLock(id, open)` takes effect on the next step.
  - `lockStates()` is a debug helper.
- **Bridge and lift gates:**
  - A bridge or lift lock is three static cuboids from the pure module `src/locks.ts` (exported as
    `@wwm/physics/locks`): the gate (4.5 m tall, 0.3 m thick, deck + rails + 0.45 m wings wide) and two invisible
    side fences that run to the far end of the deck or platform.
  - Open = `Collider.setEnabled(false)`.
- **Lift locks:** the ride trigger is ignored while the lock is closed. Opening it clears `wasInLow/High`, so a ball
  already standing on the platform rides.
- **Goal locks:** while one is closed, the goal emits `locked` and doesn't latch. Once every goal lock is open, the
  next goal contact fires `goal`.
- **The `locked` event:** fires on touching a gate or fence, on a locked lift's trigger edge, or on the locked goal.
  It fires at most once per `simHz` ticks per lock.
- **Lock contacts** never set `grounded` or the jump grace.
- **No locks is the old path:** no extra colliders, and the same step order. `PHYSICS_VERSION` is unchanged
  (0.2.0).
- **Worker:** `load` carries `options`, and there is a new `{ t: 'lock', lockId, open }` message. `WorkerSimulation`
  has `setLock`.
- **Replay:** `replay(stage, inputs, { locks, lockTimeline })` applies each `{ tick, lockId, open }` before its step.
- **`LockableSimulation`** = the contract `Simulation` + `load(stage, options?)` + `setLock`.
- **Dev dependency:** `@wwm/stage-builder`, for the bypass spike only.

### Web (`apps/web`, minimal)
- `sim-driver.ts`: `SimDriver.load(stage, options?)` and `setLock(id, open)` on both `WorkerDriver` and
  `LockstepDriver`.
- `/dev/engine`: a `wwm.placeAt(px, py)` automation hook for the screenshots.

### Engine (`packages/engine`)
New dependency: `@wwm/physics`, which is used only for `@wwm/physics/locks`, a pure module with no Rapier.

**API:**
- `setLocks(specs: { lock: LockSpec; label: string; color: string; icon: 'pip' | 'gem' }[])`: call after
  `loadStage`. It replaces the set, and `[]` clears it.
- `setLockState(id, 'closed' | 'opening' | 'open')`
- `pulseLock(id)`. `handleEvent({ type: 'locked' })` also calls it.
- `setBeacon(pagePos | null)`

**Exports:** `LockVisual`, `LockVisualState`, `LockIcon`, `LockInstance`, `planLocks`, `OPENING_SEC`, `BADGE_M`.

**Visuals:**
- **`world/locks.ts`:** one InstancedMesh, so **+1 scene draw call** for any number of locks (measured 20 vs 19 at
  the same view). It uses `forceSinglePass`, because a transparent double-sided material otherwise draws twice.
  - **The gate:** posts, 7 bars and 3 crossbars in the gate colour, with a soft glow.
  - **The badge:** a white disc with a gate-colour ring and a padlock with Pip (or a gem) inside. It turns to face
    the camera.
  - **The label card** hangs above the badge.
  - **Pulse:** the gate rattles, flashes and wobbles the badge.
  - **Opening:** the bars drop into the deck like a portcullis while the badge pops and fades and gold sparkles
    burst. It lasts 1.1 s; under reduced motion it is a 0.45 s fade with no drop, sparkles or wobble.
  - **Map view:** badges grow ×3.6 and the cards hide.
  - **Sign height:** signs stay below 3.1 m, because the chase camera's top edge is level at about 3.2 m.
- **Dimming:**
  - **Locked bridges:** the decks and rails are desaturated and darkened. Each vertex carries its bridge index
    (`bidx`, from `structures.ts` `bridgeIndex`/`railBridgeIndex`), and a `bridgeDim` uniform array holds the
    dimming (the `elevatorY` pattern).
  - **Locked lifts:** `elevatorDim` dims them and switches off their glow strips.
- **Goal:** a `locked` uniform greys the ribbon, the wire vase and the pad.
- **Beacon:** a golden beam of three crossed quads plus a floor ring, visible in every view. It costs one draw call
  while shown (single pass).

## Screenshots (`node packages/engine/scripts/lock-shots.ts <vite> /tmp/wwm-locks`, 1280 × 720, WebGPU)
All shots are in `/tmp/wwm-locks/`; `webgl/` has three WebGL2 repeats and `reduced-motion/` has two.

| file | shows |
|---|---|
| `01-closed-bridge.png` | chase view, 8 m before the "Pip gate 1" gate on bridge 1; the deck behind it is greyed |
| `02-closed-ramp-gems.png` | the ramp gate with the gem padlock and "4 gems" |
| `03-closed-elevator.png` | the lift gate "Pip gate 2" at the lift entry |
| `04-closed-goal.png` | a greyed goal with the padlock and "Pip gate 3" |
| `05-map-closed.png` | map view: padlocks on bridge 1, the ramp, the lift and the goal; the locked connectors are grey |
| `06-bridge-hit-pulse.png` | close-up just after `locked`: the gate flashes and the padlock tilts |
| `07-bridge-opening.png` | 0.55 s into opening: the bars sink, the badge pops, sparkles |
| `08-bridge-opened.png` | the gate is gone and the deck is green again |
| `09-elevator-opened.png`, `10-goal-opened.png`, `11-map-opened.png` | everything open |
| `12-beacon-chase.png`, `13-beacon-map.png` | the beacon over a point on island A |
| `14-no-locks-baseline.png` | the same view with no locks (draw-call baseline) |

**Review:**
- The first pass put the card at 3 m and the badge at 1.75 m. Both were cut off by the chase camera's top edge
  (`01`/`04`/`06` in the first run).
- The fix lowered the badge to 1.45 m and the card to 2.65 m, and made the badge 1.6 m and Pip larger.
- The gate + padlock reads as "closed" from the chase distance and in the map view.

## Tests
- **Physics** (`test/locks.test.ts`, 21 tests; `test/worker-locks.test.ts`, 1 test):
  - the pose geometry, and bad specs rejected;
  - the gate holds at 7 angles, and an open lock passes;
  - `setLock` mid-run opens the way;
  - the lift gate holds on both sides, and a locked lift won't ride until it opens;
  - the goal lock emits `locked` ×3 in 3 s, then `goal`;
  - the rate limit;
  - `load(stage, {})` and `{ locks: [] }` give bit-identical replays of the fixture;
  - a locked replay is deterministic, and the fixture route is identical with locks opened on schedule;
  - the worker client sends `load` options and the `lock` message.
- **Engine** (`test/locks.test.ts`, 3 tests):
  - the drawn gates equal `barrierPose` and the gate collider box (centre, yaw, width, top);
  - the badge sits on the island side;
  - the goal-lock placement;
  - the per-vertex bridge index covers the decks and the bridge rails only.
- **`pnpm check`:**
  - Typecheck and lint pass.
  - All physics, engine, docent and web unit tests pass. After adding this log, the docent index was regenerated with
    `pnpm docent:index` (`apps/worker/src/docent/corpus.json`).
  - Each of the three full runs had one *different* timing failure. Each passed when run alone, on a machine at a
    load average of 22–27 with other agents' suites running:
    - `@wwm/worker` `room.test.ts` "flood beyond the token bucket": 17/17 alone;
    - `@wwm/web` `portal.e2e` "declining a portal": 3/3 alone, twice;
    - `@wwm/extension` e2e (`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` quota): 33/33 alone.
  - None of the three touches locks.
  - The web e2e files (`game.e2e`: the keyboard replay run, 08b replay verification and the ghost race; `portal.e2e`;
    `learning.e2e`) pass: 14/14.

## Deviations and requests
- **CCR (schema):** `packages/schema` `Simulation` still declares `load(stage)` without `options` or `setLock`.
  Physics exports `LockableSimulation` as a local adapter. Please add both members to the contract interface. The
  optional argument is source-compatible.
- **The API is as specified.** Additions:
  - `setLock` on the drivers;
  - `replay` options `locks` / `lockTimeline`;
  - `lockStates()`;
  - `handleEvent('locked')` pulses the lock.
- **Invisible side fences** are an addition to "a barrier across the deck". They are needed so a ball can't hop around
  the gate's ends onto the deck.

## Known issues
- The bypass rate is high (above). The region guard has to handle hops, including **wall-jump climbing**:
  - any island side wall re-arms the jump, so a ball can climb up to a higher neighbour next to a lock;
  - this predates Phase 22, and the envelope analysis doesn't count it.
- The map view shows padlocks but no "line to the gate that opens them". The engine doesn't know gate positions;
  `setBeacon` covers the pointing.
- Physics validates specs but the engine skips unmatched ones silently.
