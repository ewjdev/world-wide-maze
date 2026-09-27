/** Bounded opt-in audit overhead: paired minimal-rAF vs CPU wrapper/long-task observer/state samples. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');
const base = process.env.AUDIT_BASE ?? 'http://127.0.0.1:4318';
const out = resolve(process.env.AUDIT_OUT ?? 'docs/launch/evidence/performance-p1-staging');
mkdirSync(out, { recursive: true });
const headless = !!process.env.CI || process.env.AUDIT_HEADLESS === '1';
const browser = await chromium.launch({
  headless,
  args:
    process.platform === 'darwin' ? ['--enable-gpu', '--use-angle=metal'] : ['--enable-unsafe-swiftshader'],
});
const report = {
  date: new Date().toISOString(),
  base,
  browser: browser.version(),
  headless,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  hardware:
    process.platform === 'darwin'
      ? execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string', 'hw.memsize'], { encoding: 'utf8' }).trim()
      : process.platform,
  viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  method:
    'Three alternating pairs, ten seconds per run, same idle practice scene. Off still records minimal rAF intervals and endpoint CDP metrics. On adds audit-style per-frame CPU wrapper, long-task observer and once/second debugState reads. No CPU profiler or GPU timestamp resolution; those invasive modes require separate interpretation. No production instrumentation is installed.',
  runs: [],
};
const stats = (values) => {
  const ordered = [...values].sort((a, b) => a - b);
  return {
    n: values.length,
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    p95: ordered[Math.floor(ordered.length * 0.95)],
    max: ordered.at(-1),
  };
};
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.route('**/api/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await context.addInitScript(
    ({ headless }) => {
      if (headless) delete Navigator.prototype.gpu;
      localStorage.setItem('wwm.analytics.preference', 'off');
      localStorage.setItem('wwm.howtoSeen', '1');
      localStorage.setItem('wwm.tutorialDone', '1');
      window.__WWM_TEST__ = { skipIntro: true, noAutoPause: true, quality: 'high' };
    },
    { headless },
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(`${base}/play/practice?offline=1`);
  await page.waitForFunction(() => window.__wwmGame?.debugState().phase === 'play');
  await page.waitForTimeout(2000);
  const metrics = async () =>
    Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  for (let pair = 0; pair < 3; pair++) {
    for (const enabled of pair === 1 ? [true, false] : [false, true]) {
      const before = await metrics();
      const start = performance.now();
      await page.evaluate((enabled) => {
        const engine = window.__wwmGame.engine;
        const original = engine.frame;
        const record = {
          frames: [],
          cpuMs: [],
          longTasks: [],
          start: performance.now(),
          active: true,
          original,
          observer: null,
        };
        window.__overhead = record;
        if (enabled) {
          record.observer = new PerformanceObserver((list) =>
            record.longTasks.push(...list.getEntries().map((e) => e.duration)),
          );
          record.observer.observe({ type: 'longtask' });
          engine.frame = function (...args) {
            const begin = performance.now();
            const result = original.apply(this, args);
            record.cpuMs.push(performance.now() - begin);
            return result;
          };
        }
        let last;
        const tick = (time) => {
          if (!record.active) return;
          if (last !== undefined) record.frames.push(time - last);
          last = time;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, enabled);
      for (let second = 0; second < 10; second++) {
        await page.waitForTimeout(1000);
        if (enabled) await page.evaluate(() => window.__wwmGame.debugState());
      }
      const elapsedMs = performance.now() - start;
      const after = await metrics();
      const data = await page.evaluate(() => {
        const record = window.__overhead;
        record.active = false;
        record.observer?.disconnect();
        window.__wwmGame.engine.frame = record.original;
        return {
          frames: record.frames,
          cpuMs: record.cpuMs,
          longTasks: record.longTasks,
          backend: window.__wwmGame.debugState().engine.backend,
        };
      });
      const taskMs = (after.TaskDuration - before.TaskDuration) * 1000;
      report.runs.push({
        pair,
        enabled,
        elapsedMs,
        frame: stats(data.frames),
        taskMs,
        mainThreadBusyPct: (100 * taskMs) / elapsedMs,
        sampledCpuMs: enabled ? stats(data.cpuMs) : null,
        longTasks: data.longTasks,
        backend: data.backend,
      });
    }
  }
  report.errors = errors;
  report.pairs = [0, 1, 2].map((pair) => {
    const off = report.runs.find((r) => r.pair === pair && !r.enabled);
    const on = report.runs.find((r) => r.pair === pair && r.enabled);
    return {
      pair,
      frameP95DeltaMs: on.frame.p95 - off.frame.p95,
      mainThreadBusyDeltaPercentagePoints: on.mainThreadBusyPct - off.mainThreadBusyPct,
    };
  });
  console.log(JSON.stringify({ pairs: report.pairs, errors }, null, 2));
} finally {
  writeFileSync(resolve(out, 'overhead.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
