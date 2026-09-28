import type { BallState, InputSample, StageData, Vec2 } from '@wwm/schema';

export interface RaceGate {
  id: string;
  center: [number, number, number];
  /** Unit forward normal in world x/z. */
  normal: [number, number];
  halfWidth: number;
  halfHeight: number;
  kind: 'sector' | 'finish';
}
export interface RaceCourse {
  schema: 'wwm.race-course/1';
  courseId: string;
  title: string;
  description: string;
  stage: StageData;
  textureUrl: string;
  gates: RaceGate[];
  generatorVersion: string;
  seed: number;
  stunts?: RaceStunts;
  /** Opt-in terrain momentum and grounded charging rules. Absent retains legacy Race physics. */
  physicsProfile?: 'elevation-v1';
}
export type PracticeReason =
  | 'fall'
  | 'recovery'
  | 'pause'
  | 'focus-loss'
  | 'controller-disconnect'
  | 'recording-limit';
export interface RaceProgress {
  tick: number;
  nextGate: number;
  sectorTicks: number[];
  finishTick: number | null;
  reasons: PracticeReason[];
}
export interface RaceRecovery {
  /** Applied before this 1-based physics tick. Destination uses stage pixels. */
  beforeTick: number;
  destination: Vec2;
  reason: 'fall' | 'recovery';
}
export interface RaceRecording {
  format: 'wwm.race-input/1' | 'wwm.race-input/2';
  /** 3 little-endian float64 values + one flag byte per sample, exact consumed doubles. */
  data: ArrayBuffer;
  ticks: number;
  truncated: boolean;
  recoveries: RaceRecovery[];
}
export interface RaceCompatibility {
  courseId: string;
  physicsVersion: string;
  physicsConfig: string;
  rulesVersion: string;
  hz: number;
}
export interface RaceAttempt {
  schema: 'wwm.race-attempt/1';
  id: string;
  createdAt: number;
  compatibility: RaceCompatibility;
  inputSource: 'keyboard' | 'phone' | 'mixed';
  outcome: 'finished' | 'abandoned';
  progress: RaceProgress;
  recording: RaceRecording;
}
export interface RaceGhostTrack {
  attemptId: string;
  hz: number;
  /** Pose zero is initial state; completed tick N is index N. */
  pos: Float32Array;
  quat: Float32Array;
  /** 1 at recovered tick; interpolation must not span this boundary. */
  discontinuities: Uint8Array;
  ticks: number;
  progress: RaceProgress;
}
export interface RaceStep {
  tick: number;
  previous: BallState['pos'];
  current: BallState['pos'];
  fell?: boolean;
}

export interface RaceInputSample extends InputSample {
  turbo?: boolean;
}
export interface RaceStunts {
  version: 1;
  cruiseSpeed: number;
  chargeTicks: number;
  turboDeltaV: number;
  turboMaxSpeed: number;
  landingDeltaV: number;
  launchPads: { id: string; gate: RaceGate; upSpeed: number; minSpeed: number; landingIslandIds: number[] }[];
}
export interface RaceMechanics {
  enabled: boolean;
  chargeTicks: number;
  chargeRequired: number;
  chargingReason?: 'charging' | 'slow' | 'downhill' | 'airborne' | 'recovering' | 'disabled';
  /** Derived convenience flag: at least one stored turbo. */
  ready: boolean;
  turboCharges: number;
  lives: number;
  maxLives: number;
  exhausted: boolean;
  turboTicks: number;
  launches: number;
  landings: number;
  lastEvent: string | null;
}
