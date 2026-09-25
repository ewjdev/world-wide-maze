# Proposed contract deltas (Phase 01 → gate G0)

These are proposals against `plans/contracts.md` v0.1.0, with evidence. The orchestrator decides and applies them. Priority: **P0** = changes behavior or shape that several phases code against; **P1** = should land before Wave 1 ends; **P2** = nice to have.

Units: 2013 world unit (WU) = 10 px of a 1024 px-wide stage. The 2013 ball radius is 0.54 WU = 5.4 px (diameter **D = 10.8 px**). See [bundle-notes.md](bundle-notes.md) and [stage-format.md](stage-format.md).

---

### CD-1 (P0, product decision) World scale: ball size relative to the page
- **Now:** `PX_PER_METER = 40`, `BALL_RADIUS_M = 0.5` → ball diameter 40 px on a 1280 px capture = **3.1 % of the page width** (the page is 32 ball diameters wide). `MAX_PAGE_HEIGHT_PX = 6000`.
- **2013 (E):** ball diameter 10.8 px on a fixed 1024 × 1358 stage = **1.05 % of the width** (the page is 95 D wide, 126 D tall). Camera 5 WU from the ball (≈9 ball radii).
- **Effect:** at the current scale a page has about 1/3 of the ball-lengths per axis (about 1/9 of the area) of a 2013 maze. Mazes will feel cramped, and text blocks merge into fewer, coarser islands.
- **Proposal:** a faithful default of `PX_PER_METER = 13.5` (ball diameter 13.5 px at 1280 px ≈ 95 D, like 2013). Re-express the other px constants in D: `MIN_BRIDGE_WIDTH_PX = 34` (2.5 D; 2013 minimum was 1.6 D and typical 3.6 D), `MIN_ISLAND_SIZE_PX = 27` (2 D; 2013 had strips down to 1.1 D). Cap a single stage at a 2013-like aspect: `MAX_STAGE_HEIGHT_PX ≈ 1.33 × capture width` (1700 px at 1280). Longer pages become multiple stages (RESEARCH §4.8). Keep capture at DPR 2 so textures stay sharp at close range (2013 deliberately used a pixelated `NearestFilter`).
- **Alternative (accessibility-leaning):** `PX_PER_METER = 20` (ball 20 px, 64 D wide). This is a middle ground.
- **Consumers:** schema constants, 03 (all thresholds), 04 (camera distances in m stay valid), 05 (unchanged in meters), 09 (eval thresholds), 07 (capture height cap).

### CD-2 (P0) `Island.level`: continuous height, slope-limited ramps
- **Now:** `level` is an integer, `worldY = level × 1.5 m`, and ramps must connect levels that differ by exactly 1.
- **2013 (E):** `level` is a **continuous height in page px** (fixture 100–250 px ≈ 9–23 D). Static bridges are ramps of **any height difference with slope ≤ 0.176 (10°)** (e.g. Δ80.9 px over 459 px). Elevators handle **40/60/80 px jumps across gaps ≤ 10 px**.
- **Proposal:** make `level: number` (a float allowed) in units of `LEVEL_HEIGHT_M`, and set `LEVEL_HEIGHT_M` to 1 D (`= 2 × BALL_RADIUS_M`). Replace the ramp invariant with `|Δheight| / length ≤ MAX_RAMP_SLOPE = 0.176`, and set `type: 'ramp'` whenever Δ ≠ 0. Elevators are required when the slope would exceed that.
- Converter evidence: 4 of the fixture's ramps fail the current invariant after quantization (`reference/aid-dcc.check.txt`).
- **Consumers:** schema (`validateStage`, `space.ts`), 03, 04, 05, 09.

### CD-3 (P0) `Elevator`: triggered, bridge-shaped, not periodic
- **Now:** `{pos, size, levelLow, levelHigh, periodSec}`.
- **2013 (E):** an elevator is a bridge record with `type: 1`. It has a lower and an upper platform `max(len, 15 px)` × `width`, placed along the bridge axis. **Touching a sensor at either end** transports the ball vertically in `1 s + 0.15 s × Δh[WU]` (cubicInOut). The ball's velocity is zeroed. There is a **2 s cooldown**.
- **Proposal:**
  ```ts
  export interface Elevator {
    id: number; islandFrom: number; islandTo: number;
    a: Vec2; b: Vec2; width: number;          // same footprint convention as Bridge
    levelLow: number; levelHigh: number;
    travelSec: number;                        // default 1 + 0.162 * Δh_m (2013 formula in meters)
    cooldownSec: number;                      // default 2
  }
  ```
  An alternative with the same content: fold it into `Bridge` as `type: 'elevator'` plus `travelSec`/`cooldownSec`.
- **Consumers:** schema, 03, 04, 05, 09 (the solver must model the trigger), 08.

### CD-4 (P0) `InputSample`: per-axis tilt limits and the camera-frame yaw
- **Now:** `tiltX`, `tiltZ` clamped to ±0.44 rad. Tilt semantics are unspecified.
- **2013 (E):** tilt **rotates gravity** (it doesn't push the ball). The rotation is applied **in the camera's yaw frame** (forward = away from the camera). Limits: phone **pitch ±45° (0.785 rad), roll ±20° (0.349 rad)**; keyboard ±25° (0.436 rad) on both axes. Smoothing is slerp 0.09 per 60 Hz tick (τ ≈ 0.18 s). POWER released → target returns to 0.
- **Proposal:** add `frameYaw: number` (rad, the camera heading that the tilt is relative to) to `InputSample`. A headless/deterministic sim cannot know the renderer's camera, so replays must carry it. Replace `MAX_TILT` with `MAX_TILT_PITCH = 0.785`, `MAX_TILT_ROLL = 0.349`, `KEYBOARD_TILT = 0.436`. Document that the sim applies tilt as a gravity rotation.
- An alternative to `frameYaw`: move the 2013 chase-camera heading logic (leash, §6 of bundle-notes) into the sim so it is deterministic, and expose it in `BallState`. That is more coupling, but no input change.
- **Consumers:** schema, 05, 06 (controller normalisation), 08, 09 (solver outputs), replays.

### CD-5 (P1) 2013 gameplay constants in `constants.ts`
- Add (all E, converted with 0.926 m/WU):
  `TIME_LIMIT_SEC_DEFAULT = 300` (fixed per stage; the timer **resets on every respawn**),
  `GRAVITY_MPS2 = 46.3` (50 WU/s²; doubled while falling),
  `JUMP_DELTA_V_MPS = 16.7` (18 WU/s; only with ground contact in the last 100 ms → `JUMP_GRACE_SEC = 0.1`),
  `ITEM_PICKUP_RADIUS_M = 0.926` (sensor r = 1 WU), `GOAL_RADIUS_M = 0.926`, `GOAL_SENSOR_HEIGHT_M = 1.85`,
  `ELEVATOR_COOLDOWN_SEC = 2`, `FALL_LOST_DELAY_SEC = 3`.
- Clarify the doc comment on `NUM_BALLS = 3`: it is the **spare** balls. Game over happens when spares go below 0, so there are 4 attempts. One-up needs spares < 3, and the reserve is capped at 3.
- Physics tuning (damping, friction, restitution, tilt smoothing) should live in `@wwm/physics` defaults, not the contract. They are listed in [fidelity-spec.md](fidelity-spec.md) §Physics.

### CD-6 (P1) Contour orientation convention
- **Now:** "outer ring CCW, holes CW" with no axis convention (page y-down vs world).
- **2013 data (E):** every outer ring has negative shoelace area computed on raw page (x right, y down) coordinates, i.e. CCW as seen on screen. The 2013 client normalised orientation itself.
- **Proposal:** define `signedArea(ring)` in `@wwm/schema` on page coords, with outer `< 0` and holes `> 0`. Have `validateStage` check that sign, not the word "CCW".

### CD-7 (P1) `GamePhase` coverage
- **2013 (E)** world states: TITLE, OPENING, STAGE_PREVIEW, GAME, PAUSE (map), FALLING, TIMESUP, RESTARTING, FLY_AWAY, RESULT, GAME_OVER. App states: HOWTO, CONNECT, INPUT_NUMBER, CONNECTED, STAGE_SELECT, BUILDING, STAGE_RESULT, RANKING, ERROR, NON_DISPLAY.
- **Proposal:** add `'howto' | 'falling' | 'restarting' | 'error'`, and document `'paused'` = map view (the timer and physics are paused). The controller needs `falling` for haptics/UI and `error` for the disconnect screen.

### CD-8 (P1) Ranking model
- **Now:** per-stage leaderboards (`POST /api/scores {stageId,…}`).
- **2013 (E):** a **single global top-10 of session totals**. A session is a multi-stage run (stage result → "next stage" keeps score and balls; "finish" or game over → ranking). `add_ranking` sent `url: ""`. Nicknames were `[a-z0-9_]`.
- **Proposal:** keep per-stage boards (New, better for curated levels) **and** add a session board: `POST /api/runs {name, totalScore, stages:[{stageId, score, timeMs}]}` → `{rank}`, `GET /api/runs/top`. Or add `kind:'stage'|'run'` to `/api/scores`. The server should validate against replays where feasible.

### CD-9 (P2) Controller extras (optional, New/Reconstructed)
- **2013 (E):** the PC pushed `position {x, y, direction}` at 10 Hz and `stageData` to the phone. The phone could type the site search and the ranking nickname.
- **Proposal (optional):** host → controller `{t:'pos', x, y, heading}` at ≤10 Hz and `{t:'stage', thumb}` for a phone mini-map. Controller → host `{t:'text', field:'url'|'name', value}`.

### CD-10 (P2) `SimEvent` additions
- `{type:'elevator', elevatorId, phase:'start'|'end'}` (sounds, camera).
- `{type:'island', islandId}` on first contact with a new island. This mirrors 2013's `lastIslandId`, which picks the respawn point, and lets the game reproduce "restart point nearest the last island contact". Alternatively keep it internal to the sim and only emit `fell.restartAt` (the current contract), which is sufficient.
- `fell` should fire when the ball is clearly off the course. 2013 fired at world height 0, i.e. at least 10 WU (≈9 m) below the lowest island top. Propose `FALL_DEPTH_M = 9` below the lowest island instead of the absolute `OCEAN_Y_M = -6` (with continuous heights, absolute −6 m may be above some ramps' low ends if levels start at 0; either works if levels ≥ 0).

### CD-11 (P2) Stage metadata
- 2013 recommendations had a difficulty `level` shown as stars. Our `difficulty` covers it, so no change.
- Large items: document "≤ 6 per stage" (case study). The fixture has 4.
- `texture`: document that the UV is `page px / source.pageWidth|pageHeight`. The texture resolution may differ (converter output 1024 × 1356 for a 3704 × 5030 px scaled page).

---

## Validation evidence
`reference/aid-dcc.check.txt` (generated by `pnpm ref:fetch`): 38 islands, 31 bridges, 6 elevators, 505 items. **All reachability, crossing, self-intersection and level-consistency checks pass.** The only failures come from CD-1/CD-2 (11 bridges under 100 px, 4 multi-level ramps, 32 small items within 20 px of an edge).
