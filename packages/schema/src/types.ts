/**
 * Contract types, transcribed from plans/contracts.md (v0.1.0). Section numbers refer to that file.
 * Do not add fields here without a Contract Change Request; the orchestrator owns this file after Phase 02.
 */

// ================================================================================================
// §2 Capture: CaptureBundle (Capture → Builder)
// ================================================================================================

export interface CaptureBundle {
  schema: 'wwm.capture/1';
  captureId: string; // sha256(normalizedUrl + capturedAt)
  url: string; // normalized final URL after redirects
  title: string;
  capturedAt: string; // ISO
  viewport: { width: number; height: number }; // default 1280 × 800
  page: { width: number; height: number }; // full scrollable size, height capped (MAX_PAGE_HEIGHT_PX = 6000)
  screenshot: { path: string; width: number; height: number; format: 'png' | 'webp' };
  backgroundColor: string; // computed <body>/<html> bg, "#rrggbb"
  elements: DomElement[];
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
} // page px

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
}

// ================================================================================================
// §3 Level: StageData (Builder → Renderer, Physics, Solver, Storage). Everything in page px except level.
// ================================================================================================

export type Vec2 = [number, number];

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface StageData {
  schema: 'wwm.stage/1';
  stageId: string; // sha256(captureId + seed + builderVersion + difficulty)
  builderVersion: string; // semver of packages/stage-builder
  seed: number; // uint32
  difficulty: Difficulty;
  source: { url: string; title: string; captureId: string; pageWidth: number; pageHeight: number };
  texture: { path: string; width: number; height: number }; // the screenshot the island tops sample
  timeLimitSec: number;
  islands: Island[];
  bridges: Bridge[];
  elevators: Elevator[];
  items: Item[];
  start: Spawn;
  goal: Goal;
  provenance: Provenance; // why regions were kept/dropped (debuggability requirement)
}

export interface Island {
  id: number;
  contour: Vec2[]; // outer ring, CCW, simplified, no self-intersection
  holes: Vec2[][]; // CW rings
  level: number; // integer height step
  guardrails: Vec2[][]; // open polylines along the edge, gaps at bridge mouths
  restartPoints: Vec2[];
  sourceElementIds: number[]; // DomElement ids that formed this island
}

export type BridgeType = 'flat' | 'ramp';
export interface Bridge {
  id: number;
  from: number;
  to: number; // island ids
  a: Vec2;
  b: Vec2; // centerline endpoints on each island edge
  width: number; // px, ≥ MIN_BRIDGE_WIDTH_PX
  type: BridgeType; // ramp when endpoint levels differ by 1
  levelA: number;
  levelB: number;
}

export interface Elevator {
  // for level differences > 1
  id: number;
  islandFrom: number;
  islandTo: number;
  pos: Vec2;
  size: number;
  levelLow: number;
  levelHigh: number;
  periodSec: number;
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

export type DropReason = 'too-small' | 'fixed' | 'offscreen' | 'background' | 'merged' | 'other';
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
  image: RGBAImage; // decoded screenshot (decoding is the caller's job)
  seed: number;
  difficulty: StageData['difficulty'];
}
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

// ================================================================================================
// §5 Simulation API (implemented by packages/physics)
// ================================================================================================

export interface InputSample {
  // what the sim consumes each tick (after filtering)
  tiltX: number; // radians, + = roll right, clamped ±MAX_TILT (0.44)
  tiltZ: number; // radians, + = pitch toward player
  power: boolean; // held: tilt acts (faithful: "hold POWER while tilting")
  jump: boolean; // edge-triggered by the sim
}

export type SimEvent =
  | { type: 'item'; itemId: number; kind: 'small' | 'large' }
  | { type: 'goal' }
  | { type: 'fell'; restartAt: Vec2 }
  | { type: 'landed'; impact: number }
  | { type: 'bump'; impact: number };

export interface BallState {
  pos: [number, number, number];
  quat: [number, number, number, number];
  vel: [number, number, number];
  grounded: boolean;
}

export interface Simulation {
  // same interface in worker and headless (Node) builds
  load(stage: StageData): Promise<void>;
  step(input: InputSample): { ball: BallState; events: SimEvent[] }; // advances exactly 1/SIM_HZ
  reset(to?: Vec2): void;
  dispose(): void;
}
/** Signatures of `createSimulation` (headless) and `createWorkerSimulation` (Web Worker proxy) in @wwm/physics. */
export type CreateSimulationFn = () => Promise<Simulation>;

/** A replay is `InputSample[]` at SIM_HZ (contracts §5). */
export type Replay = InputSample[];

// ================================================================================================
// §6 Controller protocol (packages/net)
// ================================================================================================

export type GamePhase =
  | 'title'
  | 'pairing'
  | 'calibrate'
  | 'select'
  | 'building'
  | 'intro'
  | 'countdown'
  | 'play'
  | 'paused'
  | 'goal'
  | 'timeup'
  | 'gameover'
  | 'result'
  | 'ranking';

export type RoomRole = 'host' | 'controller';
export type HapticPattern = 'item' | 'fall' | 'goal';

/** Decoded form of the 12-byte binary INPUT frame (controller → host). */
export interface ControllerInputFrame {
  seq: number; // u16, wraps
  power: boolean; // bit0
  jump: boolean; // bit1
  menu: boolean; // bit2
  tiltX: number; // f32 radians
  tiltZ: number; // f32 radians
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
/** `POST /api/stages` → `202 {jobId}` or `200 {stageId}` if cached. */
export type CreateStageResponse = { jobId: string } | { stageId: string };

/** `GET /api/jobs/:jobId` server-sent events. The SSE `event:` name is `type`; `data:` is the rest as JSON. */
export type JobEvent =
  | { type: 'progress'; step: string; pct: number }
  | { type: 'done'; stageId: string }
  | { type: 'error'; code: ApiErrorCode; message: string };

/** `GET /api/curated`. */
export interface CuratedStage {
  stageId: string;
  title: string;
  url: string;
  thumb: string;
}
export interface CuratedResponse {
  stages: CuratedStage[];
}

/** `POST /api/rooms`. */
export interface CreateRoomResponse {
  code: string; // 6 digits
}

/** `POST /api/scores`. */
export interface SubmitScoreRequest {
  stageId: string;
  name: string;
  score: number;
  timeMs: number;
  replay?: Replay;
}
export interface SubmitScoreResponse {
  rank: number;
}

/** `GET /api/scores/:stageId`. `at` is an ISO timestamp. */
export interface ScoreEntry {
  name: string;
  score: number;
  timeMs: number;
  at: string;
}
export interface ScoresResponse {
  entries: ScoreEntry[];
}
