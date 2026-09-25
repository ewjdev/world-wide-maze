/**
 * @wwm/engine: three.js (WebGPURenderer, WebGL2 fallback) renderer for World Wide Maze stages.
 * See README.md for the API, the yaw convention and the quality ladder.
 */
export { CHASE, ChaseCamera, tiltQuaternion, wrapAngle, yawFromDirection } from './camera/chase.ts';
export { type IntroMode, type IntroTimeline, introTimeline } from './camera/intro.ts';
export {
  type ControlState,
  createEngine,
  type Engine,
  type EngineOptions,
  type EngineStats,
  type StageImage,
  type ViewMode,
} from './engine.ts';
export { buildHeightfield, type Heightfield, lineOfSight, sampleTop } from './geom/heightfield.ts';
export { type MeshData, mergeMeshData } from './geom/mesh.ts';
export {
  buildStageMeshes,
  elevatorFootprint,
  type StageMeshes,
  triangulateIsland,
} from './geom/structures.ts';
export { clipTriangleToBand, planTiles, type TexTile, type TilePlan, tileUv } from './geom/tiling.ts';
export { MAX_TIER, QualityLadder, type QualitySetting, TIERS, type TierFeatures } from './quality.ts';

export const ENGINE_NAME = '@wwm/engine';
