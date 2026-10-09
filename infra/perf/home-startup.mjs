/** Opt-in, source-bound headed home performance probe. */

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { prepareOutput, verifyHomeBuild } from './home-common.mjs';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');
const out = prepareOutput();
const base = process.env.AUDIT_BASE ?? 'http://127.0.0.1:4318';
const servedBuild = await verifyHomeBuild(base);
function instrument() {
  localStorage.setItem('wwm.analytics.preference', 'off');
  const p = (window.__startup = {
    phases: [],
    long: [],
    events: [],
    shifts: [],
    paint: [],
    lcp: [],
    spans: [],
  });
  new PerformanceObserver((l) =>
    p.long.push(...l.getEntries().map((e) => ({ at: e.startTime, ms: e.duration }))),
  ).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((l) =>
    p.paint.push(...l.getEntries().map((e) => ({ name: e.name, at: e.startTime }))),
  ).observe({ type: 'paint', buffered: true });
  new PerformanceObserver((l) =>
    p.lcp.push(
      ...l
        .getEntries()
        .map((e) => ({ at: e.startTime, size: e.size, element: e.element?.outerHTML?.slice(0, 350) })),
    ),
  ).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) =>
    p.shifts.push(
      ...l.getEntries().map((e) => ({ at: e.startTime, value: e.value, recentInput: e.hadRecentInput })),
    ),
  ).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) =>
    p.events.push(
      ...l
        .getEntries()
        .map((e) => ({
          name: e.name,
          at: e.startTime,
          ms: e.duration,
          processingStart: e.processingStart,
          processingEnd: e.processingEnd,
          id: e.interactionId,
        })),
    ),
  ).observe({ type: 'event', buffered: true, durationThreshold: 16 });
  const watch = new MutationObserver(() => {
    const b = document.querySelector('[data-testid=start]');
    if (b && !p.titleAt) p.titleAt = performance.now();
    if (b && !b.disabled && !p.startAt) p.startAt = performance.now();
  });
  watch.observe(document, { childList: true, attributes: true, subtree: true });
  let game;
  Object.defineProperty(window, '__wwmGame', {
    configurable: true,
    get: () => game,
    set(g) {
      game = g;
      if (!g) return;
      p.gameAt = performance.now();
      let phase, engine;
      g.subscribe(() => {
        const v = g.getView();
        if (v.phase !== phase) {
          phase = v.phase;
          p.phases.push({ at: performance.now(), phase });
        }
        if (g.engine && g.engine !== engine) {
          engine = g.engine;
          p.engineAt = performance.now();
          const orig = engine.loadStage;
          engine.loadStage = async function (...args) {
            const span = { name: 'loadStage', at: performance.now() };
            p.spans.push(span);
            const specs = process.env.AUDIT_CASES
              ? allSpecs.filter((s) => process.env.AUDIT_CASES.split(',').includes(s.name))
              : allSpecs;
            try {
              return await orig.apply(this, args);
            } finally {
              span.ms = performance.now() - span.at;
              p.attractReadyAt = performance.now();
            }
          };
        }
      });
    },
  });
}
const browser = await chromium.launch({ headless: false, args: ['--enable-gpu', '--use-angle=metal'] });
const report = {
  when: new Date().toISOString(),
  url: base,
  servedBuild,
  browser: browser.version(),
  note: 'Real live network, fresh isolated context per pair; warm is same-context reload. All CPU limits start before navigation. No sampling profiler. MutationObserver/PerformanceObservers and loadStage timing wrappers. Event duration is scripted lab interaction latency, not field INP.',
  runs: [],
};
const save = () => writeFileSync(out + '/startup.json', JSON.stringify(report, null, 2));
const allSpecs = [
  { name: 'desktop-native', viewport: { width: 1440, height: 900 }, dpr: 2, cpu: 1 },
  {
    name: 'desktop-cpu6-10Mbps',
    viewport: { width: 1440, height: 900 },
    dpr: 2,
    cpu: 6,
    mbps: 10,
    latency: 100,
  },
  {
    name: 'mobile-cpu6-1.6Mbps',
    viewport: { width: 390, height: 844 },
    dpr: 2,
    cpu: 6,
    mbps: 1.6,
    latency: 150,
    mobile: true,
  },
];
try {
  for (const spec of specs)
    for (let repeat = 0; repeat < Number(process.env.AUDIT_REPEATS ?? 3); repeat++) {
      const ctx = await browser.newContext({
        viewport: spec.viewport,
        deviceScaleFactor: spec.dpr,
        isMobile: spec.mobile ?? false,
        hasTouch: spec.mobile ?? false,
      });
      await ctx.addInitScript(instrument);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: spec.cpu });
      if (spec.mbps)
        await cdp.send('Network.emulateNetworkConditions', {
          offline: false,
          latency: spec.latency,
          downloadThroughput: spec.mbps * 125000,
          uploadThroughput: spec.mbps * 125000,
          connectionType: 'cellular4g',
        });
      for (const cache of ['cold', 'warm']) {
        errors.length = 0;
        if (cache === 'cold') await page.goto(report.url, { waitUntil: 'domcontentloaded' });
        else await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () =>
            window.__startup?.attractReadyAt &&
            document.querySelector('[data-testid=start]')?.disabled === false,
          { timeout: 90000 },
        );
        await page.waitForTimeout(1200);
        const data = await page.evaluate(() => ({
          probe: window.__startup,
          nav: performance.getEntriesByType('navigation').map((e) => e.toJSON()),
          resources: performance.getEntriesByType('resource').map((e) => e.toJSON()),
          engine: window.__wwmGame.engine.stats(),
          canvas: {
            width: document.querySelector('canvas').width,
            height: document.querySelector('canvas').height,
          },
          phase: window.__wwmGame.getView().phase,
          visibility: document.visibilityState,
        }));
        // One intended native click after LCP collection; this goes only to local how-to state.
        await page.getByTestId('start').click();
        await page.waitForTimeout(700);
        data.afterClick = await page.evaluate(() => ({
          phase: window.__wwmGame.getView().phase,
          events: window.__startup.events,
          phases: window.__startup.phases,
        }));
        report.runs.push({ spec, repeat, cache, errors: [...errors], ...data });
        save();
        console.log(
          JSON.stringify({
            name: spec.name,
            repeat,
            cache,
            fcp: data.probe.paint.find((e) => e.name === 'first-contentful-paint')?.at,
            lcp: data.probe.lcp.at(-1)?.at,
            startAt: data.probe.startAt,
            engineAt: data.probe.engineAt,
            attractAt: data.probe.attractReadyAt,
            ttfb: data.nav[0].responseStart,
            totalEncodedBytes: data.resources.reduce((a, e) => a + e.encodedBodySize, 0),
            transferBytes: data.resources.reduce((a, e) => a + e.transferSize, 0),
            longTasks: data.probe.long,
            click: data.afterClick.events,
            errors,
          }),
        );
      }
      await ctx.close();
    }
} finally {
  save();
  await browser.close();
}
