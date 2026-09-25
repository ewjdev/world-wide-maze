/**
 * @wwm/batch-eval — build + solve every capture fixture × slice × difficulty × seed and report playability
 * (Phase 09). CLIs in src/cli/: batch (the run), serve (dashboard + ratings), shot (screenshots), thumb (debug
 * render), capture-set (grow the eval set).
 */
export { renderDashboard } from './html.ts';
export { CAPTURES_DIR, EVAL_DIR, type EvalCaptureSource, loadEvalCaptures, REPO_ROOT } from './paths.ts';
export { Raster, type RGBA } from './raster.ts';
export {
  type Dist,
  dist,
  type EvalReport,
  type GroupStats,
  group,
  type RunStats,
  runStats,
} from './report.ts';
export { type EvalJob, type EvalRecord, runJob, slicesOf } from './run.ts';
export { renderThumb, type ThumbOptions } from './thumb.ts';
