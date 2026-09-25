/**
 * Phase 12 hardening shared by every Worker response and request body.
 *
 * - `withSecurityHeaders()` adds the security headers to Worker-generated responses (API JSON, SSE, the share
 *   page, images). Static assets get theirs from `apps/web/public/_headers` (Workers static assets).
 * - `readJsonCapped()` reads a JSON body with a hard byte cap, whatever `content-length` claims (chunked bodies
 *   have none), so no route buffers an unbounded body.
 * - `clientIp()` is the one place that decides which IP a request is counted against.
 */

/** Largest body `POST /api/stages` reads (`{url ≤ 2048 chars, difficulty, seed}`). */
export const MAX_STAGE_REQUEST_BYTES = 8 * 1024;
/** Largest telemetry batch (50 small events). */
export const MAX_TELEMETRY_BYTES = 16 * 1024;

/** API responses never render as documents: nothing may load, nothing may frame them. */
const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
/** The share page (`/s/:id`): one inline <style>, a meta refresh, no scripts. */
const SHARE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export function securityHeadersFor(url: URL, contentType: string | null): Record<string, string> {
  const html = (contentType ?? '').includes('text/html');
  const h: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'DENY',
    'content-security-policy': html ? SHARE_CSP : API_CSP,
    'cross-origin-opener-policy': 'same-origin',
    // Share cards are fetched by social-network crawlers and may be embedded elsewhere; the rest is ours.
    'cross-origin-resource-policy': /^\/api\/share\/[^/]+\/card$/.test(url.pathname)
      ? 'cross-origin'
      : 'same-origin',
  };
  if (url.protocol === 'https:') h['strict-transport-security'] = 'max-age=31536000';
  return h;
}

/**
 * Returns `res` with the security headers set (existing values win, so a route can override). WebSocket
 * upgrades (101) are returned untouched.
 */
export function withSecurityHeaders(req: Request, res: Response): Response {
  if (res.status === 101 || (res as Response & { webSocket?: unknown }).webSocket) return res;
  const url = new URL(req.url);
  const add = securityHeadersFor(url, res.headers.get('content-type'));
  let out = res;
  try {
    for (const [k, v] of Object.entries(add)) if (!res.headers.has(k)) res.headers.set(k, v);
  } catch {
    // immutable headers (e.g. a fetched response): copy once
    out = new Response(res.body, res);
    for (const [k, v] of Object.entries(add)) if (!out.headers.has(k)) out.headers.set(k, v);
  }
  return out;
}

export class BodyTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`request body larger than ${limit} bytes`);
    this.name = 'BodyTooLargeError';
  }
}

/** Read at most `maxBytes` of `req`'s body as text; throws BodyTooLargeError beyond that. */
export async function readTextCapped(req: Request, maxBytes: number): Promise<string> {
  const declared = Number(req.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError(maxBytes);
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

/** JSON body with a byte cap: `null` for invalid JSON; throws BodyTooLargeError when too big. */
export async function readJsonCapped(req: Request, maxBytes: number): Promise<unknown> {
  const text = await readTextCapped(req, maxBytes);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export const tooLarge = (e: BodyTooLargeError) =>
  Response.json(
    { error: 'payload too large', message: e.message },
    { status: 413, headers: { 'cache-control': 'no-store' } },
  );

/**
 * The client key rate limits are counted against. On Cloudflare `cf-connecting-ip` is always set by the edge
 * and can't be spoofed by the client. Locally (wrangler dev, tests) it may be missing: everything is 'local'.
 * IPv6 clients are keyed on their /64: one subscriber usually holds a whole /64, so keying on the full
 * address would hand out 2^64 separate budgets.
 */
export function clientIp(req: Request): string {
  const ip = req.headers.get('cf-connecting-ip');
  return ip ? rateLimitKey(ip) : 'local';
}

/** IPv4 as is; IPv6 → its /64 prefix (`2001:db8:1:2::/64`). */
export function rateLimitKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [head = '', tail = ''] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = ip.includes('::')
    ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t]
    : h;
  if (groups.length < 4) return ip;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

/**
 * Cross-site request refusal for state-changing requests: browsers send `Sec-Fetch-Site`; a page on another
 * site must not be able to make its visitors create builds, rooms or scores (a `no-cors` text/plain POST needs
 * no preflight). Requests without the header (curl, server-to-server, old browsers) pass.
 */
export function isCrossSite(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  return site === 'cross-site';
}

export const crossSiteRefused = () =>
  Response.json(
    { error: 'forbidden', message: 'cross-site requests are not accepted' },
    { status: 403, headers: { 'cache-control': 'no-store' } },
  );
