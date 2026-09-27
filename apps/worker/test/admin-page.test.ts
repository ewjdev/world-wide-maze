import { beforeEach, expect, test, vi } from 'vitest';
import { authenticateAdmin } from '../src/admin-auth.ts';
import { serveAdminPage } from '../src/routes/admin-page.ts';
import { SPA_SECURITY_HEADERS, withSecurityHeaders } from '../src/security.ts';

vi.mock('../src/admin-auth.ts', () => ({ authenticateAdmin: vi.fn() }));
const auth = vi.mocked(authenticateAdmin);
beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue(null);
});
test.each(['/admin', '/admin/jev'])('public requests for %s cannot read the app shell', async (path) => {
  const fetch = vi.fn();
  const response = await serveAdminPage(new Request(`https://maze.example${path}`), {
    ASSETS: { fetch },
  });
  expect(response?.status).toBe(401);
  expect(response?.headers.get('Cache-Control')).toBe('private, no-store');
  expect(fetch).not.toHaveBeenCalled();
});
test('authenticated admin HTML gets the app CSP even when the asset binding omits headers', async () => {
  auth.mockResolvedValue({ email: 'admin@example.com' });
  const request = new Request('https://maze.example/admin/jev');
  const fetch = vi.fn(
    async () =>
      new Response('<html>app</html>', {
        headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=3600' },
      }),
  );
  const shell = await serveAdminPage(request, { ASSETS: { fetch } });
  expect(shell).not.toBeNull();
  if (!shell) throw new Error('Missing response');
  const response = withSecurityHeaders(request, shell);
  expect(await response.text()).toContain('app');
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  for (const [name, value] of Object.entries(SPA_SECURITY_HEADERS))
    expect(response.headers.get(name)).toBe(value);
});
test('public paths remain public and missing assets fail privately', async () => {
  expect(await serveAdminPage(new Request('https://maze.example/'), {})).toBeNull();
  expect(auth).not.toHaveBeenCalled();
  auth.mockResolvedValue({ email: 'admin@example.com' });
  const response = await serveAdminPage(new Request('https://maze.example/admin'), {});
  expect(response?.status).toBe(503);
  expect(response?.headers.get('Cache-Control')).toBe('private, no-store');
});
