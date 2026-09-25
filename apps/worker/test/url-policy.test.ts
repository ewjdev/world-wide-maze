/**
 * SSRF policy, pure layer (static rules, DNS answers, request guard). The browser-level enforcement
 * (redirect hops, subresources, workers, sockets) is covered with real Chromium in capture-guard.test.ts.
 */
import { describe, expect, test } from 'vitest';
import { createStaticResolver, type DnsResolver } from '../src/policy/dns.ts';
import { forbiddenIp, parseIp, parseIpv4, parseIpv6 } from '../src/policy/ip.ts';
import {
  checkUrl,
  checkUrlStatic,
  createRequestGuard,
  domainChain,
  normalizeTargetUrl,
  parseAllowHosts,
} from '../src/policy/url-policy.ts';

const PUBLIC_V4 = '93.184.215.14';
const resolver = createStaticResolver({
  'example.com': [PUBLIC_V4, '2606:2800:21f:cb07:6820:80da:af6b:8b2c'],
  'rebind.attacker.dev': ['127.0.0.1'],
  'mixed.attacker.dev': [PUBLIC_V4, '10.1.2.3'],
  'v6private.attacker.dev': ['fd00::1'],
  'mapped.attacker.dev': ['::ffff:169.254.169.254'],
  'metadata.attacker.dev': ['169.254.169.254'],
  'cgnat.attacker.dev': ['100.64.0.1'],
});

const forbidden = (url: string) => {
  const r = checkUrlStatic(url);
  expect(r.ok, `${url} should be forbidden`).toBe(false);
  return r.ok ? '' : r.reason;
};

describe('IP parsing (inet_aton + IPv6 spellings)', () => {
  test('IPv4 decimal, octal, hex and short forms all mean 127.0.0.1', () => {
    for (const s of [
      '127.0.0.1',
      '2130706433',
      '0177.0.0.1',
      '0x7f.0.0.1',
      '0x7f000001',
      '127.1',
      '017700000001',
    ])
      expect([...(parseIpv4(s) ?? [])], s).toEqual([127, 0, 0, 1]);
    expect(parseIpv4('256.0.0.1')).toBeNull();
    expect(parseIpv4('1.2.3.4.5')).toBeNull();
    expect(parseIpv4('example.com')).toBeNull();
  });

  test('IPv6 forms', () => {
    expect([...(parseIpv6('::1') ?? [])].at(-1)).toBe(1);
    expect([...(parseIpv6('[::ffff:127.0.0.1]') ?? [])].slice(10)).toEqual([0xff, 0xff, 127, 0, 0, 1]);
    expect(parseIpv6('fe80::1%eth0')).not.toBeNull();
    expect(parseIpv6('1::2::3')).toBeNull();
    expect(parseIpv6('::ffff:01.2.3.4')).toBeNull();
  });

  test.each([
    ['10.0.0.1', 'private'],
    ['172.16.5.4', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.1.1', 'private'],
    ['127.0.0.1', 'loopback'],
    ['0.0.0.0', 'this-network'],
    ['169.254.169.254', 'link-local/metadata'],
    ['100.64.0.1', 'cgnat'],
    ['100.127.255.255', 'cgnat'],
    ['198.18.0.1', 'benchmarking'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'reserved'],
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['fe80::1', 'link-local'],
    ['fc00::1', 'unique-local'],
    ['fd12:3456::1', 'unique-local'],
    ['ff02::1', 'multicast'],
    ['64:ff9b::a9fe:a9fe', 'nat64'],
    ['2002:7f00:1::', '6to4'],
    ['2001::1', 'ietf-protocol/teredo'],
    ['2001:db8::1', 'documentation'],
    ['::127.0.0.1', 'ipv4-compatible'],
  ])('%s is forbidden (%s)', (ip, reason) => {
    expect(forbiddenIp(ip)).toBe(reason);
  });

  test('IPv4-mapped IPv6 is always forbidden and names the embedded range', () => {
    expect(forbiddenIp('::ffff:10.0.0.1')).toBe('ipv4-mapped(private)');
    expect(forbiddenIp('::ffff:7f00:1')).toBe('ipv4-mapped(loopback)');
    expect(forbiddenIp(`::ffff:${PUBLIC_V4}`)).toBe('ipv4-mapped(public)');
  });

  test('public unicast is allowed', () => {
    expect(forbiddenIp(PUBLIC_V4)).toBeNull();
    expect(forbiddenIp('172.32.0.1')).toBeNull();
    expect(forbiddenIp('100.128.0.1')).toBeNull();
    expect(forbiddenIp('2606:4700:4700::1111')).toBeNull();
    expect(parseIp('not-an-ip')).toBeNull();
  });
});

describe('static URL rules', () => {
  test('1. loopback literal', () => expect(forbidden('http://127.0.0.1/')).toMatch(/loopback/));
  test('2. decimal IP (2130706433 = 127.0.0.1)', () =>
    expect(forbidden('http://2130706433/')).toMatch(/loopback/));
  test('3. octal IP (0177.0.0.1)', () => expect(forbidden('http://0177.0.0.1/')).toMatch(/loopback/));
  test('4. hex IP (0x7f.1)', () => expect(forbidden('http://0x7f.1/')).toMatch(/loopback/));
  test('5. cloud metadata 169.254.169.254', () =>
    expect(forbidden('http://169.254.169.254/latest/meta-data/')).toMatch(/metadata/));
  test('6. IPv6 loopback [::1]', () => expect(forbidden('http://[::1]/')).toMatch(/loopback/));
  test('7. IPv6-mapped IPv4 [::ffff:127.0.0.1]', () =>
    expect(forbidden('http://[::ffff:127.0.0.1]/')).toMatch(/ipv4-mapped\(loopback\)/));
  test('8. IPv6-mapped IPv4 in hex [::ffff:a9fe:a9fe]', () =>
    expect(forbidden('http://[::ffff:a9fe:a9fe]/')).toMatch(/ipv4-mapped/));
  test('9. private ranges', () => {
    for (const u of ['http://10.0.0.1/', 'http://192.168.0.1/', 'http://172.20.1.1/', 'http://100.64.1.1/'])
      forbidden(u);
  });
  test('10. localhost and reserved names', () => {
    for (const u of [
      'http://localhost/',
      'http://LOCALHOST./',
      'http://api.localhost/',
      'http://printer.local/',
      'http://metadata.google.internal/',
      'http://router/',
      'http://intranet.corp/',
    ])
      forbidden(u);
  });
  test('11. non-http schemes', () => {
    for (const u of [
      'file:///etc/passwd',
      'ftp://example.com/',
      'gopher://example.com/',
      'javascript:alert(1)',
      'data:text/html,hi',
    ])
      expect(forbidden(u)).toMatch(/scheme|invalid/);
  });
  test('12. non-default ports', () => {
    expect(forbidden('http://example.com:8080/')).toMatch(/port 8080/);
    expect(forbidden('https://example.com:22/')).toMatch(/port 22/);
    // Default ports are fine (and normalized away).
    expect(checkUrlStatic('https://example.com:443/')).toEqual({
      ok: true,
      url: 'https://example.com/',
      host: 'example.com',
    });
  });
  test('13. credentials in the URL', () => {
    expect(forbidden('https://user:pass@example.com/')).toMatch(/credentials/);
    expect(forbidden('https://user@example.com/')).toMatch(/credentials/);
  });
  test('14. over-long URLs', () =>
    expect(forbidden(`https://example.com/${'a'.repeat(2100)}`)).toMatch(/longer/));
  test('0.0.0.0 and unspecified IPv6', () => {
    forbidden('http://0.0.0.0/');
    forbidden('http://0/');
    forbidden('http://[::]/');
  });

  test('normalization: scheme added, host lower-cased, fragment and tracking params dropped', () => {
    expect(normalizeTargetUrl('Example.COM/a?utm_source=x&b=1#top')).toBe('https://example.com/a?b=1');
    expect(checkUrlStatic('https://EXAMPLE.com/path')).toMatchObject({ ok: true, host: 'example.com' });
  });

  test('dev allowHosts: only exact loopback host:port pairs, only for that port', () => {
    expect(
      parseAllowHosts('127.0.0.1:5173, localhost:8080, 10.0.0.1:80, example.com:443, 127.0.0.1'),
    ).toEqual(['127.0.0.1:5173', 'localhost:8080']);
    const allow = ['127.0.0.1:5173'];
    expect(checkUrlStatic('http://127.0.0.1:5173/page', { allowHosts: allow }).ok).toBe(true);
    expect(checkUrlStatic('http://127.0.0.1:5174/page', { allowHosts: allow }).ok).toBe(false);
    expect(checkUrlStatic('http://127.0.0.1/', { allowHosts: allow }).ok).toBe(false);
    expect(checkUrlStatic('http://10.0.0.1:80/', { allowHosts: ['10.0.0.1:80'] }).ok).toBe(false);
  });
});

describe('DNS-aware checks', () => {
  test('15. a public name that resolves to loopback (DNS rebinding) is refused', async () => {
    const r = await checkUrl('https://rebind.attacker.dev/', { resolver });
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? '' : r.reason).toMatch(/resolves to 127\.0\.0\.1 \(loopback\)/);
  });
  test('16. ANY private answer rejects the host (public + private A records)', async () => {
    const r = await checkUrl('https://mixed.attacker.dev/', { resolver });
    expect(r.ok ? '' : r.reason).toMatch(/10\.1\.2\.3/);
  });
  test('17. private AAAA, v4-mapped metadata, CGNAT answers', async () => {
    for (const h of ['v6private', 'mapped', 'metadata', 'cgnat'])
      expect((await checkUrl(`https://${h}.attacker.dev/`, { resolver })).ok, h).toBe(false);
  });
  test('18. names that do not resolve, and resolver failures, are refused', async () => {
    expect(await checkUrl('https://nx.attacker.dev/', { resolver })).toMatchObject({ ok: false });
    const broken: DnsResolver = { resolve: async () => Promise.reject(new Error('SERVFAIL')) };
    const r = await checkUrl('https://example.com/', { resolver: broken });
    expect(r.ok ? '' : r.reason).toMatch(/dns lookup failed/);
  });
  test('19. opt-out list covers the domain and its subdomains', async () => {
    const optedOut = new Set(['example.com']);
    const isOptedOut = async (host: string) => domainChain(host).some((d) => optedOut.has(d));
    expect(domainChain('a.b.example.com')).toEqual(['a.b.example.com', 'b.example.com', 'example.com']);
    const sub = createStaticResolver({ 'www.example.com': [PUBLIC_V4] });
    expect(await checkUrl('https://www.example.com/', { resolver: sub, isOptedOut })).toMatchObject({
      ok: false,
    });
  });
  test('public hosts pass', async () => {
    expect(await checkUrl('https://example.com/x', { resolver })).toEqual({
      ok: true,
      url: 'https://example.com/x',
      host: 'example.com',
    });
  });
});

describe('request guard (every browser request)', () => {
  test('allows public + inert schemes, blocks private/rebinding/odd schemes, memoizes per host', async () => {
    let lookups = 0;
    const counting: DnsResolver = {
      resolve: async (h) => {
        lookups++;
        return resolver.resolve(h);
      },
    };
    const g = createRequestGuard({ resolver: counting });
    expect((await g.check('https://example.com/a.png')).ok).toBe(true);
    expect((await g.check('https://example.com/b.css')).ok).toBe(true);
    expect(lookups).toBe(1);
    expect((await g.check('data:image/png;base64,AAAA')).ok).toBe(true);
    expect((await g.check('blob:https://example.com/uuid')).ok).toBe(true);
    expect((await g.check('http://169.254.169.254/latest/')).ok).toBe(false);
    expect((await g.check('https://rebind.attacker.dev/x')).ok).toBe(false);
    expect((await g.check('http://[::ffff:10.0.0.1]/')).ok).toBe(false);
    expect((await g.check('ws://example.com/socket')).ok).toBe(false);
    expect((await g.check('chrome://settings')).ok).toBe(false);
    expect((await g.check('file:///etc/hosts')).ok).toBe(false);
    expect((await g.check('https://u:p@example.com/')).ok).toBe(false);
    // data: and blob: never touch the network, so they aren't counted.
    expect(g.stats).toMatchObject({ allowed: 2, blocked: 7 });
  });

  test('request budget', async () => {
    const g = createRequestGuard({ resolver, maxRequests: 3 });
    for (let i = 0; i < 3; i++) expect((await g.check(`https://example.com/${i}`)).ok).toBe(true);
    expect(await g.check('https://example.com/4')).toMatchObject({
      ok: false,
      reason: 'request budget exceeded',
    });
  });
});
