#!/usr/bin/env node
/**
 * Which JS chunks and workers each route downloads (Phase 12 bundle check): verifies that the default game path
 * loads one Rapier copy and no physics worker, and that the phone controller loads no three.js/Rapier.
 *   node infra/perf/requests.mjs http://localhost:8899
 */
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');
const base = (process.argv[2] ?? 'http://localhost:8899').replace(/\/$/, '');
const browser = await chromium.launch({
  args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu'],
});
for (const path of ['/c/123456', '/about', '/play/practice', '/play/practice?physics=worker']) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    localStorage.setItem('wwm.howtoSeen', '1');
    localStorage.setItem('wwm.tutorialDone', '1');
    window.__WWM_TEST__ = { noAutoPause: true, skipIntro: true };
  });
  const page = await ctx.newPage();
  const js = new Map();
  page.on('response', async (r) => {
    const u = new URL(r.url());
    if (!u.pathname.endsWith('.js')) return;
    const len =
      Number(r.headers()['content-length'] ?? 0) || (await r.body().catch(() => Buffer.alloc(0))).length;
    js.set(u.pathname.split('/').pop(), len);
  });
  // workers' own requests are reported through the context
  ctx.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.endsWith('.js') && !js.has(u.pathname.split('/').pop()))
      js.set(u.pathname.split('/').pop(), 0);
  });
  await page.goto(`${base}${path}`);
  if (path.startsWith('/play'))
    await page.waitForFunction(() => document.body.dataset.phase === 'play', null, { timeout: 60_000 });
  else await page.waitForTimeout(3000);
  const names = [...js.keys()].sort();
  const rapier = names.filter((n) => n.startsWith('rapier-'));
  const workers = names.filter((n) => /worker/i.test(n));
  const three = names.filter((n) => n.startsWith('vendor-three'));
  console.log(
    `${path}: ${names.length} JS files; rapier chunks ${rapier.length} ${JSON.stringify(rapier)}; workers ${JSON.stringify(workers)}; three ${three.length}`,
  );
  await ctx.close();
}
await browser.close();
