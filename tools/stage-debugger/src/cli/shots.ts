/**
 * Screenshot the debugger for every fixture (Playwright Chromium + an in-process Vite server).
 *
 *   node tools/stage-debugger/src/cli/shots.ts [--out docs/build-log/assets/phase-03] [--slug hn-front]
 *        [--slices first|all] [--slice k] [--zoom 0.6] [--layers a,b,c] [--seed 1] [--difficulty normal]
 *        [--clip x,y,w,h] [--reference]
 * Files: <out>/<slug>.png for slice 0 and <out>/<slug>.s<k>.png for later slices (with --slices all).
 * `--reference` also renders the 2013 stage to <out>/aid-dcc-reference.png (local only: never commit it).
 * `--ui <slug>` instead captures the whole debugger UI (panel + canvas) to <out>/debugger-ui.png.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sliceCount } from '@wwm/stage-builder';
import { listCaptureSlugs, loadCapture } from '@wwm/stage-builder/node';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const repo = resolve(root, '../..');
const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? dflt) : dflt;
};
const out = resolve(repo, opt('out', 'docs/build-log/assets/phase-03'));
const only = opt('slug', '');
const allSlices = opt('slices', 'first') === 'all';
const zoom = opt('zoom', '0.6');
const layers = opt('layers', '');
const seed = opt('seed', '1');
const difficulty = opt('difficulty', 'normal');
const clip = opt('clip', '');
const slice0 = Number(opt('slice', '0'));
mkdirSync(out, { recursive: true });

const server = await createServer({
  configFile: join(root, 'vite.config.ts'),
  root,
  server: { port: 0 },
  logLevel: 'warn',
});
await server.listen();
const address = server.httpServer?.address();
const port = typeof address === 'object' && address ? address.port : 5178;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  const ui = opt('ui', '');
  if (ui) {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.goto(
      `http://localhost:${port}/?${new URLSearchParams({ fixture: ui, seed, difficulty, zoom: '0.75' })}`,
    );
    await page.waitForFunction(() => document.body.dataset.ready === '1', undefined, { timeout: 60_000 });
    const file = join(out, 'debugger-ui.png');
    await page.screenshot({ path: file });
    console.log('wrote', file);
  }
  const jobs: { slug: string; slice: number; file: string }[] = [];
  for (const slug of ui ? [] : listCaptureSlugs().filter((s) => !only || s === only)) {
    const n = allSlices ? sliceCount(loadCapture(slug).capture) : 1;
    if (!allSlices && slice0 > 0)
      jobs.push({ slug, slice: slice0, file: join(out, `${slug}.s${slice0}.png`) });
    else
      for (let k = 0; k < n; k++)
        jobs.push({ slug, slice: k, file: join(out, k === 0 ? `${slug}.png` : `${slug}.s${k}.png`) });
  }
  if (args.includes('--reference'))
    jobs.push({ slug: 'reference', slice: 0, file: join(out, 'aid-dcc-reference.png') });
  for (const j of jobs) {
    const qs = new URLSearchParams({
      fixture: j.slug,
      slice: String(j.slice),
      seed,
      difficulty,
      zoom,
      shot: '1',
    });
    if (layers) qs.set('layers', layers);
    await page.goto(`http://localhost:${port}/?${qs}`);
    await page.waitForFunction(
      () => document.body.dataset.ready === '1' || document.getElementById('status')?.className === 'err',
      undefined,
      { timeout: 60_000 },
    );
    const status = await page.locator('#status').textContent();
    if (status?.includes('INVALID') || (await page.locator('#status.err').count()) > 0)
      console.error(`${j.slug} s${j.slice}: ${status}`);
    if (clip) {
      const [x, y, width, height] = clip.split(',').map(Number) as [number, number, number, number];
      const box = await page.locator('#canvas').boundingBox();
      await page.screenshot({
        path: j.file,
        clip: { x: (box?.x ?? 0) + x, y: (box?.y ?? 0) + y, width, height },
        fullPage: true,
      });
    } else await page.locator('#canvas').screenshot({ path: j.file });
    console.log('wrote', j.file);
  }
} finally {
  await browser.close();
  await server.close();
}
