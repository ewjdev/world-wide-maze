# Shared Contracts (v0 draft)

**Every sub-agent reads this before writing code.** These are the only interfaces that cross phase boundaries. They live in code at `packages/schema` (created in Phase 02). This file is the human-readable spec, and the code must match it.

**Changing a contract:** agents do not edit `packages/schema` outside Phase 02. If you need a change, stop and put a **Contract Change Request** in your hand-off report:
- the field
- why you need it
- which consumers are affected

The orchestrator applies the change and notifies the other agents.

Contract version: `0.1.0` (bumps are recorded in `packages/schema/CHANGELOG.md`).

---

## 1. Coordinates and units

- **Page space** (the builder's output) is in page CSS pixels at capture DPR 1. `x` points right and `y` points down. The origin is the page's top-left.
- **World space** (renderer and physics) is in meters and right-handed, with `+Y` up.
  - `worldX = pageX / PX_PER_METER`
  - `worldZ = pageY / PX_PER_METER`
  - `worldY = level * LEVEL_HEIGHT_M` (island top surface)
- The conversion only happens in `packages/schema/src/space.ts` (`pageToWorld`, `worldToPage`). Nobody else hand-rolls it.
- Angles are in radians everywhere, except that raw DeviceOrientation values are normalized to radians at the controller edge.

```ts
// packages/schema/src/constants.ts
export const PX_PER_METER = 40;          // ball diameter ≈ 40 page px
export const BALL_RADIUS_M = 0.5;
export const LEVEL_HEIGHT_M = 1.5;       // one "level" step (the original islands had integer levels)
export const MIN_BRIDGE_WIDTH_PX = 100;  // ≥ 2.5 × ball diameter
export const MIN_ISLAND_SIZE_PX = 120;
export const OCEAN_Y_M = -6;             // below this = fell
export const SIM_HZ = 120;
// Faithful scoring from the recovered 2013 desktop bundle (common/config)
export const NUM_BALLS = 3;
export const SMALL_SCORE = 1;
export const LARGE_SCORE = 100;
export const TIME_SCORE = 5;             // per remaining second at goal
export const ONEUP_SCORE = 3000;
```

## 2. Capture: `CaptureBundle` (Capture → Builder)

```ts
export interface CaptureBundle {
  schema: 'wwm.capture/1';
  captureId: string;                 // sha256(normalizedUrl + capturedAt)
  url: string;                       // normalized final URL after redirects
  title: string;
  capturedAt: string;                // ISO
  viewport: { width: number; height: number };   // default 1280 × 800
  page: { width: number; height: number };       // full scrollable size, height capped (MAX_PAGE_HEIGHT_PX = 6000)
  screenshot: { path: string; width: number; height: number; format: 'png' | 'webp' };
  backgroundColor: string;           // computed <body>/<html> bg, "#rrggbb"
  elements: DomElement[];
}

export type ElementKind =
  | 'text' | 'heading' | 'image' | 'video' | 'canvas' | 'button'
  | 'link' | 'input' | 'nav' | 'header' | 'footer' | 'adlike' | 'block';

export interface Rect { x: number; y: number; w: number; h: number } // page px

export interface DomElement {
  id: number;
  kind: ElementKind;
  rect: Rect;
  lines?: Rect[];                    // per-line text rects (Range.getClientRects)
  bg?: string;                       // own computed background if not transparent
  depth: number;                     // DOM depth
  z: number;                         // resolved stacking hint
  fixed: boolean;                    // position fixed/sticky
  text?: string;                     // trimmed ≤ 120 chars (for labels / optional AI)
  fontSize?: number;
}
```

The in-page extraction function lives in `packages/capture-script` and is shared by the local fixture tool (Phase 02) and the hosted service (Phase 07).

## 3. Level: `StageData` (Builder → Renderer, Physics, Solver, Storage)

The shape is modeled on the recovered 2013 installation format: islands with contours, guardrails, levels and restart points, and bridges with widths, types and endpoint levels. Everything is in **page px** except `level`, which is an integer.

```ts
export type Vec2 = [number, number];

export interface StageData {
  schema: 'wwm.stage/1';
  stageId: string;                   // sha256(captureId + seed + builderVersion + difficulty)
  builderVersion: string;            // semver of packages/stage-builder
  seed: number;                      // uint32
  difficulty: 'easy' | 'normal' | 'hard';
  source: { url: string; title: string; captureId: string; pageWidth: number; pageHeight: number };
  texture: { path: string; width: number; height: number };   // the screenshot the island tops sample
  timeLimitSec: number;
  islands: Island[];
  bridges: Bridge[];
  elevators: Elevator[];
  items: Item[];
  start: Spawn;
  goal: Goal;
  provenance: Provenance;            // why regions were kept/dropped (debuggability requirement)
}

export interface Island {
  id: number;
  contour: Vec2[];                   // outer ring, CCW, simplified, no self-intersection
  holes: Vec2[][];                   // CW rings
  level: number;                     // integer height step
  guardrails: Vec2[][];              // open polylines along the edge, gaps at bridge mouths
  restartPoints: Vec2[];
  sourceElementIds: number[];        // DomElement ids that formed this island
}

export type BridgeType = 'flat' | 'ramp';
export interface Bridge {
  id: number;
  from: number; to: number;          // island ids
  a: Vec2; b: Vec2;                  // centerline endpoints on each island edge
  width: number;                     // px, ≥ MIN_BRIDGE_WIDTH_PX
  type: BridgeType;                  // ramp when endpoint levels differ by 1
  levelA: number; levelB: number;
}

export interface Elevator {           // for level differences > 1
  id: number;
  islandFrom: number; islandTo: number;
  pos: Vec2; size: number;
  levelLow: number; levelHigh: number;
  periodSec: number;
}

export interface Item { id: number; kind: 'small' | 'large'; pos: Vec2; islandId: number }
export interface Spawn { pos: Vec2; islandId: number }
export interface Goal  { pos: Vec2; islandId: number; radius: number }

export interface Provenance {
  keptElementIds: number[];
  dropped: { elementId: number; reason: 'too-small' | 'fixed' | 'offscreen' | 'background' | 'merged' | 'other' }[];
  notes: string[];
}
```

**Invariants** (validated by `validateStage()` in `packages/schema`, which every consumer can call):
- Every island is reachable from the start's island through bridges and elevators.
- The goal is on a different island from the start, unless the stage has only 1 island.
- Bridge widths are at least the minimum, bridges don't cross islands they don't connect, and ramps connect levels that differ by exactly 1.
- Items and restart points lie inside their island's contour, at least `BALL_RADIUS_M` × `PX_PER_METER` from the edge.

## 4. Build API (packages/stage-builder)

```ts
export interface RGBAImage { width: number; height: number; data: Uint8ClampedArray }
export interface BuildInput {
  capture: CaptureBundle;
  image: RGBAImage;                  // decoded screenshot (decoding is the caller's job)
  seed: number;
  difficulty: StageData['difficulty'];
}
export interface BuildResult { stage: StageData; debug: DebugLayers }
export interface DebugLayers {       // for tools/stage-debugger; plain data, renderable to canvas
  gridCellPx: number;
  backgroundMask: Uint8Array; islandMask: Uint8Array; labels: Int32Array;
  candidateBridges: { a: Vec2; b: Vec2; from: number; to: number }[];
  timingsMs: Record<string, number>;
}
export function buildStage(input: BuildInput): BuildResult; // pure, deterministic, no I/O, no DOM
```

## 5. Simulation API (packages/physics)

```ts
export interface InputSample {       // what the sim consumes each tick (after filtering)
  tiltX: number;                     // radians, + = roll right, clamped ±MAX_TILT (0.44)
  tiltZ: number;                     // radians, + = pitch toward player
  power: boolean;                    // held: tilt acts (faithful: "hold POWER while tilting")
  jump: boolean;                     // edge-triggered by the sim
}

export type SimEvent =
  | { type: 'item'; itemId: number; kind: 'small' | 'large' }
  | { type: 'goal' }
  | { type: 'fell'; restartAt: Vec2 }
  | { type: 'landed'; impact: number }
  | { type: 'bump'; impact: number };

export interface BallState { pos: [number, number, number]; quat: [number, number, number, number]; vel: [number, number, number]; grounded: boolean }

export interface Simulation {        // same interface in worker and headless (Node) builds
  load(stage: StageData): Promise<void>;
  step(input: InputSample): { ball: BallState; events: SimEvent[] }; // advances exactly 1/SIM_HZ
  reset(to?: Vec2): void;
  dispose(): void;
}
export function createSimulation(): Promise<Simulation>;          // headless
export function createWorkerSimulation(): Promise<Simulation>;    // Web Worker proxy (async step batching)
```

Determinism: the same `StageData` plus the same `InputSample[]` must give the same event stream on the same build. Replays are `InputSample[]` at `SIM_HZ`.

## 6. Controller protocol (packages/net)

**Transport:** WebSocket through a relay (a Cloudflare Durable Object per room). The room code is **6 digits**, the same as the original. Pairing URL: `/c/<code>`.

**Controller → host** (binary, 12 bytes, little-endian):

| offset | type | field |
|---|---|---|
| 0 | u8 | msgType = 1 (INPUT) |
| 1 | u8 | buttons bitmask: bit0 POWER, bit1 JUMP, bit2 MENU |
| 2 | u16 | seq (wraps) |
| 4 | f32 | tiltX (rad, calibrated, filtered on host) |
| 8 | f32 | tiltZ (rad) |

The controller sends at 30–60 Hz while the page is visible. The host drops samples with `seq` older than the last one it saw, and treats input as stale after 250 ms (stale means tilt 0, no power).

**Everything else is JSON text frames** `{ t: string, ... }`:
- relay → both: `{t:'peer', role:'host'|'controller', connected:boolean}`
- host → controller: `{t:'state', phase:GamePhase, score:number, balls:number, timeLeft:number}`
- host → controller: `{t:'haptic', pattern:'item'|'fall'|'goal'}`
- controller → host: `{t:'calibrated'}`
- either direction: `{t:'ping', id:number, ts:number}` / `{t:'pong', id:number, ts:number}` (for RTT measurement)

```ts
export type GamePhase = 'title' | 'pairing' | 'calibrate' | 'select' | 'building' | 'intro' | 'countdown' | 'play' | 'paused' | 'goal' | 'timeup' | 'gameover' | 'result' | 'ranking';
```

## 7. HTTP API (apps/worker)

| Method and path | Body / response |
|---|---|
| `POST /api/stages` | `{url, difficulty?, seed?}` → `202 {jobId}` or `200 {stageId}` if cached |
| `GET /api/jobs/:jobId` (SSE) | events `progress {step, pct}` → `done {stageId}` or `error {code, message}` |
| `GET /api/stages/:stageId` | `StageData` |
| `GET /api/stages/:stageId/texture` | image |
| `GET /api/curated` | `{stages: {stageId, title, url, thumb}[]}` |
| `POST /api/rooms` | `{code}` (6 digits) |
| `GET /api/rooms/:code/ws?role=host\|controller` | WebSocket upgrade |
| `POST /api/scores` | `{stageId, name, score, timeMs, replay?}` → `{rank}` |
| `GET /api/scores/:stageId` | `{entries: {name, score, timeMs, at}[]}` |

Error codes: `CAPTURE_BLOCKED`, `CAPTURE_TIMEOUT`, `URL_FORBIDDEN` (SSRF, scheme, or opt-out), `BUILD_FAILED`, `UNPLAYABLE` (failed validation after N seeds), `RATE_LIMITED`.

## 8. Fixtures (created in Phase 02; everyone tests against them)

```
fixtures/
  captures/<slug>/capture.json + screenshot.png    # 5+ contrasting pages: article, card grid, dark theme, sparse, image-heavy
  stages/handmade-simple.json                      # hand-authored StageData: 4 islands, 1 ramp, 1 elevator, items
  stages/handmade-simple.png                       # its texture
  replays/handmade-simple.keyboard.json            # InputSample[] that reaches the goal (added in Phase 05)
```

The WWMMM reference stage (no license) is **downloaded on demand** to `reference/` (gitignored) by `pnpm ref:fetch`. It is never committed.
