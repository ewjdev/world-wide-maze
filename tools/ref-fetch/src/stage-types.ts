// TEMP: replace with @wwm/schema import at merge.
// This is a local copy of plans/contracts.md §1 (constants) and §3 (StageData) at contract v0.1.0.
// It exists only because Phase 02 (packages/schema) runs in parallel with Phase 01.
// Do not extend it. Delete it once `import type { StageData } from '@wwm/schema'` works.

export const PX_PER_METER = 40;
export const BALL_RADIUS_M = 0.5;
export const LEVEL_HEIGHT_M = 1.5;
export const MIN_BRIDGE_WIDTH_PX = 100;
export const MIN_ISLAND_SIZE_PX = 120;

export type Vec2 = [number, number];

export interface StageData {
  schema: 'wwm.stage/1';
  stageId: string;
  builderVersion: string;
  seed: number;
  difficulty: 'easy' | 'normal' | 'hard';
  source: { url: string; title: string; captureId: string; pageWidth: number; pageHeight: number };
  texture: { path: string; width: number; height: number };
  timeLimitSec: number;
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
  contour: Vec2[];
  holes: Vec2[][];
  level: number;
  guardrails: Vec2[][];
  restartPoints: Vec2[];
  sourceElementIds: number[];
}

export type BridgeType = 'flat' | 'ramp';
export interface Bridge {
  id: number;
  from: number; to: number;
  a: Vec2; b: Vec2;
  width: number;
  type: BridgeType;
  levelA: number; levelB: number;
}

export interface Elevator {
  id: number;
  islandFrom: number; islandTo: number;
  pos: Vec2; size: number;
  levelLow: number; levelHigh: number;
  periodSec: number;
}

export interface Item { id: number; kind: 'small' | 'large'; pos: Vec2; islandId: number }
export interface Spawn { pos: Vec2; islandId: number }
export interface Goal { pos: Vec2; islandId: number; radius: number }

export interface Provenance {
  keptElementIds: number[];
  dropped: { elementId: number; reason: 'too-small' | 'fixed' | 'offscreen' | 'background' | 'merged' | 'other' }[];
  notes: string[];
}
