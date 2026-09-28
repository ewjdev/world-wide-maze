/** #32 actual production audio lifecycle/PCM acceptance, separate from timed startup collector. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { verifyServedBuild } from './p1-build.mjs';
import { runtimeFingerprint } from './p1-fingerprint.mjs';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');
const base = process.env.AUDIT_BASE ?? 'http://127.0.0.1:4321';
const negativeControl = process.env.AUDIT_NEGATIVE_CONTROL === '1';
const out = resolve(process.env.AUDIT_OUT ?? 'docs/launch/evidence/audio-p2/lifecycle');
mkdirSync(out, { recursive: true });
const expected = JSON.parse(
  readFileSync(new URL('../../docs/launch/evidence/startup-p2/audio-spike/paired.json', import.meta.url)),
).runs[0].hashes;
const report = {
  date: new Date().toISOString(),
  negativeControl,
  runtimeFingerprint: runtimeFingerprint(),
  servedBuild: await verifyServedBuild(base),
  runs: [],
  errors: [],
};
const browser = await chromium.launch({ headless: false, args: ['--enable-gpu', '--use-angle=metal'] });
report.browser = browser.version();
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
try {
  for (const mode of negativeControl
    ? ['pending']
    : ['ready', 'pending', 'failure', 'worker-error', 'dispose']) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    await context.addInitScript(
      ({ mode, negativeControl }) => {
        localStorage.setItem('wwm.analytics.preference', 'off');
        localStorage.setItem('wwm.muted', '0');
        localStorage.setItem('wwm.howtoSeen', '1');
        localStorage.setItem('wwm.tutorialDone', '1');
        window.__WWM_TEST__ = { skipIntro: true, noAutoPause: true, quality: 'low' };
        const probe = {
          contexts: [],
          workers: [],
          sources: [],
          oscillators: [],
          hashes: null,
          bytes: null,
          release: null,
        };
        window.__audioProbe = probe;
        const NativeWorker = Worker;
        window.Worker = class extends NativeWorker {
          constructor(url, options) {
            if (!String(url).includes('synthesis.worker')) {
              super(url, options);
              return;
            }
            if (mode === 'failure') throw new Error('Deliberately unavailable synthesis worker');
            const failingUrl =
              mode === 'worker-error'
                ? URL.createObjectURL(
                    new Blob(["throw new Error('Controlled audio worker failure')"], {
                      type: 'text/javascript',
                    }),
                  )
                : null;
            super(failingUrl ?? url, options);
            const state = { terminated: false, received: false };
            probe.workers.push(state);
            const terminate = this.terminate.bind(this);
            this.terminate = () => {
              state.terminated = true;
              if (failingUrl) URL.revokeObjectURL(failingUrl);
              terminate();
            };
            let handler;
            Object.defineProperty(this, 'onmessage', {
              set(value) {
                handler = value;
              },
            });
            this.addEventListener('message', async (event) => {
              state.received = true;
              state.pcmBytes = Object.values(event.data.sfx).reduce(
                (n, a) => n + a.byteLength,
                event.data.roll.byteLength,
              );
              const entries = await Promise.all(
                Object.entries(event.data.sfx).map(async ([k, data]) => [
                  k,
                  [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
                    .map((n) => n.toString(16).padStart(2, '0'))
                    .join(''),
                ]),
              );
              probe.hashes = Object.fromEntries(entries);
              probe.rollHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', event.data.roll))]
                .map((n) => n.toString(16).padStart(2, '0'))
                .join('');
              probe.bytes = Object.values(event.data.sfx).reduce((n, a) => n + a.byteLength, 0);
              // Deliberately delay delivery rather than synthesizing a different test sound set.
              if (mode === 'pending' || mode === 'dispose')
                probe.release = () => {
                  handler?.(event);
                  if (negativeControl) {
                    window.__wwmGame.audio.setMuted(false);
                    window.__wwmGame.audio.play('jump');
                  }
                };
              else handler?.(event);
            });
          }
        };
        const NativeAudioContext = AudioContext;
        window.AudioContext = class extends NativeAudioContext {
          constructor(options) {
            super(options);
            window.__audioContext = this;
            const state = { created: performance.now(), closed: false };
            probe.contexts.push(state);
            const close = this.close.bind(this);
            this.close = async () => {
              await close();
              state.closed = true;
            };
            const create = this.createBufferSource.bind(this);
            this.createBufferSource = () => {
              const s = create();
              const start = s.start.bind(s);
              s.start = (...args) => {
                probe.sources.push({ at: performance.now(), length: s.buffer?.length, loop: s.loop });
                start(...args);
              };
              return s;
            };
            const createOsc = this.createOscillator.bind(this);
            this.createOscillator = () => {
              const s = createOsc();
              const row = { frequency: null, started: false, stopped: false };
              probe.oscillators.push(row);
              const start = s.start.bind(s);
              const stop = s.stop.bind(s);
              s.start = (...a) => {
                row.frequency = s.frequency.value;
                row.started = true;
                start(...a);
              };
              s.stop = (...a) => {
                row.stopped = true;
                stop(...a);
              };
              return s;
            };
          }
        };
      },
      { mode, negativeControl },
    );
    const page = await context.newPage();
    page.on('pageerror', (e) => report.errors.push({ mode, error: e.message }));
    page.on('console', (m) => {
      if (m.type() === 'error') report.errors.push({ mode, error: m.text() });
    });
    try {
      await page.goto(`${base}/play/practice?offline=1`);
      await page.waitForFunction(() => window.__wwmGame?.debugState().phase === 'play');
      if (mode !== 'failure' && mode !== 'worker-error')
        await page.waitForFunction(() => window.__audioProbe.hashes);
      const before = await page.evaluate(() => ({
        preparation: window.__wwmGame.audio.preparation,
        contexts: window.__audioProbe.contexts.length,
      }));
      check(before.contexts === 0, `${mode}: preparation created AudioContext before gesture`);
      if (mode === 'dispose') {
        await page.evaluate(() => {
          window.__wwmGame.dispose();
          window.__audioProbe.release?.();
          window.__wwmGame.audio.unlock();
        });
      } else {
        await page.evaluate(() => {
          window.__wwmGame.audio.setMusic(null);
          addEventListener('keydown', () => window.__wwmGame.audio.play('jump'), { once: true });
        });
        await page.keyboard.press('Space');
        await page.waitForTimeout(150);
        const first = await page.evaluate(() => ({
          preparation: window.__wwmGame.audio.preparation,
          sources: [...window.__audioProbe.sources],
          oscillators: [...window.__audioProbe.oscillators],
        }));
        if (mode === 'ready')
          check(
            first.sources.some((s) => s.length === 9702),
            'Prepared first jump PCM was not scheduled',
          );
        else
          check(
            first.oscillators.some((s) => s.started && s.stopped && s.frequency === 660),
            `${mode}: early feedback tone missing`,
          );
        await page.evaluate(() => {
          window.__wwmGame.audio.setMuted(true);
          window.__wwmGame.audio.play('jump');
        });
        const mutedCount = await page.evaluate(
          () => window.__audioProbe.sources.filter((s) => !s.loop).length,
        );
        if (mode === 'pending') {
          await page.evaluate(() => window.__audioProbe.release());
          await page.waitForTimeout(100);
          check(
            (await page.evaluate(() => window.__audioProbe.sources.filter((s) => !s.loop).length)) ===
              mutedCount,
            'Stale early cue replayed on delivery',
          );
          await page.evaluate(() => {
            window.__wwmGame.audio.setMuted(false);
            window.__wwmGame.audio.play('jump');
          });
          check(
            await page.evaluate(() => window.__audioProbe.sources.some((s) => s.length === 9702)),
            'Prepared PCM did not replace fallback',
          );
        }
        if (mode === 'ready') {
          await page.evaluate(async () => {
            window.__wwmGame.audio.setMuted(false);
            await window.__audioContext.suspend();
            addEventListener('keydown', () => window.__wwmGame.audio.play('jump'), { once: true });
          });
          await page.keyboard.press('Space');
          await page.waitForTimeout(100);
          check(
            await page.evaluate(() => window.__wwmGame.audio.unlocked),
            'Native suspended context did not resume on next gesture',
          );
          check(
            (await page.evaluate(
              () => window.__audioProbe.sources.filter((s) => s.length === 9702).length,
            )) >= 2,
            'Resumed first cue lost',
          );
        }
        await page.evaluate(() => window.__wwmGame.dispose());
      }
      if (mode === 'ready') {
        const cycles = [];
        for (let cycle = 0; cycle < 10; cycle++) {
          await page.evaluate(() => {
            window.__audioCycle = new window.__wwmGame.audio.constructor({ muted: false });
            window.__audioCycle.prepare();
            addEventListener(
              'keydown',
              () => {
                window.__audioCycle.unlock();
                window.__audioCycle.play('jump');
              },
              { once: true },
            );
          });
          await page.waitForFunction(() => window.__audioCycle.preparation === 'ready');
          await page.keyboard.press('Space');
          await page.waitForTimeout(40);
          await page.evaluate(() => window.__audioCycle.dispose());
          await page.waitForFunction(() => window.__audioProbe.contexts.every((c) => c.closed));
          const checkpoint = await page.evaluate(() => ({
            liveContexts: window.__audioProbe.contexts.filter((c) => !c.closed).length,
            liveWorkers: window.__audioProbe.workers.filter((w) => !w.terminated).length,
          }));
          check(
            checkpoint.liveContexts === 0 && checkpoint.liveWorkers === 0,
            'Repeated audio dispose did not return to zero owners',
          );
          cycles.push(checkpoint);
        }
        report.disposeCycles = cycles;
      }
      await page.waitForTimeout(100);
      const after = await page.evaluate(() => JSON.parse(JSON.stringify(window.__audioProbe)));
      if (mode !== 'failure' && mode !== 'worker-error') {
        check(
          JSON.stringify(after.hashes) === JSON.stringify(expected),
          'Production worker PCM parity mismatch',
        );
        check(after.bytes === 2273788, 'Production worker PCM byte count mismatch');
        check(
          after.rollHash === '4d3e35c2d17e49f72add68585bebb5ab376615d0c950476ed93eaa57d93175c4',
          'Production rolling PCM differs',
        );
      }
      check(
        after.workers.every((w) => w.terminated),
        'Worker survived disposal',
      );
      check(
        after.contexts.every((c) => c.closed),
        'AudioContext survived game disposal',
      );
      report.runs.push({ mode, before, after, passed: true });
    } catch (error) {
      report.failedCase = {
        mode,
        error: String(error),
        observation: await page.evaluate(() => JSON.parse(JSON.stringify(window.__audioProbe))),
      };
      throw error;
    } finally {
      await context.close();
    }
  }
  check(report.errors.length === 0, 'Unexpected browser errors');
} catch (error) {
  report.error = String(error);
  throw error;
} finally {
  writeFileSync(resolve(out, 'lifecycle.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
