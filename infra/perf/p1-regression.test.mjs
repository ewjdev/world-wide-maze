import assert from 'node:assert/strict';
import test from 'node:test';
import { compareEvidence } from './p1-regression.mjs';

function fixture() {
  const meta = {
    commit: 'fixture',
    date: '2026-09-27',
    browser: '153',
    hardware: 'controlled-test',
    headless: true,
    viewport: { width: 1440, height: 900 },
  };
  const run = (quality, total, renderTargets) => ({
    quality,
    frame: { p95: 17 },
    after: { game: { state: { engine: { backend: 'webgpu' } }, rendererMemory: { total, renderTargets } } },
  });
  return {
    frames: { ...meta, runs: [run(undefined, 100, 1)] },
    gpu: { ...meta, runs: [run('low', 100, 1), run('high-to-low', 100, 1)] },
    replay: {
      ...meta,
      runs: [1, 6, 20].map((throttle) => ({
        throttle,
        after: { game: { state: { phase: 'result', tick: 5429, total: 1484, recording: { replays: 1 } } } },
      })),
    },
    lifecycle: {
      ...meta,
      runs: [],
      retries: Array.from({ length: 5 }, () => ({ game: { rendererMemory: { attributesSize: 100 } } })),
    },
  };
}

test('complete matching controlled evidence passes', () =>
  assert.equal(compareEvidence(fixture(), fixture()).exitCode, 0));
test('missing evidence cannot pass', () => assert.equal(compareEvidence({}, {}).exitCode, 2));
test('changed score fails correctness even with fast frames', () => {
  const candidate = fixture();
  candidate.replay.runs[0].after.game.state.total = 1485;
  assert.equal(compareEvidence(fixture(), candidate).exitCode, 1);
});
test('extra retained targets fail even if their reported bytes are small', () => {
  const candidate = fixture();
  candidate.gpu.runs[1].after.game.rendererMemory.renderTargets = 2;
  assert.equal(compareEvidence(fixture(), candidate).exitCode, 1);
});
test('retained bytes fail despite unchanged target count', () => {
  const candidate = fixture();
  candidate.gpu.runs[1].after.game.rendererMemory.total = 100 * 1024 * 1024;
  assert.equal(compareEvidence(fixture(), candidate).exitCode, 1);
});
test('known retry leak is explicitly nonzero and remains assigned to P2', () => {
  const candidate = fixture();
  candidate.lifecycle.retries.forEach((r, i) => {
    r.game.rendererMemory.attributesSize += i * 44800;
  });
  const report = compareEvidence(fixture(), candidate);
  assert.equal(report.exitCode, 3);
  assert.equal(report.gates.find((g) => g.id === 'memory:retry-attributes').bytesPerRetry, 44800);
});
test('noisy timing regressions require review instead of claiming a deterministic failure', () => {
  const candidate = fixture();
  candidate.frames.runs[0].frame.p95 = 40;
  assert.equal(compareEvidence(fixture(), candidate).exitCode, 4);
});
test('different environment requires review', () => {
  const candidate = fixture();
  candidate.frames.browser = '154';
  assert.equal(compareEvidence(fixture(), candidate).exitCode, 4);
});
test('cache evidence cannot hide a decoded-byte overflow', () => {
  const candidate = fixture();
  candidate.cache = {
    identicalStages: true,
    rounds: [{ variant: 'candidate', stages: [{ decoded: { liveBytes: 33 * 1024 * 1024 } }] }],
  };
  assert.equal(compareEvidence(fixture(), candidate).exitCode, 1);
});
