/** #30: opt-in production startup/first-input attribution. No runtime imports or API writes.
 * Build with p1-build.mjs; serve dist; AUDIT_BASE=... AUDIT_OUT=... node infra/perf/startup-p2.mjs
 * Phase wrappers and sampling profiler add overhead. Samples are diagnostic, not field INP.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { verifyServedBuild } from './p1-build.mjs';
import { runtimeFingerprint } from './p1-fingerprint.mjs';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');
const base = process.env.AUDIT_BASE ?? 'http://127.0.0.1:4318';
const out = resolve(process.env.AUDIT_OUT ?? 'docs/launch/evidence/startup-p2');
mkdirSync(out, { recursive: true });
// A prior verified report can bind a historical baseline after the worktree has advanced.
// Every served asset is still verified; this never labels dirty candidate source as the baseline.
const historical = process.env.AUDIT_BASELINE_RECORD
  ? JSON.parse(readFileSync(process.env.AUDIT_BASELINE_RECORD, 'utf8'))
  : null;
const expected = historical?.runtimeFingerprint ?? runtimeFingerprint();
const servedBuild = await verifyServedBuild(base, expected);
const muted = process.env.AUDIT_MUTED !== '0';
const browser = await chromium.launch({ headless: false, args: ['--enable-gpu', '--use-angle=metal'] });
const report = {
  date: new Date().toISOString(),
  commit: historical?.commit ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  runtimeFingerprint: expected,
  historicalSourceRecord: process.env.AUDIT_BASELINE_RECORD ?? null,
  muted,
  servedBuild,
  browser: browser.version(),
  hardware: execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string', 'hw.memsize'], {
    encoding: 'utf8',
  }).trim(),
  system: await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo'),
  instrumentation:
    'Phase/audio wrappers plus CDP sampling profiler; scripted-input isolation; not field INP.',
  inputIsolation: 'v1: one armed Space per press; reject suppressed Space or timing-window interference',
  runs: [],
};
const save = () => writeFileSync(resolve(out, 'startup.json'), `${JSON.stringify(report, null, 2)}\n`);

function instrument({ muted }) {
  localStorage.setItem('wwm.analytics.preference', 'off');
  localStorage.setItem('wwm.howtoSeen', '1');
  localStorage.setItem('wwm.tutorialDone', '1');
  localStorage.setItem('wwm.muted', muted ? '1' : '0');
  window.__WWM_TEST__ = { skipIntro: true, noAutoPause: true };
  const probe = {
    spans: [],
    phases: [],
    longTasks: [],
    inputs: [],
    frames: [],
    gestures: [],
    armedInput: false,
    releases: 0,
  };
  window.__startup = probe;
  // This headed benchmark shares a desktop. Only its two explicitly armed Space
  // presses belong to the workload; unrelated gestures must not pre-unlock audio.
  // Preserve suppressed gesture categories/times without recording typed content.
  const isolate = (event) => {
    const allowed = event.type === 'keydown' && event.code === 'Space' && !event.repeat && probe.armedInput;
    probe.gestures.push({
      at: performance.now(),
      type: event.type,
      category: event.type === 'keydown' ? (event.code === 'Space' ? 'space' : 'other-key') : 'pointer',
      trusted: event.isTrusted,
      shot: allowed ? probe.inputs.length : null,
      allowed,
    });
    if (allowed) probe.armedInput = false;
    else {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  addEventListener('keydown', isolate, { capture: true });
  addEventListener('pointerdown', isolate, { capture: true });
  new PerformanceObserver((list) => {
    probe.longTasks.push(...list.getEntries().map((e) => ({ start: e.startTime, duration: e.duration })));
  }).observe({ type: 'longtask', buffered: true });
  let last;
  function frame(at) {
    if (last !== undefined) probe.frames.push({ start: last, duration: at - last });
    last = at;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  addEventListener(
    'keydown',
    (event) => {
      if (event.code !== 'Space' || event.repeat) return;
      const input = { start: performance.now(), trusted: event.isTrusted };
      probe.inputs.push(input);
      requestAnimationFrame(() => {
        input.nextFrame = performance.now();
      });
    },
    { capture: true },
  );
  const wrap = (object, name, label) => {
    const original = object[name];
    object[name] = function (...args) {
      const span = { name: label, start: performance.now() };
      probe.spans.push(span);
      const finish = () => {
        span.end = performance.now();
        span.duration = span.end - span.start;
      };
      try {
        const result = original.apply(this, args);
        if (result?.then)
          return result.then(
            (value) => {
              finish();
              return value;
            },
            (error) => {
              finish();
              throw error;
            },
          );
        finish();
        return result;
      } catch (error) {
        finish();
        throw error;
      }
    };
  };
  let game;
  Object.defineProperty(window, '__wwmGame', {
    configurable: true,
    get: () => game,
    set(value) {
      game = value;
      if (!value) return;
      wrap(value, 'mount', 'game.mount');
      wrap(value.audio, 'unlock', 'audio.unlock');
      wrap(value.audio, 'setRoll', 'audio.setRoll');
      let engine;
      let key;
      const changed = () => {
        const view = value.getView();
        const next = `${view.phase}:${view.build?.step ?? ''}:${view.countdown ?? ''}`;
        if (next !== key) {
          key = next;
          probe.phases.push({
            at: performance.now(),
            phase: view.phase,
            build: view.build?.step,
            countdown: view.countdown,
          });
        }
        if (value.engine && value.engine !== engine) {
          engine = value.engine;
          wrap(engine, 'loadStage', 'engine.loadStage');
          const renderer = engine.debug().renderer;
          if (renderer.compileAsync) wrap(renderer, 'compileAsync', 'renderer.compileAsync');
        }
      };
      value.subscribe(changed);
      changed();
    },
  });
}

function summarizeProfile(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const totals = new Map();
  for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
    const node = nodes.get(profile.samples[i]);
    if (!node) continue;
    const frame = node.callFrame;
    const key = JSON.stringify(frame);
    const entry = totals.get(key) ?? { ...frame, sampledMs: 0, samples: 0 };
    entry.sampledMs += (profile.timeDeltas?.[i] ?? 0) / 1000;
    entry.samples++;
    totals.set(key, entry);
  }
  return [...totals.values()].sort((a, b) => b.sampledMs - a.sampledMs).slice(0, 60);
}

try {
  for (const scenario of [
    { label: 'native', throttle: 1, latency: 0, download: -1 },
    { label: 'cpu6-slow10mbps', throttle: 6, latency: 50, download: 1_250_000 },
    { label: 'learning-cpu6', throttle: 6, latency: 0, download: -1, learn: true },
  ]) {
    for (let trial = 0; trial < 3; trial++) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      });
      await context.addInitScript(instrument, { muted });
      // Offline mode keeps scores local and telemetry is off. Avoid request interception,
      // which disables browser HTTP cache in Playwright; record actual transfer sizes.
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(`page: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`console: ${m.text()}`);
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: scenario.latency,
        downloadThroughput: scenario.download,
        uploadThroughput: scenario.download,
      });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: scenario.throttle });
      for (const cache of ['cold', 'warm']) {
        if (cache === 'cold') await cdp.send('Network.clearBrowserCache');
        errors.length = 0;
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.start');
        const run = { scenario, trial, cache, errors };
        report.runs.push(run);
        try {
          await page.goto(`${base}/play/practice?offline=1${scenario.learn ? '&learn=compare-groups' : ''}`);
          await page.waitForFunction(() => window.__wwmGame?.debugState().phase === 'play', null, {
            timeout: 120_000,
          });
          await page.waitForTimeout(300);
          await page.evaluate(() => {
            window.__startup.armedInput = true;
          });
          await page.keyboard.down('Space');
          await page.waitForTimeout(300);
          await page.keyboard.up('Space');
          await page.evaluate(() => {
            window.__startup.releases++;
          });
          await page.waitForTimeout(300);
          await page.evaluate(() => {
            window.__startup.armedInput = true;
          });
          await page.keyboard.down('Space');
          await page.waitForTimeout(300);
          await page.keyboard.up('Space');
          await page.evaluate(() => {
            window.__startup.releases++;
          });
          await page.waitForTimeout(300);
          run.observations = await page.evaluate(() => ({
            ...window.__startup,
            resources: performance.getEntriesByType('resource').map((r) => ({
              name: new URL(r.name).pathname,
              start: r.startTime,
              duration: r.duration,
              transferSize: r.transferSize,
              encodedBodySize: r.encodedBodySize,
            })),
            state: window.__wwmGame.debugState(),
          }));
          const observed = run.observations;
          const admitted = observed.gestures.filter((gesture) => gesture.allowed);
          if (observed.armedInput || observed.releases !== 2 || admitted.length !== 2)
            throw new Error('Scripted input isolation did not complete two press/release pairs');
          if (
            observed.gestures.some(
              (gesture) =>
                !gesture.allowed &&
                (gesture.category === 'space' ||
                  observed.inputs.some(
                    (input) => gesture.at >= input.start && gesture.at <= input.nextFrame,
                  )),
            )
          )
            throw new Error('Desktop input interfered with a measured input window');
        } finally {
          const profile = (await cdp.send('Profiler.stop')).profile;
          const profileFile = `${scenario.label}-${trial}-${cache}.cpuprofile`;
          writeFileSync(resolve(out, profileFile), JSON.stringify(profile));
          run.profile = profileFile;
          run.sampledSelfTime = summarizeProfile(profile);
          run.errors = [...errors];
          save();
        }
      }
      await context.close();
    }
  }
} catch (error) {
  report.error = String(error);
  throw error;
} finally {
  save();
  await browser.close();
}
