/**
 * Rapier loading. The WASM module is initialised once per JS realm (main thread, each worker, Node, workerd).
 *
 * Build choice (see README "Rapier build"): `@dimforge/rapier3d-deterministic-compat` — Rapier compiled
 * with `enhanced-determinism` (software-consistent float paths, no SIMD), so the same StageData + the same
 * InputSample[] give bit-identical results in Node, Chromium, Safari and Cloudflare workerd. The `-compat`
 * flavour inlines the WASM as base64, so it loads without bundler/wasm plugins in Node, Vite and workers.
 * `standard` (`@dimforge/rapier3d-compat`) is kept only as a devDependency for the benchmark.
 *
 * **Precompiled module (05b).** Runtimes that forbid compiling WASM from bytes (Cloudflare workerd: "Wasm code
 * generation disallowed by embedder") can pass `{ wasmModule }`: a `WebAssembly.Module` of the same binary,
 * compiled ahead of time (wrangler's `.wasm` import rule). The package ships it byte-identical as
 * `dist/rapier_wasm3d_bg.wasm` (checked in test/rapier.test.ts). The compat build's `init()` takes no arguments
 * and always instantiates its inlined bytes, so while it initialises, the first `WebAssembly.instantiate` call
 * with a byte buffer is answered with the precompiled module instead (scoped: restored right after). Same
 * binary → the same deterministic results.
 */
import type * as RapierNS from '@dimforge/rapier3d-deterministic-compat';

export type Rapier = typeof RapierNS;
export type RapierBuild = 'deterministic' | 'standard';

export interface LoadRapierOptions {
  build?: RapierBuild;
  /** Precompiled Rapier WASM (the package's `dist/rapier_wasm3d_bg.wasm`), for runtimes without WASM codegen. */
  wasmModule?: WebAssembly.Module;
}

const cache = new Map<RapierBuild, Promise<Rapier>>();

type Instantiate = (src: unknown, imports?: WebAssembly.Imports) => Promise<unknown>;

function isBytes(src: unknown): boolean {
  return src instanceof ArrayBuffer || ArrayBuffer.isView(src);
}

/** Run `init` with `WebAssembly.instantiate(bytes)` answered once from `module`. */
async function withPrecompiled<T>(module: WebAssembly.Module, init: () => Promise<T>): Promise<T> {
  const wasm = WebAssembly as unknown as { instantiate: Instantiate };
  const original = wasm.instantiate;
  let used = false;
  wasm.instantiate = (src, imports) => {
    if (!used && isBytes(src)) {
      used = true;
      return original.call(WebAssembly, module, imports);
    }
    return original.call(WebAssembly, src, imports);
  };
  try {
    const out = await init();
    if (!used) throw new Error('loadRapier: Rapier initialised without using the precompiled wasmModule');
    return out;
  } finally {
    wasm.instantiate = original;
  }
}

/**
 * Load and initialise Rapier (cached per build). `loadRapier('deterministic')` and `loadRapier({ build })` are
 * equivalent; pass `wasmModule` on the first call in runtimes that can't compile WASM (later calls, e.g. from
 * `createSimulation()`, then reuse the initialised instance).
 */
export function loadRapier(opts: RapierBuild | LoadRapierOptions = 'deterministic'): Promise<Rapier> {
  const { build = 'deterministic', wasmModule } = typeof opts === 'string' ? { build: opts } : opts;
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
      if (wasmModule) await withPrecompiled(wasmModule, () => R.init());
      else await R.init();
      return R;
    })();
    cache.set(build, p);
    // a failed load (e.g. no codegen and no module yet) must not poison later calls
    p.catch(() => {
      if (cache.get(build) === p) cache.delete(build);
    });
  }
  return p;
}
