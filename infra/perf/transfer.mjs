#!/usr/bin/env node
/**
 * Per-route transfer sizes (Phase 12b, Rapier deferred load). Serve a production build without compression, e.g.
 *   pnpm --filter @wwm/web exec vite build --outDir /tmp/wwm-dist && npx vite preview --outDir /tmp/wwm-dist --port 4311
 *   node infra/perf/transfer.mjs http://localhost:4311
 * then every same-origin response body is gzip-9 / brotli compressed here and summed per route.
 */
import { createRequire } from 'node:module';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');
const base = process.argv[2].replace(/\/$/, '');
const browser = await chromium.launch({
  args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu'],
});
const kb = (n) => (n / 1024).toFixed(1);
for (const path of ['/', '/play/practice', '/play/practice?physics=worker']) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    localStorage.setItem('wwm.howtoSeen', '1');
    localStorage.setItem('wwm.tutorialDone', '1');
    window.__WWM_TEST__ = { noAutoPause: true, skipIntro: true };
  });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      console.log(`   [console.${m.type()}] ${m.text().slice(0, 200)}`);
  });
  const files = new Map();
  const pending = [];
  ctx.on('response', (r) => {
    pending.push(
      (async () => {
        const u = new URL(r.url());
        if (u.origin !== new URL(base).origin) return;
        const body = await r.body().catch(() => null);
        if (!body) return;
        const name = u.pathname;
        const ext = /\.wasm$/.test(name) ? 'wasm' : /\.m?js$/.test(name) ? 'js' : 'other';
        files.set(name, {
          ext,
          raw: body.length,
          gz: gzipSync(body, { level: 9 }).length,
          br: brotliCompressSync(body).length,
          ct: r.headers()['content-type'],
        });
      })(),
    );
  });
  const t0 = Date.now();
  await page.goto(`${base}${path}`);
  if (path.startsWith('/play'))
    await page.waitForFunction(() => document.body.dataset.phase === 'play', null, { timeout: 90_000 });
  else {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(4000);
  }
  const ms = Date.now() - t0;
  await Promise.all(pending);
  const sum = (ext) =>
    [...files.values()]
      .filter((f) => !ext || f.ext === ext)
      .reduce((a, f) => ({ raw: a.raw + f.raw, gz: a.gz + f.gz }), { raw: 0, gz: 0 });
  const js = sum('js');
  const wasm = sum('wasm');
  const all = sum();
  console.log(
    `${path}: ${files.size} files, ${ms} ms | JS ${kb(js.raw)} KiB raw / ${kb(js.gz)} KiB gz | wasm ${kb(wasm.raw)} / ${kb(wasm.gz)} gz | total ${kb(all.raw)} / ${kb(all.gz)} KiB gz`,
  );
  for (const [n, f] of [...files].filter(([, f]) => f.raw > 100_000).sort((a, b) => b[1].raw - a[1].raw))
    console.log(
      `   ${n.padEnd(48)} ${kb(f.raw).padStart(8)} gz ${kb(f.gz).padStart(8)} br ${kb(f.br).padStart(8)}  ${f.ct}`,
    );
  await ctx.close();
}
await browser.close();
