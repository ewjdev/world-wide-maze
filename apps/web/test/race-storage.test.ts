import { makeCompatibility, type RaceAttempt, RaceRecorder } from '@wwm/race';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { RaceHistory, selectHistory } from '../src/race/storage.ts';

function attempt(id: string, ticks: number, createdAt = Number(id) || 1, courseId = 'course'): RaceAttempt {
  const recorder = new RaceRecorder();
  for (let i = 0; i < ticks; i++)
    recorder.record({ tiltX: 0, tiltZ: 0, frameYaw: 0, power: false, jump: false });
  return {
    schema: 'wwm.race-attempt/1',
    id,
    createdAt,
    compatibility: makeCompatibility(courseId),
    inputSource: 'keyboard',
    outcome: 'finished',
    progress: { tick: ticks, nextGate: 1, sectorTicks: [], finishTick: ticks, reasons: [] },
    recording: recorder.finish(),
  };
}
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
test('best and recent history survive a new adapter, with exact binary inputs', async () => {
  const history = new RaceHistory();
  await expect(history.save(attempt('1', 10))).resolves.toEqual({ persistent: true });
  const loaded = await new RaceHistory().list(makeCompatibility('course'));
  expect(loaded.persistent).toBe(true);
  expect(loaded.best?.id).toBe('1');
  expect(loaded.best?.recording.data).toEqual(attempt('1', 10).recording.data);
});
test('two concurrent writers serialize best and recent atomically; ties retain existing saved best', async () => {
  const a = new RaceHistory();
  const b = new RaceHistory();
  await Promise.all([a.save(attempt('slow', 20)), b.save(attempt('fast', 10))]);
  const result = await a.list(makeCompatibility('course'));
  expect(result.recent).toHaveLength(2);
  expect(result.best?.id).toBe('fast');
  await b.save(attempt('aaa', 10));
  expect((await a.list(makeCompatibility('course'))).best?.id).toBe('fast');
});
test('retains ten recent plus protected earlier best and isolates compatibility', async () => {
  const history = new RaceHistory();
  await history.save(attempt('1', 1));
  for (let i = 2; i <= 14; i++) await history.save(attempt(String(i), i));
  const result = await history.list(makeCompatibility('course'));
  expect(result.best?.id).toBe('1');
  expect(result.recent).toHaveLength(10);
  expect(result.recent.map((a) => a.id)).not.toContain('1');
  const otherPhysics = makeCompatibility('course');
  otherPhysics.physicsVersion = 'future';
  expect((await history.list(otherPhysics)).recent).toEqual([]);
});
test('practice attempts cannot replace a best and malformed records never enter storage', async () => {
  const history = new RaceHistory();
  await history.save(attempt('1', 10));
  const practice = attempt('2', 5);
  practice.progress.reasons = ['pause'];
  await history.save(practice);
  expect((await history.list(makeCompatibility('course'))).best?.id).toBe('1');
  const invalid = attempt('3', 3);
  invalid.recording.ticks = 999_999;
  expect((await history.save(invalid)).persistent).toBe(false);
  expect((await history.list(makeCompatibility('course'))).recent).toHaveLength(2);
});
test('quota failure aborts both stores while retaining live result as session-only', async () => {
  const history = new RaceHistory();
  await history.save(attempt('1', 10));
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<typeof put>
  ) {
    if (this.name === 'bests') throw new DOMException('Quota exhausted', 'QuotaExceededError');
    return put.apply(this, args);
  });
  const result = await history.save(attempt('2', 5));
  expect(result.persistent).toBe(false);
  expect((await history.list(makeCompatibility('course'))).best?.id).toBe('2');
  const reloaded = await new RaceHistory().list(makeCompatibility('course'));
  expect(reloaded.best?.id).toBe('1');
  expect(reloaded.recent).toHaveLength(1);
});
test('unavailable IndexedDB leaves a bounded usable session history', async () => {
  vi.stubGlobal('indexedDB', undefined);
  const history = new RaceHistory();
  expect((await history.save(attempt('1', 5))).persistent).toBe(false);
  const loaded = await history.list(makeCompatibility('course'));
  expect(loaded.persistent).toBe(false);
  expect(loaded.best?.id).toBe('1');
});
test('budget eviction keeps protected best or fails without silently removing it', () => {
  const best = attempt('1', 1);
  const recent = attempt('2', 10);
  recent.progress.reasons = ['pause'];
  const result = selectHistory([best, recent], 10_000);
  expect(result).toContain(best);
  expect(() => selectHistory([best], 1)).toThrow('Protected Race records');
});
test('clear deletes course attempts and best index while preserving another course', async () => {
  const history = new RaceHistory();
  await history.save(attempt('1', 1));
  await history.save(attempt('2', 2, 2, 'other'));
  await history.clear('course');
  expect((await history.list(makeCompatibility('course'))).recent).toEqual([]);
  expect((await history.list(makeCompatibility('other'))).best?.id).toBe('2');
  await history.clear();
  expect((await history.list(makeCompatibility('other'))).recent).toEqual([]);
});
