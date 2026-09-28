import { readFileSync } from 'node:fs';
import { type InputSample, type StageData, VersionedReplaySchema } from '@wwm/schema';
import { expect, test } from 'vitest';
import { scoreReplayEvents } from '../../worker/src/routes/scores-rules.ts';
import { InputRecording, SavedRecording } from '../src/game/input-recording.ts';

const neutral: InputSample = { tiltX: 0, tiltZ: 0, frameYaw: 0, power: false, jump: false };
const fixture = JSON.parse(
  readFileSync(new URL('../../../fixtures/replays/handmade-simple.keyboard.json', import.meta.url), 'utf8'),
) as InputSample[];
const stage = JSON.parse(
  readFileSync(new URL('../../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
) as StageData;

test('lazy chunks preserve exact doubles, signed zero, flags and snapshot ownership across boundaries', () => {
  const rec = new InputRecording();
  expect(rec.byteLength).toBe(0);
  const inputs = Array.from({ length: 3073 }, (_, i) => ({
    tiltX: i % 2 ? -0 : Number.MIN_VALUE,
    tiltZ: Math.sin(i) / 3,
    frameYaw: i * Math.PI,
    power: i % 2 === 0,
    jump: i % 3 === 0,
  }));
  for (const input of inputs) rec.append(input);
  expect(rec.toArray()).toEqual(inputs);
  expect(Object.is(rec.toArray()[1]?.tiltX, -0)).toBe(true);
  expect(rec.byteLength).toBe(4 * 1024 * 29);
  const snapshot = rec.toArray();
  (snapshot[0] as InputSample).tiltX = 999;
  expect(rec.toArray()[0]?.tiltX).toBe(Number.MIN_VALUE);
  rec.append(neutral);
  expect(snapshot).toHaveLength(inputs.length);
});

test('copies mutable source values; clear releases chunks and does not alter an exported run', () => {
  const rec = new InputRecording();
  const input = { ...neutral };
  rec.append(input);
  input.power = true;
  rec.append(input);
  const exported = rec.toReplay('0.2.0', 1);
  rec.clear();
  expect(rec.length).toBe(0);
  expect(rec.byteLength).toBe(0);
  expect(exported.inputs.map((i) => i.power)).toEqual([false, true]);
  rec.append(neutral);
  expect(rec.toArray()).toEqual([neutral]);
  expect(exported.inputs).toHaveLength(2);
});

test('retains all ticks across the server verification horizon without truncation or policy changes', () => {
  const rec = new InputRecording();
  for (let i = 0; i < 72001; i++)
    rec.append({ ...neutral, frameYaw: i, power: i === 36000, jump: i === 72000 });
  expect(rec.length).toBe(72001);
  const exported = rec.toReplay('0.2.0', 36000);
  expect(exported.inputs[36000]?.power).toBe(true);
  expect(exported.inputs[72000]?.jump).toBe(true);
  expect(exported.timerStartTick).toBe(36000);
  expect(VersionedReplaySchema.parse(exported).inputs).toHaveLength(72001);
});

test('fixture export and explicit/implicit timer offsets retain score and submission envelope values', () => {
  const rec = new InputRecording();
  for (const input of fixture) rec.append(input);
  expect(rec.toArray()).toEqual(fixture);
  const events = [
    { tick: 100, event: { type: 'item' as const, itemId: 1, kind: 'small' as const } },
    { tick: 5429, event: { type: 'goal' as const } },
  ];
  for (const timerStartTick of [undefined, 0, 1394]) {
    const original = {
      physicsVersion: '0.2.0',
      inputs: fixture,
      ...(timerStartTick === undefined ? {} : { timerStartTick }),
    };
    const exported = rec.toReplay('0.2.0', timerStartTick);
    expect(JSON.parse(JSON.stringify(exported))).toEqual(JSON.parse(JSON.stringify(original)));
    expect(
      scoreReplayEvents(events, exported.inputs, stage.timeLimitSec, 5429, 5429, timerStartTick),
    ).toEqual(scoreReplayEvents(events, fixture, stage.timeLimitSec, 5429, 5429, timerStartTick));
  }
});

test('equal exported ticks share objects without collapsing signed zero or exposing internal state', () => {
  const rec = new InputRecording();
  rec.append(neutral);
  rec.append({ ...neutral });
  rec.append({ ...neutral, tiltX: -0 });
  const snapshot = rec.toArray();
  expect(snapshot[0]).toBe(snapshot[1]);
  expect(snapshot[2]).not.toBe(snapshot[1]);
  (snapshot[0] as InputSample).power = true;
  expect(rec.toArray()[0]?.power).toBe(false);
});

test('completed runs stay compact until submission, release chunks once and retain exact replay availability', () => {
  const rec = new InputRecording();
  for (const input of fixture) rec.append(input);
  const saved = new SavedRecording(rec, '0.2.0', 1394);
  const snapshot = saved.snapshot();
  (snapshot.inputs[0] as InputSample).power = true;
  expect(saved.byteLength).toBeGreaterThan(0);
  const submitted = saved.forSubmission();
  expect(saved.byteLength).toBe(0);
  expect(rec.byteLength).toBe(0);
  expect(submitted.inputs).toEqual(fixture);
  expect(submitted.timerStartTick).toBe(1394);
  expect(saved.forSubmission()).toBe(submitted);
  const after = saved.snapshot();
  expect(after.inputs[0]).not.toBe(submitted.inputs[0]);
  const shared = submitted.inputs.findIndex((input, i) => i > 0 && input === submitted.inputs[i - 1]);
  expect(shared).toBeGreaterThan(0);
  expect(after.inputs[shared]).toBe(after.inputs[shared - 1]);
  (after.inputs[0] as InputSample).power = true;
  expect(saved.forSubmission().inputs).toEqual(fixture);
  expect(JSON.parse(JSON.stringify(submitted))).toEqual(
    JSON.parse(JSON.stringify({ physicsVersion: '0.2.0', inputs: fixture, timerStartTick: 1394 })),
  );
});

test('storage run overflow splits losslessly and never limits the complete recording', () => {
  const rec = new InputRecording(3);
  for (let i = 0; i < 3073; i++) rec.append(neutral);
  expect(rec.length).toBe(3073);
  expect(rec.byteLength).toBe(2 * 1024 * 29);
  expect(rec.toArray()).toEqual(Array(3073).fill(neutral));
  for (const max of [0, -1, 1.5, 0x100000000]) expect(() => new InputRecording(max)).toThrow(RangeError);
  rec.clear();
  rec.append({ ...neutral, tiltX: -0 });
  expect(rec.length).toBe(1);
  expect(Object.is(rec.toArray()[0]?.tiltX, -0)).toBe(true);
});

test('equal fresh or reused idle samples occupy one run across a long idle horizon', () => {
  for (const fresh of [false, true]) {
    const rec = new InputRecording();
    for (let i = 0; i < 72001; i++) rec.append(fresh ? { ...neutral } : neutral);
    expect(rec.length).toBe(72001);
    expect(rec.byteLength).toBe(1024 * 29);
    expect(rec.toArray()).toEqual(Array(72001).fill(neutral));
  }
});
