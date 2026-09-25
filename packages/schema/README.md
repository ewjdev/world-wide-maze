# @wwm/schema

`plans/contracts.md` in code. It holds every type, constant, codec and validator that crosses a phase boundary.
**Import these from here and never redeclare them.** Phase 02 created it. After that the orchestrator owns it
and applies Contract Change Requests; version history is in [CHANGELOG.md](CHANGELOG.md).

## API
| Module (subpath) | Exports |
|---|---|
| `constants` | Every contract §1 constant (scale, simulation, rules: `PX_PER_METER` = 13.5, `MAX_RAMP_SLOPE`, `MAX_STAGE_HEIGHT_PX`, `CAPTURE_DPR`, `GRAVITY_MPS2`, `MAX_TILT_PITCH`/`ROLL`, `KEYBOARD_TILT`, `FALL_DEPTH_M`, `TIME_LIMIT_SEC_DEFAULT`, …) plus the derived `CONTRACT_VERSION`, `BALL_RADIUS_PX` (6.75), `ENDPOINT_TOLERANCE_PX` (20), `ELEVATOR_TRAVEL_BASE_SEC`/`_SEC_PER_M`, `INPUT_STALE_MS`, `ROOM_CODE_LENGTH`; v0.2.7: `CAPTURE_LIMITS`, `ROOM_TOKEN_BYTES`, `ROOM_CLOSE_CODES` |
| (types) | `CaptureBundle`, `DomElement`, `ElementKind`, `Rect`, `StageData`, `StageSlice`, `Island`, `Bridge`, `Elevator`, `Item`, `Spawn`, `Goal`, `Provenance`, `Vec2`, `Difficulty`, `BuildInput`/`BuildResult`/`DebugLayers`/`RGBAImage`/`BuildStageFn`/`SliceCountFn`, `InputSample`, `SimEvent`, `SimStepResult`, `BallState`, `Simulation`, `CreateSimulationFn`, `Replay`, `GamePhase`, `ControllerInputFrame`, `ControlMessage` (+ each message, incl. optional `PosMessage`/`TextMessage`), HTTP bodies (`CreateStageRequest`, `JobEvent`, `RunResponse`, `CuratedResponse`, `SubmitScoreRequest` = stage \| run, `ScoresResponse`, `CreateRoomResponse` = `{code, hostToken, pairToken}`, …), `RoomCloseCode`, `ApiErrorCode`, `ApiError` |
| `space` | `pageToWorld(p, level?)`, `worldToPage(w)`, `pxToMeters`, `metersToPx`, `levelToWorldY`, `worldYToLevel`. **These are the only stage↔world conversions** (inputs are stage-local px). |
| `slice` | `sliceCount(capture)` (≥ 1; the builder re-exports it) and `sliceRange(capture, index)` → `{index, count, y, height}` = `StageData.source.slice`. Slice i covers page y ∈ [i·1700, min((i+1)·1700, page.height)). |
| `rng` | `createRng(seed)` → `{next, nextUint32, range, int, chance, pick, shuffle, fork(label)}`, `mulberry32`, `hashString` |
| `zod` | Zod schemas that mirror every type (`StageDataSchema`, `CaptureBundleSchema`, `ControlMessageSchema`, HTTP body schemas, `RoomCodeSchema`, `RoomTokenSchema`, …). Importing it sets `z.config({ jitless: true })` (v0.2.7), so zod never probes `new Function` under a strict CSP |
| (validate) | `parseStage`, `parseCapture` (these throw `SchemaError`), `parseControlMessage` (returns null on bad input), `validateStage(unknown) → {ok, errors[]}`, `rampSlope(a, b, levelA, levelB)` |
| `codec` | `encodeInput`, `decodeInput` (the 12-byte INPUT frame), `isSeqNewer`, `MSG_INPUT`, `BUTTON_*`, `INPUT_FRAME_BYTES` |
| `geometry` | `signedArea`, `isCCW`, `pointInRing`, `pointInPolygon`, `distanceToSegment/Ring/Polyline/PolygonEdge`, `segmentsIntersect`, `ringsOverlap`, `ringSelfIntersects`, `bridgeRect`, `offsetSegment`, `rectToRing`, `boundsOf` |
| (ids) | `sha256Hex`, `computeCaptureId(url, capturedAt)`, `computeStageId(captureId, sliceIndex, seed, builderVersion, difficulty)` |
| (errors) | `API_ERROR_CODES`, `isApiErrorCode` |

## Conventions you must know
- **Ring orientation.** "CCW" means a positive shoelace signed area computed on the raw page `(x, y)` numbers
  (`isCCW(ring) === signedArea(ring) > 0`). Page y points down, so a "CCW" ring looks **clockwise on screen**.
  Outer contours must be CCW and holes must be CW. `rectToRing` produces CCW rings. (2013 data is the opposite;
  the WWMMM converter flips it.)
- **Scale (v0.2).** 1 m = 1 ball diameter = 13.5 px. `level` is a float in `LEVEL_HEIGHT_M` (= 1 m) units.
  All `StageData` coordinates are **stage-local** px (origin = slice top-left); `CaptureBundle` rects stay in page px.
- **ids.** Fields are joined with `|` before hashing, e.g. `sha256("<captureId>|<sliceIndex>|<seed>|<builderVersion>|<difficulty>")`.
- **Relative paths.** `CaptureBundle.screenshot.path` and `StageData.texture.path` are relative to the JSON file.
- **fork(label)** derives from the *root seed* plus the label, so it doesn't depend on how many numbers the parent has consumed.

## `validateStage` error codes
It runs a structural (Zod) pass, then every contracts §3 invariant plus the consistency rules implied by the field
comments. The full table is at the top of `src/validate.ts`: `schema`, `duplicate-id`, `unknown-island`,
`slice-invalid`, `out-of-bounds`, `contour-degenerate`, `contour-orientation`, `contour-self-intersection`,
`hole-orientation`, `hole-outside`, `unreachable-island`, `goal-on-start-island`, `bridge-too-narrow`,
`bridge-self-loop`, `bridge-crosses-island`, `bridge-endpoint-off-island`, `bridge-level-mismatch`,
`bridge-type-mismatch` ('ramp' iff levels differ), `ramp-too-steep` (slope in world units ≤ `MAX_RAMP_SLOPE`),
`bridge-mouth-blocked`, `elevator-too-narrow`, `elevator-self-loop`, `elevator-level-mismatch` (from = lower island),
`elevator-endpoint-off-island`, `elevator-crosses-island`, `elevator-mouth-blocked`, `too-many-large-items`,
`item-outside-island`, `restart-outside-island`, `start-outside-island`, `goal-outside-island`.

## Run
- Tests: `pnpm vitest run --project @wwm/schema`. The suite has property tests (fast-check) for the codec, space and RNG, one or more negative tests per invariant, and compile-time checks that each Zod schema infers exactly its TS type.
- Typecheck: `pnpm --filter @wwm/schema typecheck`.
