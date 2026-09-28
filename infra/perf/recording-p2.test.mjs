import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreReplayEvents } from '../../apps/worker/src/routes/scores-rules.ts';
import { RecordingPrototype } from './recording-p2.mjs';

test('preserves exact double precision, button edges, tick offsets and envelope serialization', () => {
  const samples = [0, -0, Number.MIN_VALUE, Math.PI, -0.12345678901234566].map((n, i) => ({
    tiltX: n,
    tiltZ: -n,
    frameYaw: n / 3,
    power: i > 2,
    jump: i === 4,
  }));
  const p = new RecordingPrototype(5);
  for (const s of samples) assert(p.append(s));
  assert.deepEqual(p.expand(), samples);
  const before = { physicsVersion: '0.2.0', inputs: samples, timerStartTick: 3 };
  assert.equal(JSON.stringify({ ...before, inputs: p.expand() }), JSON.stringify(before));
});
test('bound refuses the first overflow tick without overwriting or pretending exactness; retry clears', () => {
  const p = new RecordingPrototype(36000);
  const s = { tiltX: 0, tiltZ: 0, frameYaw: 0, power: false, jump: false };
  for (let i = 0; i < 36000; i++) assert(p.append(s));
  assert.equal(p.byteLength, 900000);
  assert.equal(p.append({ ...s, power: true }), false);
  assert.equal(p.length, 36000);
  assert.equal(p.expand().at(-1).power, false);
  p.clear();
  assert.equal(p.length, 0);
  assert(p.append({ ...s, power: true }));
  assert.equal(p.expand()[0].power, true);
});

test('score and explicit/implicit timer offsets survive exact expansion and unchanged submit envelope', () => {
  const samples = Array.from({ length: 7200 }, (_, i) => ({
    tiltX: i < 1394 ? 0 : 0.1,
    tiltZ: 0,
    frameYaw: 0,
    power: i >= 1394,
    jump: i === 3000,
  }));
  const p = new RecordingPrototype();
  for (const sample of samples) assert(p.append(sample));
  const events = [
    { tick: 3500, event: { type: 'item', itemId: 1, kind: 'small' } },
    { tick: 7000, event: { type: 'goal' } },
  ];
  for (const timerStartTick of [undefined, 0, 1394]) {
    const score = scoreReplayEvents(events, samples, 300, 7000, 7000, timerStartTick);
    assert.deepEqual(scoreReplayEvents(events, p.expand(), 300, 7000, 7000, timerStartTick), score);
    assert.deepEqual(
      JSON.parse(JSON.stringify({ physicsVersion: '0.2.0', inputs: p.expand(), timerStartTick })),
      JSON.parse(JSON.stringify({ physicsVersion: '0.2.0', inputs: samples, timerStartTick })),
    );
  }
});
