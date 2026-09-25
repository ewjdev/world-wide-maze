/** Phase 12 hardening: headers, body caps, rate-limit keys, IP hashing, telemetry sanitising, deploy config. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { hashIp, ipHashSecret } from '../src/routes/scores-rules.ts';
import { sanitizeTelemetry } from '../src/routes/telemetry-rules.ts';
import {
  BodyTooLargeError,
  clientIp,
  isCrossSite,
  rateLimitKey,
  readJsonCapped,
  readTextCapped,
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
});

describe('telemetry ingest', () => {
  test('keeps only allow-listed events and fields', () => {
    const out = sanitizeTelemetry({
      events: [
        {
          name: 'played',
          input: 'phone',
          run: 'fixture',
          slice: 2,
          visit: '0123456789abcdef',
          ms: 10,
          url: 'https://x',
        },
        { name: 'build_failed', code: 'UNPLAYABLE', name2: 'x' },
        { name: 'build_failed', code: 'lowercase<script>' },
        { name: 'evil' },
        'junk',
      ],
    });
    expect(out).toEqual([
      { event: 'played', input: 'phone', run: 'fixture', slice: 2, visit: '0123456789abcdef', ms: 10 },
      { event: 'build_failed', code: 'UNPLAYABLE' },
      { event: 'build_failed' },
    ]);
    expect(sanitizeTelemetry(null)).toEqual([]);
    expect(sanitizeTelemetry({ events: Array(80).fill({ name: 'title' }) })).toHaveLength(50);
  });
});

describe('deploy config (wrangler.jsonc)', () => {
  // JSONC → JSON: drop comments (none of our strings contain "//").
  const cfg = JSON.parse(
    readFileSync(resolve(here, '../wrangler.jsonc'), 'utf8')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,(\s*[}\]])/g, '$1'),
  ) as {
    vars: Record<string, string>;
    env: Record<
      string,
      { vars: Record<string, string>; ratelimits: { name: string }[]; assets: { run_worker_first: string[] } }
    >;
  };
  test.each(['staging', 'production'])('%s: dev-only switches are off and abuse caps are bound', (name) => {
    const env = cfg.env[name];
    expect(env).toBeDefined();
    if (!env) return;
    expect(env.vars.ROOM_STATS).toBe('0');
    expect(env.vars.DEV_ALLOWED_HOSTS).toBe('');
    expect(env.vars.TELEMETRY_INGEST).toBe('0');
    expect(env.vars.CAPTURE_BACKEND).toBe('browser-run');
    // every top-level var is redeclared (vars are not inherited by environments)
    expect(Object.keys(env.vars).sort()).toEqual(Object.keys(cfg.vars).sort());
    expect(env.ratelimits.map((r) => r.name).sort()).toEqual([
      'READ_LIMITER',
      'ROOM_CREATE_LIMITER',
      'ROOM_WS_LIMITER',
    ]);
    expect(env.assets.run_worker_first).toEqual(['/api/*', '/s/*']);
  });
});
