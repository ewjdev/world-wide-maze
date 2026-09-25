# @wwm/solver

The solver bot (Phase 09). It plays a generated stage with the **real physics** (`@wwm/physics` `createSimulation`,
headless and deterministic) through the same `InputSample` channel a player uses. It proves a stage is playable,
measures its par time, derives difficulty stars and exports the winning run as a ghost replay.

## API
```ts
import {
  solveStage, validatePlayable, buildPlayableStage, difficultyStars, toGhostReplay,
  buildNavGrid, planRoute, auditIslands, diagnoseNoRoute, PAR_REJECT_SEC,
} from '@wwm/solver';

const r = await solveStage(stage);            // { success, timeSec, falls, jumps, inputs, failure?, attempts, trace, … }
const v = await validatePlayable(stage);      // { ok, parTimeSec, report: { stars, reason?, failure?, … }, solve }
const p = await buildPlayableStage(input, { build: buildStage, maxSeeds: 4 }); // rerolls seed … seed+3
const ghost = toGhostReplay(stage, r);        // { kind: 'wwm.ghost/1', stageId, physicsVersion, inputs, … }
```
- **`solveStage(stage, { sim?, variants?, maxSimSec = 240, grid?, squeeze = true })`** runs up to K attempts.
  - It stops at the first attempt that reaches the goal with no falls.
  - The attempt ladder: `normal` → `careful` → `crawl`, each with its own speed caps and corner speeds.
  - If the strict planner finds **no route**, the physics gets the final say. It retries on a grid with looser
    elevator boarding ground, then on one with clearance relaxed by 1.5 px (`squeeze`). If those fail too, the
    strict geometric diagnosis is reported.
  - `inputs` replay exactly with `runInputs` (`@wwm/physics`). The solver follows the contract restart flow (on
    `lost`, `reset(restartAt)` after the step), so ghosts reproduce, including falls.
- **`validatePlayable`**: `ok` requires a solve **and** `par ≤ PAR_REJECT_SEC` (150 s).
  - The time limit stays a fixed 300 s (G0), and the 150 s cutoff keeps at least 2× headroom.
  - `report.reason` is a one-line explanation, e.g. `solver failed: narrow-neck on island 3 bridge 2 (…)` or
    `par 162.0 s > 150 s`.
- **`buildPlayableStage(input, { build, maxSeeds })`** tries seeds `seed … seed+maxSeeds−1`. It returns the first
  stage that builds, passes `validateStage` and passes `validatePlayable`, together with `tried[]` (seed, reason).
  Otherwise it throws `PlayabilityError` (`code: 'UNPLAYABLE'`). `build` is injected so the solver never pins a
  builder version.
- **`difficultyStars(solve)`** (1–5, N: chosen; 2013 showed stars but the formula is lost): par bands of 30 s
  (≤30 → 1 … >120 → 5), +1 if even the bot fell, +1 if the route needs a jump.
- **`auditIslands(grid)`**: builder feedback that doesn't depend on the route. It reports islands whose link mouths,
  start or goal lie in different ball-walkable parts (`split`), or have no ball-sized ground (`no-ground`).

## How it works
| Step | Module | What |
|---|---|---|
| nav grid | `nav.ts` | 3 px cells labelled by surface (island / deck / void). `clear` is the distance to the nearest wall, where walls are void, other islands, unrelated decks and elevator footprints. Bridge and platform **side rails are exact segments** (they run the whole a→b length and can stand on an island). Portals connect the ground just off each platform end. Jump links cross necks narrower than the ball (≤ 22 px, with land underneath the whole way). |
| planner | `plan.ts` | A* over walkable cells (clearance ≥ ball radius 6.75 px, cost rises near walls, ramps slightly dearer). Elevator portals cost their ride time plus an average cooldown. Jumps carry a 60-cell penalty, so they're used only where rolling can't get through. The path is split into legs at rides and jumps, simplified by line of sight (never below the original path's clearance) and given a speed profile: clearance/deck/ramp caps, corner speed from the turn angle, and a backward braking pass. |
| pilot | `pilot.ts` | Pure pursuit with the look-ahead scaled by speed. Sharp corners (> 40°) are driven through, not cut. `frameYaw` = heading to the pursuit point (a chase camera, G0), and POWER is held. The tilt gives the wanted acceleration of a rolling sphere (a = 5/7·g·sin θ) and is clamped to the **phone limits** (pitch ±45°, roll ±20°). Inputs are rounded to 1e-4, with no −0. |
| solve loop | `solve.ts` | Handles rides (release POWER until `elevator end`), planned jumps (JUMP 0.25 m before take-off, then steer in the air), falls (contract restart, then replan) and stuck detection (no progress for 2.5 s). The response is to back off, replan, then run up and jump; the 4th time at the same spot is a failure. It replans when more than 2.2 m off the path. |
| diagnosis | `diagnose.ts` | Classifies every failure (below), with the island, bridge and elevator IDs. |

**Failure classes:** `narrow-neck`, `elevator-blocked`, `no-route`, `goal-pocket`, `rail-corner`, `ramp-climb`,
`bridge-fall`, `edge-fall`, `elevator-timing`, `unreachable-item`, `stuck`, `timeout`. The first four are
geometric: the planner proves the ball can't fit, and the physics retries confirm it. The rest come from failed
physical attempts.

**Calibration against the physics** (tests): a 12 px neck blocks the ball and a 16 px one lets it through, with the
planner and the physics agreeing on the 13/14 px boundary (ball diameter 13.5 px). An elevator rising less than
ball diameter + slab (1.463 D) pins the ball between its two platforms, so it's never used.

## Numbers
From the batch eval, on 28 captures × all slices × easy/normal/hard × seeds 1–3 (666 stages, builder 0.5.0,
physics 0.2.0). See `fixtures/eval/report.json`:
- solved 100 % (666/666), and all 252 runs fully playable;
- par p50 47.9 s / p90 72.2 s / max 97.6 s at normal (0 stages over 150 s);
- solve CPU p50 104 ms / p90 150 ms / max 315 ms per stage at normal (Node 26, Apple M5 Max), about 490× real time.

The first run (Phase 09, builder 0.3.0, 35 captures, 819 stages, some since removed before publication) solved
93.9 % overall and 94.1 % at normal; `docs/build-log/phase-09.md` has the details.

## Known limits
- The planner is 2D. Decks crossing over other decks at different heights aren't supported. Only the converted 2013
  AID-DCC stage has them, and our builder never makes overlapping decks.
- No item tour yet (`unreachable-item` is reserved). Items on the route are picked up on the way.
- Par is a bot time with phone-limit tilt. Humans are slower. The 150 s cutoff has 2× headroom against 300 s.

## Commands
- Tests: `pnpm vitest run --project @wwm/solver`.
- Dev CLIs (in `scripts/`):
  - `node packages/solver/scripts/solve.ts handmade | aid | <slug>[:slice[:difficulty[:seed]]]`
  - `probe.ts <spec> x y [r]`: geometry and ball states near a point.
  - `dbg.ts <spec> x y [r]`: ASCII nav grid.
  - `reach.ts <spec>`: unreachable islands.
  - `necks.ts [report]`: neck gaps of narrow-neck failures.
  - `issues.ts [report]`: builder-issue repro list.
  - `geomstats.ts`: elevator rises and deck-rail intrusions over all builds.
