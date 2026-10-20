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

/**
 * Phase 31 M3: the family account pages also load Cloudflare Turnstile (script and iframe from one origin), and
 * nothing else; every other learning page keeps the stricter policy.
 */
const TURNSTILE = 'https://challenges.cloudflare.com';
export const ACCOUNT_SECURITY_HEADERS = {
  ...LEARNING_SECURITY_HEADERS,
  'content-security-policy': `${LEARNING_SECURITY_HEADERS['content-security-policy']
    .replace("script-src 'self'", `script-src 'self' ${TURNSTILE}`)
    .replace("object-src 'none'", `frame-src ${TURNSTILE}; object-src 'none'`)}`,
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
  const policy = url.pathname.startsWith('/learn/account/')
    ? ACCOUNT_SECURITY_HEADERS
    : LEARNING_SECURITY_HEADERS;
  for (const [name, value] of Object.entries(policy)) headers.set(name, value);
  const pack = /^\/learn\/lesson-packs\/([a-z0-9-]+)(?:\.html)?$/.exec(url.pathname);
  if (pack && asset.ok) headers.set('content-disposition', `attachment; filename="${pack[1]}.html"`);
  return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
}
