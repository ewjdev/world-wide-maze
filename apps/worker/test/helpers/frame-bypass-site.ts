/**
 * Fixtures for the "child realm" SSRF bypass tests (capture-guard.test.ts). A captured page tries to reach
 * the `internal` server through network APIs that CDP `Fetch` cannot see (WebSocket, WebSocketStream,
 * dedicated/shared workers opening sockets, WebRTC TURN-over-TCP), taken from a realm the top-level init
 * script might not have covered: a synchronously created about:blank iframe, srcdoc/data:/blob:/javascript:
 * frames, a cross-site (out-of-process) iframe, nested frames, `<object>`, and `window.open` popups.
 *
 * `internal` counts HTTP requests, WebSocket upgrades AND raw TCP connections, so a TURN allocation or any
 * other non-HTTP connection attempt is visible too. Each attack tags its URLs (`/ws-<tag>`) so a leak
 * names its case.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export interface CountingServer {
  origin: string;
  host: string;
  port: number;
  /** HTTP request paths and `ws:<path>` upgrade attempts. */
  hits: string[];
  /** Raw TCP connections accepted (includes the ones behind `hits`). */
  connections: () => number;
  close(): Promise<void>;
}

async function listen(server: Server, hostname: string, originHost: string): Promise<CountingServer> {
  const hits: string[] = [];
  let connections = 0;
  const sockets = new Set<Socket>();
  server.on('connection', (s: Socket) => {
    connections++;
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  server.on('request', (req) => hits.push(req.url ?? ''));
  server.on('upgrade', (req, socket: Socket) => {
    hits.push(`ws:${req.url}`);
    socket.destroy();
  });
  await new Promise<void>((r) => server.listen({ port: 0, host: hostname, ipv6Only: false }, r));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://${originHost}:${port}`,
    host: `${originHost}:${port}`,
    port,
    hits,
    connections: () => connections,
    close: () =>
      new Promise((r) => {
        for (const s of sockets) s.destroy();
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

/** The private service stand-in. Must see 0 hits and 0 connections. */
export function startCountingInternalServer(): Promise<CountingServer> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }).end('internal');
  });
  return listen(server, '127.0.0.1', '127.0.0.1');
}

/**
 * JS source of `attack(W, tag)`: from realm `W`, try every Fetch-invisible channel to `internal`. It records
 * what it found in `top.__probe[tag]` when reachable (best effort, for debugging).
 */
function attackFn(internal: CountingServer): string {
  const ws = `ws://${internal.host}`;
  const turn = `turn:127.0.0.1:${internal.port}?transport=tcp`;
  return `function attack(W, tag) {
  var seen = {};
  try { seen.ws = typeof W.WebSocket; new W.WebSocket('${ws}/ws-' + tag); } catch (e) { seen.wsErr = String(e); }
  try { seen.wss = typeof W.WebSocketStream; new W.WebSocketStream('${ws}/wss-' + tag); } catch (e) { seen.wssErr = String(e); }
  var workerSrc = "try{new WebSocket('${ws}/ws-worker-" + tag + "')}catch(e){}"
    + ";try{new WebSocketStream('${ws}/wss-worker-" + tag + "')}catch(e){}";
  try {
    seen.worker = typeof W.Worker;
    var url = W.URL.createObjectURL(new W.Blob([workerSrc], { type: 'text/javascript' }));
    new W.Worker(url);
  } catch (e) { seen.workerErr = String(e); }
  try { new W.Worker('data:text/javascript,' + encodeURIComponent(workerSrc)); } catch (e) {}
  try {
    seen.shared = typeof W.SharedWorker;
    var surl = W.URL.createObjectURL(new W.Blob([workerSrc.split('worker-').join('shared-')], { type: 'text/javascript' }));
    new W.SharedWorker(surl);
  } catch (e) { seen.sharedErr = String(e); }
  try {
    var PC = W.RTCPeerConnection || W.webkitRTCPeerConnection;
    seen.rtc = typeof PC;
    var pc = new PC({ iceServers: [{ urls: '${turn}', username: 'u', credential: 'p' }], iceTransportPolicy: 'relay' });
    pc.createDataChannel('x');
    pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).catch(function () {});
  } catch (e) { seen.rtcErr = String(e); }
  try { (top.__probe = top.__probe || {})[tag] = seen; } catch (e) {}
  return seen;
}`;
}

const doc = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>${'Roll the ball to the goal. '.repeat(20)}</p>${body}</body></html>`;

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/**
 * The attacker site. `crossOrigin` is a second, cross-SITE origin (`localhost:<port>` vs `127.0.0.1:<port>`),
 * so with site isolation its frames are out-of-process iframes. Both origins serve the same routes.
 *
 *  /attack?tag=T      runs attack(self, T) inline, plus a sync about:blank grab (T-blank)
 *  /case/<name>       one bypass case per page (see CASES)
 */
export async function startFrameBypassSite(internal: CountingServer): Promise<{
  site: CountingServer;
  cross: CountingServer;
  close(): Promise<void>;
}> {
  const attack = attackFn(internal);
  // Grab a freshly appended about:blank iframe's realm synchronously, before anything could run in it.
  const blankGrab = (tag: string) =>
    `var f = document.createElement('iframe'); document.body.appendChild(f); attack(f.contentWindow, '${tag}');`;
  let crossOrigin = '';

  const cases: Record<string, () => string> = {
    // (0) control: the top-level realm itself.
    main: () => `<script>${attack}; attack(window, 'main');</script>`,
    // (a) about:blank iframe created and used synchronously right after append.
    'blank-sync': () => `<script>${attack}; ${blankGrab('blank-sync')}</script>`,
    // (a') same, but also through contentDocument.defaultView and Function from that realm.
    'blank-sync-alt': () =>
      `<script>${attack};
        var g = document.createElement('iframe'); document.body.appendChild(g);
        attack(g.contentDocument.defaultView, 'blank-sync-doc');
        attack(g.contentWindow.Function('return this')(), 'blank-sync-fn');
        var h = document.createElement('iframe'); document.body.appendChild(h);
        h.contentDocument.open(); h.contentDocument.write('<p>x</p>'); h.contentDocument.close();
        attack(h.contentWindow, 'blank-docwrite');</script>`,
    // (a'') parsed <iframe src=about:blank> grabbed via frames[] from the next script.
    'blank-parsed': () =>
      `<iframe src="about:blank"></iframe><iframe></iframe><script>${attack}; attack(frames[0], 'blank-parsed-0'); attack(frames[1], 'blank-parsed-1');</script>`,
    // (b) srcdoc iframe running its own inline script.
    srcdoc: () =>
      `<iframe srcdoc="${attr(`<body><script>${attack}; attack(window, 'srcdoc'); ${blankGrab('srcdoc-blank')}</script>`)}"></iframe>`,
    // (b') data:, blob: and javascript: URL frames.
    'data-frame': () =>
      `<iframe src="data:text/html,${encodeURIComponent(`<script>${attack}; attack(window, 'data-frame');</script>`)}"></iframe>`,
    'blob-frame': () =>
      `<script>${attack};
        var b = new Blob([${JSON.stringify(`<script>${attack}; attack(window, 'blob-frame');</script>`).replace(/</g, '\\u003c')}], { type: 'text/html' });
        var bf = document.createElement('iframe'); bf.src = URL.createObjectURL(b); document.body.appendChild(bf);</script>`,
    'js-frame': () =>
      `<script>${attack}; window.attack = attack;
        var jf = document.createElement('iframe'); jf.src = "javascript:parent.attack(window, 'js-frame')"; document.body.appendChild(jf);</script>`,
    // (c) cross-site iframe (OOPIF under site isolation).
    cross: () => `<iframe src="${crossOrigin}/attack?tag=cross"></iframe>`,
    // (d) nested: srcdoc → sync about:blank, srcdoc → cross-site, cross-site → its own sync about:blank.
    nested: () =>
      `<iframe srcdoc="${attr(
        `<body><script>${attack}; var f = document.createElement('iframe'); document.body.appendChild(f);
          var d = f.contentDocument; var n = d.createElement('iframe'); d.body.appendChild(n);
          attack(n.contentWindow, 'nested-blank2');</script><iframe src="${crossOrigin}/attack?tag=nested-cross"></iframe>`,
      )}"></iframe>`,
    // (e) popups: about:blank grabbed synchronously, and a cross-site popup, via window.open (also from a
    // fresh iframe's realm) and via <a target=_blank>.click(), which doesn't need window.open at all.
    popup: () =>
      `<script>${attack};
        try { var w = window.open('about:blank', '_blank'); if (w) attack(w, 'popup-blank'); } catch (e) {}
        try { window.open('${crossOrigin}/attack?tag=popup-cross', '_blank'); } catch (e) {}
        try { var pf = document.createElement('iframe'); document.body.appendChild(pf);
          var w2 = pf.contentWindow.open('about:blank', '_blank'); if (w2) attack(w2, 'popup-frame-blank'); } catch (e) {}
        var a = document.createElement('a'); a.href = '${crossOrigin}/attack?tag=popup-link'; a.target = '_blank';
        document.body.appendChild(a); a.click();</script>`,
    // (f) <object>/<embed> nested browsing contexts.
    object: () =>
      `<object data="${crossOrigin}/attack?tag=object" type="text/html" width="300" height="100"></object>
       <embed src="${crossOrigin}/attack?tag=embed" type="text/html" width="300" height="100">`,
  };

  const handler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const html = (s: string) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(s);
    if (u.pathname === '/attack') {
      const tag = (u.searchParams.get('tag') ?? 'x').replace(/[^a-z0-9-]/gi, '');
      return html(
        doc(
          `Attack ${tag}`,
          `<script>${attack}; attack(window, '${tag}'); ${blankGrab(`${tag}-blank`)}</script>`,
        ),
      );
    }
    const name = u.pathname.startsWith('/case/') ? u.pathname.slice(6) : '';
    const make = cases[name];
    if (make) return html(doc(`Case ${name}`, make()));
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  };

  const site = await listen(createServer(handler), '127.0.0.1', '127.0.0.1');
  const cross = await listen(createServer(handler), '::', 'localhost');
  crossOrigin = cross.origin;
  return {
    site,
    cross,
    close: async () => {
      await site.close();
      await cross.close();
    },
  };
}

export const FRAME_BYPASS_CASES = [
  'main',
  'blank-sync',
  'blank-sync-alt',
  'blank-parsed',
  'srcdoc',
  'data-frame',
  'blob-frame',
  'js-frame',
  'cross',
  'nested',
  'popup',
  'object',
] as const;
