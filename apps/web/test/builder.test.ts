import type { CaptureBundle, RGBAImage, StageData } from '@wwm/schema';
import { describe, expect, test, vi } from 'vitest';
import { StageBuilderPool } from '../src/game/builder-pool.ts';
import {
  type BuilderMessage,
  type BuildReply,
  type BuildRequest,
  createBuilderService,
} from '../src/game/builder-service.ts';
import { DecodedImageCache } from '../src/game/decoded-image-cache.ts';

const image = (bytes: number): RGBAImage => ({
  width: bytes / 4,
  height: 1,
  data: new Uint8ClampedArray(bytes),
});
const stage = { stageId: 'unchanged' } as StageData;
const request: Omit<BuildRequest, 'id'> = {
  capture: {} as CaptureBundle,
  screenshotUrl: '/a.png',
  sliceIndex: 0,
  seed: 1,
  difficulty: 'normal',
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('decoded screenshot retention', () => {
  test('evicts least recently used bytes while retaining adjacent slices', () => {
    const cache = new DecodedImageCache(12);
    const a = image(4);
    cache.set('a', a);
    cache.set('b', image(8));
    expect(cache.get('a')).toBe(a);
    cache.set('c', image(8));
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(a);
    expect(cache.stats).toMatchObject({ retainedBytes: 12, entries: 2, hits: 2, evictions: 1 });
  });
  test('accounts owned backing store, handles replacements and never retains an oversized image', () => {
    const cache = new DecodedImageCache(16);
    cache.set('a', image(8));
    cache.set('a', image(4));
    expect(cache.stats.retainedBytes).toBe(4);
    const big = image(32);
    cache.set('big-view', { ...big, data: big.data.subarray(0, 4) });
    expect(cache.get('big-view')).toBeUndefined();
    expect(cache.stats).toMatchObject({ retainedBytes: 4, oversized: 1 });
  });
  test('arbitrary tours and revisits stay within budget', () => {
    const cache = new DecodedImageCache(64);
    for (let i = 0; i < 1000; i++) {
      cache.set(`page-${i % 17}`, image(((i % 24) + 1) * 4));
      expect(cache.stats.retainedBytes).toBeLessThanOrEqual(64);
    }
    expect(cache.stats.evictions).toBeGreaterThan(0);
    expect(cache.stats.oversized).toBeGreaterThan(0);
  });
});

describe('serial worker service', () => {
  test('same screenshot shares decode, queued cancellation never builds, failed decode can retry', async () => {
    let release: ((value: RGBAImage) => void) | undefined;
    const decode = vi.fn(
      () =>
        new Promise<RGBAImage>((resolve) => {
          release = resolve;
        }),
    );
    const replies: BuildReply[] = [];
    const build = vi.fn(() => ({ stage })) as unknown as Parameters<typeof createBuilderService>[3];
    const receive = createBuilderService(decode, (r) => replies.push(r), new DecodedImageCache(32), build);
    receive({ ...request, id: 1 });
    receive({ ...request, id: 2, sliceIndex: 1 });
    receive({ ...request, id: 3, screenshotUrl: '/cancelled' });
    receive({ cancel: 3 });
    expect(decode).toHaveBeenCalledTimes(1);
    release?.(image(16));
    await flush();
    expect(replies.map((r) => r.id)).toEqual([1, 2]);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledTimes(2);
    expect(replies[1]).toMatchObject({ cache: { hits: 1, retainedBytes: 16 } });
  });
  test('aborting during decode releases the pending image without caching or building it', async () => {
    let release: ((value: RGBAImage) => void) | undefined;
    let signal: AbortSignal | undefined;
    const decode = (_url: string, s: AbortSignal) => {
      signal = s;
      return new Promise<RGBAImage>((resolve) => {
        release = resolve;
      });
    };
    const cache = new DecodedImageCache(32);
    const reply = vi.fn();
    const build = vi.fn() as unknown as Parameters<typeof createBuilderService>[3];
    const receive = createBuilderService(decode, reply, cache, build);
    receive({ ...request, id: 1 });
    receive({ cancel: 1 });
    expect(signal?.aborted).toBe(true);
    release?.(image(16));
    await flush();
    expect(build).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled(); // The pool already rejected synchronously on abort.
    expect(cache.stats.retainedBytes).toBe(0);
  });
  test('decode failure is not sticky and the next request completes', async () => {
    const decode = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(image(8));
    const replies: BuildReply[] = [];
    const build = vi.fn(() => ({ stage })) as unknown as Parameters<typeof createBuilderService>[3];
    const receive = createBuilderService(decode, (r) => replies.push(r), undefined, build);
    receive({ ...request, id: 1 });
    receive({ ...request, id: 2 });
    await flush();
    expect(replies).toMatchObject([
      { id: 1, ok: false, error: 'offline' },
      { id: 2, ok: true, stage },
    ]);
  });
});

class FakeWorker {
  onmessage: ((event: MessageEvent<BuildReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn<(message: BuilderMessage) => void>();
  terminate = vi.fn();
  reply(id: number) {
    this.onmessage?.({
      data: { id, ok: true, stage, ms: 0, cache: new DecodedImageCache().stats },
    } as MessageEvent<BuildReply>);
  }
}
const fakePool = () => {
  const workers: FakeWorker[] = [];
  const pool = new StageBuilderPool(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  return { pool, workers };
};

describe('builder pool settlement and cancellation', () => {
  test('pre-aborted request never creates a worker', async () => {
    const { pool, workers } = fakePool();
    await expect(pool.build(request, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers).toHaveLength(0);
  });
  test('last pending abort interrupts worker and late obsolete reply cannot resolve a new generation', async () => {
    const { pool, workers } = fakePool();
    const abort = new AbortController();
    const first = pool.build(request, abort.signal);
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort();
    await rejected;
    expect(workers[0]?.terminate).toHaveBeenCalledOnce();
    const second = pool.build(request);
    workers[0]?.reply(2);
    workers[1]?.reply(2);
    await expect(second).resolves.toBe(stage);
  });
  test('one abort preserves other pending work, and completed signal does not terminate useful cache', async () => {
    const { pool, workers } = fakePool();
    const abort = new AbortController();
    const first = pool.build(request, abort.signal);
    const second = pool.build(request);
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort();
    await rejected;
    expect(workers[0]?.postMessage).toHaveBeenLastCalledWith({ cancel: 1 });
    expect(workers[0]?.terminate).not.toHaveBeenCalled();
    workers[0]?.reply(1);
    workers[0]?.reply(2);
    await expect(second).resolves.toBe(stage);
    const completedAbort = new AbortController();
    const third = pool.build(request, completedAbort.signal);
    workers[0]?.reply(3);
    await third;
    completedAbort.abort();
    expect(workers[0]?.terminate).not.toHaveBeenCalled();
  });
  test.each(['error', 'messageerror', 'dispose'] as const)(
    '%s rejects every pending promise',
    async (failure) => {
      const { pool, workers } = fakePool();
      const first = pool.build(request);
      const second = pool.build(request);
      const settled = Promise.allSettled([first, second]);
      if (failure === 'error')
        workers[0]?.onerror?.({ message: 'module failed', preventDefault() {} } as ErrorEvent);
      else if (failure === 'messageerror') workers[0]?.onmessageerror?.();
      else pool.dispose();
      expect((await settled).map((x) => x.status)).toEqual(['rejected', 'rejected']);
      expect(workers[0]?.terminate).toHaveBeenCalledOnce();
      if (failure === 'dispose') await expect(pool.build(request)).rejects.toThrow('disposed');
      else {
        const retry = pool.build(request);
        workers[1]?.reply(3);
        await expect(retry).resolves.toBe(stage);
      }
    },
  );
  test('worker constructor and postMessage failures reject without stranding callbacks', async () => {
    const broken = new StageBuilderPool(() => {
      throw new Error('blocked');
    });
    await expect(broken.build(request)).rejects.toThrow('blocked');
    broken.dispose();
    const { pool, workers } = fakePool();
    const first = pool.build(request);
    const rejected = expect(first).rejects.toThrow('clone');
    workers[0]?.postMessage.mockImplementation(() => {
      throw new Error('clone');
    });
    await expect(pool.build(request)).rejects.toThrow('clone');
    await rejected;
  });
});
