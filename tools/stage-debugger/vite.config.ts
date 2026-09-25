import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const MAX_STAGE_HEIGHT_PX = 1700; // mirrors @wwm/schema (kept literal so the config needs no TS imports)

/** Serves the fixture list and read-only files from fixtures/ and reference/ (gitignored 2013 material). */
function fixturesPlugin(): Plugin {
  return {
    name: 'wwm-fixtures',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://x');
        if (url.pathname === '/api/fixtures') {
          const dir = join(repo, 'fixtures/captures');
          const list = readdirSync(dir)
            .filter((s) => existsSync(join(dir, s, 'capture.json')))
            .sort()
            .map((slug) => {
              const c = JSON.parse(readFileSync(join(dir, slug, 'capture.json'), 'utf8'));
              return {
                slug,
                title: c.title,
                pageHeight: c.page.height,
                slices: Math.max(1, Math.ceil(c.page.height / MAX_STAGE_HEIGHT_PX)),
              };
            });
          const reference = existsSync(join(repo, 'reference/aid-dcc.stage.json'));
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ fixtures: list, reference }));
          return;
        }
        if (url.pathname.startsWith('/files/')) {
          const rel = normalize(decodeURIComponent(url.pathname.slice('/files/'.length)));
          if (!(rel.startsWith('fixtures/') || rel.startsWith('reference/')) || rel.includes('..')) {
            res.statusCode = 403;
            res.end();
            return;
          }
          const file = join(repo, rel);
          if (!existsSync(file) || !statSync(file).isFile()) {
            res.statusCode = 404;
            res.end();
            return;
          }
          const types: Record<string, string> = {
            '.json': 'application/json',
            '.png': 'image/png',
            '.webp': 'image/webp',
          };
          res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
          res.end(readFileSync(file));
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  root: here,
  plugins: [fixturesPlugin()],
  server: { port: 5178 },
  worker: { format: 'es' },
});
