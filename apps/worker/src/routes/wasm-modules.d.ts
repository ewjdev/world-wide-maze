/** wrangler bundles `.wasm` imports as precompiled modules (CompiledWasm rule). */
declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}
