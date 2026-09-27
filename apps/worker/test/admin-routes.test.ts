import { Hono } from 'hono';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { runCacheKey } from '../src/ids.ts';
import { adminRoutes } from '../src/routes/admin.ts';
import { fixture } from './helpers/catalog-fixture.ts';

vi.mock('../src/admin-auth.ts', () => ({
  authenticateAdmin: vi.fn(async () => ({ email: 'operator@example.com' })),
}));
const fixtures: ReturnType<typeof fixture>[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) f.close();
});
function setup() {
  const f = fixture();
  fixtures.push(f);
  const start = vi.fn(async () => {});
  const env = {
    ...f.env,
    ADMIN_ACCESS_TEAM_DOMAIN: 'maze.cloudflareaccess.com',
    ADMIN_ACCESS_AUD: 'app',
    ADMIN_EMAILS: 'operator@example.com',
    BUILD_JOB: { idFromName: (id: string) => id, get: () => ({ start }) },
    LIMITER: { idFromName: (id: string) => id, get: () => ({ hit: async () => ({ ok: true }) }) },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set(
      'services' as never,
      {
        policy: { resolver: { resolve: async () => ['93.184.215.14'] } },
        builder: { version: 'v2' },
        settings: { buildLimitPerHour: 10, globalBuildLimitPerHour: 600 },
      } as never,
    );
    await next();
  });
  app.route('/api/admin', adminRoutes);
  const request = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    app.request(
      `https://maze.example/api/admin${path}`,
      {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: { 'content-type': 'application/json', ...headers },
      },
      env,
    );
  return { ...f, start, request };
}
describe('authenticated admin operations using real migrated SQLite', () => {
  test('catalog, private evidence, decision, rule reversal and audit trail', async () => {
    const f = setup();
    f.run('a');
    await f.record('a', 'pending_review');
    const list = await f.request('/catalog?status=pending_review');
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ items: [{ runId: 'a', status: 'pending_review' }] });
    expect((await f.request('/runs/a')).status).toBe(200);
    const evidence = await f.request('/runs/a/evidence/texture-0');
    expect(evidence.status).toBe(200);
    expect(evidence.headers.get('content-type')).toBe('image/png');
    expect(evidence.headers.get('cache-control')).toBe('private, no-store');
    expect((await f.request('/runs/a/evidence/stage-other')).status).toBe(404);
    expect(
      (await f.request('/runs/a/decision', 'POST', { status: 'approved', reason: 'All evidence reviewed' }))
        .status,
    ).toBe(200);
    expect(await f.cat.canServeRun('a')).toBe(true);
    expect(
      (
        await f.request('/rules', 'POST', {
          scope: 'domain',
          target: 'example.com',
          blocked: true,
          reason: 'Operator block',
        })
      ).status,
    ).toBe(200);
    expect(await f.cat.canServeRun('a')).toBe(false);
    expect(
      (await f.request('/runs/a/decision', 'POST', { status: 'approved', reason: 'Cannot override rule' }))
        .status,
    ).toBe(400);
    expect(
      (
        await f.request('/rules', 'POST', {
          scope: 'domain',
          target: 'example.com',
          blocked: false,
          reason: 'Appeal upheld',
        })
      ).status,
    ).toBe(200);
    expect(await f.cat.canServeRun('a')).toBe(true);
    expect((await f.cat.detail('a'))?.events).toContainEqual(
      expect.objectContaining({ actor: 'operator@example.com', action: 'decision:approved' }),
    );
  });
  test('blocked capture evidence includes slice textures without built stages', async () => {
    const f = setup();
    f.run('a');
    await f.record('a', 'blocked');
    f.sqlite.exec('DELETE FROM stages');
    const detail = (await (await f.request('/runs/a')).json()) as { textures: unknown[] };
    expect(detail.textures).toHaveLength(1);
    expect((await f.request('/runs/a/evidence/texture-0')).status).toBe(200);
    expect(
      (await f.request('/runs/a/decision', 'POST', { status: 'approved', reason: 'Review' })).status,
    ).toBe(400);
  });
  test('refresh queues a deduplicated current-builder job and retains approved old version', async () => {
    const f = setup();
    f.run('a');
    await f.record('a');
    const response = await f.request('/runs/a/refresh', 'POST', { reason: 'Page changed' });
    expect(response.status).toBe(202);
    const second = await f.request('/runs/a/refresh', 'POST', { reason: 'Retry request' });
    expect(await second.json()).toEqual(await response.json());
    expect(f.start).toHaveBeenCalledTimes(1);
    expect(f.start).toHaveBeenCalledWith(
      expect.objectContaining({ cacheKey: await runCacheKey('https://example.com/', 'normal', 'v2', 42) }),
    );
    expect(await f.cat.resolveVariant('key')).toBe('a');
  });
  test('failed operator refresh records a generic attempt and clears pending indicators and claim', async () => {
    const f = setup();
    f.run('a');
    await f.record('a');
    f.start.mockRejectedValueOnce(new Error('secret provider failure'));
    const response = await f.request('/runs/a/refresh', 'POST', { reason: 'Retry page' });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Admin operation failed' });
    expect((await f.cat.detail('a'))?.refreshRequested).toBe(false);
    expect(f.sqlite.prepare('SELECT * FROM build_claims').all()).toEqual([]);
    expect(f.sqlite.prepare('SELECT status,reason FROM capture_attempts').get()).toEqual(
      expect.objectContaining({ status: 'failed', reason: 'Operator refresh could not be queued' }),
    );
    expect(await f.cat.resolveVariant('key')).toBe('a');
  });
  test('invalid opaque pagination cursors return a validation error', async () => {
    const f = setup();
    expect((await f.request('/catalog?cursor=bad')).status).toBe(400);
    expect((await f.request('/attempts?cursor=bad')).status).toBe(400);
  });
  test('removal and attempts are visible; removed evidence cannot be fetched or approved', async () => {
    const f = setup();
    f.run('a');
    await f.record('a');
    await f.cat.recordAttempt({
      jobId: 'job',
      url: 'https://failed.com/',
      status: 'failed',
      reason: 'Timeout',
    });
    expect(await (await f.request('/attempts')).json()).toMatchObject({
      items: [{ jobId: 'job', status: 'failed' }],
    });
    expect((await f.request('/runs/a/remove', 'POST', { reason: 'Remove content' })).status).toBe(200);
    expect((await f.request('/runs/a/evidence/screenshot')).status).toBe(404);
    expect(
      (await f.request('/runs/a/decision', 'POST', { status: 'approved', reason: 'Restore' })).status,
    ).toBe(400);
  });
  test('mutation rejects cross-origin, invalid reason, oversized body and malformed inputs', async () => {
    const f = setup();
    f.run('a');
    await f.record('a');
    expect(
      (await f.request('/runs/a/remove', 'POST', { reason: 'Forged' }, { origin: 'https://evil.example' }))
        .status,
    ).toBe(403);
    expect(
      (await f.request('/runs/a/remove', 'POST', { reason: 'Forged' }, { 'sec-fetch-site': 'cross-site' }))
        .status,
    ).toBe(403);
    expect((await f.request('/runs/a/remove', 'POST', { reason: '' })).status).toBe(400);
    expect((await f.request('/runs/a/remove', 'POST', { reason: 'x'.repeat(5000) })).status).toBe(413);
    expect(
      (
        await f.request('/rules', 'POST', {
          scope: 'domain',
          target: 'example.com/path',
          blocked: true,
          reason: 'Invalid target',
        })
      ).status,
    ).toBe(400);
    expect((await f.request('/runs/a/decision', 'POST', { status: 'foo', reason: 'Invalid' })).status).toBe(
      400,
    );
    expect(await f.cat.canServeRun('a')).toBe(true);
  });
  test('database failures return generic errors without leaking SQL', async () => {
    const f = setup();
    f.sqlite.exec('DROP TABLE moderation_cases');
    const response = await f.request('/catalog');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Admin operation failed' });
  });
});
