/**
 * Contract types, transcribed from plans/contracts.md (v0.2.0). Section numbers refer to that file.
 * Do not add fields here without a Contract Change Request; the orchestrator owns this file after Phase 02.
 */

// ================================================================================================
// §2 Capture: CaptureBundle (Capture → Builder)
// ================================================================================================

export interface CaptureBundle {
  schema: 'wwm.capture/1';
  captureId: string; // computeCaptureId(normalizedUrl | capturedAt)
  url: string; // normalized final URL after redirects
  title: string;
  capturedAt: string; // ISO
  viewport: { width: number; height: number };
  page: { width: number; height: number }; // CSS px; width = viewport width; height ≤ MAX_PAGE_HEIGHT_PX
  /** width/height are IMAGE px (= CSS px × scale); scale = device px per CSS px (CAPTURE_DPR; legacy fixtures 1). */
  screenshot: { path: string; width: number; height: number; format: 'png' | 'webp'; scale: number };
  backgroundColor: string; // "#rrggbb"
  elements: DomElement[]; // rects in PAGE CSS px (not slice-local)
}

export type ElementKind =
  | 'text'
  | 'heading'
  | 'image'
  | 'video'
  | 'canvas'
  | 'button'
  | 'link'
  | 'input'
  | 'nav'
  | 'header'
  | 'footer'
  | 'adlike'
  | 'block';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DomElement {
  id: number;
  kind: ElementKind;
  rect: Rect;
  lines?: Rect[]; // per-line text rects (Range.getClientRects)
  bg?: string; // own computed background if not transparent
  depth: number; // DOM depth
  z: number; // resolved stacking hint
  fixed: boolean; // position fixed/sticky
  text?: string; // trimmed ≤ 120 chars (for labels / optional AI)
  fontSize?: number;
  href?: string; // contracts §10.1: absolute http(s) link target (links only), ≤ 2048 chars
}

// ================================================================================================
// §3 Level: StageData (Builder → Renderer, Physics, Solver, Storage). Every coordinate is in STAGE-LOCAL
// px (origin = top-left of the slice) except `level`. A long page becomes several stages played as a run.
// ================================================================================================

export type Vec2 = [number, number];

export type Difficulty = 'easy' | 'normal' | 'hard';

/** Which part of the page a stage covers (page CSS px). */
export interface StageSlice {
  index: number; // 0-based
  count: number; // total slices of the capture
  y: number; // page-space origin of this stage
  height: number;
}

export interface StageData {
  schema: 'wwm.stage/2';
  stageId: string; // computeStageId(captureId | slice.index | seed | builderVersion | difficulty)
  builderVersion: string; // semver of packages/stage-builder
  seed: number; // uint32
  difficulty: Difficulty;
  source: {
    url: string;
    title: string;
    captureId: string;
    pageWidth: number;
    pageHeight: number;
    slice: StageSlice; // page-space origin of this stage
  };
  size: { width: number; height: number }; // stage extent in local px
  /** Image covering exactly `size`; scale = image px per stage px. UV = local px / (texture size / scale). */
  texture: { path: string; width: number; height: number; scale: number };
  timeLimitSec: number; // default TIME_LIMIT_SEC_DEFAULT
  islands: Island[];
  bridges: Bridge[];
  elevators: Elevator[];
  items: Item[];
  portals?: Portal[]; // contracts §10.1 (optional; missing = [])
  start: Spawn;
  goal: Goal;
  provenance: Provenance; // why regions were kept/dropped (debuggability requirement)
}

export interface Island {
  id: number;
  contour: Vec2[]; // outer ring: positive shoelace area in (x right, y down) coords — use isCCW()
  holes: Vec2[][]; // opposite orientation
  level: number; // FLOAT, top height in LEVEL_HEIGHT_M units (ball diameters)
  guardrails: Vec2[][]; // open polylines along the edge, gaps at bridge/elevator mouths
  restartPoints: Vec2[];
  sourceElementIds: number[]; // DomElement ids that formed this island
}

export type BridgeType = 'flat' | 'ramp';
export interface Bridge {
  id: number;
  from: number;
  to: number; // island ids
  a: Vec2;
  b: Vec2; // centerline endpoints on each island edge (2013: cardinal directions)
  width: number; // ≥ MIN_BRIDGE_WIDTH_PX
  type: BridgeType; // 'ramp' iff levelA ≠ levelB
  levelA: number; // = island levels; |Δlevel·LEVEL_HEIGHT_M| / (|b−a| / PX_PER_METER) ≤ MAX_RAMP_SLOPE
  levelB: number;
}

/** E: 2013 bridge type 1 — trigger-activated lift across a short gap. */
export interface Elevator {
  id: number;
  islandFrom: number; // = lower island
  islandTo: number;
  a: Vec2; // footprint like a bridge: lower platform at a, upper at b
  b: Vec2;
  width: number;
  levelLow: number;
  levelHigh: number;
  travelSec: number; // default 1 + 0.162 × Δh_m, cubicInOut
  cooldownSec: number; // default ELEVATOR_COOLDOWN_SEC
}

export type ItemKind = 'small' | 'large';
export interface Item {
  id: number;
  kind: ItemKind;
  pos: Vec2;
  islandId: number;
}
export interface Spawn {
  pos: Vec2;
  islandId: number;
}
export interface Goal {
  pos: Vec2;
  islandId: number;
  radius: number;
}

export type DropReason =
  | 'too-small'
  | 'fixed'
  | 'offscreen'
  | 'background'
  | 'merged'
  | 'out-of-slice'
  | 'other';
export interface Provenance {
  keptElementIds: number[];
  dropped: { elementId: number; reason: DropReason }[];
  notes: string[];
}

// ================================================================================================
// §4 Build API (implemented by packages/stage-builder; types live here so consumers share them)
// ================================================================================================

export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
export interface BuildInput {
  capture: CaptureBundle;
  image: RGBAImage; // full decoded screenshot (image px = page px × capture.screenshot.scale)
  sliceIndex: number; // 0-based; slice = [i·MAX_STAGE_HEIGHT_PX, min(+MAX_STAGE_HEIGHT_PX, page.height))
  seed: number;
  difficulty: StageData['difficulty'];
}
/** `stage.texture.path = ''` — the caller crops + stores the texture and fills it in. */
export interface BuildResult {
  stage: StageData;
  debug: DebugLayers;
}
export interface DebugLayers {
  // for tools/stage-debugger; plain data, renderable to canvas
  gridCellPx: number;
  backgroundMask: Uint8Array;
  islandMask: Uint8Array;
  labels: Int32Array;
  candidateBridges: { a: Vec2; b: Vec2; from: number; to: number }[];
  timingsMs: Record<string, number>;
}
/** Signature of `buildStage` in @wwm/stage-builder: pure, deterministic, no I/O, no DOM. */
export type BuildStageFn = (input: BuildInput) => BuildResult;
/** Signature of `sliceCount` (implemented in @wwm/schema slice.ts; re-exported by @wwm/stage-builder). */
export type SliceCountFn = (capture: CaptureBundle) => number;

// ================================================================================================
// §5 Simulation API (implemented by packages/physics)
// ================================================================================================

/**
 * Tilt model (E): tilt ROTATES THE GRAVITY VECTOR (it doesn't push the ball), expressed in the camera's
 * yaw frame (forward = away from the camera). Tilt only acts while `power` is held; on release the target
 * tilt returns to 0.
 */
export interface InputSample {
  tiltX: number; // rad, roll (+ = right), |·| ≤ MAX_TILT_ROLL (keyboard ≤ KEYBOARD_TILT)
  tiltZ: number; // rad, pitch (+ = away from camera/forward), |·| ≤ MAX_TILT_PITCH
  frameYaw: number; // rad, heading of the frame tilt is relative to (renderer camera yaw; solver chooses its own)
  power: boolean;
  jump: boolean; // edge-triggered by the sim
}

export type SimEvent =
  | { type: 'item'; itemId: number; kind: 'small' | 'large' }
  | { type: 'goal' }
  | { type: 'fell'; restartAt: Vec2 } // restart = nearest restart point on the last-touched island
  | { type: 'lost' } // FALL_LOST_DELAY_SEC after 'fell'
  | { type: 'island'; islandId: number } // first contact with a different island
  | { type: 'elevator'; elevatorId: number; phase: 'start' | 'end' }
  | { type: 'landed'; impact: number }
  | { type: 'bump'; impact: number }
  | { type: 'portal'; portalId: number }; // contracts §10.1

export interface BallState {
  pos: [number, number, number];
  quat: [number, number, number, number];
  vel: [number, number, number];
  grounded: boolean;
}

/** What `Simulation.step` returns. `elevators[].y` is the current platform height (world m). */
export interface SimStepResult {
  ball: BallState;
  events: SimEvent[];
  elevators: { id: number; y: number }[];
}

export interface Simulation {
  // same interface in worker and headless (Node) builds
  load(stage: StageData): Promise<void>;
  step(input: InputSample): SimStepResult; // advances exactly 1/SIM_HZ
  reset(to?: Vec2): void;
  dispose(): void;
}
/** Signatures of `createSimulation` (headless) and `createWorkerSimulation` (Web Worker proxy) in @wwm/physics. */
export type CreateSimulationFn = () => Promise<Simulation>;

/** A replay is `InputSample[]` at SIM_HZ (contracts §5). */
export type Replay = InputSample[];
/** contracts §9 v0.2.2/v0.2.5: a replay tagged with the physics build that recorded it. */
export interface VersionedReplay {
  physicsVersion: string;
  inputs: Replay;
  /** Tick at which the stage timer started (2013: GO, or the first POWER press on the first game). */
  timerStartTick?: number;
}

// ================================================================================================
// §6 Controller protocol (packages/net)
// ================================================================================================

export type GamePhase =
  | 'title'
  | 'howto'
  | 'pairing'
  | 'calibrate'
  | 'select'
  | 'building'
  | 'intro'
  | 'countdown'
  | 'play'
  | 'paused' // = map view: physics + timer stopped
  | 'falling'
  | 'restarting'
  | 'goal'
  | 'timeup'
  | 'gameover'
  | 'result'
  | 'ranking'
  | 'error';

export type RoomRole = 'host' | 'controller';
export type HapticPattern = 'item' | 'large' | 'fall' | 'goal';

/** Decoded form of the 12-byte binary INPUT frame (controller → host). The host adds `frameYaw`. */
export interface ControllerInputFrame {
  seq: number; // u16, wraps
  power: boolean; // bit0
  jump: boolean; // bit1
  menu: boolean; // bit2
  tiltX: number; // f32 radians, calibrated, roll
  tiltZ: number; // f32 radians, calibrated, pitch
}

export interface PeerMessage {
  t: 'peer';
  role: RoomRole;
  connected: boolean;
} // relay → both
export interface StateMessage {
  t: 'state';
  phase: GamePhase;
  score: number;
  balls: number;
  timeLeft: number;
} // host → controller
export interface HapticMessage {
  t: 'haptic';
  pattern: HapticPattern;
} // host → controller
/** Optional (E: 2013 sent this): ≤ 10 Hz ball position for a phone mini-map. */
export interface PosMessage {
  t: 'pos';
  x: number;
  y: number;
  heading: number;
} // host → controller
/** Optional (E: typing on the phone). */
export interface TextMessage {
  t: 'text';
  field: 'url' | 'name';
  value: string;
} // controller → host
export interface CalibratedMessage {
  t: 'calibrated';
} // controller → host
export interface PingMessage {
  t: 'ping';
  id: number;
  ts: number;
} // either direction
export interface PongMessage {
  t: 'pong';
  id: number;
  ts: number;
} // either direction

/** Every JSON text frame on the room socket. */
export type ControlMessage =
  | PeerMessage
  | StateMessage
  | HapticMessage
  | PosMessage
  | TextMessage
  | CalibratedMessage
  | PingMessage
  | PongMessage;

// ================================================================================================
// §7 HTTP API (apps/worker)
// ================================================================================================

export type ApiErrorCode =
  | 'CAPTURE_BLOCKED'
  | 'CAPTURE_TIMEOUT'
  | 'URL_FORBIDDEN'
  | 'BUILD_FAILED'
  | 'UNPLAYABLE'
  | 'RATE_LIMITED';

export interface ApiError {
  code: ApiErrorCode;
  message: string;
}

/** `POST /api/stages` body. */
export interface CreateStageRequest {
  url: string;
  difficulty?: Difficulty;
  seed?: number;
}
/** `POST /api/stages` → `202 {jobId}` or `200 {runId, stageIds[]}` if cached. */
export type CreateStageResponse = { jobId: string } | { runId: string; stageIds: string[] };

/** `GET /api/jobs/:jobId` server-sent events. The SSE `event:` name is `type`; `data:` is the rest as JSON. */
export type JobEvent =
  | { type: 'progress'; step: string; pct: number }
  | { type: 'done'; runId: string; stageIds: string[] }
  | { type: 'error'; code: ApiErrorCode; message: string };

/** `GET /api/runs/:runId`: all slices of one page capture, in play order. */
export interface RunResponse {
  runId: string;
  url: string;
  title: string;
  stageIds: string[];
}

/** `GET /api/curated`. */
export interface CuratedRun {
  runId: string;
  title: string;
  url: string;
  thumb: string;
  stars: number;
}
export interface CuratedResponse {
  runs: CuratedRun[];
}

/**
 * `POST /api/rooms` (v0.2.7, CCR-12-2). Both tokens are 128 random bits, base64url.
 * - `hostToken`: the desktop connects with `?role=host&token=<hostToken>` (always required).
 * - `pairToken`: goes in the pairing URL's fragment, `/c/<code>#p=<pairToken>` (never sent to the server in
 *   the page request). The phone connects with `?role=controller&token=<pairToken>`. Without a token a
 *   controller is admitted only while no controller is connected (typed 6-digit code, as in 2013).
 */
export interface CreateRoomResponse {
  code: string; // 6 digits
  hostToken: string;
  pairToken: string;
}

/** WebSocket close codes used by the room relay (contracts §9 v0.2.3 + v0.2.7). */
export type RoomCloseCode = 4400 | 4401 | 4404 | 4409;

/** `POST /api/scores`, per-stage board. */
export interface SubmitStageScoreRequest {
  kind: 'stage';
  stageId: string;
  name: string;
  score: number;
  timeMs: number;
  replay?: VersionedReplay | Replay; // bare array = legacy, stored unverified
}
/** `POST /api/scores`, global run board (as 2013's single top-10 of session totals). */
export interface SubmitRunScoreRequest {
  kind: 'run';
  runId?: string;
  name: string;
  totalScore: number;
  stages: { stageId: string; score: number; timeMs: number }[];
}
export type SubmitScoreRequest = SubmitStageScoreRequest | SubmitRunScoreRequest;
export interface SubmitScoreResponse {
  rank: number;
  verified?: boolean; // replay re-simulated and matched
  note?: string;
}

/** `GET /api/scores/stage/:stageId` · `GET /api/scores/run`. `at` is an ISO timestamp. */
export interface ScoreEntry {
  name: string;
  score: number;
  timeMs?: number;
  at: string;
}
export interface ScoresResponse {
  entries: ScoreEntry[];
}

// ── contracts §10 (v0.3.0) ────────────────────────────────────────────────────────────────────────

/** §10.1 A link on the page that leads to another site's maze. */
export interface Portal {
  id: number;
  islandId: number;
  pos: Vec2;
  href: string;
  label: string; // ≤ 60 chars
  sourceElementId: number;
}

/** §10.2 postMessage payload handing a capture made in the user's browser to `/play/local`. */
export interface LocalCaptureMessage {
  type: 'wwm:capture';
  version: 1;
  bundle: CaptureBundle;
  /** Omitted/null = DOM-only bookmarklet capture ("sketch mode", contracts v0.3.1). */
  image?: { mime: 'image/png' | 'image/webp'; bytes: ArrayBuffer } | null;
}

/** §10.3 AI docent. */
export interface DocentRequest {
  question: string; // ≤ 500 chars
  history?: { role: 'user' | 'assistant'; text: string }[]; // ≤ 6
}
export interface DocentCitation {
  title: string;
  path: string;
  anchor?: string;
  url?: string;
}
export type DocentEvent =
  | { type: 'delta'; text: string }
  | { type: 'citations'; items: DocentCitation[] }
  | { type: 'done' }
  | { type: 'error'; code: 'DOCENT_UNAVAILABLE' | 'RATE_LIMITED' | 'QUESTION_REJECTED'; message: string };
