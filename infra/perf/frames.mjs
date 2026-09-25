#!/usr/bin/env node
/**
 * Phase 12 measurement: frame-time distribution of the PRODUCTION build while playing, per stage, plus a
 * CSP / console check of every page. Needs the production build served the way it will be deployed:
 *
 *   pnpm --filter @wwm/web build
 *   (cd apps/worker && npx wrangler dev --env production --port 8899)   # Worker + static assets + _headers
 *   node infra/perf/frames.mjs http://localhost:8899 [--seconds 20] [--throttle 1,4] [--headless] [--out f.json]
 *
 * Method: Chromium (Playwright) with the real GPU (ANGLE/Metal on macOS), 1440×900 viewport, DPR 1 by default
 * (`--dpr 2` for Retina). Each stage is deep-linked (`/play/<ref>`, built in the browser from the fixture
 * capture), the intro is skipped, then the ball is driven with the arrow keys for `--seconds` while a rAF
 * recorder logs every frame interval (performance.now deltas). The engine's own fps estimate and quality tier
 * are sampled once a second. `--throttle 4` applies DevTools CPU throttling ×4 (a CPU-only proxy for a slower
 * machine; it does NOT slow the GPU).
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const base = (args.find((a) => /^https?:/.test(a)) ?? 'http://localhost:8899').replace(/\/$/, '');
const seconds = Number(opt('--seconds', '20'));
const throttles = opt('--throttle', '1').split(',').map(Number);
const dpr = Number(opt('--dpr', '1'));
const headless = args.includes('--headless');
const out = opt('--out', '/tmp/wwm-frames.json');
const stages = opt(
  '--stages',
  'practice,fixture-hn-front,fixture-govuk-card-grid,fixture-mdn-dark-docs,fixture-image-gallery,fixture-wikipedia-article~3',
).split(',');
const pages = ['/', '/about', '/making', '/log', '/c/123456', '/p/123456'];

const GPU = ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-unsafe-webgpu'];

function pct(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
const r1 = (n) => (n === null ? null : Math.round(n * 10) / 10);

async function newPage(browser, extraInit) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
  await ctx.addInitScript(() => {
    localStorage.setItem('wwm.howtoSeen', '1');
    localStorage.setItem('wwm.tutorialDone', '1');
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      window.__csp.push(
        `${e.violatedDirective} ${e.blockedURI} @ ${(e.sourceFile || '').split('/').pop()}:${e.lineNumber}:${e.columnNumber} ${e.disposition}`,
      ),
    );
  });
  if (extraInit) await ctx.addInitScript(extraInit);
  const page = await ctx.newPage();
  const log = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') log.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
  return { ctx, page, log };
}

async function measureStage(browser, ref, throttle) {
  const { ctx, page, log } = await newPage(browser, () => {
    window.__WWM_TEST__ = { noAutoPause: true, skipIntro: true };
  });
  const cdp = await ctx.newCDPSession(page);
  const t0 = Date.now();
  await page.goto(`${base}/play/${ref}`);
  await page.waitForFunction(() => document.body.dataset.phase === 'play', null, { timeout: 120_000 });
  const toPlayMs = Date.now() - t0;
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const tick = (t) => {
      window.__frames.push(t - last);
      last = t;
      if (window.__recording) requestAnimationFrame(tick);
    };
    window.__recording = true;
    requestAnimationFrame(tick);
  });
  const samples = [];
  const keys = ['ArrowUp', 'ArrowLeft', 'ArrowUp', 'ArrowRight'];
  for (let s = 0; s < seconds; s++) {
    const k = keys[s % keys.length];
    await page.keyboard.down(k);
    await page.waitForTimeout(1000);
    await page.keyboard.up(k);
    samples.push(
      await page.evaluate(() => {
        const st = window.__wwmGame?.debugState();
        return st?.engine
          ? {
              fps: st.engine.fps,
              tier: st.engine.tier,
              phase: st.phase,
              backend: st.engine.backend,
              draws: st.engine.drawCalls,
            }
          : { phase: st?.phase };
      }),
    );
  }
  const frames = await page.evaluate(() => {
    window.__recording = false;
    return window.__frames.slice(1);
  });
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const csp = await page.evaluate(() => window.__csp);
  await ctx.close();
  const sorted = [...frames].sort((a, b) => a - b);
  const total = frames.reduce((a, b) => a + b, 0);
  return {
    ref,
    throttle,
    gpu,
    toPlayMs,
    frames: frames.length,
    meanFps: r1((frames.length / total) * 1000),
    p50: r1(pct(sorted, 50)),
    p95: r1(pct(sorted, 95)),
    p99: r1(pct(sorted, 99)),
    max: r1(sorted.at(-1) ?? null),
    // At 60 Hz vsync intervals scatter around 16.7 ms; a frame counts as dropped/late above 1.5 vsyncs (25 ms).
    over25: r1((100 * frames.filter((f) => f > 25).length) / frames.length),
    over33_3: r1((100 * frames.filter((f) => f > 33.4).length) / frames.length),
    over50: r1((100 * frames.filter((f) => f > 50).length) / frames.length),
    histogramMs: Object.fromEntries(
      [8, 12, 17, 20, 25, 34, 50, 100, Infinity].map((hi, i, a) => [
        `${i ? a[i - 1] : 0}-${hi}`,
        frames.filter((f) => f > (i ? a[i - 1] : 0) && f <= hi).length,
      ]),
    ),
    tiers: [...new Set(samples.map((s) => s.tier))],
    finalTier: samples.at(-1)?.tier,
    backend: samples.at(-1)?.backend,
    drawCalls: samples.at(-1)?.draws,
    phases: [...new Set(samples.map((s) => s.phase))],
    csp,
    console: log.slice(0, 10),
  };
}

async function checkPage(browser, path) {
  const { ctx, page, log } = await newPage(browser);
  await page.goto(`${base}${path}`);
  await page.waitForTimeout(4000);
  const csp = await page.evaluate(() => window.__csp);
  const headers = (await page.request.get(`${base}${path}`)).headers();
  await ctx.close();
  return { path, csp, console: log.slice(0, 10), hasCsp: 'content-security-policy' in headers };
}

const browser = await chromium.launch({ headless, args: GPU });
const result = { base, when: new Date().toISOString(), headless, dpr, seconds, pages: [], runs: [] };
for (const p of pages) {
  const r = await checkPage(browser, p);
  result.pages.push(r);
  console.log(
    `page ${p}: csp violations ${r.csp.length}, console ${r.console.length}, CSP header ${r.hasCsp}`,
  );
  for (const l of [...r.csp, ...r.console]) console.log(`   ${l}`);
}
for (const throttle of throttles) {
  for (const ref of stages) {
    try {
      const r = await measureStage(browser, ref, throttle);
      result.runs.push(r);
      console.log(
        `${ref} ×${throttle}: ${r.frames} frames, ${r.meanFps} fps, p50 ${r.p50} p95 ${r.p95} p99 ${r.p99} max ${r.max} ms, >25 ${r.over25}%, >33 ${r.over33_3}%, >50 ${r.over50}%, tier ${r.tiers.join('→')} (${r.backend}, ${r.drawCalls} draws), to-play ${r.toPlayMs} ms, csp ${r.csp.length}, console ${r.console.length}`,
      );
      for (const l of [...r.csp, ...r.console]) console.log(`   ${l}`);
    } catch (e) {
      console.log(`${ref} ×${throttle}: FAILED ${String(e).slice(0, 200)}`);
      result.runs.push({ ref, throttle, error: String(e).slice(0, 300) });
    }
  }
}
await browser.close();
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(`wrote ${out}`);
