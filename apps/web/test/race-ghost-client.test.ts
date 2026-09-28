import type { RaceAttempt, RaceCourse, RaceGhostTrack } from '@wwm/race';
import { afterEach, expect, test, vi } from 'vitest';
import { GhostClient } from '../src/race/ghost-client.ts';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: { track: RaceGhostTrack } }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  postMessage = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
  terminate() {
    this.terminated = true;
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
});
test('retry/course switch cancels synchronous worker replay and ignores obsolete completions', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const client = new GhostClient();
  const course = {} as RaceCourse;
  const attempt = {} as RaceAttempt;
  const first = client.prepare(course, attempt);
  const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  const second = client.prepare(course, attempt);
  await rejected;
  expect(FakeWorker.instances[0].terminated).toBe(true);
  const track = { attemptId: 'second' } as RaceGhostTrack;
  FakeWorker.instances[0].onmessage?.({ data: { track: { attemptId: 'stale' } as RaceGhostTrack } });
  FakeWorker.instances[1].onmessage?.({ data: { track } });
  await expect(second).resolves.toBe(track);
  expect(FakeWorker.instances[1].terminated).toBe(true);
  client.dispose();
});
test('repeated cancel releases worker and rejects each pending promise exactly once', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const client = new GhostClient();
  for (let i = 0; i < 5; i++) {
    const pending = client.prepare({} as RaceCourse, {} as RaceAttempt);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    client.cancel();
    client.cancel();
    await rejected;
  }
  expect(FakeWorker.instances.every((w) => w.terminated)).toBe(true);
});
