/**
 * Stub for `@dimforge/rapier3d-compat` in the web bundle (see vite.config.ts, Phase 12). `@wwm/physics` loads
 * the standard (non-deterministic) Rapier build only for its Node benchmark; the game uses the deterministic one.
 */
export async function init(): Promise<never> {
  throw new Error('the standard Rapier build is not bundled in the web app; use the deterministic build');
}
export default { init };
