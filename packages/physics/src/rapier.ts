/**
 * Rapier loading. The WASM module is initialised once per JS realm (main thread, each worker, Node).
 *
 * Build choice (see README "Rapier build"): `@dimforge/rapier3d-deterministic-compat` — Rapier compiled
 * with `enhanced-determinism` (software-consistent float paths, no SIMD), so the same StageData + the same
 * InputSample[] give bit-identical results in Node, Chromium, Safari and Cloudflare workerd. The `-compat`
 * flavour inlines the WASM as base64, so it loads without bundler/wasm plugins in Node, Vite and workers.
 * `standard` (`@dimforge/rapier3d-compat`) is kept only as a devDependency for the benchmark.
 */
import type * as RapierNS from '@dimforge/rapier3d-deterministic-compat';

export type Rapier = typeof RapierNS;
export type RapierBuild = 'deterministic' | 'standard';

const cache = new Map<RapierBuild, Promise<Rapier>>();

export function loadRapier(build: RapierBuild = 'deterministic'): Promise<Rapier> {
  let p = cache.get(build);
  if (!p) {
    p = (async () => {
      const mod = (
        build === 'deterministic'
          ? await import('@dimforge/rapier3d-deterministic-compat')
          : // The standard build has the identical API; its types are structurally the same.
            ((await import(
              '@dimforge/rapier3d-compat'
            )) as unknown as typeof import('@dimforge/rapier3d-deterministic-compat'))
      ) as { default?: Rapier } & Rapier;
      const R = (mod.default ?? mod) as Rapier;
      await R.init();
      return R;
    })();
    cache.set(build, p);
  }
  return p;
}
