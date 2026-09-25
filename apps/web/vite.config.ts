import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `pnpm dev` runs this alongside `wrangler dev` (apps/worker, port 8787); /api is proxied there.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Phase 12: `@wwm/physics` `loadRapier('standard')` (non-deterministic Rapier) exists only for the
      // Node benchmark. The game always loads the deterministic build, so the web bundle gets a stub instead
      // of a second 2.8 MB Rapier copy (it was emitted as its own chunk and inlined into the physics worker).
      '@dimforge/rapier3d-compat': fileURLToPath(new URL('./src/stubs/rapier-standard.ts', import.meta.url)),
    },
  },
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
