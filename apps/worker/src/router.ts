/**
 * Tiny, runtime-agnostic request handling (no `cloudflare:*` imports) so it can be unit tested in Node.
 * Phase 07 replaces this with the real API (contracts §7).
 */
import { CONTRACT_VERSION } from '@wwm/schema';

export function handleBasic(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.pathname === '/api/health') {
    return Response.json({ ok: true, contract: CONTRACT_VERSION });
  }
  return null;
}
