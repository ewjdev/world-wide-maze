import { Hono } from 'hono';
import { readJsonCapped } from '../security.ts';
import type { AdminEnv } from './admin.ts';

export const jevAdminRoutes = new Hono<AdminEnv>();
// Parent router verifies Cloudflare Access JWT and the admin email allowlist on every request.
jevAdminRoutes.all('*', async (c) => {
  const method = c.req.method;
  if (!['GET', 'POST'].includes(method)) return c.json({ error: 'Method not allowed' }, 405);
  if (method === 'POST') {
    if (c.req.header('origin') !== new URL(c.req.url).origin)
      return c.json({ error: 'Same-origin request required' }, 403);
    if (c.req.header('content-type') !== 'application/json') return c.json({ error: 'JSON required' }, 415);
  }
  const url = new URL(c.req.url);
  const path = url.pathname.slice('/api/admin/jev'.length);
  const value =
    method === 'POST'
      ? await readJsonCapped(c.req.raw, path === '/runs' ? 4 * 1024 * 1024 : 65536)
      : undefined;
  const stub = c.env.JEV_CONTROL.get(c.env.JEV_CONTROL.idFromName('jev-admin-v1'));
  const result = await stub.operation(method, path, url.search, value, c.get('adminEmail'));
  return Response.json(result.data, {
    status: result.status,
    headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
});
