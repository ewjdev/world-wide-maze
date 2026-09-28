import { Hono } from 'hono';
import { beforeEach, expect, test, vi } from 'vitest';
import { authenticateAdmin } from '../src/admin-auth.ts';
import { adminRoutes } from '../src/routes/admin.ts';

vi.mock('../src/admin-auth.ts', () => ({ authenticateAdmin: vi.fn() }));
const auth = vi.mocked(authenticateAdmin);
beforeEach(() => auth.mockResolvedValue({ email: 'admin@example.com' }));
function setup() {
  const operation = vi.fn(async () => ({ status: 200, data: { enabled: false } }));
  const env = {
    ADMIN_ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
    ADMIN_ACCESS_AUD: 'app',
    ADMIN_EMAILS: 'admin@example.com',
    JEV_CONTROL: { idFromName: (s: string) => s, get: () => ({ operation }) },
  };
  const app = new Hono().route('/api/admin', adminRoutes);
  const request = (path = '/settings', method = 'GET', headers: Record<string, string> = {}, body = '{}') =>
    app.request(
      `https://maze.example/api/admin/jev${path}`,
      { method, headers, ...(method === 'POST' ? { body } : {}) },
      env,
    );
  return { request, operation, app, env };
}
test('every Jev endpoint rejects unauthenticated visitors before touching storage or provider', async () => {
  auth.mockResolvedValue(null);
  const s = setup();
  for (const [path, method] of [
    ['/settings', 'GET'],
    ['/settings', 'POST'],
    ['/session', 'GET'],
    ['/runs', 'GET'],
    ['/runs', 'POST'],
    ['/runs/abc/decide', 'POST'],
  ])
    expect((await s.request(path, method)).status).toBe(401);
  expect(s.operation).not.toHaveBeenCalled();
  expect((await s.app.request('https://maze.example/api/jev/runs', {}, s.env)).status).toBe(404);
});
test('admin writes require exact origin and JSON; valid calls carry the verified actor', async () => {
  const s = setup();
  expect((await s.request('/settings', 'POST')).status).toBe(403);
  expect((await s.request('/settings', 'POST', { origin: 'https://evil.example' })).status).toBe(403);
  expect((await s.request('/settings', 'POST', { origin: 'https://maze.example' })).status).toBe(415);
  expect(s.operation).not.toHaveBeenCalled();
  const response = await s.request(
    '/settings',
    'POST',
    { origin: 'https://maze.example', 'content-type': 'application/json' },
    JSON.stringify({ enabled: true, dailyLimitCents: 100 }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(s.operation).toHaveBeenCalledWith(
    'POST',
    '/settings',
    '',
    { enabled: true, dailyLimitCents: 100 },
    'admin@example.com',
  );
});
test('oversized mutations fail before forwarding to the object', async () => {
  const s = setup();
  expect(
    (
      await s.request(
        '/settings',
        'POST',
        { origin: 'https://maze.example', 'content-type': 'application/json' },
        JSON.stringify({ text: 'x'.repeat(66000) }),
      )
    ).status,
  ).toBe(413);
  expect(s.operation).not.toHaveBeenCalled();
});
