import type { InputSample } from '@wwm/schema';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { FromWorker, ToWorker } from '../src/worker-protocol.ts';
import { HANDMADE } from './helpers/stages.ts';

const { steps, sim } = vi.hoisted(() => {
  const steps: InputSample[] = [];
  return {
    steps,
    sim: {
      params: { simHz: 120 },
      load: async () => {},
      stats: () => ({ tick: steps.length, lastStepMs: 0.1 }),
      getBallState: () => ({}),
      step: (input: InputSample) => {
        steps.push(input);
        return { events: [], elevators: [] };
      },
      reset: () => {},
      setLock: () => {},
    },
  };
});
vi.mock('../src/simulation.ts', () => ({ RapierSimulation: { create: async () => sim } }));

const input: InputSample = { tiltX: 0, tiltZ: 0, frameYaw: 0, power: false, jump: false };
let receive: (event: MessageEvent<ToWorker>) => void;
let messages: FromWorker[];
async function send(message: ToWorker) {
  receive({ data: message } as MessageEvent<ToWorker>);
  await vi.advanceTimersByTimeAsync(0);
}
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  steps.length = 0;
  messages = [];
  vi.stubGlobal('self', {
    addEventListener: (_type: string, listener: typeof receive) => {
      receive = listener;
    },
    postMessage: (message: FromWorker) => messages.push(message),
  });
  await import('../src/worker.ts');
  await send({ t: 'init' });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('physics worker idle scheduling', () => {
  test('initialization and loading do not start a polling timer before input', async () => {
    expect(messages).toContainEqual({ t: 'ready' });
    expect(vi.getTimerCount()).toBe(0);
    await send({ t: 'pause', paused: true });
    expect(messages).toEqual([{ t: 'ready' }]); // driver pauses immediately after init, before any world exists
    await send({ t: 'load', id: 1, stage: HANDMADE });
    expect(messages).toContainEqual({ t: 'loaded', id: 1 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(vi.getTimerCount()).toBe(0);
    expect(steps).toHaveLength(0);
  });

  test('pause cancels the live timer and resume waits for fresh input without catch-up or stale jumps', async () => {
    await send({ t: 'load', id: 1, stage: HANDMADE });
    await send({ t: 'input', input, jumps: 0 });
    await vi.advanceTimersByTimeAsync(100);
    expect(steps.length).toBeGreaterThanOrEqual(11);
    expect(steps.length).toBeLessThanOrEqual(12);
    await send({ t: 'input', input: { ...input, jump: true }, jumps: 1 });
    await send({ t: 'pause', paused: true });
    const tick = steps.length;
    await send({ t: 'input', input: { ...input, jump: true }, jumps: 1 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(vi.getTimerCount()).toBe(0);
    expect(steps).toHaveLength(tick);
    await send({ t: 'pause', paused: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.getTimerCount()).toBe(0);
    await send({ t: 'input', input, jumps: 0 });
    await vi.advanceTimersByTimeAsync(10);
    expect(steps).toHaveLength(tick + 1);
    expect(steps.at(-1)?.jump).toBe(false);
  });

  test('a silent sender stops all timers and a later input wakes exactly one loop', async () => {
    await send({ t: 'load', id: 1, stage: HANDMADE });
    await send({ t: 'input', input, jumps: 0 });
    await vi.advanceTimersByTimeAsync(200);
    const tick = steps.length;
    expect(tick).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(steps).toHaveLength(tick);
    await send({ t: 'input', input, jumps: 0 });
    await send({ t: 'input', input, jumps: 0 });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(steps).toHaveLength(tick + 1);
  });
});
