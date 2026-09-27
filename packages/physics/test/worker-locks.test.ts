/** Phase 22: the worker client forwards load options and `setLock` (protocol messages `load` + `lock`). */
import type { LockSpec } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { createWorkerSimulation } from '../src/worker-client.ts';
import type { FromWorker, ToWorker } from '../src/worker-protocol.ts';
import { HANDMADE } from './helpers/stages.ts';

/** A stand-in Worker: records messages, answers init and load. */
function fakeWorker() {
  const sent: ToWorker[] = [];
  const listeners: ((e: MessageEvent<FromWorker>) => void)[] = [];
  const reply = (m: FromWorker) =>
    queueMicrotask(() => {
      for (const f of listeners) f({ data: m } as never);
    });
  const w = {
    postMessage(m: ToWorker) {
      sent.push(m);
      if (m.t === 'init') reply({ t: 'ready' });
      if (m.t === 'load') reply({ t: 'loaded', id: m.id });
    },
    addEventListener(type: string, f: (e: MessageEvent<FromWorker>) => void) {
      if (type === 'message') listeners.push(f);
    },
    terminate() {},
  };
  return { worker: w as unknown as Worker, sent };
}

describe('worker protocol: locks', () => {
  test('load(stage, { locks }) sends the options; setLock sends a `lock` message; plain load sends none', async () => {
    const { worker, sent } = fakeWorker();
    const sim = await createWorkerSimulation({ worker });
    const locks: LockSpec[] = [{ id: 7, kind: 'bridge', targetId: 1, islandId: 0 }];
    await sim.load(HANDMADE, { locks });
    sim.setLock(7, true);
    await sim.load(HANDMADE);
    const loads = sent.filter((m) => m.t === 'load');
    expect(loads[0]).toMatchObject({ t: 'load', options: { locks } });
    expect(loads[1] && 'options' in loads[1]).toBe(false);
    expect(sent.filter((m) => m.t === 'lock')).toEqual([{ t: 'lock', lockId: 7, open: true }]);
    sim.dispose();
    sim.setLock(7, false); // after dispose: ignored, no throw
    expect(sent.filter((m) => m.t === 'lock')).toHaveLength(1);
  });
});
