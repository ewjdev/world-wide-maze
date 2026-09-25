/**
 * DNS resolution for the SSRF policy. Workers have no `dns` module, so production resolves over
 * DNS-over-HTTPS (JSON API, RFC 8484-style `application/dns-json`). Both A and AAAA are queried and every
 * answer is returned: the policy rejects the host if ANY address is forbidden.
 */

export interface DnsResolver {
  /** All A and AAAA addresses for `host` (CNAME chains already followed). Empty = does not resolve. */
  resolve(host: string): Promise<string[]>;
}

export const DEFAULT_DOH_URL = 'https://cloudflare-dns.com/dns-query';

interface DohAnswer {
  name: string;
  type: number;
  data: string;
}
interface DohResponse {
  Status: number;
  Answer?: DohAnswer[];
}

const TYPE_A = 1;
const TYPE_AAAA = 28;

export function createDohResolver(
  opts: { url?: string; fetch?: typeof fetch; timeoutMs?: number } = {},
): DnsResolver {
  const base = opts.url || DEFAULT_DOH_URL;
  const doFetch = opts.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = opts.timeoutMs ?? 4000;
  const query = async (host: string, type: 'A' | 'AAAA'): Promise<string[]> => {
    const u = new URL(base);
    u.searchParams.set('name', host);
    u.searchParams.set('type', type);
    const res = await doFetch(u.toString(), {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`DoH HTTP ${res.status}`);
    const body = (await res.json()) as DohResponse;
    // NOERROR (0) or NXDOMAIN (3) are definitive; anything else (SERVFAIL, REFUSED) is an error.
    if (body.Status !== 0 && body.Status !== 3) throw new Error(`DoH status ${body.Status}`);
    const want = type === 'A' ? TYPE_A : TYPE_AAAA;
    return (body.Answer ?? []).filter((a) => a.type === want).map((a) => a.data.trim());
  };
  return {
    async resolve(host) {
      const [a, aaaa] = await Promise.all([query(host, 'A'), query(host, 'AAAA')]);
      return [...a, ...aaaa];
    },
  };
}

/** Test/dev resolver from a fixed table (`host → addresses`); unknown hosts don't resolve. */
export function createStaticResolver(table: Record<string, string[]>): DnsResolver {
  return { resolve: async (host) => table[host.toLowerCase()] ?? [] };
}
