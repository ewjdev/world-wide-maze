# Shared Contracts

**Every sub-agent reads this before writing code.** These are the only interfaces that cross phase boundaries. They live in code at `packages/schema`, and the code must match this file.

**Changing a contract:** agents do not edit `packages/schema` unless their brief says so. If you need a change, put a **Contract Change Request** in your hand-off report:
- the field
- why you need it
- which consumers are affected

The orchestrator applies the change and notifies the other agents.

**Contract version: `0.2.2`** (G0, 2026-09-25). Changes are recorded in `packages/schema/CHANGELOG.md` and §9. The numbers come from the recovered 2013 build. See `docs/reference/fidelity-spec.md` (E = evidenced) and `docs/reference/contract-deltas.md`.

---

## 1. Coordinates, units, scale

- **Stage space** is the builder's output, in CSS pixels **local to the stage slice**. `x` points right and `y` points down. The origin is the top-left of the slice (see §3 `source.slice`).
- **World space** (renderer and physics) is in meters and right-handed, with `+Y` up.
  - `worldX = x / PX_PER_METER`
  - `worldZ = y / PX_PER_METER`
  - `worldY = level * LEVEL_HEIGHT_M` (island top surface)
- The conversion only happens in `@wwm/schema/space` (`pageToWorld`, `worldToPage`).
- **Scale is faithful to 2013:** the ball diameter D is about 1% of the page width, and a 1280 px page is about 95 D wide. **1 m = 1 D = 13.5 px.**
- Angles are in radians everywhere. Raw DeviceOrientation values are converted at the controller edge.

```ts
// packages/schema/src/constants.ts
// ── Scale ──
export const PX_PER_METER = 13.5;          // 1 ball diameter = 1 m = 13.5 px (2013: 10.8 px of a 1024 stage)
export const BALL_RADIUS_M = 0.5;
export const LEVEL_HEIGHT_M = 1.0;         // `level` is a float in ball diameters (2013 island heights ≈ 9–23 D)
export const MAX_RAMP_SLOPE = 0.176;       // 10°, E
export const MIN_BRIDGE_WIDTH_PX = 34;     // 2.5 D (2013 decks 1.6–3.6 D)
export const MIN_ISLAND_SIZE_PX = 27;      // 2 D
export const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
export const MAX_PAGE_HEIGHT_PX = 6000;    // capture cap
export const MAX_STAGE_HEIGHT_PX = 1700;   // one stage slice ≈ 1.33 × width (2013: 1024 × 1358); longer pages → more stages in a run
export const CAPTURE_DPR = 2;              // screenshots at 2× for close-range sharpness
export const MAX_LARGE_ITEMS = 6;          // E (case study)
// ── Simulation (E, converted from 2013 world units at 0.926 m/WU) ──
export const SIM_HZ = 120;
export const GRAVITY_MPS2 = 46.3;          // ×2 while falling
export const JUMP_DELTA_V_MPS = 16.7;
export const JUMP_GRACE_SEC = 0.1;         // must have touched something within this window
export const MAX_TILT_PITCH = 0.785;       // phone ±45°
export const MAX_TILT_ROLL = 0.349;        // phone ±20°
export const KEYBOARD_TILT = 0.436;        // ±25° both axes
export const ITEM_PICKUP_RADIUS_M = 0.926;
export const GOAL_RADIUS_M = 0.926;
export const GOAL_SENSOR_HEIGHT_M = 1.85;
export const ELEVATOR_COOLDOWN_SEC = 2;
export const FALL_DEPTH_M = 9;             // 'fell' when ball.y < (lowest island top − FALL_DEPTH_M)
export const FALL_LOST_DELAY_SEC = 3;
// ── Rules (E, recovered common/config) ──
export const TIME_LIMIT_SEC_DEFAULT = 300; // fixed per stage; resets on every respawn
export const NUM_BALLS = 3;                // SPARE balls; game over when spares < 0 (4 attempts)
export const SMALL_SCORE = 1;
export const LARGE_SCORE = 100;
export const TIME_SCORE = 5;               // × remaining whole seconds at goal
export const ONEUP_SCORE = 3000;           // each multiple crossed in the run total → +1 spare if spares < 3
```

## 2. Capture: `CaptureBundle` (Capture → Builder)

```ts
export interface CaptureBundle {
  schema: 'wwm.capture/1';
  captureId: string;                 // computeCaptureId(normalizedUrl | capturedAt)
  url: string;                       // normalized final URL after redirects
  title: string;
  capturedAt: string;                // ISO
  viewport: { width: number; height: number };
  page: { width: number; height: number };       // CSS px; width = viewport width; height ≤ MAX_PAGE_HEIGHT_PX
  screenshot: { path: string; width: number; height: number; format: 'png' | 'webp'; scale: number }; // scale = device px per CSS px (CAPTURE_DPR; legacy fixtures 1)
  backgroundColor: string;           // "#rrggbb"
  elements: DomElement[];            // rects in PAGE CSS px (not slice-local)
}

export type ElementKind =
  | 'text' | 'heading' | 'image' | 'video' | 'canvas' | 'button'
  | 'link' | 'input' | 'nav' | 'header' | 'footer' | 'adlike' | 'block';

export interface Rect { x: number; y: number; w: number; h: number }

export interface DomElement {
  id: number; kind: ElementKind; rect: Rect;
  lines?: Rect[]; bg?: string; depth: number; z: number; fixed: boolean;
  text?: string; fontSize?: number;
}
```

## 3. Level: `StageData`

A long page becomes **several stages**: slice k covers page y ∈ [k·MAX_STAGE_HEIGHT_PX, …). The slices are played in order as one **run** (2013's "Next stage" flow). Every coordinate below is in **stage-local px**. The texture is **cropped to the slice** by whoever stores the stage, so UV = local px / (texture size / texture.scale).

```ts
export type Vec2 = [number, number];

export interface StageData {
  schema: 'wwm.stage/2';
  stageId: string;                   // computeStageId(captureId | slice.index | seed | builderVersion | difficulty)
  builderVersion: string;
  seed: number;
  difficulty: 'easy' | 'normal' | 'hard';
  source: {
    url: string; title: string; captureId: string;
    pageWidth: number; pageHeight: number;
    slice: { index: number; count: number; y: number; height: number };   // page-space origin of this stage
  };
  size: { width: number; height: number };                               // stage extent in local px
  texture: { path: string; width: number; height: number; scale: number }; // image covering exactly `size`; scale = image px per stage px
  timeLimitSec: number;              // default TIME_LIMIT_SEC_DEFAULT
  islands: Island[];
  bridges: Bridge[];
  elevators: Elevator[];
  items: Item[];
  start: Spawn;
  goal: Goal;
  provenance: Provenance;
}

export interface Island {
  id: number;
  contour: Vec2[];                   // outer ring: positive shoelace area in (x right, y down) coords — use isCCW()
  holes: Vec2[][];                   // opposite orientation
  level: number;                     // FLOAT, top height in LEVEL_HEIGHT_M units (ball diameters)
  guardrails: Vec2[][];              // open polylines along the edge, gaps at bridge/elevator mouths
  restartPoints: Vec2[];
  sourceElementIds: number[];
}

export type BridgeType = 'flat' | 'ramp';
export interface Bridge {
  id: number;
  from: number; to: number;
  a: Vec2; b: Vec2;                  // centerline endpoints on each island edge (2013: cardinal directions)
  width: number;                     // ≥ MIN_BRIDGE_WIDTH_PX
  type: BridgeType;                  // 'ramp' iff levelA ≠ levelB
  levelA: number; levelB: number;    // = island levels; |Δlevel·LEVEL_HEIGHT_M| / (|b−a| / PX_PER_METER) ≤ MAX_RAMP_SLOPE
}

export interface Elevator {           // E: 2013 bridge type 1 — trigger-activated lift across a short gap
  id: number;
  islandFrom: number; islandTo: number;   // from = lower island
  a: Vec2; b: Vec2; width: number;        // footprint like a bridge: lower platform at a, upper at b
  levelLow: number; levelHigh: number;
  travelSec: number;                      // default 1 + 0.162 × Δh_m, cubicInOut
  cooldownSec: number;                    // default ELEVATOR_COOLDOWN_SEC
}

export interface Item { id: number; kind: 'small' | 'large'; pos: Vec2; islandId: number }
export interface Spawn { pos: Vec2; islandId: number }
export interface Goal  { pos: Vec2; islandId: number; radius: number }

export interface Provenance {
  keptElementIds: number[];
  dropped: { elementId: number; reason: 'too-small' | 'fixed' | 'offscreen' | 'background' | 'merged' | 'out-of-slice' | 'other' }[];
  notes: string[];
}
```

**Invariants** (`validateStage()`, plus the §9 additions):
- Every island is reachable from the start island through bridges and elevators.
- The goal is on a different island from the start, unless the stage has only 1 island.
- Bridge widths are at least the minimum, and bridges don't cross islands they don't connect.
- A ramp's slope is ≤ `MAX_RAMP_SLOPE`. Height differences that would be steeper must use an elevator.
- Items and restart points lie inside their island, at least `BALL_RADIUS_M × PX_PER_METER` from the edge.
- At most `MAX_LARGE_ITEMS` large items.
- All geometry lies within `size`.

## 4. Build API (packages/stage-builder)

```ts
export interface RGBAImage { width: number; height: number; data: Uint8ClampedArray }
export interface BuildInput {
  capture: CaptureBundle;
  image: RGBAImage;                  // full decoded screenshot (image px = page px × capture.screenshot.scale)
  sliceIndex: number;                // 0-based; slice = [i·MAX_STAGE_HEIGHT_PX, min(+MAX_STAGE_HEIGHT_PX, page.height))
  seed: number;
  difficulty: StageData['difficulty'];
}
export interface BuildResult { stage: StageData; debug: DebugLayers }   // stage.texture.path = '' — caller crops + stores the texture and fills it in
export interface DebugLayers {
  gridCellPx: number;
  backgroundMask: Uint8Array; islandMask: Uint8Array; labels: Int32Array;
  candidateBridges: { a: Vec2; b: Vec2; from: number; to: number }[];
  timingsMs: Record<string, number>;
}
export function sliceCount(capture: CaptureBundle): number;
export function buildStage(input: BuildInput): BuildResult; // pure, deterministic, no I/O, no DOM
```

## 5. Simulation API (packages/physics)

**Tilt model (E):** tilt **rotates the gravity vector**. It doesn't push the ball. The rotation is expressed in the camera's yaw frame (forward = away from the camera). Tilt only acts while `power` is held. When `power` is released, the target tilt goes back to 0.

```ts
export interface InputSample {
  tiltX: number;                     // rad, roll (+ = right), |·| ≤ MAX_TILT_ROLL (keyboard ≤ KEYBOARD_TILT)
  tiltZ: number;                     // rad, pitch (+ = away from camera/forward), |·| ≤ MAX_TILT_PITCH
  frameYaw: number;                  // rad, heading of the frame tilt is relative to (renderer camera yaw; solver chooses its own)
  power: boolean;
  jump: boolean;                     // edge-triggered by the sim
}

export type SimEvent =
  | { type: 'item'; itemId: number; kind: 'small' | 'large' }
  | { type: 'goal' }
  | { type: 'fell'; restartAt: Vec2 }              // restart = nearest restart point on the last-touched island
  | { type: 'lost' }                               // FALL_LOST_DELAY_SEC after 'fell'
  | { type: 'island'; islandId: number }           // first contact with a different island
  | { type: 'elevator'; elevatorId: number; phase: 'start' | 'end' }
  | { type: 'landed'; impact: number }
  | { type: 'bump'; impact: number };

export interface BallState { pos: [number, number, number]; quat: [number, number, number, number]; vel: [number, number, number]; grounded: boolean }

export interface Simulation {
  load(stage: StageData): Promise<void>;
  step(input: InputSample): { ball: BallState; events: SimEvent[]; elevators: { id: number; y: number }[] };
  reset(to?: Vec2): void;
  dispose(): void;
}
export function createSimulation(): Promise<Simulation>;
export function createWorkerSimulation(): Promise<Simulation>;
```

Determinism: the same `StageData` plus the same `InputSample[]` give the same events on the same build. Replays are `InputSample[]` at `SIM_HZ`.

## 6. Controller protocol (packages/net)

The transport is a WebSocket relay (a Durable Object per room). Room codes are **6 digits**, and the pairing URL is `/c/<code>`.

**Controller → host** (binary, 12 bytes, little-endian):

| offset | type | field |
|---|---|---|
| 0 | u8 | msgType = 1 (INPUT) |
| 1 | u8 | buttons: bit0 POWER, bit1 JUMP, bit2 MENU |
| 2 | u16 | seq (wraps) |
| 4 | f32 | tiltX (rad, calibrated, roll) |
| 8 | f32 | tiltZ (rad, calibrated, pitch) |

The host adds `frameYaw` from its camera. Input is stale after 250 ms, and stale input means tilt 0 with power off.

**JSON text frames** `{ t, ... }`:
- relay → both: `{t:'peer', role, connected}`
- host → controller: `{t:'state', phase, score, balls, timeLeft}`, `{t:'haptic', pattern:'item'|'large'|'fall'|'goal'}`
- *optional* host → controller: `{t:'pos', x, y, heading}` at ≤10 Hz for a phone mini-map (E: 2013 sent this)
- controller → host: `{t:'calibrated'}`, and *optionally* `{t:'text', field:'url'|'name', value}` (E: typing on the phone)
- either direction: `{t:'ping', id, ts}` / `{t:'pong', id, ts}`

```ts
export type GamePhase = 'title' | 'howto' | 'pairing' | 'calibrate' | 'select' | 'building' | 'intro' | 'countdown'
  | 'play' | 'paused' /* = map view: physics + timer stopped */ | 'falling' | 'restarting' | 'goal' | 'timeup'
  | 'gameover' | 'result' | 'ranking' | 'error';
```

## 7. HTTP API (apps/worker)

| Method and path | Body / response |
|---|---|
| `POST /api/stages` | `{url, difficulty?, seed?}` → `202 {jobId}` or `200 {runId, stageIds[]}` if cached |
| `GET /api/jobs/:jobId` (SSE) | `progress {step, pct}` → `done {runId, stageIds[]}` or `error {code, message}` |
| `GET /api/stages/:stageId` | `StageData` |
| `GET /api/stages/:stageId/texture` | image |
| `GET /api/runs/:runId` | `{runId, url, title, stageIds[]}` (all slices of one page capture) |
| `GET /api/curated` | `{runs: {runId, title, url, thumb, stars}[]}` |
| `POST /api/rooms` | `{code}` |
| `GET /api/rooms/:code/ws?role=host\|controller` | WebSocket upgrade |
| `POST /api/scores` | `{kind:'stage', stageId, name, score, timeMs, replay?}` or `{kind:'run', runId?, name, totalScore, stages:[{stageId, score, timeMs}]}` → `{rank}` |
| `GET /api/scores/stage/:stageId` · `GET /api/scores/run` | `{entries: {name, score, timeMs?, at}[]}` (the run board is global, as in 2013) |

Error codes: `CAPTURE_BLOCKED`, `CAPTURE_TIMEOUT`, `URL_FORBIDDEN`, `BUILD_FAILED`, `UNPLAYABLE`, `RATE_LIMITED`.

## 8. Fixtures

```
fixtures/
  captures/<slug>/capture.json + screenshot.png    # 7 pages (Phase 02), scale 1 legacy OK
  stages/handmade-simple.json + .png               # schema wwm.stage/2
  replays/handmade-simple.keyboard.json            # Phase 05
```
The WWMMM reference is fetched on demand to `reference/` (gitignored) by `pnpm ref:fetch`.

---

## 9. Resolutions log (orchestrator)

**v0.1.0, from the Phase 02 hand-off (accepted):**
- `isCCW` means a positive shoelace area on (x, y-down) coords for outer rings.
- IDs are hashed from fields joined with `|`.
- SSE events are `{type: progress|done|error}` with `pct` 0–100.
- Extra invariants:
  - Bridge levels match their islands.
  - Endpoints are within 20 px of their island.
  - Rail gaps at mouths.
  - Elevator levels match their islands.
  - Start and goal are inside their islands.
  - IDs are unique, contours simple, and holes inside the contour.
- Added constants and HTTP body types. Score names are 1–32 characters.
- Asset paths are relative to their JSON file.

**v0.2.0, gate G0 (from the Phase 01 contract deltas):**
- **CD-1 accepted, faithful scale:** `PX_PER_METER` 40 → 13.5. Minimums are re-expressed in D. Pages are sliced into stages of ≤1700 px, played as a run. Capture is at DPR 2.
- **CD-2 accepted:** `level` is a float, in D units, and ramps are limited by slope (≤0.176) rather than by Δlevel = 1.
- **CD-3 accepted:** Elevators are bridge-shaped and triggered (`a`, `b`, `width`, `travelSec`, `cooldownSec`).
- **CD-4 accepted:** `InputSample.frameYaw` is added (the sim stays camera-agnostic), with per-axis tilt limits. Tilt is a gravity rotation.
- **CD-5 accepted:** the 2013 constants are added. `NUM_BALLS` means spare balls. The timer is a fixed 300 s and resets on respawn.
- **CD-6 resolved in favor of the existing `isCCW` (positive area).** The 2013 data has negative area, and the WWMMM converter flips it.
- **CD-7 accepted:** `howto`, `falling`, `restarting` and `error` are added to `GamePhase`.
- **CD-8 accepted:** both per-stage boards and a global run board.
- **CD-9 accepted as optional messages.** **CD-10 accepted:** the `island`, `elevator` and `lost` events, plus `FALL_DEPTH_M` relative to the lowest island (replaces `OCEAN_Y_M`). **CD-11:** documented.
- **New in 0.2 (orchestrator):** `source.slice`, `size`, `texture.scale`, `BuildInput.sliceIndex`, `sliceCount()`, `runId`, and the stage schema tag becomes `wwm.stage/2`. `Simulation.step` returns elevator heights.

**v0.2.1, from the Phase 02b CCRs (orchestrator, 2026-09-25):**
- **CCR1:** `MAX_RAMP_SLOPE` = 0.1765 (tan 10° plus float tolerance, matching the 2013 ramps).
- **CCR2:** items use `ITEM_EDGE_CLEARANCE_PX` = 0.25 D, because they're pickup zones. Restart points and the start keep the full ball-radius clearance.
- **CCR3:** confirmed. Elevators follow the same minimum width as bridges (N: a playability choice, since 2013 decks were 1.6–2.9 D).
- **CCR4:** confirmed. `ENDPOINT_TOLERANCE_PX` = 20.
- **CCR5:** slices are **balanced**: n = ceil(h / 1700), and slice i covers [round(i·h/n), round((i+1)·h/n)), so there's no tiny tail stage.
- **CCR6, CCR7:** accepted (`texture.path` may be `''` before storage, and `stars` is an integer from 0 to 5).
- **G0 check:** the converted 2013 AID-DCC stage passes `validateStage`, except for 13 intentional width-minimum differences.

**v0.2.2, from the Phase 05 CCRs (orchestrator, 2026-09-25):**
- **`frameYaw` convention:**
  - At yaw 0, forward (+tiltZ) is world −Z (page up) and right (+tiltX) is +X.
  - Positive yaw is counter-clockwise seen from above, the same as three.js `camera.rotation.y` with Euler order `'YXZ'`.
  - `engine.cameraYaw()` returns exactly this value.
- **`BallState.quat` order** is `[x, y, z, w]`.
- **Elevator geometry** (two platforms share one footprint):
  - Length `max(|b−a|, ELEVATOR_MIN_PLATFORM_PX)` along a→b, ending at `b`, with width `width`.
  - `step().elevators[].y` is the top of platform A, which starts at `levelLow`. Platform B is at `levelLow + levelHigh − y`.
  - The reference implementation is `elevatorFootprint` in `@wwm/physics/src/geometry.ts`. The renderer must match it.
- **New constants `SLAB_THICKNESS_M`, `RAIL_HEIGHT_M`, `ELEVATOR_MIN_PLATFORM_PX`.** Rails sit just outside the island edge line, and outside a bridge deck's width.
- **Replays** carry `physicsVersion`, and score submissions include `replay?: {physicsVersion, inputs}`. The server only verifies replays whose version matches its `PHYSICS_VERSION`.
