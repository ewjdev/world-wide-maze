import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
test('offline practice does not issue dynamic requests but still loads bundled assets', async () => {
  vi.stubGlobal('location', { search: '?offline=1' });
  const fetcher = vi.fn(async () => new Response('asset'));
  vi.stubGlobal('fetch', fetcher);
  const { serviceFetch } = await import('./service-mode.ts');
  expect((await serviceFetch('/api/rooms', { method: 'POST' })).status).toBe(429);
  expect(fetcher).not.toHaveBeenCalled();
  expect(await (await serviceFetch('/assets/practice.png')).text()).toBe('asset');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test('a server shutdown response suppresses subsequent API attempts for this page session', async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 429, headers: { 'x-wwm-mode': 'static' } }));
  vi.stubGlobal('fetch', fetcher);
  const { serviceFetch, servicesResting } = await import('./service-mode.ts');
  await serviceFetch('/api/rooms');
  expect(servicesResting()).toBe(true);
  await serviceFetch('/api/scores');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
