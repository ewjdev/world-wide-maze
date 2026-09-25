/**
 * Rapier in workerd for replay verification. Phase 10 shipped a scoped `WebAssembly.instantiate` shim here;
 * since physics 0.2.0 `loadRapier({ wasmModule })` does this itself, and the Worker has one loader for both
 * replay verification and playability validation: `../physics-wasm.ts`.
 */
export { loadPhysicsInWorkerd } from '../physics-wasm.ts';
