/// <reference path="./routes/wasm-modules.d.ts" />
/**
 * Rapier in workerd (Phase 10 replay verification, Phase 03b/05b playability validation).
 *
 * `@wwm/physics` loads `@dimforge/rapier3d-deterministic-compat`, whose `init()` compiles WASM from inlined
 * base64 bytes. workerd forbids compiling code at runtime ("Wasm code generation disallowed by embedder"), but
 * it does allow instantiating a module that wrangler compiled at deploy time (a `.wasm` import, CompiledWasm
 * rule). The package ships the same binary as `dist/rapier_wasm3d_bg.wasm` (byte-identical to the inlined copy,
 * checked in packages/physics/test/rapier.test.ts and test/scores-rules.test.ts), and `loadRapier({ wasmModule })`
 * (physics 0.2.0) initialises Rapier from it. Same binary → the same deterministic results as Node and the
 * browser. Every later `loadRapier()` (e.g. inside `createSimulation()`, used by the solver) reuses the instance.
 */
// Relative file import (the package's `exports` map hides `dist/`); wrangler bundles it as a compiled module.
import rapierWasm from '../node_modules/@dimforge/rapier3d-deterministic-compat/dist/rapier_wasm3d_bg.wasm';

let loading: Promise<typeof import('@wwm/physics')> | null = null;

/** Import `@wwm/physics` and initialise Rapier from the precompiled module. Idempotent. */
export function loadPhysicsInWorkerd(): Promise<typeof import('@wwm/physics')> {
  loading ??= (async () => {
    const physics = await import('@wwm/physics');
    await physics.loadRapier({ wasmModule: rapierWasm });
    return physics;
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}
