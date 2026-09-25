/**
 * Serves fixtures/eval/ (the dashboard) and persists human ratings to fixtures/eval/ratings.json.
 *   node tools/batch-eval/src/cli/serve.ts [--port 5178] [--dir fixtures/eval]
 * GET /api/ratings → the JSON; POST /api/ratings {key, rating} → merges one entry (key = "<slug>#<slice>").
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { parseArgs } from 'node:util';
import { EVAL_DIR } from '../paths.ts';

const { values } = parseArgs({
  options: { port: { type: 'string', default: '5178' }, dir: { type: 'string', default: EVAL_DIR } },
});
const dir = values.dir as string;
const ratingsPath = join(dir, 'ratings.json');
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
};

export function readRatings(path = ratingsPath): Record<string, unknown> {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>) : {};
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/ratings') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(readRatings()));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c: Buffer) => {
        body += c.toString();
        if (body.length > 1e6) req.destroy();
      });
      req.on('end', () => {
        try {
          const { key, rating } = JSON.parse(body) as { key: string; rating: unknown };
          if (typeof key !== 'string' || !/^[a-z0-9-]+#\d+$/.test(key)) throw new Error('bad key');
          const all = readRatings();
          all[key] = rating;
          const sorted = Object.fromEntries(Object.entries(all).sort(([a], [b]) => a.localeCompare(b)));
          writeFileSync(ratingsPath, `${JSON.stringify(sorted, null, 1)}\n`);
          res.writeHead(204).end();
        } catch (e) {
          res.writeHead(400).end((e as Error).message);
        }
      });
      return;
    }
  }
  const rel = normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)).replace(
    /^(\.\.[/\\])+/,
    '',
  );
  const file = join(dir, rel);
  if (!file.startsWith(dir) || !existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
server.listen(Number(values.port), () => console.log(`eval dashboard: http://localhost:${values.port}/`));
