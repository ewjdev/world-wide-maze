/** A DNS-over-HTTPS JSON endpoint answering from a fixed table (so the Worker's DoH path is exercised). */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseIp } from '../../src/policy/ip.ts';

export async function startFakeDoh(
  table: Record<string, string[]>,
): Promise<{ url: string; queries: string[]; close(): Promise<void> }> {
  const queries: string[] = [];
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const name = (u.searchParams.get('name') ?? '').toLowerCase();
    const type = u.searchParams.get('type');
    queries.push(`${name}/${type}`);
    const addrs = table[name];
    const want = type === 'AAAA' ? 6 : 4;
    const answers = (addrs ?? [])
      .filter((a) => parseIp(a)?.v === want)
      .map((data) => ({ name, type: want === 4 ? 1 : 28, TTL: 60, data }));
    res.writeHead(200, { 'content-type': 'application/dns-json' });
    res.end(JSON.stringify({ Status: addrs ? 0 : 3, Answer: answers }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/dns-query`,
    queries,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
