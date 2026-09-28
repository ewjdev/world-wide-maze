/** #30 research only: compare exact existing SFX synthesis on main thread vs fresh worker.
 * build writes temporary diagnostic entries, removes them afterward, and does not edit shipped audio.
 * AUDIT_OUT=... node infra/perf/audio-spike-p2.mjs build|measure
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetManifest } from './p1-build.mjs';
import { runtimeFingerprint } from './p1-fingerprint.mjs';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const web = fileURLToPath(new URL('../../apps/web/', import.meta.url));
const out = resolve(process.env.AUDIT_OUT ?? 'docs/launch/evidence/startup-p2/audio-spike');
mkdirSync(out, { recursive: true });
// #32 extracted the same PCM functions; retain the historical prototype on both source layouts.
const extracted = existsSync(`${web}src/audio/synthesis.ts`);
const source = readFileSync(`${web}src/audio/${extracted ? 'synthesis' : 'audio'}.ts`, 'utf8');
const synth = extracted ? source : source.slice(0, source.indexOf('// ── music'));
if (!synth.includes('function buildSfx()') || (!extracted && synth.length >= source.length))
  throw new Error('Synthesis extraction boundary changed');
const sourceHash = createHash('sha256').update(source).digest('hex');
if (process.argv[2] === 'build') {
  const entry = `${web}.audio-spike.ts`;
  const worker = `${web}.audio-spike-worker.ts`;
  if (existsSync(entry) || existsSync(worker))
    throw new Error('Refusing to overwrite existing diagnostic entry files');
  writeFileSync(
    worker,
    `${synth}\nself.onmessage = () => { const raw = buildSfx(); self.postMessage(raw, Object.values(raw).map(a => a.buffer)); };\n`,
  );
  writeFileSync(
    entry,
    `${synth}\nObject.assign(window, { audioSpike: { buildSfx, worker: () => new Worker(new URL('./.audio-spike-worker.ts', import.meta.url), { type: 'module' }) } });\n`,
  );
  try {
    const { build } = await import(require.resolve('vite'));
    await build({
      root: web,
      build: { rolldownOptions: { input: { main: `${web}index.html`, audioSpike: entry } } },
    });
    writeFileSync(
      `${web}dist/audio-spike-build.json`,
      JSON.stringify({
        runtimeFingerprint: runtimeFingerprint(),
        sourceHash,
        assets: assetManifest(`${web}dist`),
      }),
    );
  } finally {
    unlinkSync(entry);
    unlinkSync(worker);
  }
  process.exit(0);
}
const base = process.env.AUDIT_BASE ?? 'http://127.0.0.1:4318';
const manifest = JSON.parse(readFileSync(`${web}dist/audio-spike-build.json`, 'utf8'));
if (manifest.sourceHash !== sourceHash || manifest.runtimeFingerprint.sha256 !== runtimeFingerprint().sha256)
  throw new Error('Stale diagnostic build');
for (const asset of manifest.assets) {
  const response = await fetch(`${base}/${asset.path}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!response.ok || createHash('sha256').update(bytes).digest('hex') !== asset.sha256)
    throw new Error(`Served asset mismatch: ${asset.path}`);
}
const asset = readdirSync(`${web}dist/assets`).find((name) => /^audioSpike-.*\.js$/.test(name));
if (!asset) throw new Error('Diagnostic entry missing');
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: false, args: ['--enable-gpu', '--use-angle=metal'] });
const report = {
  date: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  manifest,
  browser: browser.version(),
  note: 'Research prototype only; actual AudioManager remains unchanged. CPU throttling affects page, not worker. PCM hashes must match for every cue.',
  runs: [],
  errors: [],
};
try {
  for (const throttle of [1, 6]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('**/audio-lab', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Local audio synthesis investigation</title>',
      }),
    );
    const page = await context.newPage();
    page.on('pageerror', (e) => report.errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') report.errors.push(m.text());
    });
    await page.goto(`${base}/audio-lab`);
    await page.evaluate((entry) => import(`/assets/${entry}`), asset);
    await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: throttle });
    for (let trial = 0; trial < 3; trial++) {
      for (const mode of trial % 2 ? ['worker', 'main'] : ['main', 'worker']) {
        const result = await page.evaluate(async (mode) => {
          const frames = [];
          const longTasks = [];
          const observer = new PerformanceObserver((l) =>
            longTasks.push(...l.getEntries().map((e) => ({ start: e.startTime, duration: e.duration }))),
          );
          observer.observe({ type: 'longtask' });
          let last = performance.now();
          let raf;
          const sample = (now) => {
            frames.push(now - last);
            last = now;
            raf = requestAnimationFrame(sample);
          };
          raf = requestAnimationFrame(sample);
          await new Promise((r) => setTimeout(r, 100));
          const start = performance.now();
          let raw;
          if (mode === 'main') raw = window.audioSpike.buildSfx();
          else
            raw = await new Promise((resolve, reject) => {
              const worker = window.audioSpike.worker();
              const timeout = setTimeout(() => {
                worker.terminate();
                reject(new Error('Audio worker timeout'));
              }, 30_000);
              worker.onmessage = (e) => {
                clearTimeout(timeout);
                worker.terminate();
                resolve(e.data);
              };
              worker.onerror = (e) => {
                clearTimeout(timeout);
                worker.terminate();
                reject(new Error(e.message));
              };
              worker.postMessage(null);
            });
          const end = performance.now();
          await new Promise((r) => setTimeout(r, 100));
          cancelAnimationFrame(raf);
          observer.disconnect();
          const hashes = {};
          let bytes = 0;
          for (const [name, data] of Object.entries(raw)) {
            hashes[name] = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
              .map((x) => x.toString(16).padStart(2, '0'))
              .join('');
            bytes += data.byteLength;
          }
          return {
            start,
            end,
            wallMs: end - start,
            frames,
            maxFrameMs: Math.max(...frames),
            longTasks,
            bytes,
            hashes,
          };
        }, mode);
        report.runs.push({ throttle, trial, mode, ...result });
      }
    }
    await context.close();
  }
  for (const run of report.runs) {
    if (JSON.stringify(run.hashes) !== JSON.stringify(report.runs[0].hashes))
      throw new Error('PCM parity failed');
  }
  if (report.errors.length) throw new Error('Browser errors; inspect evidence');
} catch (error) {
  report.error = String(error);
  throw error;
} finally {
  writeFileSync(resolve(out, 'paired.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
