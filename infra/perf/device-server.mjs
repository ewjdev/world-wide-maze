/** Explicit local-only instrumented preview. Never changes dist or product modules. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect } from 'node:net';
import { extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assetManifest } from './p1-build.mjs';
import { runtimeFingerprint } from './p1-fingerprint.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const digest = (data) => createHash('sha256').update(data).digest('hex');
export function createDeviceServer({
  dist = resolve(root, 'apps/web/dist'),
  expectedRuntime = runtimeFingerprint().sha256,
  api = null,
} = {}) {
  const manifest = JSON.parse(readFileSync(resolve(dist, 'performance-build.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.runtimeFingerprint?.sha256 !== expectedRuntime)
    throw new Error('Missing/stale source-bound production build. Run node infra/perf/p1-build.mjs.');
  const actual = assetManifest(dist);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.assets))
    throw new Error('Dist assets differ from the build manifest');
  const assets = new Map(actual.map((x) => [`/${x.path}`, readFileSync(resolve(dist, x.path))]));
  const scripts = new Map(
    ['device-collector.mjs', 'device-data.mjs', 'device-panel.html'].map((name) => [
      `/__device/${name}`,
      readFileSync(new URL(name, import.meta.url)),
    ]),
  );
  const sourceHtml = assets.get('/index.html');
  if (!sourceHtml?.toString().includes('</head>')) throw new Error('Missing production index.html');
  const injection =
    '<script>localStorage.setItem("wwm.analytics.preference","off")</script><script type="module" src="/__device/device-collector.mjs"></script>';
  const html = Buffer.from(sourceHtml.toString().replace('</head>', `${injection}</head>`));
  const provenance = {
    schemaVersion: 1,
    commit: manifest.commit,
    builtAt: manifest.builtAt,
    runtimeSHA256: expectedRuntime,
    assetManifestSHA256: digest(JSON.stringify(manifest)),
    collectorSHA256: digest(Buffer.concat([...scripts.values()])),
    instrumentedHtmlSHA256: digest(html),
    originalHtmlSHA256: digest(sourceHtml),
    assetsVerified: true,
    htmlModifiedForCollector: true,
    note: 'Opt-in local server verified every source-bound dist asset and serves an immutable in-memory snapshot. Only entry HTML gains the disclosed collector. Responses disable browser caching; begin capture after warm-up. This is not a cold-cache benchmark.',
  };
  let upstream = null;
  if (api) {
    upstream = new URL(api);
    if (!['http:', 'https:'].includes(upstream.protocol)) throw new Error('API must be an HTTP(S) origin');
  }
  const mime = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
  };
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://local').pathname;
    res.setHeader('Cache-Control', 'no-store');
    if (path.startsWith('/api/')) {
      if (!upstream) {
        res
          .writeHead(503, { 'Content-Type': 'application/json' })
          .end('{"error":"API disabled in device preview"}');
        return;
      }
      const local = new URL(req.url, 'http://local');
      const target = new URL(local.pathname + local.search, upstream);
      const proxy = (target.protocol === 'https:' ? httpsRequest : httpRequest)(
        target,
        { method: req.method, headers: { ...req.headers, host: target.host } },
        (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
        },
      );
      proxy.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(proxy);
      return;
    }
    if (path === '/__device/provenance') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(provenance));
      return;
    }
    let body;
    if (path === '/__device/' || path === '/__device') body = scripts.get('/__device/device-panel.html');
    else body = path === '/index.html' ? html : (scripts.get(path) ?? assets.get(path));
    if (body) {
      res.setHeader(
        'Content-Type',
        path.startsWith('/__device') && !extname(path)
          ? 'text/html'
          : (mime[extname(path)] ?? 'application/octet-stream'),
      );
      res.end(body);
      return;
    }
    if (path.startsWith('/assets/') || extname(path)) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(html);
  });
  // Optional existing local Worker relay. No server is started or exposed automatically.
  server.on('upgrade', (req, socket, head) => {
    if (upstream?.protocol !== 'http:' || !req.url.startsWith('/api/')) {
      socket.destroy();
      return;
    }
    const remote = connect(Number(upstream.port) || 80, upstream.hostname, () => {
      const headers = { ...req.headers, host: upstream.host };
      remote.write(
        `${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headers)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
          .join('\r\n')}\r\n\r\n`,
      );
      if (head.length) remote.write(head);
      socket.pipe(remote);
      remote.pipe(socket);
    });
    remote.on('error', () => socket.destroy());
    socket.on('error', () => remote.destroy());
    socket.on('close', () => remote.destroy());
  });
  return { server, provenance };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = Object.fromEntries(
    process.argv.slice(2).map((x) => {
      const at = x.indexOf('=');
      if (!x.startsWith('--') || at < 0)
        throw new Error('Use --host=127.0.0.1 --port=4328 --api=http://127.0.0.1:8787');
      return [x.slice(2, at), x.slice(at + 1)];
    }),
  );
  const { server } = createDeviceServer({
    api: options.api,
    ...(options.dist ? { dist: resolve(options.dist) } : {}),
  });
  const host = options.host ?? '127.0.0.1',
    port = Number(options.port ?? 4328);
  server.listen(port, host, () =>
    console.log(`Opt-in device preview: http://${host}:${port}/__device/ (no device acceptance implied)`),
  );
}
