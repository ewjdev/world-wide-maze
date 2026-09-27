/** Paired production-build idle-work probe. Baseline must be the saved clean P1 dist. */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, resolve } from 'node:path';
import { verifyServedBuild } from './p1-build.mjs';
import { runtimeFingerprint } from './p1-fingerprint.mjs';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = new URL('../../', import.meta.url).pathname;
const out = resolve(process.env.AUDIT_OUT ?? `${root}docs/launch/evidence/idle-p2`);
mkdirSync(out, { recursive: true });
const directories = {
  baseline: process.env.IDLE_BASELINE ?? '/tmp/wwm-idle-p1-baseline-dist',
  candidate: `${root}apps/web/dist`,
};
const servers = [];
const origins = {};
const builds = {};
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
for (const [name, dir] of Object.entries(directories)) {
  const server = createServer((req, res) => {
    let file = resolve(dir, `.${new URL(req.url, 'http://local').pathname}`);
    if (!file.startsWith(resolve(dir))) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = resolve(dir, 'index.html');
    res.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  origins[name] = `http://127.0.0.1:${server.address().port}`;
  const expected =
    name === 'candidate'
      ? runtimeFingerprint()
      : {
          sha256:
            process.env.IDLE_BASELINE_SHA ??
            '7ec6d5eb369258f8d58e47c31222bda8ad395505dfbc13597f3bfee45509ba1e',
        };
  builds[name] = await verifyServedBuild(origins[name], expected);
}
const browser = await chromium.launch({ headless: false, args: ['--enable-gpu', '--use-angle=metal'] });
const browserCdp = await browser.newBrowserCDPSession();
const report = {
  system: await browserCdp.send('SystemInfo.getInfo'),
  viewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
  date: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  browser: browser.version(),
  hardware: execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string', 'hw.memsize'], {
    encoding: 'utf8',
  }).trim(),
  builds,
  note: 'Same viewport1440x900/DPR2/high quality and native GPU. Synthetic document visibility while foreground proves application exclusion independent of browser throttling. Main-thread TaskDuration excludes worker CPU; worker timer callback CPU is separately instrumented and excludes messaging. GPU summed query cost is sampled submitted work, not device utilization.',
  runs: [],
};
try {
  for (let repeat = 0; repeat < 3; repeat++)
    for (const name of repeat % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
      await ctx.addInitScript(() => {
        localStorage.setItem('wwm.analytics.preference', 'off');
        localStorage.setItem('wwm.howtoSeen', '1');
        localStorage.setItem('wwm.tutorialDone', '1');
        window.__WWM_TEST__ = {
          skipIntro: true,
          noAutoPause: true,
          quality: 'high',
          gpuTimestampQueries: true,
        };
      });
      await ctx.route('**/api/**', (r) => r.fulfill({ json: [] }));
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      let physicsWorker;
      const instrumented = [];
      page.on('worker', (worker) => {
        instrumented.push(
          worker
            .evaluate(() => {
              if (self.name !== 'wwm-physics') return false;
              self.__idleTimers = { count: 0, cpuMs: 0, tick: 0, stepsPerSec: 0 };
              const originalPost = self.postMessage.bind(self);
              self.postMessage = (message, ...args) => {
                if (message.t === 'state') {
                  self.__idleTimers.tick = message.snap.tick;
                  self.__idleTimers.stepsPerSec = message.stepsPerSec;
                }
                return originalPost(message, ...args);
              };
              const original = setTimeout;
              self.setTimeout = (fn, delay, ...args) =>
                original(
                  (...a) => {
                    const start = performance.now();
                    try {
                      self.__idleTimers.count++;
                      return fn(...a);
                    } finally {
                      self.__idleTimers.cpuMs += performance.now() - start;
                    }
                  },
                  delay,
                  ...args,
                );
              return true;
            })
            .then((yes) => {
              if (yes) physicsWorker = worker;
            }),
        );
      });
      await page.goto(`${origins[name]}/play/practice?offline=1&physics=worker`);
      await page.waitForFunction(() => window.__wwmGame?.debugState().phase === 'play');
      await Promise.all(instrumented);
      if ((await page.evaluate(() => window.__wwmGame.debugState().driver)) !== 'worker')
        throw new Error('Worker driver required');
      if (!physicsWorker) throw new Error('Physics worker instrumentation missing');
      await page.evaluate(() => {
        const e = window.__wwmGame.engine,
          r = e.debug().renderer;
        const original = e.frame;
        window.__idle = { frames: 0, browserFrames: 0, gpu: [], pending: false };
        const beat = () => {
          window.__idle.browserFrames++;
          requestAnimationFrame(beat);
        };
        requestAnimationFrame(beat);
        if (!r.backend.device?.features.has('timestamp-query'))
          throw new Error('Native timestamp-query GPU required');
        r.backend.trackTimestamp = true;
        e.frame = function (...args) {
          window.__idle.frames++;
          original.apply(this, args);
          if (!window.__idle.pending) {
            window.__idle.pending = true;
            r.resolveTimestampsAsync('render')
              .then((ms) => window.__idle.gpu.push(ms))
              .finally(() => {
                window.__idle.pending = false;
              });
          }
        };
        window.__idleVisibility = 'visible';
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => window.__idleVisibility,
        });
      });
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Performance.enable');
      const task = async () =>
        Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]))
          .TaskDuration;
      for (const mode of ['active', 'paused', 'hidden', 'title']) {
        await page.evaluate((mode) => {
          const g = window.__wwmGame;
          if (mode === 'paused') g.menu();
          if (mode === 'hidden') {
            window.__idleVisibility = 'hidden';
            document.dispatchEvent(new Event('visibilitychange'));
          }
          if (mode === 'title') {
            window.__idleVisibility = 'visible';
            document.dispatchEvent(new Event('visibilitychange'));
            g.askConfirm('quit');
            g.confirm(true);
          }
        }, mode);
        if (mode === 'title')
          await page.waitForFunction(() => window.__wwmGame.debugState().phase === 'title');
        await page.waitForTimeout(1400); // excluded, identical warm-up; camera transition is 0.9 seconds
        const snapshot = () =>
          page.evaluate(() => ({
            frames: window.__idle.frames,
            browserFrames: window.__idle.browserFrames,
            gpu: window.__idle.gpu.length,
            state: window.__wwmGame.debugState(),
            at: performance.now(),
          }));
        const before = await snapshot(),
          workerBefore = physicsWorker ? await physicsWorker.evaluate(() => self.__idleTimers) : null,
          cpuBefore = await task();
        await page.waitForTimeout(4000);
        const cpuAfter = await task(),
          workerAfter = physicsWorker ? await physicsWorker.evaluate(() => self.__idleTimers) : null,
          after = await snapshot();
        const gpu = await page.evaluate((start) => window.__idle.gpu.slice(start), before.gpu);
        const elapsedMs = after.at - before.at;
        report.runs.push({
          name,
          repeat,
          mode,
          elapsedMs,
          frames: after.frames - before.frames,
          browserFrames: after.browserFrames - before.browserFrames,
          mainCpuMs: (cpuAfter - cpuBefore) * 1000,
          mainBusyPct: ((cpuAfter - cpuBefore) * 100000) / elapsedMs,
          workerTicks: workerAfter ? workerAfter.tick - workerBefore.tick : null,
          workerStepsPerSec: workerAfter?.stepsPerSec,
          workerTimerCallbacks: workerAfter ? workerAfter.count - workerBefore.count : null,
          workerTimerCpuMs: workerAfter ? workerAfter.cpuMs - workerBefore.cpuMs : null,
          gpuSamples: gpu.length,
          gpuTotalMs: gpu.reduce((a, b) => a + b, 0),
          gpuMeanMs: gpu.length ? gpu.reduce((a, b) => a + b, 0) / gpu.length : null,
          before: before.state,
          after: after.state,
          errors: [...errors],
        });
        writeFileSync(`${out}/paired.json`, JSON.stringify(report, null, 2));
        if (errors.length) throw new Error(errors.join('\n'));
        if (mode !== 'hidden' && (!gpu.length || gpu.some((ms) => !Number.isFinite(ms) || ms <= 0)))
          throw new Error('Missing or invalid submitted GPU timing');
        if (repeat === 0 && ['paused', 'title'].includes(mode))
          await page.screenshot({ path: `${out}/${name}-${mode}.png` });
        console.log(
          JSON.stringify(report.runs.at(-1), (k, v) => (['before', 'after'].includes(k) ? undefined : v)),
        );
      }
      await ctx.close();
    }
} finally {
  await browser.close();
  for (const server of servers) server.close();
}
