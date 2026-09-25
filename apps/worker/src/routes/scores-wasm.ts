/**
 * Rapier in workerd (Phase 10, replay verification).
 *
 * `@wwm/physics` loads `@dimforge/rapier3d-deterministic-compat`, whose `init()` compiles WASM from inlined
 * base64 bytes. workerd forbids compiling code at runtime ("Wasm code generation disallowed by embedder"), but
 * it does allow instantiating a module that wrangler compiled at deploy time (a `.wasm` import). The package ships
 * the same binary as `dist/rapier_wasm3d_bg.wasm` (byte-identical to the inlined copy, checked in
 * test/scores-rules.test.ts), so while Rapier initialises we hand `WebAssembly.instantiate` that precompiled
 * module instead of the bytes. Same binary → the same deterministic results as Node and the browser.
 *
 * Follow-up for Phase 05 (docs/build-log/phase-10.md): let `loadRapier()` accept a precompiled
 * `WebAssembly.Module`, which would make this shim unnecessary.
 */
// Relative file import (the package's `exports` map hides `dist/`); wrangler bundles it as a compiled module.
import rapierWasm from '../../node_modules/@dimforge/rapier3d-deterministic-compat/dist/rapier_wasm3d_bg.wasm';
import { RAPIER_WASM_BYTES } from './scores-rules.ts';

let loading: Promise<typeof import('@wwm/physics')> | null = null;

function byteLength(src: unknown): number {
  if (src instanceof ArrayBuffer) return src.byteLength;
  if (ArrayBuffer.isView(src)) return src.byteLength;
  return -1;
}

/** Import `@wwm/physics` and initialise Rapier from the precompiled module. Idempotent. */
export function loadPhysicsInWorkerd(): Promise<typeof import('@wwm/physics')> {
  loading ??= (async () => {
    const wasm = WebAssembly as unknown as {
      instantiate: (src: unknown, imports?: WebAssembly.Imports) => Promise<unknown>;
    };
    const original = wasm.instantiate;
    wasm.instantiate = (src, imports) =>
      byteLength(src) === RAPIER_WASM_BYTES ? original(rapierWasm, imports) : original(src, imports);
    try {
      const physics = await import('@wwm/physics');
      await physics.loadRapier('deterministic');
      return physics;
    } finally {
      wasm.instantiate = original;
    }
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}
