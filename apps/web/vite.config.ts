import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `pnpm dev` runs this alongside `wrangler dev` (apps/worker, port 8787); /api is proxied there.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // reachable from a phone on the LAN for /c/:code
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true, ws: true },
    },
  },
});
