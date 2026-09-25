/**
 * Phase 03b/05b: the playability hook really runs the solver inside workerd (Rapier from the precompiled
 * `.wasm` module, no fail-open), and what it costs per slice. Runs a test-only entry
 * (../src/testing/solver-probe-worker.ts) with the production wrangler config via `unstable_startWorker`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCapture, type StageData, sliceCount } from '@wwm/schema';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

type Worker = Awaited<ReturnType<typeof import('wrangler').unstable_startWorker>>;
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
let worker: Worker;
let base: string;

beforeAll(async () => {
  const { unstable_startWorker } = await import('wrangler');
  worker = await unstable_startWorker({
    config: resolve(here, '../wrangler.jsonc'),
    entrypoint: resolve(here, '../src/testing/solver-probe-worker.ts'),
    dev: { server: { hostname: '127.0.0.1', port: 0 }, inspector: false, persist: false, logLevel: 'warn' },
  } as Parameters<typeof unstable_startWorker>[0]);
  await worker.ready;
  base = (await worker.url).toString().replace(/\/$/, '');
}, 120_000);

afterAll(async () => {
  await worker?.dispose();
});

const handmade = JSON.parse(
  readFileSync(resolve(root, 'fixtures/stages/handmade-simple.json'), 'utf8'),
) as StageData;

interface SolveReply {
  ua: string;
  result: { ok: true; parTimeSec?: number; solveMs?: number } | { ok: false; reason: string };
  ms: number;
}

describe('playability validation in workerd', () => {
  test('solves handmade-simple in workerd with the real physics', { timeout: 120_000 }, async () => {
    const r = await fetch(`${base}/solve`, { method: 'POST', body: JSON.stringify(handmade) });
    const j = (await r.json()) as SolveReply;
    expect(j.ua).toBe('Cloudflare-Workers');
    expect(j.result.ok).toBe(true);
    // parTimeSec is only set when the solver actually ran (the fail-open path returns a bare {ok: true})
    expect(j.result.ok && j.result.parTimeSec).toBeGreaterThan(5);
  });

  test('rejects a stage the bot cannot finish', { timeout: 120_000 }, async () => {
    // the only elevator is the goal island's link: without it the goal is unreachable
    const cut: StageData = { ...handmade, elevators: [] };
    const r = await fetch(`${base}/solve`, { method: 'POST', body: JSON.stringify(cut) });
    const j = (await r.json()) as SolveReply;
    expect(j.result.ok).toBe(false);
    expect(!j.result.ok && j.result.reason).toMatch(/solver failed/);
  });

  test('build + solve per slice: cost in workerd (logged for the build log)', {
    timeout: 300_000,
  }, async () => {
    const rows: string[] = [];
    for (const slug of ['wikipedia-article', 'hn-front', 'govuk-card-grid']) {
      const dir = resolve(root, 'fixtures/captures', slug);
      const capture = parseCapture(JSON.parse(readFileSync(resolve(dir, 'capture.json'), 'utf8')));
      const png = readFileSync(resolve(dir, 'screenshot.png')).toString('base64');
      for (let slice = 0; slice < sliceCount(capture); slice++) {
        const t0 = performance.now();
        const r = await fetch(`${base}/build-solve`, {
          method: 'POST',
          body: JSON.stringify({ capture, png, slice, seed: 1, difficulty: 'normal' }),
        });
        const wall = performance.now() - t0;
        const j = (await r.json()) as {
          result: SolveReply['result'];
          islands: number;
          decodeMs: number;
          buildMs: number;
          solveMs: number;
        };
        expect(j.result.ok, `${slug} slice ${slice}`).toBe(true);
        expect(j.result.ok && j.result.parTimeSec, `${slug} slice ${slice} solver ran`).toBeGreaterThan(0);
        rows.push(
          `${slug} s${slice}: islands ${j.islands}, decode ${j.decodeMs.toFixed(0)} ms, build ${j.buildMs.toFixed(0)} ms, solve ${j.solveMs.toFixed(0)} ms (par ${j.result.ok ? j.result.parTimeSec : '-'} s), request wall ${wall.toFixed(0)} ms`,
        );
      }
    }
    console.log(`[workerd build+solve]\n${rows.join('\n')}`);
  });
});
