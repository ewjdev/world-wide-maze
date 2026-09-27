import { type AdminAuthConfig, authenticateAdmin } from '../admin-auth.ts';
import { SPA_SECURITY_HEADERS } from '../security.ts';

/** Authenticate before asking the asset binding for any admin HTML. */
export async function serveAdminPage(
  request: Request,
  env: AdminAuthConfig & { ASSETS?: Pick<Fetcher, 'fetch'> },
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== '/admin' && !path.startsWith('/admin/')) return null;
  const privateHeaders = { 'Cache-Control': 'private, no-store' };
  if (!(await authenticateAdmin(request, env)))
    return new Response('Operator authentication required', { status: 401, headers: privateHeaders });
  if (!env.ASSETS)
    return new Response('Admin app assets unavailable', { status: 503, headers: privateHeaders });
  const shell = await env.ASSETS.fetch(request);
  const headers = new Headers(shell.headers);
  for (const [name, value] of Object.entries(SPA_SECURITY_HEADERS)) headers.set(name, value);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(shell.body, { status: shell.status, headers });
}
