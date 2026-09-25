# Shared Contracts

**Every sub-agent reads this before writing code.** These are the only interfaces that cross phase boundaries. They live in code at `packages/schema`, and the code must match this file.

**Changing a contract:** agents do not edit `packages/schema` unless their brief says so. If you need a change, put a **Contract Change Request** in your hand-off report:
- the field
- why you need it
- which consumers are affected

The orchestrator applies the change and notifies the other agents.

**Contract version: `0.3.0`** (G0, 2026-09-25). Changes are recorded in `packages/schema/CHANGELOG.md` and §9. The numbers come from the recovered 2013 build. See `docs/reference/fidelity-spec.md` (E = evidenced) and `docs/reference/contract-deltas.md`.

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

**v0.2.3, from the Phase 06 CCRs (orchestrator, 2026-09-25). Documentation only:**
- **WebSocket close codes:**
  - `4404`: room not found or expired.
  - `4409`: replaced by a newer socket of the same role.
  - `4400`: bad role.
- **Relay keepalive:** the relay sends pings with **negative** ids and consumes their pongs itself.
- **Controller keepalive:** outside play, the controller sends neutral INPUT frames at 4 Hz. The host treats 1.5 s of silence as disconnected, which catches suspended iOS pages whose sockets stay open.
- **`GET /api/rooms/:code/stats`:** relay diagnostics for dev only. Phase 12 must gate it or remove it in production.

**v0.2.4, from the Phase 07 CCRs (orchestrator, 2026-09-25):**
- **CCR-07-1:** `computeRunId(captureId, seed, builderVersion, difficulty)` is now in `@wwm/schema`. It hashes `run|captureId|seed|builderVersion|difficulty`.
- **CCR-07-2, accepted:** `CaptureBundle.screenshot` is the **1× analysis image** (`scale: 1`), because a full DPR-2 page can exceed the Worker's 128 MB. **DPR 2 applies only to the per-slice stage textures** (`stage.texture.scale = 2`). This supersedes the G0 note "screenshot.scale = 2".
- **CCR-07-3, accepted:**
  - The KV key is `run:<normUrl>:<difficulty>:<builderVersion>`, plus `:seed=<n>` only when the client chose a seed.
  - The default seed = `hashString(normalizedUrl)`, so popular pages share stages.
- **`CONTRACT_VERSION`** in code is now kept in sync (`0.2.4`).
- **Real builder wired into the worker.** Live capture plus build of the 7 fixture URLs (local Chromium): slice 0 ready in 0.96–4.69 s (p50 2.6 s), with the build step 37–169 ms.

**v0.2.5, from the Phase 10 CCRs (orchestrator, 2026-09-25):**
- **CCR-10-1:** `SubmitStageScoreRequest.replay` is `VersionedReplay {physicsVersion, inputs} | Replay`. A bare array is legacy and is stored unverified.
- **CCR-10-2:** `SubmitScoreResponse` gains optional `verified` and `note` fields.
- **New endpoint:** `GET /api/scores/stage/:stageId/ghost` returns the #1 replay track for ghost racing.
- **Share page:** `GET /s/:stageId?beat=&by=`, plus a card image at `GET /api/share/:stageId/card`.
- **G3 check (orchestrator):** every credit, date and award on `/about` (`apps/web/src/pages/about/history.ts`) was cross-checked against `research/world-wide-maze.md`. No unsupported claims found.

**v0.2.6, from the Phase 08b CCRs (orchestrator, 2026-09-25):**
- **`VersionedReplay.timerStartTick?`:** the tick at which the stage timer started. In 2013 that was GO, except on the first game, where it was the first POWER press. The server clamps it to be no later than the first POWER press, so it can lower the bonus but never inflate it.
- **Ghost endpoint:** `GET /api/scores/stage/:id/ghost` returns **204** when there's no ghost yet (previously 404), so the browser console stays clean.
- **Physics driver:** the game now runs lockstep physics on the main thread by default, so recorded replays verify exactly (3 of 3 identical). The worker driver is still available with `?physics=worker`.

**v0.2.7, from the Phase 12 CCRs (orchestrator, 2026-09-25):**
- **CCR-12-2, pairing secret (security: room takeover by guessing the code):**
  - `POST /api/rooms` → `{code, hostToken, pairToken}`. Both tokens are random: 128 bits, base64url.
  - The pairing URL is `/c/<code>#p=<pairToken>`. The token lives in the **fragment**, so it never reaches server logs or the Referer header. The QR code encodes the full URL.
  - Typing the 6-digit code alone is still allowed (2013 had typed codes), but only while **no controller is connected**. It can never replace a live controller.
  - WebSocket: `GET /api/rooms/:code/ws?role=host&token=<hostToken>` or `?role=controller&token=<pairToken>`. The controller token is optional only as described above.
  - A socket may replace an existing one of the same role (4409) only with a valid token. An invalid or missing token where one is required closes with **`4401`**.
  - After a controller authenticates with the pairTok, the relay rotates nothing. The phone remembers the token in `sessionStorage` for reconnects.
- **CCR-12-3:** `CaptureBundleSchema` size limits: `elements` ≤ 20,000, `title` ≤ 512, `url` ≤ 2,048, `text` ≤ 120 (already), `lines` ≤ 200 per element.
- **CCR-12-1:** `@wwm/schema` calls `z.config({ jitless: true })`, so the CSP never sees an `eval` probe.
- **CCR-12b-1, accepted:** "no controller connected" means no controller heard from in the last `CONTROLLER_LIVE_MS` (3 s). A locked phone that joined by typed code can therefore rejoin. The QR phone reclaims control when it reconnects.
- **CCR-12b-2, accepted:** the host keeps its tokens in `sessionStorage`. A `#h=<hostToken>&p=<pairToken>` link lets another tab rejoin as host. `/p/<code>` without the host token gets 4401.
- **CCR-12b-3, accepted:** a malformed token gets HTTP 400 before the WebSocket upgrade.
- **Open:** the WS token travels in the query string and can appear in Cloudflare request logs. Options are log redaction or moving it to `Sec-WebSocket-Protocol` (a contract change). Decide before production.

---

## 10. v0.3.0: signature features (orchestrator, 2026-09-25)

### 10.1 Link portals (the "World Wide" in World Wide Maze)
- `DomElement.href?: string`: an absolute `http(s)` URL of at most 2,048 characters. Only for `kind: 'link'` (or a `button` wrapped in an `<a>`). `fragment`, `javascript:`, `mailto:` and similar are dropped at capture.
- `StageData.portals?: Portal[]`. It's **optional** (missing means `[]`), so existing stages stay valid, and the tag stays `wwm.stage/2`.
  ```ts
  export interface Portal {
    id: number;
    islandId: number;          // the island built from (or containing) the link element
    pos: Vec2;                 // inside the island, ≥ BALL_RADIUS_PX clearance, not on start/goal
    href: string;              // normalized target URL (same normalization as capture)
    label: string;             // link text, ≤ 60 chars
    sourceElementId: number;
  }
  export const MAX_PORTALS = 6;           // per stage; prefer off-site, distinct, well-labelled links
  export const PORTAL_RADIUS_M = 0.926;   // sensor like the goal
  ```
- **Invariants:**
  - Portals lie inside their island with clearance.
  - There are at most `MAX_PORTALS`, with unique `href` values.
  - `href` passes the capture URL policy shape (http(s), no credentials).
- **`SimEvent` gains `{ type: 'portal'; portalId: number }`.** It fires once on entering the sensor and re-arms after the ball leaves.
- **Game rule (N):** entering a portal pauses play and asks "Travel to <label> (<host>)?". Yes builds that URL through `POST /api/stages` and starts its run. Score and spare balls carry over as a **web journey**.
  - A breadcrumb trail of the sites visited is shown and shareable.
  - The goal still ends the stage normally. Portals are optional exits.

### 10.2 Local capture handoff (browser extension and bookmarklet)
- `/play/local` accepts a capture made in the user's own browser. The game page listens for
  `window.postMessage({ type: 'wwm:capture', version: 1, bundle: CaptureBundle, image: { mime: 'image/png'|'image/webp', bytes: ArrayBuffer } })`
  **only** from an allowed origin: the extension's content script on the same page, or `window.opener` when it's the bookmarklet tab.
- The bundle is validated with `parseCapture` (including the v0.2.7 size limits). It's built client-side by `@wwm/stage-builder`, and nothing is uploaded unless the user chooses **Share**. Share then uses `POST /api/stages/upload`: multipart `{bundle, image}` → the same pipeline minus capture, subject to the same limits, rate limits and moderation hook.
- The source is recorded as `provenance.notes: ['local-capture']`. Shared local captures are unlisted.

### 10.3 AI docent (runtime AI through Cloudflare AI Gateway)
- `POST /api/docent` `{ question: string (≤ 500 chars), history?: {role:'user'|'assistant', text}[] (≤ 6) }` returns an SSE stream:
  - `delta {text}` (repeated)
  - `citations {items: {title, path, anchor?, url?}[]}`
  - `done {}`, or `error {code, message}`
- It answers **only** from the project corpus: `research/**`, `docs/reference/**`, `docs/build-log/**`, `RESEARCH.md`, and the `/about` history data. It must cite, and must say it doesn't know when the corpus doesn't cover a question.
- Error codes: `DOCENT_UNAVAILABLE`, `RATE_LIMITED`, `QUESTION_REJECTED`.
- Model calls go through **Cloudflare AI Gateway** (config: `AI_GATEWAY_ACCOUNT_ID`, `AI_GATEWAY_ID`, and the provider key as a Worker secret). There's a mock provider for dev and tests. Responses are cached by normalized question. A per-IP and global daily cap stays under a configurable budget.
