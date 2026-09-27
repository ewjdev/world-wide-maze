import type { AdminRunDetail } from '@wwm/schema';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, test, vi } from 'vitest';
import AdminPage, { DecisionForm } from './AdminPage.tsx';
import { AdminError, adminApi, adminRequest, errorMessage } from './api.ts';

afterEach(() => vi.unstubAllGlobals());

describe('operator workspace', () => {
  test('initial render loads privately without embedding evidence or credentials', () => {
    const html = renderToString(<AdminPage />);
    expect(html).toContain('Loading catalog');
    expect(html).toContain('Pending review');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('type="password"');
  });

  test('artifact removal starts disabled and requires a reason and explicit confirmation', () => {
    const run = { runId: 'r1', host: 'example.com', url: 'https://example.com/' } as AdminRunDetail;
    const html = renderToString(
      <DecisionForm run={run} action="remove" onCancel={() => {}} onDone={() => {}} />,
    );
    expect(html).toContain('This cannot be undone');
    expect(html).toContain('required=""');
    expect(html).toContain('type="checkbox"');
    expect(html).toMatch(/type="submit" disabled=""/);
    expect(html).toContain('Cancel');
  });

  test('ancestor domain reversal displays the actual rule target', () => {
    const run = { runId: 'r1', host: 'sub.example.com', url: 'https://sub.example.com/' } as AdminRunDetail;
    const html = renderToString(
      <DecisionForm
        run={run}
        action="clear-domain"
        ruleTarget="example.com"
        onCancel={() => {}}
        onDone={() => {}}
      />,
    );
    expect(html).toContain('Applies to: </strong>example.com');
  });

  test.each([401, 403, 503])('HTTP %s explains operator recovery', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'unavailable' }, { status })));
    const error = await adminRequest('/catalog').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(AdminError);
    expect(errorMessage(error)).toMatch(status === 503 ? /configuration/ : /Operator access required/);
  });

  test('HTML sign-in responses cannot be treated as catalog data', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } }),
        ),
    );
    await expect(adminRequest('/catalog')).rejects.toMatchObject({ status: 401 });
  });

  test('mutations use same-origin cookies and no cache, with only the reviewed body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await adminApi.rule({
      scope: 'domain',
      target: 'example.com',
      blocked: true,
      reason: 'Reviewed evidence',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/rules',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        body: JSON.stringify({
          scope: 'domain',
          target: 'example.com',
          blocked: true,
          reason: 'Reviewed evidence',
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1].headers).not.toHaveProperty('Authorization');
  });

  test('search and opaque pagination values are encoded without changing URL identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ items: [], nextCursor: null }));
    vi.stubGlobal('fetch', fetchMock);
    await adminApi.catalog('https://example.com/?x=1&y=2', 'blocked', 'x/y+z');
    const url = new URL(fetchMock.mock.calls[0]?.[0] as string, 'http://localhost');
    expect(url.searchParams.get('q')).toBe('https://example.com/?x=1&y=2');
    expect(url.searchParams.get('cursor')).toBe('x/y+z');
    expect(url.searchParams.get('status')).toBe('blocked');
  });
});
