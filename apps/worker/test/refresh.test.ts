import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Services } from '../src/config.ts';
import { scheduleRefresh } from '../src/refresh.ts';
import { fixture } from './helpers/catalog-fixture.ts';

const NOW = new Date('2026-09-26T12:00:00Z');
const fixtures: ReturnType<typeof fixture>[] = [];
beforeEach(() => vi.useFakeTimers({ now: NOW, toFake: ['Date'] }));
afterEach(() => {
  vi.useRealTimers();
  for (const f of fixtures.splice(0)) f.close();
});
async function setup({
  age = 8,
  mode = 'auto',
  limit = true,
}: {
  age?: number;
  mode?: string;
  limit?: boolean;
} = {}) {
  const f = fixture();
  fixtures.push(f);
  f.run('a', 'https://example.com/', 'capture-a', new Date(NOW.getTime() - age * 86400_000).toISOString());
  await f.record('a');
  const start = vi.fn(async () => {}),
    hit = vi.fn(async () => ({ ok: limit })),
    warn = vi.fn();
  const env = {
    ...f.env,
    MODERATION_MODE: mode,
    CAPTURE_ENABLED: '1',
    LIMITER: { idFromName: (id: string) => id, get: () => ({ hit }) },
    BUILD_JOB: { idFromName: (id: string) => id, get: () => ({ start }) },
  } as unknown as Env;
  const services = {
    store: {
      catalog: f.cat,
      setInflightJob: async (key: string, job: string) => {
        f.cache.set(`job:${key}`, job);
      },
      clearInflightJob: async (key: string, job: string) => {
        if (f.cache.get(`job:${key}`) === job) f.cache.delete(`job:${key}`);
      },
    },
    policy: { resolver: { resolve: async () => ['93.184.215.14'] } },
    settings: { buildLimitPerHour: 10, globalBuildLimitPerHour: 100 },
    log: { warn },
  } as unknown as Pick<Services, 'store' | 'policy' | 'settings' | 'log'>;
  const input = {
    cacheKey: 'key',
    runId: 'a',
    url: 'https://example.com/',
    difficulty: 'normal' as const,
    seed: 42,
    ip: '192.0.2.1',
  };
  const refresh = () => scheduleRefresh(env, services, input);
  return { ...f, env, services, input, start, hit, warn, refresh };
}
describe('bounded background freshness refresh', () => {
  test('queues one stale auto-mode refresh across concurrent hits while serving the approved version', async () => {
    const f = await setup();
    await Promise.all([f.refresh(), f.refresh()]);
    expect(f.start).toHaveBeenCalledTimes(1);
    expect(f.hit).toHaveBeenCalledTimes(2);
    expect(await f.cat.resolveVariant('key')).toBe('a');
    expect(f.cache.get('job:key')).toBeTruthy();
    expect((await f.cat.detail('a'))?.refreshRequested).toBe(true);
    const attempt = f.sqlite.prepare('SELECT status FROM capture_attempts').get();
    expect(attempt).toMatchObject({ status: 'queued' });
  });
  test('manual mode and fresh captures never launch browser jobs', async () => {
    const manual = await setup({ mode: 'manual' });
    await manual.refresh();
    expect(manual.start).not.toHaveBeenCalled();
    const fresh = await setup({ age: 6 });
    await fresh.refresh();
    expect(fresh.start).not.toHaveBeenCalled();
  });
  test('provider failures and pending captures throttle repeated refreshes', async () => {
    const f = await setup();
    await f.cat.recordAttempt({ jobId: 'failed', url: f.input.url, status: 'failed' });
    await f.refresh();
    expect(f.start).not.toHaveBeenCalled();
    f.sqlite.exec("UPDATE capture_attempts SET updated_at='2026-09-20T00:00:00Z'");
    f.run('pending');
    await f.record('pending', 'pending_review');
    await f.refresh();
    expect(f.start).not.toHaveBeenCalled();
  });
  test('capture kill, policy block, and capacity limits skip refresh without replacing old artifacts', async () => {
    const f = await setup();
    f.cache.set('kill:capture', '1');
    await f.refresh();
    expect(f.start).not.toHaveBeenCalled();
    f.cache.delete('kill:capture');
    await f.cat.setRule('url', f.input.url, true, 'Blocked', 'operator');
    await f.refresh();
    expect(f.start).not.toHaveBeenCalled();
    const limited = await setup({ limit: false });
    await limited.refresh();
    expect(limited.start).not.toHaveBeenCalled();
    expect(limited.sqlite.prepare('SELECT * FROM build_claims').all()).toEqual([]);
    expect(await limited.cat.resolveVariant('key')).toBe('a');
  });
  test('start failure clears owned claims and KV, records failure, and clears refresh indicator', async () => {
    const f = await setup();
    f.start.mockRejectedValueOnce(new Error('DO unavailable'));
    await f.refresh();
    expect(f.warn).toHaveBeenCalled();
    expect(f.sqlite.prepare('SELECT * FROM build_claims').all()).toEqual([]);
    expect(f.cache.has('job:key')).toBe(false);
    expect((await f.cat.detail('a'))?.refreshRequested).toBe(false);
    expect(f.sqlite.prepare('SELECT status FROM capture_attempts').get()).toMatchObject({ status: 'failed' });
    await f.refresh();
    expect(f.start).toHaveBeenCalledTimes(1);
    expect(await f.cat.resolveVariant('key')).toBe('a');
  });
  test('terminal moderation attempt clears refresh indicator, retaining history', async () => {
    const f = await setup();
    await f.refresh();
    await f.cat.recordAttempt({
      jobId: 'completion',
      url: f.input.url,
      status: 'pending_review',
      runId: 'pending',
    });
    expect((await f.cat.detail('a'))?.refreshRequested).toBe(false);
    expect((await f.cat.detail('a'))?.events.some((e) => e.action === 'request-refresh')).toBe(true);
  });
  test('DNS policy refusal and other job ownership do not consume build capacity', async () => {
    const f = await setup();
    f.services.policy.resolver = { resolve: async () => ['127.0.0.1'] };
    await f.refresh();
    expect(f.start).not.toHaveBeenCalled();
    expect(f.hit).not.toHaveBeenCalled();
    f.services.policy.resolver = { resolve: async () => ['93.184.215.14'] };
    await f.cat.claimBuild('key', 'other-job');
    await f.refresh();
    expect(f.hit).not.toHaveBeenCalled();
    expect(await f.cat.claimBuild('key', 'next')).toBe('other-job');
  });
});
