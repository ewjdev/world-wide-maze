import { readFileSync } from 'node:fs';
import {
  CAPTURE_DPR,
  computeStageId,
  type JobEvent,
  parseCapture,
  sliceCount,
  sliceRange,
  validateStage,
} from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { MemoryStore } from '../node/memory-store.ts';
import { STUB_BUILDER, type StageBuilder } from '../src/builder.ts';
import type { CaptureOutput, Capturer } from '../src/capture/types.ts';
import { ServiceError } from '../src/errors.ts';
import { silentLogger } from '../src/log.ts';
import { type JobParams, type PipelineDeps, runBuildJob } from '../src/pipeline.ts';

const dir = new URL('../../../fixtures/captures/wikipedia-article/', import.meta.url);
const bundle = parseCapture(JSON.parse(readFileSync(new URL('capture.json', dir), 'utf8')));
const png = new Uint8Array(readFileSync(new URL('screenshot.png', dir)));

function fakeCapture(): CaptureOutput {
  return {
    bundle,
    screenshotPng: png,
    textures: Array.from({ length: sliceCount(bundle) }, (_, i) => {
      const s = sliceRange(bundle, i);
      return {
        sliceIndex: i,
        y: s.y,
        height: s.height,
        width: bundle.page.width * CAPTURE_DPR,
        heightPx: s.height * CAPTURE_DPR,
        scale: CAPTURE_DPR,
        contentType: 'image/webp' as const,
        bytes: new Uint8Array([i]),
      };
    }),
    status: 200,
    timingsMs: { total: 1 },
    requests: { allowed: 1, blocked: 0, blockedUrls: [] },
  };
}
const okCapturer: Capturer = {
  name: 'fake',
  capture: async (req) => {
    req.onStep?.('extracting');
    return fakeCapture();
  },
};
const params: JobParams = {
  jobId: 'j1',
  url: bundle.url,
  difficulty: 'normal',
  seed: 7,
  cacheKey: 'run:test',
};

async function run(over: Partial<PipelineDeps> = {}) {
  const store = new MemoryStore();
  const events: JobEvent[] = [];
  const result = await runBuildJob(
    params,
    {
      capturer: okCapturer,
      builder: STUB_BUILDER,
      moderate: async () => 'ok',
      store,
      log: silentLogger,
      ...over,
    },
    (e) => {
      events.push(e);
    },
  );
  return { store, events, result };
}
const terminal = (events: JobEvent[]) => events.filter((e) => e.type !== 'progress');

describe('build pipeline', () => {
  test('progress in order, done after slice 0, then every slice stored and valid', async () => {
    const { store, events, result } = await run();
    expect(
      events.filter((e) => e.type === 'progress').map((e) => (e.type === 'progress' ? e.step : '')),
    ).toEqual(['capturing', 'extracting', 'building', 'validating', 'storing']);
    const pcts = events.flatMap((e) => (e.type === 'progress' ? [e.pct] : []));
    expect([...pcts].sort((a, b) => a - b)).toEqual(pcts);
    const done = terminal(events);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ type: 'done', stageIds: [result?.stageIds[0]] });

    const count = sliceCount(bundle);
    expect(count).toBe(4);
    expect(result?.stageIds).toHaveLength(count);
    const stages = store.stagesOf(result?.runId ?? '');
    expect(stages.map((s) => s.source.slice.index)).toEqual([0, 1, 2, 3]);
    for (const s of stages) {
      expect(validateStage(s).ok).toBe(true);
      expect(s.texture).toEqual({
        path: `${s.stageId}/texture`,
        width: 2560,
        height: s.size.height * 2,
        scale: 2,
      });
      expect(s.source.slice).toEqual(sliceRange(bundle, s.source.slice.index));
    }
    expect(store.runs.get(result?.runId ?? '')).toMatchObject({ status: 'complete', sliceCount: 4, seed: 7 });
    expect(store.cache.get('run:test')).toBe(result?.runId);
    expect(store.captures.get(bundle.captureId)?.png).toBe(png);
    expect(store.textures.size).toBe(4);
  });

  test('deterministic ids for the same capture, seed, builder and difficulty', async () => {
    const a = await run();
    const b = await run();
    expect(b.result?.stageIds).toEqual(a.result?.stageIds);
    expect(b.result?.runId).toBe(a.result?.runId);
  });

  const failing = (fn: StageBuilder['buildStage']): StageBuilder => ({
    version: '0.0.1-test',
    buildStage: fn,
  });

  test.each<[string, Partial<PipelineDeps>, string]>([
    [
      'builder throws',
      {
        builder: failing(() => {
          throw new Error('boom');
        }),
      },
      'BUILD_FAILED',
    ],
    [
      'builder returns an invalid stage',
      {
        builder: failing((i) => {
          const r = STUB_BUILDER.buildStage(i);
          r.stage.islands = [];
          return r;
        }),
      },
      'BUILD_FAILED',
    ],
    [
      'solver says unplayable',
      { validatePlayable: async () => ({ ok: false, reason: 'goal unreachable' }) },
      'UNPLAYABLE',
    ],
    ['content filter blocks', { moderate: async () => 'block' }, 'CAPTURE_BLOCKED'],
    [
      'capture times out',
      {
        capturer: {
          name: 'x',
          capture: async () => {
            throw new ServiceError('CAPTURE_TIMEOUT', 'slow');
          },
        },
      },
      'CAPTURE_TIMEOUT',
    ],
    [
      'unexpected capture error',
      {
        capturer: {
          name: 'x',
          capture: async () => {
            throw new Error('socket hang up');
          },
        },
      },
      'BUILD_FAILED',
    ],
    [
      'no browser slot',
      {
        gate: {
          acquire: async () => {
            throw new ServiceError('RATE_LIMITED', 'busy', 5);
          },
        },
      },
      'RATE_LIMITED',
    ],
    [
      'slice 0 over its 30 s budget',
      {
        slice0BudgetMs: 5,
        builder: failing((i) => {
          const t = Date.now();
          while (Date.now() - t < 20);
          return STUB_BUILDER.buildStage(i);
        }),
      },
      'CAPTURE_TIMEOUT',
    ],
  ])('%s → error %s', async (_name, over, code) => {
    const { events, store } = await run(over);
    const t = terminal(events);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ type: 'error', code });
    expect(store.stages.size).toBe(0);
    expect(store.cache.size).toBe(0);
  });

  test('a later slice failing truncates the run without a second terminal event', async () => {
    const builder = failing((i) => {
      if (i.sliceIndex === 2) throw new Error('slice 2 broke');
      return STUB_BUILDER.buildStage(i);
    });
    const { events, store, result } = await run({ builder });
    expect(terminal(events)).toEqual([expect.objectContaining({ type: 'done' })]);
    expect(result?.stageIds).toHaveLength(2);
    expect(store.runs.get(result?.runId ?? '')?.status).toBe('partial');
  });

  test('the browser slot is released even when capture fails', async () => {
    let held = 0;
    const gate = {
      acquire: async () => {
        held++;
        return async () => {
          held--;
        };
      },
    };
    await run({
      gate,
      capturer: {
        name: 'x',
        capture: async () => {
          throw new Error('x');
        },
      },
    });
    await run({ gate });
    expect(held).toBe(0);
  });

  test('03b: an unplayable slice is rebuilt with the next seeds; its stageId follows the seed used', async () => {
    const seen: { slice: number; seed: number }[] = [];
    // seed 7 (the job seed) is "unplayable" on slice 1 only; seed 8 passes
    const { events, store, result } = await run({
      validatePlayable: async (st) => {
        seen.push({ slice: st.source.slice.index, seed: st.seed });
        return st.source.slice.index === 1 && st.seed === 7
          ? { ok: false, reason: 'goal unreachable' }
          : { ok: true, parTimeSec: 42, solveMs: 5 };
      },
    });
    expect(terminal(events)).toEqual([expect.objectContaining({ type: 'done' })]);
    expect(seen).toEqual([
      { slice: 0, seed: 7 },
      { slice: 1, seed: 7 },
      { slice: 1, seed: 8 },
      { slice: 2, seed: 7 },
      { slice: 3, seed: 7 },
    ]);
    const stages = store.stagesOf(result?.runId ?? '');
    expect(stages.map((s) => s.seed)).toEqual([7, 8, 7, 7]);
    const s1 = stages[1];
    expect(s1?.stageId).toBe(await computeStageId(bundle.captureId, 1, 8, STUB_BUILDER.version, 'normal'));
    expect(store.runs.get(result?.runId ?? '')).toMatchObject({ status: 'complete', seed: 7 });
    expect(result?.timingsMs).toMatchObject({ 'seeds.0': 1, 'seeds.1': 2, 'par.1': 42 });
  });

  test('03b: UNPLAYABLE only after every seed failed, with each reason', async () => {
    let calls = 0;
    const { events } = await run({
      playableSeeds: 3,
      validatePlayable: async (st) => {
        calls++;
        return { ok: false, reason: `nope ${st.seed}` };
      },
    });
    expect(calls).toBe(3);
    const t = terminal(events);
    expect(t).toEqual([
      expect.objectContaining({
        type: 'error',
        code: 'UNPLAYABLE',
        message: expect.stringMatching(/seed 7: nope 7; seed 8: nope 8; seed 9: nope 9/),
      }),
    ]);
  });
});

describe('Phase 12b: browser queue and failed-job dedupe', () => {
  /** A capturer that honours its deadline like the real ones (CAPTURE_TIMEOUT once past it). */
  const deadlineCapturer: Capturer = {
    name: 'deadline',
    capture: async (req) => {
      await new Promise((r) => setTimeout(r, 20));
      if (Date.now() > req.deadline)
        throw new ServiceError('CAPTURE_TIMEOUT', 'capture exceeded its time budget');
      return fakeCapture();
    },
  };
  const slowGate = (waitMs: number) => ({
    acquire: async () => {
      await new Promise((r) => setTimeout(r, waitMs));
      return async () => {};
    },
  });

  test('time spent waiting for a browser slot does not count against the capture budget', async () => {
    // Before the fix the 1 s budget started before the 1.5 s queue wait → CAPTURE_TIMEOUT. (The budget leaves ~1 s for
    // the 20 ms fake capture, so a stalled event loop on a loaded CI runner can't fail it for the wrong reason.)
    const { events, result } = await run({
      gate: slowGate(1500),
      capturer: deadlineCapturer,
      captureBudgetMs: 1000,
      slice0BudgetMs: 10_000,
    });
    expect(terminal(events)).toEqual([expect.objectContaining({ type: 'done' })]);
    expect(result?.timingsMs.queue).toBeGreaterThanOrEqual(1490);
    expect(result?.timingsMs.slice0).toBeGreaterThanOrEqual(result?.timingsMs.queue ?? 0);
  });

  test('the slice-0 budget also starts once the slot is held', { timeout: 15_000 }, async () => {
    // Queue wait (2.5 s) > budget (2 s) ≫ slice-0 work (~0.1–0.3 s, more under a loaded test run).
    const { events } = await run({ gate: slowGate(2500), slice0BudgetMs: 2000 });
    expect(terminal(events)).toEqual([expect.objectContaining({ type: 'done' })]);
  });

  test('"capturing" is only reported once a browser slot is held; a full queue is RATE_LIMITED', async () => {
    const events: JobEvent[] = [];
    let acquired = false;
    await runBuildJob(
      params,
      {
        capturer: okCapturer,
        builder: STUB_BUILDER,
        moderate: async () => 'ok',
        store: new MemoryStore(),
        log: silentLogger,
        gate: {
          acquire: async () => {
            expect(events.some((e) => e.type === 'progress' && e.step === 'capturing')).toBe(false);
            acquired = true;
            return async () => {};
          },
        },
      },
      (e) => {
        if (e.type === 'progress' && e.step === 'capturing') expect(acquired).toBe(true);
        events.push(e);
      },
    );
    expect(terminal(events)).toEqual([expect.objectContaining({ type: 'done' })]);
  });

  test.each([
    ['capture fails', { capturer: { name: 'x', capture: async () => Promise.reject(new Error('boom')) } }],
    [
      'no browser slot',
      {
        gate: {
          acquire: async () =>
            Promise.reject(new ServiceError('RATE_LIMITED', 'all capture browsers are busy', 5)),
        },
      },
    ],
  ] as [string, Partial<PipelineDeps>][])(
    'a failed job (%s) clears its own in-flight entry so a retry starts fresh',
    async (_n, over) => {
      const store = new MemoryStore();
      store.inflight.set(params.cacheKey, params.jobId);
      store.inflight.set('run:other', 'j-other');
      const events: JobEvent[] = [];
      await runBuildJob(
        params,
        {
          capturer: okCapturer,
          builder: STUB_BUILDER,
          moderate: async () => 'ok',
          store,
          log: silentLogger,
          ...over,
        },
        (e) => {
          // cleared before the error reaches the client, so an immediate retry can't race it
          if (e.type === 'error') expect(store.inflight.has(params.cacheKey)).toBe(false);
          events.push(e);
        },
      );
      expect(terminal(events)).toEqual([expect.objectContaining({ type: 'error' })]);
      expect(store.inflight.has(params.cacheKey)).toBe(false);
      expect(store.inflight.get('run:other')).toBe('j-other');
    },
  );

  test("a failed job leaves a newer job's in-flight entry alone; success keeps its entry", async () => {
    const store = new MemoryStore();
    store.inflight.set(params.cacheKey, 'j-newer');
    await runBuildJob(
      params,
      {
        capturer: { name: 'x', capture: async () => Promise.reject(new Error('boom')) },
        builder: STUB_BUILDER,
        moderate: async () => 'ok',
        store,
        log: silentLogger,
      },
      () => {},
    );
    expect(store.inflight.get(params.cacheKey)).toBe('j-newer');
    const ok = new MemoryStore();
    ok.inflight.set(params.cacheKey, params.jobId);
    await runBuildJob(
      params,
      {
        capturer: okCapturer,
        builder: STUB_BUILDER,
        moderate: async () => 'ok',
        store: ok,
        log: silentLogger,
      },
      () => {},
    );
    expect(ok.inflight.get(params.cacheKey)).toBe(params.jobId); // the run cache answers first anyway
  });
});
