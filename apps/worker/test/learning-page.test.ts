import { describe, expect, it, vi } from 'vitest';
import { serveLearningPage } from '../src/routes/learning-page.ts';
import { SPA_SECURITY_HEADERS } from '../src/security.ts';

describe('published learning pages', () => {
  const request = (path: string, method = 'GET') => new Request(`https://wwm.example${path}`, { method });
  it('leaves other routes alone and only serves GET/HEAD', async () => {
    expect(await serveLearningPage(request('/'), {})).toBeNull();
    expect((await serveLearningPage(request('/learn/', 'POST'), {}))?.status).toBe(405);
    expect((await serveLearningPage(request('/learn'), {}))?.headers.get('location')).toBe(
      'https://wwm.example/learn/',
    );
    expect((await serveLearningPage(request('/learn/'), {}))?.status).toBe(503);
  });
  it('streams assets with scoped inline styles and no inline scripts, preserving cache validators', async () => {
    const fetch = vi.fn(
      async () =>
        new Response('<h1>Hola</h1>', {
          headers: {
            etag: 'lesson-v1',
            'content-type': 'text/html',
            'content-security-policy': SPA_SECURITY_HEADERS['content-security-policy'] ?? '',
          },
        }),
    );
    const response = await serveLearningPage(request('/learn/lessons/spanish-hello/'), { ASSETS: { fetch } });
    expect(await response?.text()).toBe('<h1>Hola</h1>');
    expect(response?.headers.get('etag')).toBe('lesson-v1');
    const csp = response?.headers.get('content-security-policy');
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(SPA_SECURITY_HEADERS['content-security-policy']).toContain("style-src 'self';");
  });
  it('makes portable packs download as HTML and preserves asset error responses', async () => {
    const fetch = vi.fn(async () => new Response('pack'));
    const response = await serveLearningPage(request('/learn/lesson-packs/spanish-hello.html'), {
      ASSETS: { fetch },
    });
    expect(response?.headers.get('content-disposition')).toBe('attachment; filename="spanish-hello.html"');
    fetch.mockImplementation(async () => new Response('missing', { status: 404 }));
    expect((await serveLearningPage(request('/learn/missing'), { ASSETS: { fetch } }))?.status).toBe(404);
  });
  it('lets only the family account pages load Turnstile', async () => {
    const fetch = vi.fn(
      async () => new Response('<h1>Account</h1>', { headers: { 'content-type': 'text/html' } }),
    );
    const account = await serveLearningPage(request('/learn/account/verify'), { ASSETS: { fetch } });
    const csp = account?.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'self' https://challenges.cloudflare.com 'wasm-unsafe-eval'");
    expect(csp).toContain('frame-src https://challenges.cloudflare.com;');
    expect(csp).toContain("frame-ancestors 'none'");
    const lesson = await serveLearningPage(request('/learn/lessons/spanish-hello/'), { ASSETS: { fetch } });
    expect(lesson?.headers.get('content-security-policy')).not.toContain('challenges.cloudflare.com');
  });
});
