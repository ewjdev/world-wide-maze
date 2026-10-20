import { fileURLToPath } from 'node:url';
import { baselinePath } from '@wwm/learning';
import { defineConfig, type Plugin } from 'vite';

/** Dev only: `/learn/...` (the published prefix, used in emailed links) serves `/...`. */
function learnPrefix(): Plugin {
  return {
    name: 'wwm:learn-prefix',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url?.startsWith('/learn/')) req.url = req.url.slice('/learn'.length);
        next();
      });
    },
  };
}

export default defineConfig({
  build: {
    rolldownOptions: {
      input: [
        fileURLToPath(new URL('./index.html', import.meta.url)),
        fileURLToPath(new URL('./account/index.html', import.meta.url)),
        fileURLToPath(new URL('./account/verify.html', import.meta.url)),
        ...baselinePath.activities.map((activity) =>
          fileURLToPath(new URL(`./lessons/${activity.id}/index.html`, import.meta.url)),
        ),
      ],
    },
  },
  // Phase 31 M3: /api → `wrangler dev` (apps/worker, :8787) for family accounts, and the emailed link's
  // published path (/learn/account/verify) mapped onto this server's root.
  plugins: [learnPrefix()],
  server: {
    strictPort: true,
    proxy: { '/api': { target: process.env.WWM_API_URL ?? 'http://localhost:8787', changeOrigin: true } },
  },
});
