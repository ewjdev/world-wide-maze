/**
 * @wwm/stage-builder — screenshot + DOM → StageData (contracts §4). Pure, deterministic, no I/O, no DOM.
 * Pipeline (one module per step): grid → background → semantic → morphology → islands → contours → bridges →
 * maze → levels → placement → rails → build (validate + reroll). See README.md.
 */
export { sliceCount } from '@wwm/schema';
export {
  BUILDER_VERSION,
  BuildError,
  type BuildOptions,
  type BuildResultEx,
  buildStage,
  buildStageUnchecked,
  type DebugLayersEx,
  MAX_REROLLS,
} from './build.ts';
export { type BuildParams, D, DEFAULT_PARAMS, DIFFICULTY_PARAMS, resolveParams } from './params.ts';
export { sha256HexSync } from './sha256.ts';
export { type Dist, dist, type StageStats, stageStats, statsRows } from './stats.ts';
