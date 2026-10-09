/** Local production assets with deterministic gzip, shared by both comparison arms. */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const dist = resolve(process.env.AUDIT_DIST ?? 'apps/web/dist');
const port = Number(process.env.AUDIT_PORT ?? 4318);
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
};
const cache = new Map();
createServer((req, res) => {
  let path;
  try {
    path = resolve(dist, `.${decodeURIComponent(new URL(req.url, 'http://localhost').pathname)}`);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (path !== dist && !path.startsWith(`${dist}${sep}`)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(path) || !statSync(path).isFile()) {
    if (extname(path)) {
      res.writeHead(404).end();
      return;
    }
    path = resolve(dist, 'index.html');
  }
  let asset = cache.get(path);
  if (!asset) {
    const bytes = readFileSync(path);
    const compressed = /\.(html|js|css|json|svg)$/.test(path);
    asset = { bytes: compressed ? gzipSync(bytes, { level: 6 }) : bytes, compressed };
    cache.set(path, asset);
  }
  res.writeHead(200, {
    'Content-Type': types[extname(path)] ?? 'application/octet-stream',
    'Content-Length': asset.bytes.length,
    'Cache-Control': path.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...(asset.compressed ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}),
  });
  res.end(asset.bytes);
}).listen(port, '127.0.0.1', () =>
  console.log(`Production audit assets: http://127.0.0.1:${port} (${dist})`),
);
