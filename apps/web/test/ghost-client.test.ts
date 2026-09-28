import { readFileSync } from 'node:fs';
import { PHYSICS_VERSION, replay } from '@wwm/physics';
import { type InputSample, SIM_HZ, type StageData } from '@wwm/schema';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { GhostClient } from '../src/ranking/ghost-client.ts';
import { type GhostTrack, recordGhostTrack } from '../src/ranking/ghost-track.ts';

const stage = JSON.parse(
  readFileSync(new URL('../../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
) as StageData;
const inputs = JSON.parse(
  readFileSync(new URL('../../../fixtures/replays/handmade-simple.keyboard.json', import.meta.url), 'utf8'),
) as InputSample[];
const track: GhostTrack = {
  physicsVersion: PHYSICS_VERSION,
  hz: SIM_HZ,
  pos: new Float32Array(3),
  quat: new Float32Array(4),
  ticks: 1,
  goalTick: -1,
};
class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((event: { data: { track?: GhostTrack; error?: string } }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    FakeWorker.all.push(this);
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.all = [];
});
function setup() {
  vi.stubGlobal('Worker', FakeWorker);
  return new GhostClient();
}
function worker() {
  return FakeWorker.all.at(-1) as FakeWorker;
}

describe('classic ghost preparation', () => {
  test('reference recorder preserves every pose and goal tick on the recorded physics version', async () => {
    const expectedPos: number[] = [];
    const expectedQuat: number[] = [];
    const reference = await replay(stage, inputs, {
      stopAtGoal: true,
      onStep: (_tick, s) => {
        expectedPos.push(...s.ball.pos);
        expectedQuat.push(...s.ball.quat);
        return undefined;
      },
    });
    const actual = await recordGhostTrack(stage, inputs);
    expect(actual).toMatchObject({
      physicsVersion: PHYSICS_VERSION,
      hz: SIM_HZ,
      ticks: reference.ticks,
      goalTick: reference.goalTick,
    });
    expect(actual.pos).toEqual(new Float32Array(expectedPos));
    expect(actual.quat).toEqual(new Float32Array(expectedQuat));
    expect(actual.goalTick).toBe(5429);
  });
  test('delivers a matching track and releases its worker', async () => {
    const client = setup();
    const pending = client.prepare(stage, inputs);
    expect(worker().postMessage).toHaveBeenCalledWith({ stage, inputs });
    worker().onmessage?.({ data: { track } });
    expect(await pending).toBe(track);
    expect(worker().terminate).toHaveBeenCalledOnce();
    client.dispose();
    expect(worker().terminate).toHaveBeenCalledOnce();
  });
  test('superseding even the same stage rejects the old job and ignores its late response', async () => {
    const client = setup();
    const old = client.prepare(stage, inputs);
    const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    const stale = worker();
    const next = client.prepare(stage, inputs);
    stale.onmessage?.({ data: { track } });
    stale.onerror?.();
    await rejected;
    expect(stale.terminate).toHaveBeenCalledOnce();
    worker().onmessage?.({ data: { track } });
    expect(await next).toBe(track);
  });
  test('abort and disposal settle pending jobs and block use after disposal', async () => {
    const client = setup();
    const ac = new AbortController();
    const pending = client.prepare(stage, inputs, ac.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    ac.abort();
    await rejected;
    expect(worker().terminate).toHaveBeenCalledOnce();
    const second = client.prepare(stage, inputs);
    const disposed = expect(second).rejects.toMatchObject({ name: 'AbortError' });
    client.dispose();
    await disposed;
    await expect(client.prepare(stage, inputs)).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.all).toHaveLength(2);
  });
  test('an already aborted request does not construct a worker', async () => {
    const client = setup();
    const ac = new AbortController();
    ac.abort();
    await expect(client.prepare(stage, inputs, ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.all).toHaveLength(0);
  });
  test.each(['error', 'messageerror', 'response', 'version'] as const)(
    'failure %s releases the worker and allows retry',
    async (kind) => {
      const client = setup();
      const pending = client.prepare(stage, inputs);
      const rejected = expect(pending).rejects.toBeInstanceOf(Error);
      if (kind === 'error') worker().onerror?.();
      if (kind === 'messageerror') worker().onmessageerror?.();
      if (kind === 'response') worker().onmessage?.({ data: { error: 'Replay failed' } });
      if (kind === 'version') worker().onmessage?.({ data: { track: { ...track, physicsVersion: 'old' } } });
      await rejected;
      expect(worker().terminate).toHaveBeenCalledOnce();
      const next = client.prepare(stage, inputs);
      worker().onmessage?.({ data: { track } });
      expect(await next).toBe(track);
    },
  );
  test('unavailable Worker rejects without executing a main-thread fallback', async () => {
    vi.stubGlobal('Worker', undefined);
    await expect(new GhostClient().prepare(stage, inputs)).rejects.toBeInstanceOf(Error);
  });
  test('clone errors release a constructed worker', async () => {
    class BrokenWorker extends FakeWorker {
      override postMessage = vi.fn(() => {
        throw new DOMException('Cannot clone', 'DataCloneError');
      });
    }
    vi.stubGlobal('Worker', BrokenWorker);
    await expect(new GhostClient().prepare(stage, inputs)).rejects.toMatchObject({ name: 'DataCloneError' });
    expect(worker().terminate).toHaveBeenCalledOnce();
  });
});
