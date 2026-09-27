import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';

type Worker = Awaited<ReturnType<typeof import('wrangler').unstable_startWorker>>;
let worker: Worker;
beforeAll(async () => {
  const { unstable_startWorker } = await import('wrangler');
  worker = await unstable_startWorker({
    config: fileURLToPath(new URL('./jev-runtime/wrangler.jsonc', import.meta.url)),
    dev: { server: { hostname: '127.0.0.1', port: 0 }, inspector: false, persist: false, logLevel: 'warn' },
  });
  await worker.ready;
}, 60000);
afterAll(async () => {
  await worker?.dispose();
});
async function request(path: string, body?: unknown) {
  const response = await worker.fetch(
    new URL(path, await worker.url),
    body === undefined
      ? {}
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  expect(response.status).toBeLessThan(300);
  return response.json() as Promise<Record<string, unknown>>;
}
test('real workerd SQL and RPC round trip: off by default, persisted settings, owned run and private journal', async () => {
  expect(await request('/settings')).toMatchObject({
    configured: false,
    available: false,
    budget: { enabled: false, dailyLimitMicros: 0 },
  });
  expect(await request('/settings', { enabled: true, dailyLimitCents: 1 })).toMatchObject({
    available: false,
    budget: { enabled: true, dailyLimitMicros: 10000 },
  });
  expect(await request('/settings')).toMatchObject({ budget: { dailyLimitMicros: 10000 } });
  const run = await request('/runs', {
    fixture: 'first-fork',
    policy: 'baseline',
    orderSeed: 0,
    documentId: 'test-document',
  });
  const auth = { owner: run.owner, documentId: 'test-document', epoch: 0 };
  await request(`/runs/${run.id}/command`, { ...auth, type: 'status', data: { status: 'running' } });
  expect(await request(`/runs/${run.id}/command`, { ...auth, type: 'heartbeat', data: {} })).toMatchObject({
    ok: true,
  });
  await request(`/runs/${run.id}/command`, { ...auth, type: 'status', data: { status: 'stopped' } });
  const detail = await request(`/runs/${run.id}`);
  expect(detail).toMatchObject({ summary: { status: 'stopped' } });
  expect(JSON.stringify(detail)).not.toContain(run.owner);
  expect(await request('/runs')).toMatchObject({ total: 1, runs: [{ id: run.id, status: 'stopped' }] });
  await request('/settings', { enabled: false, dailyLimitCents: 0 });
}, 30000);
