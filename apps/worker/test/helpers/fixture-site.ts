/**
 * Local test sites (loopback only):
 * - `site`: pages to capture, allowed through DEV_ALLOWED_HOSTS.
 * - `internal`: stands in for a private service. Tests assert it is NEVER reached (`hits` stays empty).
 */

import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright';

/** Browser tests need Playwright Chromium; CI sets CI=true so a missing browser fails loudly. */
export const HAS_CHROMIUM = existsSync(chromium.executablePath()) || !!process.env.CI;

export interface TestServer {
  origin: string;
  host: string;
  hits: string[];
  close(): Promise<void>;
}

async function listen(server: Server, hits: string[]): Promise<TestServer> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    host: `127.0.0.1:${port}`,
    hits,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

export async function startInternalServer(): Promise<TestServer> {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(req.url ?? '');
    res
      .writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' })
      .end('internal secret');
  });
  server.on('upgrade', (req, socket) => {
    hits.push(`ws:${req.url}`);
    socket.destroy();
  });
  return listen(server, hits);
}

const css = `body{margin:0;font:18px/1.5 sans-serif;background:#f4f1ea;color:#222}
  header{height:120px;background:#1d3557;color:#fff;padding:24px}
  section{margin:40px;padding:24px;background:#fff;border-radius:8px}
  .card{display:inline-block;width:260px;height:180px;margin:12px;background:#a8dadc}`;

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body>${body}</body></html>`;
}

function sections(n: number): string {
  return Array.from(
    { length: n },
    (_, i) =>
      `<section><h2>Section ${i + 1}</h2><p>${'Tilt the world and roll the ball to the goal. '.repeat(8)}</p>${'<div class="card"></div>'.repeat(3)}</section>`,
  ).join('');
}

/**
 * Routes:
 *  /sparse          small page (1 slice)
 *  /long            ~3 slices
 *  /status403       HTTP 403
 *  /challenge       looks like a bot check
 *  /slow            never finishes loading the document
 *  /redirect?to=U   302 to U
 *  /leaky           page whose subresources/frames/fetch/worker/sockets all target `internal`
 */
export async function startFixtureSite(internalOrigin: string): Promise<TestServer> {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    hits.push(u.pathname);
    const html = (status: number, s: string) =>
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }).end(s);
    switch (u.pathname) {
      case '/sparse':
        return html(200, page('Sparse fixture', `<header><h1>Sparse</h1></header>${sections(1)}`));
      case '/long':
        return html(200, page('Long fixture', `<header><h1>Long page</h1></header>${sections(12)}`));
      case '/status403':
        return html(403, page('Forbidden', '<h1>403 Forbidden</h1>'));
      case '/challenge':
        return html(200, page('Just a moment...', '<p>Checking your browser before accessing the site.</p>'));
      case '/slow':
        res.writeHead(200, { 'content-type': 'text/html' });
        res.write('<!doctype html><html><head><title>slow</title></head><body>');
        return; // never ends
      case '/redirect':
        return res.writeHead(302, { location: u.searchParams.get('to') ?? '/' }).end();
      case '/worker.js':
        res.writeHead(200, { 'content-type': 'text/javascript' });
        return res.end(`fetch('${internalOrigin}/from-worker').catch(()=>{});`);
      case '/leaky':
        return html(
          200,
          page(
            'Leaky fixture',
            `<header><h1>Leaky</h1></header>${sections(2)}
             <img src="${internalOrigin}/img">
             <img src="/redirect?to=${encodeURIComponent(`${internalOrigin}/img-via-redirect`)}">
             <iframe src="${internalOrigin}/frame"></iframe>
             <link rel="stylesheet" href="${internalOrigin}/style.css">
             <script>
               fetch('${internalOrigin}/fetch').catch(()=>{});
               fetch('/redirect?to=${encodeURIComponent(`${internalOrigin}/fetch-via-redirect`)}').catch(()=>{});
               navigator.sendBeacon && navigator.sendBeacon('${internalOrigin}/beacon', 'x');
               try { new WebSocket('${internalOrigin.replace('http', 'ws')}/ws'); } catch (e) {}
               try { new Worker('/worker.js'); } catch (e) {}
               try { new EventSource('${internalOrigin}/sse'); } catch (e) {}
               window.__apis = { ws: typeof WebSocket, worker: typeof Worker, rtc: typeof RTCPeerConnection };
             </script>`,
          ),
        );
      default:
        return html(404, page('Not found', '<h1>404</h1>'));
    }
  });
  return listen(server, hits);
}
