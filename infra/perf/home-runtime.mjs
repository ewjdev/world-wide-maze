/** Opt-in, source-bound headed home performance probe. */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { prepareOutput, verifyHomeBuild } from './home-common.mjs';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');
const out = prepareOutput();
const base = process.env.AUDIT_BASE ?? 'http://127.0.0.1:4318';
const servedBuild = await verifyHomeBuild(base);
const stat = (a) => {
  const s = [...a].sort((a, b) => a - b);
  return {
    n: s.length,
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    p50: s[Math.floor(s.length * 0.5)],
    p95: s[Math.floor(s.length * 0.95)],
    p99: s[Math.floor(s.length * 0.99)],
    max: s.at(-1),
  };
};
const browser = await chromium.launch({ headless: false, args: ['--enable-gpu', '--use-angle=metal'] });
const root = await browser.newBrowserCDPSession();
const report = {
  when: new Date().toISOString(),
  base,
  servedBuild,
  browser: browser.version(),
  system: await root.send('SystemInfo.getInfo'),
  hardware: execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string', 'hw.memsize'], { encoding: 'utf8' }),
  localCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim(),
  instrumentation:
    'Headed hardware GPU, engine frame wrapper; timestamp query once per 10 engine frames. Steady phase after 5s settle. All arrays retained. Cold/warm download not timed here.',
  runs: [],
  assets: {},
};
const save = () => writeFileSync(`${out}/runtime.json`, JSON.stringify(report, null, 2));
const allSpecs = [
  { name: 'home-auto-dpr2', quality: 'auto', dpr: 2 },
  { name: 'home-medium-dpr2', quality: 'medium', dpr: 2 },
  { name: 'home-low-dpr2', quality: 'low', dpr: 2 },
  { name: 'home-auto-dpr1', quality: 'auto', dpr: 1 },
  { name: 'home-frozen-diagnostic', quality: 'auto', dpr: 2, frozen: true },
  { name: 'home-auto-cpu6-dpr2', quality: 'auto', dpr: 2, cpu: 6 },
];
const specs = process.env.AUDIT_CASES
  ? allSpecs.filter((s) => process.env.AUDIT_CASES.split(',').includes(s.name))
  : allSpecs;
try {
  for (let repeat = 0; repeat < Number(process.env.AUDIT_REPEATS ?? 3); repeat++)
    for (const spec of repeat % 2 ? [...specs].reverse() : specs) {
      const ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: spec.dpr,
      });
      await ctx.addInitScript(() => {
        localStorage.setItem('wwm.analytics.preference', 'off');
        localStorage.setItem('wwm.muted', '1');
        window.__WWM_TEST__ = { noAutoPause: true, titleMotion: 30 };
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('response', async (response) => {
        const url = response.url();
        if (url.startsWith(new URL('/assets/', base).href) && !report.assets[url]) {
          try {
            const b = await response.body();
            const sha = createHash('sha256').update(b).digest('hex');
            const local = `${process.cwd()}/apps/web/dist/assets/${url.split('/').at(-1)}`;
            report.assets[url] = {
              decodedBytes: b.length,
              sha256: sha,
              cache: response.headers()['cache-control'],
              encoding: response.headers()['content-encoding'],
              localDistMatches: existsSync(local)
                ? createHash('sha256').update(readFileSync(local)).digest('hex') === sha
                : null,
            };
          } catch {}
        }
      });
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Performance.enable');
      await page.goto(report.base);
      await page.waitForFunction(() => window.__wwmGame?.engine?.stats().drawCalls > 20, { timeout: 60000 });
      await page.evaluate((q) => window.__wwmGame.engine.setQuality(q), spec.quality);
      await page.waitForTimeout(5000);
      if (spec.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: spec.cpu });
      const snap = () =>
        page.evaluate(() => {
          const e = window.__wwmGame.engine,
            r = e.debug().renderer;
          return {
            phase: window.__wwmGame.getView().phase,
            stats: e.stats(),
            canvas: { width: r.domElement.width, height: r.domElement.height },
            rendererMemory: r.info.memory,
            totalTrackedBytes: r.info.memoryMap?.total ?? null,
            visibility: document.visibilityState,
          };
        });
      const before = await snap();
      const metricsBefore = Object.fromEntries(
        (await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]),
      );
      await page.evaluate(({ frozen }) => {
        const e = window.__wwmGame.engine,
          r = e.debug().renderer,
          orig = e.frame;
        window.__run = { at: performance.now(), engine: [], raf: [], gpu: [], tiers: [], long: [], frozen };
        let pending = false,
          counter = 0,
          last,
          renderAt;
        const supported = r.backend.device?.features.has('timestamp-query');
        if (supported) r.backend.trackTimestamp = true;
        window.__run.gpuSupported = !!supported;
        new PerformanceObserver((l) =>
          window.__run.long.push(...l.getEntries().map((x) => ({ at: x.startTime, ms: x.duration }))),
        ).observe({ type: 'longtask' });
        e.frame = function (...args) {
          const at = performance.now();
          if (!frozen) orig.apply(this, args);
          const end = performance.now();
          window.__run.engine.push({
            at,
            cpu: end - at,
            interval: renderAt === undefined ? null : at - renderAt,
          });
          renderAt = at;
          if (!frozen && supported && counter++ % 10 === 0 && !pending) {
            pending = true;
            r.resolveTimestampsAsync('render')
              .then((ms) => window.__run.gpu.push(ms))
              .finally(() => (pending = false));
          }
        };
        window.__active = true;
        function tick(t) {
          if (last !== undefined) window.__run.raf.push(t - last);
          last = t;
          if (window.__active) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }, spec);
      const started = Date.now();
      const samples = [];
      for (let s = 0; s < Number(process.env.AUDIT_SECONDS ?? 8); s++) {
        await page.waitForTimeout(1000);
        samples.push(await snap());
      }
      const elapsed = Date.now() - started;
      const data = await page.evaluate(() => {
        window.__active = false;
        return window.__run;
      });
      const metricsAfter = Object.fromEntries(
        (await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]),
      );
      const after = await snap();
      const intervals = data.engine.map((x) => x.interval).filter((x) => x !== null);
      const result = {
        spec,
        repeat,
        elapsedMs: elapsed,
        before,
        after,
        samples,
        errors,
        engineCpuMs: stat(data.engine.map((x) => x.cpu)),
        renderIntervalMs: stat(intervals),
        rafIntervalMs: stat(data.raf),
        gpuMs: stat(data.gpu),
        sceneFps: 1000 / stat(intervals).mean,
        mainThreadBusyPct:
          (100 * (metricsAfter.TaskDuration - metricsBefore.TaskDuration)) / (elapsed / 1000),
        longTasks: data.long,
        raw: data,
      };
      report.runs.push(result);
      save();
      console.log(
        JSON.stringify({
          name: spec.name,
          repeat,
          sceneFps: result.sceneFps,
          busy: result.mainThreadBusyPct,
          cpu: result.engineCpuMs,
          gpu: result.gpuMs,
          interval: result.renderIntervalMs,
          stats: after.stats,
          canvas: after.canvas,
          bytes: after.totalTrackedBytes,
          errors,
        }),
      );
      await ctx.close();
    }
} finally {
  save();
  await browser.close();
}
