/** @wwm/fixture-capture — programmatic entry points for the fixture CLI and handmade stage generator. */
export { type CaptureToDirOptions, type CaptureToDirResult, captureToDir } from './capture.ts';
export { formatJson } from './format.ts';
export { buildHandmadeStage, HANDMADE_TEXTURE_SIZE, railsAround } from './handmade.ts';
export { CAPTURES_DIR, FIXTURES_DIR, REPO_ROOT, STAGES_DIR } from './paths.ts';
