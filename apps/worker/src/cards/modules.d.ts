/** Share-card fonts: wrangler bundles `.ttf` imports as Data modules (`rules` in wrangler.jsonc). */
declare module '*.ttf' {
  const data: ArrayBuffer;
  export default data;
}

/** The practice stage's texture (default site card): a Data module (`rules` in wrangler.jsonc). */
declare module '*.png' {
  const data: ArrayBuffer;
  export default data;
}

/** resvg's WASM binary, precompiled by wrangler (default CompiledWasm rule). */
declare module '@resvg/resvg-wasm/index_bg.wasm' {
  const module: WebAssembly.Module;
  export default module;
}
