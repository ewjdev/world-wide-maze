/** Isolated manual test host: bundled gameplay assets only, with no online-service bindings. */
import { SPA_SECURITY_HEADERS, withSecurityHeaders } from './security.ts';

type StaticPreviewEnv = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  PREVIEW_COMMIT?: string;
};

export default {
  async fetch(request: Request, env: StaticPreviewEnv): Promise<Response> {
    const path = new URL(request.url).pathname;
    const headers = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };
    if (path === '/api/health' && ['GET', 'HEAD'].includes(request.method)) {
      return withSecurityHeaders(
        request,
        Response.json(
          { ok: true, contract: 'static-preview', mode: 'static', commit: env.PREVIEW_COMMIT ?? null },
          { headers },
        ),
      );
    }
    // Deny before touching assets, parsing bodies, or connecting a socket. There are no data/AI bindings.
    if (/^\/(?:api|s|r|j|admin|rooms?|ws)(?:\/|$)/.test(path)) {
      return withSecurityHeaders(
        request,
        path === '/api/t'
          ? new Response(null, { status: 204, headers })
          : Response.json(
              { code: 'RATE_LIMITED', message: 'This preview supports bundled practice and Race courses.' },
              { status: 429, headers: { ...headers, 'x-wwm-mode': 'static', 'retry-after': '60' } },
            ),
      );
    }
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    response.headers.set('x-robots-tag', 'noindex');
    if (response.headers.get('content-type')?.includes('text/html')) {
      for (const [key, value] of Object.entries(SPA_SECURITY_HEADERS)) {
        if (!response.headers.has(key)) response.headers.set(key, value);
      }
    }
    return response;
  },
};
