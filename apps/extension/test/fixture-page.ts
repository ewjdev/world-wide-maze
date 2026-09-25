/**
 * A local page to capture in the e2e test: a sticky site header, a hero, cards in the four colour roles, text
 * columns and a footer, 2,300 px tall (two stage slices). Served on 127.0.0.1, a different origin from the game.
 */
import { createServer, type Server } from 'node:http';

export const FIXTURE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Harbour Notes: a local test page</title>
<style>
  body{margin:0;font:17px/1.5 Georgia,serif;background:#f4efe6;color:#222}
  header{position:sticky;top:0;background:#1d3557;color:#fff;padding:14px 40px;font:700 20px system-ui;z-index:5}
  .hero{margin:40px;padding:60px 48px;background:#e63946;color:#fff}
  .hero h1{margin:0 0 12px;font:800 54px/1.05 system-ui}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;margin:0 40px}
  .card{padding:28px;min-height:220px;background:#fff;border:1px solid #d9d2c3}
  .card:nth-child(2){background:#a8dadc}.card:nth-child(3){background:#f1c453}
  .cols{columns:2;column-gap:48px;margin:48px 40px;max-width:1100px}
  .band{margin:48px 40px;padding:48px;background:#457b9d;color:#fff}
  footer{margin-top:60px;padding:40px;background:#222;color:#eee}
  a{color:#1d3557}
</style></head><body>
<header>Harbour Notes · <a style="color:#fff" href="https://example.org/about">About</a></header>
<section class="hero"><h1>Tides, boats and the long pier</h1><p>A page made for testing World Wide Maze's “Maze this page”.</p></section>
<div class="grid">
  <div class="card"><h2>Morning</h2><p>The first ferry leaves at six. Gulls argue over the fish market roofs.</p></div>
  <div class="card"><h2>Noon</h2><p>Low tide shows the old slipway and the chain that nobody remembers laying.</p></div>
  <div class="card"><h2>Evening</h2><p>Lanterns along the pier; the harbour master rings the bell twice.</p></div>
</div>
<div class="cols">${'<p>Rope, tar and salt: the harbour smells the same as it did a hundred years ago. Boats come and go with the tide, and the pier stretches out into the grey water like a sentence that never quite ends. </p>'.repeat(10)}</div>
<section class="band"><h2>Timetable</h2><p>Ferries every hour from six until ten. Tickets at the kiosk by the lighthouse.</p></section>
<div class="grid">
  <div class="card"><h3>North quay</h3><p>Fishing boats and the ice house.</p></div>
  <div class="card"><h3>South quay</h3><p>Sailing club, chandlery, café.</p></div>
  <div class="card"><h3>Breakwater</h3><p>Walk to the light at low tide only.</p></div>
</div>
<div style="height:260px"></div>
<footer>Harbour Notes is not a real place. <a style="color:#fff" href="https://example.org/">example.org</a></footer>
</body></html>`;

export async function startFixturePage(): Promise<{
  origin: string;
  close(): Promise<void>;
  server: Server;
}> {
  const server = createServer((req, res) => {
    if (req.url === '/' || req.url?.startsWith('/?')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(FIXTURE_HTML);
    } else if (req.url === '/favicon.ico') {
      res.writeHead(204).end();
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    origin: `http://127.0.0.1:${port}`,
    server,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
