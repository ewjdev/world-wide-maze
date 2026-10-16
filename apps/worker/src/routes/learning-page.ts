import { SPA_SECURITY_HEADERS } from '../security.ts';

/** Only this authored teaching surface needs inline SVG layout styles; scripts remain self-only. */
export const LEARNING_SECURITY_HEADERS = {
  ...SPA_SECURITY_HEADERS,
  'content-security-policy':
    SPA_SECURITY_HEADERS['content-security-policy']?.replace(
      "style-src 'self'",
      "style-src 'self' 'unsafe-inline'",
    ) ?? '',
};

export async function serveLearningPage(
  request: Request,
  env: { ASSETS?: Pick<Fetcher, 'fetch'> },
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/learn' && !url.pathname.startsWith('/learn/')) return null;
  if (!['GET', 'HEAD'].includes(request.method))
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  if (url.pathname === '/learn') {
    url.pathname = '/learn/';
    return Response.redirect(url, 308);
  }
  if (!env.ASSETS) return new Response('Learning assets unavailable', { status: 503 });
  const asset = await env.ASSETS.fetch(request);
  const headers = new Headers(asset.headers);
  for (const [name, value] of Object.entries(LEARNING_SECURITY_HEADERS)) headers.set(name, value);
  const pack = /^\/learn\/lesson-packs\/([a-z0-9-]+)(?:\.html)?$/.exec(url.pathname);
  if (pack && asset.ok) headers.set('content-disposition', `attachment; filename="${pack[1]}.html"`);
  return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
}
