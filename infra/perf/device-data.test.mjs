import assert from 'node:assert/strict';
import test from 'node:test';
import { numericLog, summarizeDevice, validateDevice as validate } from './device-data.mjs';

const validateDevice = (report, expected = { runtimeSHA256: 'a'.repeat(64) }) => validate(report, expected);
function valid() {
  const browserFrames = [],
    engineFrames = [],
    snapshots = [];
  for (let i = 0; i < 3600; i++) {
    const t = (i * 1000) / 60;
    browserFrames.push(t, i ? 1000 / 60 : -1, 1);
    engineFrames.push(t, i ? 1000 / 60 : -1, 1 / 60, 1 / 60, 0.2);
  }
  for (let i = 0; i <= 60; i++)
    snapshots.push({
      atMs: i * 1000,
      visibility: 'visible',
      game: { backend: 'webgpu', tier: 0, phase: 'play' },
      rendererMemory: { textures: 7 },
    });
  return {
    schemaVersion: 1,
    metadata: {
      operator: 'Reviewer',
      deviceModel: 'Physical model pending verification',
      osVersion: 'ExampleOS 1',
      browserVersion: 'Browser 1',
      role: 'desktop-game',
      scenario: 'steady-play',
      inputProtocol: 'practice fixed replay',
      powerMode: 'plugged-in balanced',
      cacheState: 'warm',
      network: 'local WiFi',
      execution: 'physical-self-reported',
      physicalEvidence: 'Independent reviewer photo reference',
      durationSeconds: 60,
    },
    environment: {
      userAgent: 'Real browser UA',
      viewport: { width: 1280, height: 800 },
      dpr: 1,
      webdriver: false,
    },
    provenance: {
      runtimeSHA256: 'a'.repeat(64),
      assetManifestSHA256: 'b'.repeat(64),
      collectorSHA256: 'c'.repeat(64),
      instrumentedHtmlSHA256: 'd'.repeat(64),
      assetsVerified: true,
      htmlModifiedForCollector: true,
    },
    elapsedMs: 60000,
    browserFrames,
    engineFrames,
    snapshots,
    visibility: [{ atMs: 0, state: 'visible' }],
    unavailable: {
      cpuUtilization: null,
      gpuUtilization: null,
      inputToPhotonMs: null,
      workerMemoryBytes: null,
    },
    errors: [],
  };
}
test('complete data requires review and never certifies physical hardware or budgets', () => {
  const r = validateDevice(valid());
  assert.equal(r.status, 'review-required');
  assert.equal(r.exitCode, 3);
  assert.equal(r.physicalAcceptance, 'not-certified');
});
test('automation cannot masquerade as physical; emulation remains incomplete', () => {
  for (const property of ['webdriver', 'headless']) {
    const r = valid();
    if (property === 'webdriver') r.environment.webdriver = true;
    else r.environment.userAgent = 'HeadlessChrome';
    assert.equal(validateDevice(r).status, 'invalid');
  }
  const r = valid();
  r.metadata.execution = 'emulated';
  assert.equal(validateDevice(r).status, 'incomplete');
});
test('missing metadata and independent physical evidence cannot pass', () => {
  const r = valid();
  delete r.metadata.deviceModel;
  delete r.metadata.physicalEvidence;
  assert.equal(validateDevice(r).status, 'incomplete');
});
test('stale source, build manifest and collector revisions fail', () => {
  for (const key of ['runtimeSHA256', 'assetManifestSHA256', 'collectorSHA256'])
    assert.equal(validateDevice(valid(), { [key]: 'f'.repeat(64) }).status, 'invalid');
});
test('missing build binding and undisclosed modified HTML are incomplete', () => {
  const r = valid();
  r.provenance.assetsVerified = false;
  r.provenance.htmlModifiedForCollector = false;
  delete r.provenance.collectorSHA256;
  assert.equal(validateDevice(r).status, 'incomplete');
});
test('missing raw data, malformed rows, NaN, reversed timestamps and invented utilization fail', () => {
  for (const mutate of [
    (r) => {
      delete r.engineFrames;
    },
    (r) => r.engineFrames.push(1),
    (r) => {
      r.browserFrames[5] = NaN;
    },
    (r) => {
      r.browserFrames[30] = -4;
    },
    (r) => {
      r.unavailable.cpuUtilization = 0;
    },
  ]) {
    const r = valid();
    mutate(r);
    assert.equal(validateDevice(r).status, 'invalid');
  }
});
test('positive samples clustered at start cannot cover a sustained run', () => {
  const r = valid();
  r.browserFrames = r.browserFrames.slice(0, 120);
  assert.equal(validateDevice(r).status, 'incomplete');
});
test('short, truncated, resource-less and sparse snapshots cannot pass', () => {
  for (const mutate of [
    (r) => {
      r.elapsedMs = 40000;
      r.browserFrames = r.browserFrames.slice(0, 6000);
      r.engineFrames = r.engineFrames.slice(0, 10000);
      r.snapshots = r.snapshots.slice(0, 41);
    },
    (r) => {
      r.truncated = true;
    },
    (r) => {
      delete r.snapshots[2].rendererMemory;
    },
    (r) => {
      r.snapshots = [r.snapshots[0], r.snapshots.at(-1)];
    },
  ]) {
    const r = valid();
    mutate(r);
    assert.equal(validateDevice(r).status, 'incomplete');
  }
});
test('thermal acceptance cannot be inferred from a short session or absent conditions', () => {
  const r = valid();
  r.metadata.scenario = 'thermal';
  assert.equal(validateDevice(r).status, 'incomplete');
});
test('controller-only capture does not invent engine metrics; RTT stays distinct from latency', () => {
  const r = valid();
  r.metadata.role = 'phone-controller';
  r.metadata.scenario = 'controller';
  r.engineFrames = [];
  for (const s of r.snapshots) {
    s.game = null;
    s.rendererMemory = null;
    s.controller = { rtt: { p95: 12 }, framesSent: 10 };
  }
  const result = validateDevice(r);
  assert.equal(result.status, 'review-required');
  assert.ok(result.limitations.some((x) => x.includes('RTT')));
});
test('a hidden run needs actual visibility history, not just empty frame arrays', () => {
  const r = valid();
  r.metadata.scenario = 'hidden';
  r.engineFrames = [];
  r.browserFrames = [];
  assert.equal(validateDevice(r).status, 'incomplete');
  r.visibility = [{ atMs: 0, state: 'hidden' }];
  for (const s of r.snapshots) s.visibility = 'hidden';
  assert.equal(validateDevice(r).status, 'review-required');
});
test('chunked numeric log retains exact values across chunks and caps storage', () => {
  const log = numericLog(3, 1100);
  for (let i = 0; i < 1100; i++) assert.equal(log.append([i, i + 0.125, -1]), true);
  assert.equal(log.append([9, 9, 9]), false);
  assert.equal(log.rows, 1100);
  assert.deepEqual(log.export().slice(-3), [1099, 1099.125, -1]);
});
test('minute trends keep phase/tier snapshots and separate browser from submitted scene intervals', () => {
  const r = valid();
  r.engineFrames = r.engineFrames.filter((_, i) => Math.floor(i / 5) % 2 === 0);
  const windows = summarizeDevice(r);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].browserIntervals.count, 3599);
  assert.equal(windows[0].engineIntervals.count, 1799);
  assert.equal(windows[0].lastSnapshot.game.tier, 0);
});
test('fabricated intervals, negative timings and invalid retained resources fail', () => {
  for (const mutate of [
    (r) => {
      r.browserFrames[4] = 4;
    },
    (r) => {
      r.engineFrames[4] = -1;
    },
    (r) => {
      r.snapshots[1].rendererMemory = { textures: -1 };
    },
    (r) => {
      r.snapshots[1].rendererMemory = {};
    },
    (r) => {
      r.snapshots[1].game.tier = 99;
    },
  ]) {
    const r = valid();
    mutate(r);
    assert.equal(validateDevice(r).status, 'invalid');
  }
});
test('fifteen hidden minutes cannot stand in for a sustained thermal play run', () => {
  const r = valid();
  r.metadata.scenario = 'thermal';
  r.elapsedMs = 900000;
  r.metadata.durationSeconds = 900;
  r.visibility = [{ atMs: 0, state: 'hidden' }];
  r.browserFrames = [];
  r.engineFrames = [];
  for (const s of r.snapshots) s.visibility = 'hidden';
  assert.ok(validateDevice(r).missing.includes('Thermal scenario requires 15 visible minutes'));
});

test('scenario labels and visibility cannot replace observed state', () => {
  for (const mutate of [
    (r) => {
      r.metadata.scenario = 'imaginary';
    },
    (r) => {
      r.browserFrames[2] = 0;
    },
    (r) => {
      r.snapshots[2].visibility = 'hidden';
    },
  ]) {
    const r = valid();
    mutate(r);
    assert.equal(validateDevice(r).status, 'invalid');
  }
  const r = valid();
  r.metadata.scenario = 'paused';
  assert.equal(validateDevice(r).status, 'incomplete');
  assert.equal(validate(r).status, 'incomplete');
});

test('brief play once per minute does not qualify as sustained thermal workload', () => {
  const r = valid();
  r.metadata.scenario = 'thermal';
  r.snapshots.forEach((s, i) => {
    if (i % 60) s.game.phase = 'paused';
  });
  const result = validateDevice(r);
  assert.ok(
    result.missing.includes('Thermal workload requires at least 90% visible snapshots in active play'),
  );
  assert.ok(result.activeSnapshotFraction < 0.1);
});
