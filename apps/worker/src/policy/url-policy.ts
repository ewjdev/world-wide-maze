/**
 * SSRF policy for user-supplied capture URLs (Phase 07 task 2). Three layers:
 *
 * 1. `checkUrlStatic`: scheme, port, credentials, length, hostname rules, IP-literal ranges. Pure.
 * 2. `checkUrl`: static + opt-out list + DNS resolution (DoH), rejecting when ANY answer is forbidden
 *    (so a name that resolves to both a public and a private address is refused: DNS-rebinding style).
 * 3. `createRequestGuard`: the same checks for EVERY request the browser makes (subresources, frames,
 *    workers, and each redirect hop), memoized per host for one capture. It is wired to CDP `Fetch` at the
 *    browser target by `capture/core.ts`.
 *
 * Dev/test only: `allowHosts` lists exact loopback `host:port` pairs that skip the IP/port checks so tests
 * can capture pages from a local fixture server. Entries that are not loopback are ignored.
 */
import { normalizeUrl } from '@wwm/capture-script';
import type { DnsResolver } from './dns.ts';
import { forbiddenIp, parseIp } from './ip.ts';

export const MAX_URL_LENGTH = 2048;

export interface UrlPolicyOptions {
  maxUrlLength?: number;
  /** Dev/test only: exact loopback `host:port` entries (e.g. `127.0.0.1:5173`) exempt from IP/port checks. */
  allowHosts?: readonly string[];
}

export type PolicyResult = { ok: true; url: string; host: string } | { ok: false; reason: string };

const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.localdomain',
  '.home.arpa',
  '.lan',
  '.intranet',
  '.corp',
  '.private',
  '.onion',
  '.test',
  '.invalid',
  '.example',
];
const BLOCKED_NAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Parse `allowHosts`, keeping only loopback `host:port` entries (the only thing tests need). */
export function parseAllowHosts(raw: string | readonly string[] | undefined): string[] {
  const list = typeof raw === 'string' ? raw.split(',') : (raw ?? []);
  return list
    .map((s) => s.trim().toLowerCase())
    .filter((s) => {
      const m = /^(\[::1\]|127\.0\.0\.1|localhost):(\d{1,5})$/.exec(s);
      return m !== null && LOOPBACK_HOSTS.has(m[1] as string);
    });
}

/** Normalize a user URL: trim, add `https://` when the scheme is missing, then the shared normalizer. */
export function normalizeTargetUrl(input: string): string {
  let s = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  return normalizeUrl(s);
}

function hostnameOf(u: URL): string {
  // Strip one trailing dot ("localhost." resolves like "localhost").
  return u.hostname.toLowerCase().replace(/\.$/, '');
}

/** Scheme, port, credentials, length, hostname and IP-literal checks. No I/O. */
export function checkUrlStatic(input: string, opts: UrlPolicyOptions = {}): PolicyResult {
  const max = opts.maxUrlLength ?? MAX_URL_LENGTH;
  if (typeof input !== 'string' || input.trim() === '') return { ok: false, reason: 'empty url' };
  if (input.length > max) return { ok: false, reason: `url longer than ${max} characters` };
  let u: URL;
  let normalized: string;
  try {
    normalized = normalizeTargetUrl(input);
    u = new URL(normalized);
  } catch {
    return { ok: false, reason: 'invalid url' };
  }
  if (normalized.length > max) return { ok: false, reason: `url longer than ${max} characters` };
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    return { ok: false, reason: `scheme ${u.protocol} not allowed` };
  if (u.username !== '' || u.password !== '') return { ok: false, reason: 'credentials in url' };

  const host = hostnameOf(u);
  const allow = parseAllowHosts(opts.allowHosts);
  if (allow.includes(u.host.toLowerCase())) return { ok: true, url: normalized, host };

  if (u.port !== '') return { ok: false, reason: `port ${u.port} not allowed` };
  if (host === '') return { ok: false, reason: 'missing host' };

  const ip = parseIp(host);
  if (ip) {
    const why = forbiddenIp(ip);
    return why ? { ok: false, reason: `address ${host} is ${why}` } : { ok: true, url: normalized, host };
  }
  if (BLOCKED_NAMES.has(host)) return { ok: false, reason: `host ${host} not allowed` };
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s)))
    return { ok: false, reason: `host ${host} not allowed (reserved suffix)` };
  if (!host.includes('.')) return { ok: false, reason: `single-label host ${host} not allowed` };
  if (/^[0-9.]+$/.test(host) || /^0x/i.test(host))
    return { ok: false, reason: `ambiguous numeric host ${host}` };
  return { ok: true, url: normalized, host };
}

export interface CheckUrlDeps extends UrlPolicyOptions {
  resolver: DnsResolver;
  /** True if the host (or a parent domain) opted out of capture. */
  isOptedOut?: (host: string) => Promise<boolean>;
}

/** Hosts that skip DNS checks: IP literals (already judged) and dev loopback exemptions. */
function skipsDns(u: URL, host: string, opts: UrlPolicyOptions): boolean {
  return parseIp(host) !== null || parseAllowHosts(opts.allowHosts).includes(u.host.toLowerCase());
}

/** Resolve `host` and fail if it has no addresses or if ANY address is forbidden. */
export async function checkHostDns(host: string, resolver: DnsResolver): Promise<PolicyResult> {
  let addrs: string[];
  try {
    addrs = await resolver.resolve(host);
  } catch (e) {
    return { ok: false, reason: `dns lookup failed for ${host}: ${(e as Error).message}` };
  }
  if (addrs.length === 0) return { ok: false, reason: `host ${host} does not resolve` };
  for (const a of addrs) {
    const why = forbiddenIp(a);
    if (why) return { ok: false, reason: `host ${host} resolves to ${a} (${why})` };
  }
  return { ok: true, url: '', host };
}

/** Parent domains of a host, most specific first (`a.b.example.com` → itself, `b.example.com`, `example.com`). */
export function domainChain(host: string): string[] {
  const labels = host.split('.');
  const out: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join('.'));
  return out;
}

/** Full top-level check before a capture starts: static rules, opt-out list, then DNS. */
export async function checkUrl(input: string, deps: CheckUrlDeps): Promise<PolicyResult> {
  const r = checkUrlStatic(input, deps);
  if (!r.ok) return r;
  if (deps.isOptedOut && (await deps.isOptedOut(r.host)))
    return { ok: false, reason: `${r.host} opted out of capture` };
  const u = new URL(r.url);
  if (skipsDns(u, r.host, deps)) return r;
  const d = await checkHostDns(r.host, deps.resolver);
  return d.ok ? r : d;
}

export interface RequestGuard {
  /** Decide one browser request. Never throws. */
  check(url: string): Promise<PolicyResult>;
  readonly stats: { allowed: number; blocked: number; blockedUrls: string[] };
}

/** Schemes that never touch the network and are safe inside the page. */
const LOCAL_SCHEMES = new Set(['data:', 'blob:', 'about:']);

/**
 * Per-capture request guard. Host verdicts (static + opt-out + DNS) are memoized, so a page with 300
 * requests to 20 hosts costs 20 DNS checks. `maxRequests` bounds runaway pages.
 */
export function createRequestGuard(deps: CheckUrlDeps & { maxRequests?: number }): RequestGuard {
  const hostVerdicts = new Map<string, Promise<PolicyResult>>();
  const stats = { allowed: 0, blocked: 0, blockedUrls: [] as string[] };
  const maxRequests = deps.maxRequests ?? 3000;
  const block = (url: string, reason: string): PolicyResult => {
    stats.blocked++;
    if (stats.blockedUrls.length < 50) stats.blockedUrls.push(`${url.slice(0, 200)} (${reason})`);
    return { ok: false, reason };
  };
  return {
    stats,
    async check(url) {
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        return block(url, 'invalid url');
      }
      if (LOCAL_SCHEMES.has(u.protocol)) return { ok: true, url, host: '' };
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return block(url, `scheme ${u.protocol}`);
      if (stats.allowed + stats.blocked >= maxRequests) return block(url, 'request budget exceeded');
      const key = `${u.protocol}//${u.host.toLowerCase()}${u.username || u.password ? '#cred' : ''}`;
      let verdict = hostVerdicts.get(key);
      if (!verdict) {
        // Judge the origin only (path/query don't change the destination); length is checked per URL below.
        const origin = `${u.protocol}//${u.username || u.password ? 'x@' : ''}${u.host}/`;
        verdict = checkUrl(origin, { ...deps, maxUrlLength: Number.POSITIVE_INFINITY });
        hostVerdicts.set(key, verdict);
      }
      const v = await verdict;
      if (!v.ok) return block(url, v.reason);
      stats.allowed++;
      return { ok: true, url, host: v.host };
    },
  };
}
