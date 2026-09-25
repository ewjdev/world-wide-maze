import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const RAPIER_PKG = '@dimforge/rapier3d-deterministic-compat';
const RAPIER_ENTRY = /[\\/]@dimforge[\\/]rapier3d-deterministic-compat[\\/]dist[\\/]rapier\.mjs$/;
/** compat `init()`: `__wbg_init({ module_or_path: base64.toByteArray("<2.7 MB of base64>").buffer })`. */
const RAPIER_INLINED = /module_or_path:[\w$]+\.toByteArray\("[A-Za-z0-9+/=]{100000,}"\)\.buffer/;

/**
 * Phase 12b: Rapier's WASM as a separate `.wasm` asset instead of base64 inside a JS chunk.
 *
 * The deterministic `-compat` package inlines its WASM as base64 (2.7 MB of JS, 1,069 KiB gz), and its `init()`
 * always instantiates those bytes. The package also ships the byte-identical binary as
 * `dist/rapier_wasm3d_bg.wasm` (asserted in packages/physics/test/rapier.test.ts), so for the browser we rewrite
 * that one expression to pass the binary's asset URL instead: wasm-bindgen's init then `fetch`es it and
 * `WebAssembly.instantiateStreaming`s it (compiled while downloading; served as `application/wasm`, allowed by
 * the CSP's `'wasm-unsafe-eval'`). Same binary → the same deterministic results. Applied to the page and to the
 * physics worker bundle (`?physics=worker`); Node (Vitest SSR, the solver) and workerd (precompiled
 * `wasmModule`, apps/worker/src/physics-wasm.ts) keep using the untouched package.
 */
function rapierWasmAsset(): Plugin {
  return {
    name: 'wwm:rapier-wasm-asset',
    // browser graphs only (dev client, build, worker bundles); Vitest's Node-side graph keeps the inlined bytes
    applyToEnvironment: (env) => env.config.consumer === 'client',
    transform(code, rawId) {
      const id = rawId.split('?')[0] as string; // dev appends `?v=<hash>` to node_modules files
      if (!RAPIER_ENTRY.test(id)) return;
      const m = RAPIER_INLINED.exec(code);
      if (!m) this.error(`${RAPIER_PKG}: inlined WASM not found (package changed?); update vite.config.ts`);
      const wasm = JSON.stringify(`${join(dirname(id), 'rapier_wasm3d_bg.wasm')}?url`);
      return {
        // ESM imports hoist, so appending keeps line 1 intact; no source map for this vendored, minified module
        code: `${code.replace(m[0], 'module_or_path:__wwmRapierWasmUrl')}\nimport __wwmRapierWasmUrl from ${wasm};\n`,
        map: { mappings: '' },
      };
    },
  };
}

// `pnpm dev` runs this alongside `wrangler dev` (apps/worker, port 8787); /api is proxied there.
export default defineConfig({
  plugins: [react(), rapierWasmAsset()],
  resolve: {
    alias: {
      // Phase 12: `@wwm/physics` `loadRapier('standard')` (non-deterministic Rapier) exists only for the
      // Node benchmark. The game always loads the deterministic build, so the web bundle gets a stub instead
      // of a second 2.8 MB Rapier copy (it was emitted as its own chunk and inlined into the physics worker).
      '@dimforge/rapier3d-compat': fileURLToPath(new URL('./src/stubs/rapier-standard.ts', import.meta.url)),
    },
  },
  // dev: serve the package unbundled so `rapierWasmAsset` sees it (the optimizer doesn't run plugin transforms)
  optimizeDeps: { exclude: [RAPIER_PKG] },
  // the physics worker (`?physics=worker`) is its own bundle with its own plugin list
  worker: { plugins: () => [rapierWasmAsset()] },
  build: {
    rolldownOptions: {
      output: {
        // Stable, cacheable vendor chunks. Routes are lazy (src/routes.tsx), so the phone controller and the
        // showcase pages never load three.js or Rapier.
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/ },
            { name: 'vendor-three', test: /node_modules[\\/]three[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true, // reachable from a phone on the LAN for /c/:code
    allowedHosts: ['.trycloudflare.com'], // HTTPS quick tunnels for phone tests (iOS motion needs HTTPS)
    proxy: {
      '/api': { target: process.env.WWM_API_URL ?? 'http://localhost:8787', changeOrigin: true, ws: true },
      // Share pages are served by the Worker (Phase 10); proxied so `/s/:id` works in dev as in production.
      '/s/': { target: process.env.WWM_API_URL ?? 'http://localhost:8787', changeOrigin: true },
    },
  },
});
