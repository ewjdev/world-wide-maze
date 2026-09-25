# @wwm/schema changelog

Contract version = `CONTRACT_VERSION` in `src/constants.ts`. Only the orchestrator bumps it (after a Contract Change Request).

## 0.2.0 (2026-09-25, Phase 02b, gate G0)
Implements `plans/contracts.md` v0.2.0 (contract deltas CD-1…CD-11 from Phase 01). **Breaking.**
- **Scale (CD-1):** `PX_PER_METER` 40 → 13.5 (1 m = 1 ball diameter), `LEVEL_HEIGHT_M` 1.5 → 1.0,
  `MIN_BRIDGE_WIDTH_PX` 100 → 34, `MIN_ISLAND_SIZE_PX` 120 → 27. `BALL_RADIUS_PX` is now 6.75.
- **Removed:** `OCEAN_Y_M` (use `FALL_DEPTH_M` below the lowest island) and `MAX_TILT` (use `MAX_TILT_PITCH`,
  `MAX_TILT_ROLL`, `KEYBOARD_TILT`).
- **Added constants:** `MAX_RAMP_SLOPE`, `MAX_STAGE_HEIGHT_PX`, `CAPTURE_DPR`, `MAX_LARGE_ITEMS`, `GRAVITY_MPS2`,
  `JUMP_DELTA_V_MPS`, `JUMP_GRACE_SEC`, `MAX_TILT_PITCH`, `MAX_TILT_ROLL`, `KEYBOARD_TILT`, `ITEM_PICKUP_RADIUS_M`,
  `GOAL_RADIUS_M`, `GOAL_SENSOR_HEIGHT_M`, `ELEVATOR_COOLDOWN_SEC`, `FALL_DEPTH_M`, `FALL_LOST_DELAY_SEC`,
  `TIME_LIMIT_SEC_DEFAULT`. Derived: `ENDPOINT_TOLERANCE_PX` (20, the §9 endpoint rule), `ELEVATOR_TRAVEL_BASE_SEC`,
  `ELEVATOR_TRAVEL_SEC_PER_M`.
- **`CaptureBundle.screenshot.scale`** (device px per CSS px); `width`/`height` are image px.
- **`StageData`** tag `wwm.stage/2`: stage-local coordinates, `source.slice {index, count, y, height}`, `size`,
  `texture.scale`; `texture.path` may be `''` (builder output before storage). `Island.level`/bridge levels are floats.
  `DropReason` adds `'out-of-slice'`.
- **`Elevator` (CD-3):** `{a, b, width, levelLow, levelHigh, travelSec, cooldownSec}` replaces `{pos, size, periodSec}`.
  `islandFrom` is the lower island; `a` is the lower platform.
- **`BuildInput.sliceIndex`**, `SliceCountFn`; `sliceCount(capture)` and `sliceRange(capture, index)` in `slice.ts`.
- **`computeStageId(captureId, sliceIndex, seed, builderVersion, difficulty)`** (new positional `sliceIndex`).
- **Sim (CD-4, CD-10):** `InputSample.frameYaw`; `SimEvent` adds `lost`, `island`, `elevator`; `Simulation.step`
  returns `SimStepResult` with `elevators: {id, y}[]`.
- **Controller (CD-7, CD-9):** `GamePhase` adds `howto`, `falling`, `restarting`, `error`; `HapticPattern` adds `large`;
  optional `{t:'pos', x, y, heading}` and `{t:'text', field, value}` messages.
- **HTTP (CD-8):** runs: `CreateStageResponse`/`JobEvent.done` carry `{runId, stageIds}`; `RunResponse`;
  `CuratedResponse.runs[]` with `stars`; `SubmitScoreRequest` is `{kind:'stage', …} | {kind:'run', …}`;
  `ScoreEntry.timeMs` optional.
- **`validateStage`:** float levels; `bridge-type-mismatch` is now 'ramp' iff levels differ; new `ramp-too-steep`,
  `elevator-too-narrow`, `elevator-self-loop`, `elevator-endpoint-off-island`, `elevator-crosses-island`,
  `elevator-mouth-blocked`, `too-many-large-items`, `out-of-bounds`, `slice-invalid`; `elevator-level-mismatch` also
  enforces from = lower island. Endpoint tolerance stays 20 px (`ENDPOINT_TOLERANCE_PX`). New helper `rampSlope`.
- Fixture `handmade-simple` regenerated for v0.2 (640×800 stage, levels 0/0/1.5/4, 2× texture).

## 0.1.0 (2026-09-25, Phase 02)
Initial implementation of `plans/contracts.md` v0.1.0.
- All §1–§7 types, constants, and the §7 error codes.
- Zod schemas for every type, `parseStage`, `parseCapture`, `parseControlMessage`, and `validateStage` (every §3 invariant plus the consistency rules; see README).
- `space.ts` (`pageToWorld`/`worldToPage`), `rng.ts` (mulberry32 plus `fork(label)`), and the 12-byte INPUT codec.
- Interpretations recorded as Contract Change Requests in `docs/build-log/phase-02.md`: ring-orientation definition, `|`-joined id hashing, the `JobEvent` SSE shape, extra derived constants, and the extra validation rules (bridge endpoint levels, flat ⇔ equal levels, guardrail gaps at bridge mouths, start/goal inside their island).

## 0.2.1
- MAX_RAMP_SLOPE 0.1765; ITEM_EDGE_CLEARANCE_PX (0.25 D) for items; balanced slices (no tiny tail).

## 0.2.2
- SLAB_THICKNESS_M, RAIL_HEIGHT_M, ELEVATOR_MIN_PLATFORM_PX; documented frameYaw/quat/elevator conventions (contracts §9).

## 0.2.4
- computeRunId; CONTRACT_VERSION synced; capture screenshot is 1x analysis image, stage textures 2x.

## 0.2.5
- VersionedReplay; SubmitScoreResponse.verified/note.

## 0.2.6
- VersionedReplay.timerStartTick (server clamps to first POWER).

## 0.2.7 (2026-09-25, Phase 12b)
- **CCR-12-1:** `zod.ts` calls `z.config({ jitless: true })` before any schema is used, so zod never runs its
  `new Function('')` probe and a strict CSP (`script-src` without `'unsafe-eval'`) sees no violation.
- **CCR-12-2 (pairing secret):** `CreateRoomResponse` is `{code, hostToken, pairToken}` (128-bit base64url tokens,
  `RoomTokenSchema`); `RoomCloseCode` = `4400 | 4401 | 4404 | 4409` and the `ROOM_CLOSE_CODES` constant (4401 =
  missing/invalid token); `ROOM_TOKEN_BYTES` = 16.
- **CCR-12-3:** `CAPTURE_LIMITS` and `CaptureBundleSchema` limits: `elements` ≤ 20,000, `title` ≤ 512, `url` ≤ 2,048,
  `text` ≤ 120 (unchanged), `lines` ≤ 200 per element. `@wwm/capture-script` clamps `title` and `lines` to match.

## 0.3.0 (planned, see contracts §10)
- Portal, DomElement.href, SimEvent portal, local capture handoff, docent API.
