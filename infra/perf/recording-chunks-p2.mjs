// #33: native Chromium retained-memory and export cost for the production recorder vs P1 arrays.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');
const { createServer } = require('vite');
const out = process.env.AUDIT_OUT ?? 'docs/launch/evidence/recording-chunks-p2';
mkdirSync(out, { recursive: true });
let server;
let browser;
const report = {
  date: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceSHA256: createHash('sha256')
    .update(readFileSync('apps/web/src/game/input-recording.ts'))
    .digest('hex'),
  gameSourceSHA256: createHash('sha256').update(readFileSync('apps/web/src/game/game.ts')).digest('hex'),
  method:
    'Real production InputRecording in headless Chromium/Vite. Explicit GC before every retained checkpoint. P1 array push with one fresh sample per 2 ticks (60Hz) or per tick (120Hz); separately labeled same-reference-idle holds one neutral object for the whole stress run. Heap and backing-store metrics separate; exported arrays and JSON held for a post-GC live checkpoint (lower bound on transient peak). Raw checkpoints beforeGC include temporary work; digest encoding allocations are diagnostic overhead. Completed actual submission releases compact chunks before JSON; debug retains compact source. Post-submission debug holds the cached array and one independent snapshot (JSON released). No physical-device or whole-game CPU claim.',
  runs: [],
  errors: [],
};
try {
  server = await createServer({
    root: fileURLToPath(new URL('../../apps/web', import.meta.url)),
    server: { port: 4323, strictPort: true },
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  report.browser = browser.version();
  report.system = await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo');
  const context = await browser.newContext();
  await context.route('**/recording-lab', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Recorder memory probe</title>' }),
  );
  const page = await context.newPage();
  page.on('pageerror', (e) => report.errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text());
  });
  await page.goto('http://localhost:4323/recording-lab');
  await page.addScriptTag({
    type: 'module',
    content:
      "import {InputRecording,SavedRecording} from '/src/game/input-recording.ts'; Object.assign(window,{Recorder:InputRecording,Saved:SavedRecording});",
  });
  await page.waitForFunction(() => !!window.Recorder);
  const cdp = await context.newCDPSession(page);
  const memory = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    return cdp.send('Runtime.getHeapUsage');
  };
  for (const scenario of ['active', 'idle', 'same-reference-idle'])
    for (const ticks of [120, 1394, 5429, 8192, 36000, 72000, 360000])
      for (const share of [2, 1])
        for (let repeat = 0; repeat < 3; repeat++) {
          const pair = [];
          for (const variant of repeat % 2
            ? ['chunks-submit', 'chunks-debug', 'array']
            : ['array', 'chunks-debug', 'chunks-submit']) {
            await page.evaluate(() => {
              window.store = null;
              window.exported = null;
              window.serialized = null;
            });
            const empty = await memory();
            const capture = await page.evaluate(
              ({ ticks, share, variant, scenario }) => {
                const store = variant === 'array' ? [] : new window.Recorder();
                window.store = store;
                let sample;
                const start = performance.now();
                for (let i = 0; i < ticks; i++) {
                  if (i === 0 || (scenario !== 'same-reference-idle' && i % share === 0))
                    sample =
                      scenario !== 'active'
                        ? { tiltX: 0, tiltZ: 0, frameYaw: 0, power: false, jump: false }
                        : {
                            tiltX: Math.sin(i / 47) * 0.3,
                            tiltZ: Math.cos(i / 61) * 0.4,
                            frameYaw: Math.sin(i / 137),
                            power: i >= 1394,
                            jump: i % 239 === 0,
                          };
                  if (variant === 'array') store.push(sample);
                  else store.append(sample);
                }
                return {
                  appendMs: performance.now() - start,
                  ticks: store.length,
                  backingBytes: variant === 'array' ? null : store.byteLength,
                };
              },
              { ticks, share, variant, scenario },
            );
            const retained = await memory();
            const exportStep = await page.evaluate(
              ({ variant }) => {
                const begin = performance.now();
                if (variant === 'chunks-submit') {
                  window.store = new window.Saved(window.store, '0.2.0', 1394);
                  window.exported = window.store.forSubmission().inputs;
                } else window.exported = variant === 'array' ? window.store : window.store.toArray();
                return {
                  exportMs: performance.now() - begin,
                  remainingCompactBytes: variant === 'array' ? null : window.store.byteLength,
                };
              },
              { variant },
            );
            const expansionRaw = await cdp.send('Runtime.getHeapUsage');
            const exported = await page.evaluate(async () => {
              const serialStart = performance.now();
              window.serialized = JSON.stringify({
                physicsVersion: '0.2.0',
                inputs: window.exported,
                timerStartTick: 1394,
              });
              const serializeMs = performance.now() - serialStart;
              const bytes = new TextEncoder().encode(window.serialized);
              const digest = await crypto.subtle.digest('SHA-256', bytes);
              return {
                serializeMs,
                jsonBytes: bytes.byteLength,
                sha256: [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join(''),
              };
            });
            const serializationRaw = await cdp.send('Runtime.getHeapUsage');
            const exportPeak = await memory();
            let debugAfterSubmission = null;
            if (variant === 'chunks-submit') {
              await page.evaluate(() => {
                window.exported = window.store.snapshot();
                window.serialized = null;
              });
              debugAfterSubmission = await memory();
            }
            await page.evaluate(() => {
              window.exported = null;
              window.serialized = null;
              window.store = null;
            });
            const cleared = await memory();
            pair.push({
              variant,
              empty,
              retained,
              expansionRaw,
              serializationRaw,
              exportPeak,
              debugAfterSubmission,
              cleared,
              capture,
              exported: { ...exportStep, ...exported },
            });
          }
          for (const row of pair)
            assert.equal(
              row.exported.sha256,
              pair[0].exported.sha256,
              'exported JSON must match byte for byte',
            );
          report.runs.push({ scenario, ticks, share, repeat, pair });
          writeFileSync(`${out}/memory.json`, `${JSON.stringify(report, null, 2)}\n`);
        }
  assert.deepEqual(report.errors, []);
  console.log(`Passed ${report.runs.length} paired memory/export comparisons`);
} catch (error) {
  report.error = String(error);
  throw error;
} finally {
  writeFileSync(`${out}/memory.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close();
  await server?.close();
}
