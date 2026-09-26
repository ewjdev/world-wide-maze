/** Phase 12 hardening: headers, body caps, rate-limit keys, IP hashing, telemetry sanitising, deploy config. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { parseJsonc } from '../../../infra/scripts/lib/cloudflare-infra.mjs';
import { hashIp, ipHashSecret } from '../src/routes/scores-rules.ts';
import {
  BodyTooLargeError,
  clientIp,
  isCrossSite,
  rateLimitKey,
  readJsonCapped,
  readTextCapped,
  SPA_SECURITY_HEADERS,
  securityHeadersFor,
  withSecurityHeaders,
} from '../src/security.ts';

const here = dirname(fileURLToPath(import.meta.url));

describe('security headers', () => {
  test('API responses: nosniff, no framing, a CSP that loads nothing', () => {
    const h = securityHeadersFor(new URL('https://wwm.example/api/stages/abc'), 'application/json');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['content-security-policy']).toContain("default-src 'none'");
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['cross-origin-resource-policy']).toBe('same-origin');
    expect(h['strict-transport-security']).toBe('max-age=31536000');
  });
  test('share page allows its inline style only; share cards are cross-origin readable', () => {
    const page = securityHeadersFor(new URL('http://x/s/abc'), 'text/html; charset=UTF-8');
    expect(page['content-security-policy']).toContain("style-src 'unsafe-inline'");
    expect(page['content-security-policy']).not.toContain('script-src');
    expect(page['strict-transport-security']).toBeUndefined();
    const card = securityHeadersFor(new URL('http://x/api/share/abc/card'), 'image/png');
    expect(card['cross-origin-resource-policy']).toBe('cross-origin');
    const rendered = securityHeadersFor(
      new URL('http://x/api/cards/score/AbCdEfGhIjKlMnOp.png'),
      'image/png',
    );
    expect(rendered['cross-origin-resource-policy']).toBe('cross-origin');
  });
  test('the SPA shell the Worker serves (/, /log, /j/*) carries exactly the app headers from _headers', () => {
    const file = readFileSync(resolve(here, '../../web/public/_headers'), 'utf8');
    const block = file.split(/\n(?=\S)/).find((b) => b.startsWith('/*\n')) ?? '';
    const fromFile = Object.fromEntries(
      block
        .split('\n')
        .slice(1)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const i = l.indexOf(':');
          return [l.slice(0, i).toLowerCase(), l.slice(i + 1).trim()];
        }),
    );
    expect(Object.keys(fromFile).length).toBeGreaterThan(5);
    expect(SPA_SECURITY_HEADERS).toEqual(fromFile);
  });
  test('withSecurityHeaders keeps route overrides and copies immutable responses', async () => {
    const req = new Request('http://x/api/health');
    const res = withSecurityHeaders(req, Response.json({}, { headers: { 'x-frame-options': 'SAMEORIGIN' } }));
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const immutable = await fetch('data:text/plain,hi').catch(() => null);
    if (immutable)
      expect(withSecurityHeaders(req, immutable).headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('body caps', () => {
  const chunked = (bytes: number) =>
    new Request('http://x/', {
      method: 'POST',
      body: new ReadableStream({
        start(c) {
          for (let i = 0; i < bytes; i += 1000) c.enqueue(new Uint8Array(Math.min(1000, bytes - i)).fill(32));
          c.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);

  test('a declared content-length over the cap is refused before reading', async () => {
    const req = new Request('http://x/', {
      method: 'POST',
      body: 'x'.repeat(10),
      headers: { 'content-length': '999999' },
    });
    await expect(readTextCapped(req, 100)).rejects.toBeInstanceOf(BodyTooLargeError);
  });
  test('a chunked body without content-length is cut off at the cap', async () => {
    await expect(readTextCapped(chunked(5000), 4096)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect((await readTextCapped(chunked(3000), 4096)).length).toBe(3000);
  });
  test('invalid JSON is null, valid JSON parses', async () => {
    expect(await readJsonCapped(new Request('http://x/', { method: 'POST', body: '{nope' }), 100)).toBeNull();
    expect(await readJsonCapped(new Request('http://x/', { method: 'POST', body: '{"a":1}' }), 100)).toEqual({
      a: 1,
    });
  });
});

describe('rate-limit keys and cross-site refusal', () => {
  test('IPv4 as is, IPv6 by /64', () => {
    expect(rateLimitKey('203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(rateLimitKey('2001:DB8:0001:0002::1')).toBe('2001:db8:1:2::/64');
    expect(rateLimitKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(rateLimitKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientIp(new Request('http://x/'))).toBe('local');
    expect(clientIp(new Request('http://x/', { headers: { 'cf-connecting-ip': '2001:db8:1:2::9' } }))).toBe(
      '2001:db8:1:2::/64',
    );
  });
  test('only Sec-Fetch-Site: cross-site is refused', () => {
    const r = (site?: string) =>
      new Request('http://x/', { method: 'POST', headers: site ? { 'sec-fetch-site': site } : {} });
    expect(isCrossSite(r('cross-site'))).toBe(true);
    expect(isCrossSite(r('same-origin'))).toBe(false);
    expect(isCrossSite(r('same-site'))).toBe(false);
    expect(isCrossSite(r())).toBe(false);
  });
});

describe('IP hashes', () => {
  test('keyed by the secret, rotating daily, 32 hex chars', async () => {
    const day = new Date('2026-09-25T12:00:00Z');
    const a = await hashIp('203.0.113.7', 'secret-one-0123456789', day);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(await hashIp('203.0.113.7', 'secret-one-0123456789', day)).toBe(a);
    expect(await hashIp('203.0.113.7', 'secret-two-0123456789', day)).not.toBe(a);
    expect(await hashIp('203.0.113.7', 'secret-one-0123456789', new Date('2026-09-26T12:00:00Z'))).not.toBe(
      a,
    );
  });
  test('short or missing secrets fall back to the dev default', () => {
    expect(ipHashSecret({ IP_HASH_SALT: 'x'.repeat(32) })).toBe('x'.repeat(32));
    expect(ipHashSecret({ IP_HASH_SALT: 'short' })).toBe(ipHashSecret({}));
  });
  test('deployed environments fail closed without the secret', () => {
    expect(ipHashSecret({ WWM_ENV: 'production' })).toBeNull();
    expect(ipHashSecret({ WWM_ENV: 'staging', IP_HASH_SALT: 'short' })).toBeNull();
    expect(ipHashSecret({ WWM_ENV: 'preview' })).toBeNull();
    expect(ipHashSecret({ WWM_ENV: 'development' })).not.toBeNull();
    expect(ipHashSecret({ WWM_ENV: 'production', IP_HASH_SALT: 'y'.repeat(32) })).toBe('y'.repeat(32));
  });
});

describe('deploy config (wrangler.jsonc)', () => {
  const cfg = parseJsonc(readFileSync(resolve(here, '../wrangler.jsonc'), 'utf8')) as {
    vars: Record<string, string>;
    env: Record<string, DeployTarget & { previews?: DeployTarget; assets: { run_worker_first: string[] } }>;
  };
  type DeployTarget = { vars: Record<string, string>; ratelimits: { name: string }[] };
  const prod = cfg.env.production;
  test.each([
    ['production', prod, 'production'],
    ['previews', prod?.previews, 'preview'],
  ] as const)('%s: dev-only switches are off and abuse caps are bound', (_name, target, wwmEnv) => {
    expect(target).toBeDefined();
    if (!target) return;
    expect(target.vars.ROOM_STATS).toBe('0');
    expect(target.vars.DEV_ALLOWED_HOSTS).toBe('');
    expect(target.vars.TELEMETRY_INGEST).toBe(wwmEnv === 'production' ? '1' : '0');
    expect(target.vars.TELEMETRY_DEBUG).toBe('0');
    expect(target.vars.POSTHOG_TOKEN?.startsWith('phc_') ?? false).toBe(wwmEnv === 'production');
    expect(target.vars.CAPTURE_BACKEND).toBe('browser-run');
    expect(target.vars.WWM_ENV).toBe(wwmEnv);
    // every top-level var is redeclared (vars are inherited neither by environments nor by Previews)
    expect(Object.keys(target.vars).sort()).toEqual(Object.keys(cfg.vars).sort());
    expect(target.ratelimits.map((r) => r.name).sort()).toEqual([
      'READ_LIMITER',
      'ROOM_CREATE_LIMITER',
      'ROOM_WS_LIMITER',
    ]);
  });
  test('production serves the web app with the API first', () => {
    // Phase 18: + score permalinks (/r/*) and the app routes with their own link-preview card (/, /log, /j/*)
    expect(prod?.assets.run_worker_first).toEqual(['/api/*', '/s/*', '/r/*', '/j/*', '/', '/log']);
  });
});
