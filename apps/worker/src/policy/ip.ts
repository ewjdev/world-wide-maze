/**
 * IP-literal parsing and the forbidden-range table used by the SSRF policy.
 *
 * Hostnames reach this module AFTER the WHATWG URL parser, which already canonicalizes every IPv4 spelling
 * (decimal `2130706433`, octal `0177.0.0.1`, hex `0x7f.1`, short forms `127.1`) to dotted-quad, and IPv6 to
 * a bracketed, lower-case, compressed form. `parseIp` still accepts the raw spellings itself so DNS answers
 * and direct callers get the same treatment.
 *
 * Policy: only globally routable unicast addresses are allowed. Everything private, loopback, link-local,
 * CGNAT, metadata, multicast, reserved or documentation-only is forbidden, and IPv6 forms that embed an
 * IPv4 address (mapped, compatible, NAT64, 6to4, Teredo) are judged by the embedded IPv4 or blocked outright.
 */

export type ParsedIp = { v: 4; bytes: Uint8Array } | { v: 6; bytes: Uint8Array };

/** Parse an IPv4 literal in any inet_aton spelling (1–4 parts, decimal/octal/hex). Null if not IPv4. */
export function parseIpv4(input: string): Uint8Array | null {
  const s = input.trim();
  if (s === '' || s.endsWith('.')) return null;
  const parts = s.split('.');
  if (parts.length > 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (p === '') return null;
    let n: number;
    if (/^0x[0-9a-f]*$/i.test(p)) n = p.length === 2 ? 0 : Number.parseInt(p.slice(2), 16);
    else if (/^0[0-7]*$/.test(p)) n = p.length === 1 ? 0 : Number.parseInt(p.slice(1), 8);
    else if (/^[1-9][0-9]*$/.test(p)) n = Number.parseInt(p, 10);
    else return null;
    if (!Number.isFinite(n) || n < 0) return null;
    nums.push(n);
  }
  const last = nums.pop() as number;
  if (nums.some((n) => n > 255)) return null;
  const lastMax = 256 ** (4 - nums.length);
  if (last >= lastMax) return null;
  const out = new Uint8Array(4);
  nums.forEach((n, i) => {
    out[i] = n;
  });
  for (let i = 3, v = last; i >= nums.length; i--, v = Math.floor(v / 256)) out[i] = v % 256;
  return out;
}

/** Parse an IPv6 literal (optionally bracketed, optional zone id, optional trailing dotted IPv4). */
export function parseIpv6(input: string): Uint8Array | null {
  let s = input.trim();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (!s.includes(':')) return null;
  let tail: Uint8Array | null = null;
  const lastColon = s.lastIndexOf(':');
  const lastPart = s.slice(lastColon + 1);
  if (lastPart.includes('.')) {
    const quads = lastPart.split('.');
    if (quads.length !== 4 || !quads.every((q) => /^(0|[1-9]\d{0,2})$/.test(q) && Number(q) <= 255))
      return null;
    tail = Uint8Array.from(quads.map(Number));
    s = `${s.slice(0, lastColon + 1)}0:0`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toGroups = (h: string): number[] | null => {
    if (h === '') return [];
    const gs = h.split(':');
    const out: number[] = [];
    for (const g of gs) {
      if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
      out.push(Number.parseInt(g, 16));
    }
    return out;
  };
  const head = toGroups(halves[0] as string);
  const rest = halves.length === 2 ? toGroups(halves[1] as string) : [];
  if (!head || !rest) return null;
  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...new Array<number>(fill).fill(0), ...rest];
  } else {
    if (head.length !== 8) return null;
    groups = head;
  }
  const bytes = new Uint8Array(16);
  groups.forEach((g, i) => {
    bytes[i * 2] = g >> 8;
    bytes[i * 2 + 1] = g & 0xff;
  });
  if (tail) bytes.set(tail, 12);
  return bytes;
}

export function parseIp(input: string): ParsedIp | null {
  const v6 = parseIpv6(input);
  if (v6) return { v: 6, bytes: v6 };
  const v4 = parseIpv4(input);
  if (v4) return { v: 4, bytes: v4 };
  return null;
}

type Cidr = [prefix: number[], bits: number, reason: string];

const V4_FORBIDDEN: Cidr[] = [
  [[0], 8, 'this-network'],
  [[10], 8, 'private'],
  [[100, 64], 10, 'cgnat'],
  [[127], 8, 'loopback'],
  [[169, 254], 16, 'link-local/metadata'],
  [[172, 16], 12, 'private'],
  [[192, 0, 0], 24, 'ietf-protocol'],
  [[192, 0, 2], 24, 'documentation'],
  [[192, 88, 99], 24, '6to4-relay'],
  [[192, 168], 16, 'private'],
  [[198, 18], 15, 'benchmarking'],
  [[198, 51, 100], 24, 'documentation'],
  [[203, 0, 113], 24, 'documentation'],
  [[224], 4, 'multicast'],
  [[240], 4, 'reserved'],
];

function inCidr(bytes: Uint8Array, prefix: number[], bits: number): boolean {
  for (let i = 0; i < bytes.length && bits > 0; i++, bits -= 8) {
    const p = prefix[i] ?? 0;
    const mask = bits >= 8 ? 0xff : (0xff << (8 - bits)) & 0xff;
    if (((bytes[i] as number) & mask) !== (p & mask)) return false;
  }
  return true;
}

/** Why an IPv4 address is forbidden, or null if it is public unicast. */
export function forbiddenIpv4(b: Uint8Array): string | null {
  for (const [prefix, bits, reason] of V4_FORBIDDEN) if (inCidr(b, prefix, bits)) return reason;
  return null;
}

/** Why an IPv6 address is forbidden, or null if it is public unicast. */
export function forbiddenIpv6(b: Uint8Array): string | null {
  const first10Zero = b.subarray(0, 10).every((x) => x === 0);
  // ::ffff:a.b.c.d (IPv4-mapped): judge the embedded IPv4 — and block anyway, browsers never need it.
  if (first10Zero && b[10] === 0xff && b[11] === 0xff) {
    return `ipv4-mapped(${forbiddenIpv4(b.subarray(12)) ?? 'public'})`;
  }
  if (b.every((x) => x === 0)) return 'unspecified';
  if (b.subarray(0, 15).every((x) => x === 0) && b[15] === 1) return 'loopback';
  // ::a.b.c.d (deprecated IPv4-compatible) and anything else in ::/96.
  if (b.subarray(0, 12).every((x) => x === 0)) return 'ipv4-compatible';
  // 64:ff9b::/96 and 64:ff9b:1::/48 NAT64: the embedded IPv4 is what gets reached.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return 'nat64';
  if (b[0] === 0xfe && ((b[1] as number) & 0xc0) === 0x80) return 'link-local';
  if (b[0] === 0xfe && ((b[1] as number) & 0xc0) === 0xc0) return 'site-local';
  if (((b[0] as number) & 0xfe) === 0xfc) return 'unique-local';
  if (b[0] === 0xff) return 'multicast';
  if (b[0] === 0x01 && b[1] === 0x00 && b.subarray(2, 8).every((x) => x === 0)) return 'discard';
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return 'documentation';
  if (b[0] === 0x20 && b[1] === 0x01 && ((b[2] as number) & 0xfe) === 0x00) return 'ietf-protocol/teredo';
  if (b[0] === 0x20 && b[1] === 0x02) return '6to4';
  // Only global unicast (2000::/3) is allowed.
  if (((b[0] as number) & 0xe0) !== 0x20) return 'not-global-unicast';
  return null;
}

/** Why an address is forbidden, or null when it is a public unicast address. Non-IPs return 'not-an-ip'. */
export function forbiddenIp(input: string | ParsedIp): string | null {
  const ip = typeof input === 'string' ? parseIp(input) : input;
  if (!ip) return 'not-an-ip';
  return ip.v === 4 ? forbiddenIpv4(ip.bytes) : forbiddenIpv6(ip.bytes);
}
