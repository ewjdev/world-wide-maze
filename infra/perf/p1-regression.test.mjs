import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runtimeFingerprint } from './p1-fingerprint.mjs';
import { compareEvidence } from './p1-regression.mjs';

function fixture() {
  const meta = {
    commit: 'fixture',
    date: '2026-09-27',
    browser: '153',
    hardware: 'controlled-test',
    headless: true,
    viewport: { width: 1440, height: 900 },
    runtimeFingerprint: { sha256: 'controlled-source' },
    system: {
      gpu: { devices: [{ deviceString: 'native-test-gpu' }], auxAttributes: { glRenderer: 'Metal' } },
    },
  };
  const run = (quality, total, renderTargets) => ({
    quality,
    frame: { p95: 17, n: 600 },
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
      retries: Array.from({ length: 5 }, () => ({
        game: { rendererMemory: { attributesSize: 100, attributes: 10, textures: 1, texturesSize: 100 } },
      })),
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
  const baseline = fixture();
  baseline.lifecycle.retries.forEach((r, i) => {
    r.game.rendererMemory.attributesSize += i * 44800;
    r.game.rendererMemory.attributes += i * 2;
  });
  const report = compareEvidence(baseline, structuredClone(baseline));
  assert.equal(report.exitCode, 3);
  assert.equal(report.gates.find((g) => g.id === 'memory:retry-attributes').bytesPerRetry, 44800);
});
test('larger/new retry leaks cannot be waived under P2', () => {
  const baseline = fixture();
  baseline.lifecycle.retries.forEach((r, i) => {
    r.game.rendererMemory.attributesSize += i * 44800;
    r.game.rendererMemory.attributes += i * 2;
  });
  const candidate = structuredClone(baseline);
  candidate.lifecycle.retries.forEach((r, i) => {
    r.game.rendererMemory.attributesSize += i * 44800;
  });
  assert.equal(compareEvidence(baseline, candidate).exitCode, 1);
  const other = structuredClone(baseline);
  other.lifecycle.retries.forEach((r, i) => {
    r.game.rendererMemory.textures += i;
  });
  assert.equal(compareEvidence(baseline, other).exitCode, 1);
});
test('missing frame scenarios and invalid samples cannot pass', () => {
  const candidate = fixture();
  candidate.frames.runs = [];
  assert.equal(compareEvidence(fixture(), candidate).exitCode, 2);
  const invalid = fixture();
  invalid.frames.runs[0].frame.n = 0;
  assert.equal(compareEvidence(fixture(), invalid).exitCode, 2);
});
test('native versus software GPU identity requires review', () => {
  const candidate = fixture();
  candidate.frames.system.gpu.auxAttributes.glRenderer = 'SwiftShader';
  assert.equal(compareEvidence(fixture(), candidate).exitCode, 4);
});
test('native evidence must match current runtime bytes', () => {
  assert.equal(compareEvidence(fixture(), fixture(), { sha256: 'changed-source' }).exitCode, 1);
  const missing = fixture();
  delete missing.gpu.runtimeFingerprint;
  assert.equal(compareEvidence(fixture(), missing).exitCode, 2);
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

test('runtime fingerprint ignores docs but includes new runtime bytes across git add', () => {
  const root = mkdtempSync(join(tmpdir(), 'wwm-perf-fingerprint-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    mkdirSync(join(root, 'apps/web/src'), { recursive: true });
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'apps/web/src/game.ts'), 'runtime 1');
    const first = runtimeFingerprint(root);
    execFileSync('git', ['add', '.'], { cwd: root });
    assert.equal(runtimeFingerprint(root).sha256, first.sha256);
    writeFileSync(join(root, 'docs/evidence.md'), 'documentation only');
    assert.equal(runtimeFingerprint(root).sha256, first.sha256);
    writeFileSync(join(root, 'apps/web/src/new.ts'), 'runtime 2');
    assert.notEqual(runtimeFingerprint(root).sha256, first.sha256);
    writeFileSync(join(root, 'apps/web/src/game.ts'), 'changed runtime');
    assert.notEqual(runtimeFingerprint(root).sha256, first.sha256);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
