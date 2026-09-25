# @wwm/schema

`plans/contracts.md` in code. It holds every type, constant, codec and validator that crosses a phase boundary.
**Import these from here and never redeclare them.** Phase 02 created it. After that the orchestrator owns it
and applies Contract Change Requests; version history is in [CHANGELOG.md](CHANGELOG.md).

## API
| Module (subpath) | Exports |
|---|---|
| `constants` | Contract §1 constants (`PX_PER_METER`, `BALL_RADIUS_M`, …, `ONEUP_SCORE`) plus the derived constants `CONTRACT_VERSION`, `MAX_PAGE_HEIGHT_PX`, `DEFAULT_VIEWPORT`, `MAX_TILT`, `BALL_RADIUS_PX`, `INPUT_STALE_MS`, `ROOM_CODE_LENGTH` |
| (types) | `CaptureBundle`, `DomElement`, `ElementKind`, `Rect`, `StageData`, `Island`, `Bridge`, `Elevator`, `Item`, `Spawn`, `Goal`, `Provenance`, `Vec2`, `Difficulty`, `BuildInput`/`BuildResult`/`DebugLayers`/`RGBAImage`/`BuildStageFn`, `InputSample`, `SimEvent`, `BallState`, `Simulation`, `CreateSimulationFn`, `Replay`, `GamePhase`, `ControllerInputFrame`, `ControlMessage` (+ each message), HTTP bodies (`CreateStageRequest`, `JobEvent`, `ScoresResponse`, …), `ApiErrorCode`, `ApiError` |
| `space` | `pageToWorld(p, level?)`, `worldToPage(w)`, `pxToMeters`, `metersToPx`, `levelToWorldY`, `worldYToLevel`. **These are the only page↔world conversions.** |
| `rng` | `createRng(seed)` → `{next, nextUint32, range, int, chance, pick, shuffle, fork(label)}`, `mulberry32`, `hashString` |
| `zod` | Zod schemas that mirror every type (`StageDataSchema`, `CaptureBundleSchema`, `ControlMessageSchema`, HTTP body schemas, `RoomCodeSchema`, …) |
| (validate) | `parseStage`, `parseCapture` (these throw `SchemaError`), `parseControlMessage` (returns null on bad input), `validateStage(unknown) → {ok, errors[]}` |
| `codec` | `encodeInput`, `decodeInput` (the 12-byte INPUT frame), `isSeqNewer`, `MSG_INPUT`, `BUTTON_*`, `INPUT_FRAME_BYTES` |
| `geometry` | `signedArea`, `isCCW`, `pointInRing`, `pointInPolygon`, `distanceToSegment/Ring/Polyline/PolygonEdge`, `segmentsIntersect`, `ringsOverlap`, `ringSelfIntersects`, `bridgeRect`, `offsetSegment`, `rectToRing`, `boundsOf` |
| (ids) | `sha256Hex`, `computeCaptureId(url, capturedAt)`, `computeStageId(captureId, seed, builderVersion, difficulty)` |
| (errors) | `API_ERROR_CODES`, `isApiErrorCode` |

## Conventions you must know
- **Ring orientation.** "CCW" means a positive shoelace signed area computed on the raw page `(x, y)` numbers
  (`isCCW(ring) === signedArea(ring) > 0`). Page y points down, so a "CCW" ring looks **clockwise on screen**.
  Outer contours must be CCW and holes must be CW. `rectToRing` produces CCW rings.
- **ids.** Fields are joined with `|` before hashing, e.g. `sha256("<captureId>|<seed>|<builderVersion>|<difficulty>")`.
- **Relative paths.** `CaptureBundle.screenshot.path` and `StageData.texture.path` are relative to the JSON file.
- **fork(label)** derives from the *root seed* plus the label, so it doesn't depend on how many numbers the parent has consumed.

## `validateStage` error codes
It runs a structural (Zod) pass, then every contracts §3 invariant plus the consistency rules implied by the field
comments. The full table is at the top of `src/validate.ts`: `schema`, `duplicate-id`, `unknown-island`,
`contour-degenerate`, `contour-orientation`, `contour-self-intersection`, `hole-orientation`, `hole-outside`,
`unreachable-island`, `goal-on-start-island`, `bridge-too-narrow`, `bridge-self-loop`, `bridge-crosses-island`,
`bridge-endpoint-off-island`, `bridge-level-mismatch`, `bridge-type-mismatch`, `bridge-mouth-blocked`,
`elevator-level-mismatch`, `item-outside-island`, `restart-outside-island`, `start-outside-island`, `goal-outside-island`.

## Run
- Tests: `pnpm vitest run --project @wwm/schema`. The suite has property tests (fast-check) for the codec, space and RNG, one or more negative tests per invariant, and compile-time checks that each Zod schema infers exactly its TS type.
- Typecheck: `pnpm --filter @wwm/schema typecheck`.
