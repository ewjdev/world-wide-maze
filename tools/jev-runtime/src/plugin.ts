import { randomBytes } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { Archive } from './archive.ts';
import { JevService } from './service.ts';

export async function body(req: IncomingMessage, limit = 65536) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new Error('Request too large');
    chunks.push(chunk);
  }
  // Decode once so multi-byte characters split across chunks survive.
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
// Vite replaces (not merges) `server.fs.deny`, so restate its defaults (Vite 8).
const VITE_FS_DENY = [
  '.env',
  '.env.*',
  '*.{crt,pem,key,p12,pfx,cer,der}',
  '.npmrc',
  '.yarnrc.yml',
  '**/.git/**',
];
const send = (res: ServerResponse, status: number, data: unknown) => {
  if (res.destroyed) return;
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
};
const services = globalThis as typeof globalThis & { __jevServices?: Map<string, JevService> };
services.__jevServices ??= new Map();
export function jevPlugin(root: string): Plugin {
  const privateDir = resolve(root, 'local/jev');
  const enabled = process.env.WWM_JEV_PILOT === '1';
  let service: JevService | undefined;
  function blocked(raw: string) {
    let decoded = raw;
    for (let i = 0; i < 3; i++) {
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        break;
      }
    }
    decoded = decoded.split('?')[0];
    if (
      /(^|\/)local\/jev(?:\/|$)/.test(decoded) ||
      decoded.includes('/.env') ||
      decoded.includes('/.dev.vars')
    )
      return true;
    const path = decoded.startsWith('/@fs/') ? decoded.slice(4) : decoded;
    for (const candidate of [
      path,
      resolve(root, 'apps/web/public', decoded.replace(/^\/+/, '')),
      resolve(root, 'apps/web', decoded.replace(/^\/+/, '')),
    ]) {
      if (existsSync(candidate)) {
        const real = realpathSync(candidate);
        if (
          real === privateDir ||
          real.startsWith(`${privateDir}/`) ||
          /\/\.env(?:\.|$)/.test(real) ||
          real.endsWith('/.dev.vars')
        )
          return true;
      }
    }
    return false;
  }
  return {
    name: 'wwm:jev-local',
    enforce: 'pre',
    config() {
      return {
        define: { 'import.meta.env.VITE_JEV_PILOT': JSON.stringify(enabled) },
        server: {
          fs: { deny: [...VITE_FS_DENY, '**/.env', '**/.env.*', '**/.dev.vars', '**/local/jev/**'] },
          ...(enabled
            ? {
                host: '127.0.0.1',
                port: Number(process.env.WWM_JEV_PORT ?? 5176),
                strictPort: true,
                allowedHosts: ['127.0.0.1'],
              }
            : {}),
        },
      };
    },
    load(id) {
      if (blocked(id)) throw new Error('Private Jev archive cannot be imported');
    },
    configureServer(server) {
      const token = randomBytes(24).toString('hex');
      const port = Number(process.env.WWM_JEV_PORT ?? 5176);
      const origin = `http://127.0.0.1:${port}`;
      if (enabled) {
        const pilot = process.env.WWM_JEV_PILOT_ID;
        if (!pilot || !/^[-a-zA-Z0-9_]{1,64}$/.test(pilot)) throw new Error('Provide a valid pilot ID');
        const archivePath = resolve(privateDir, pilot);
        service = services.__jevServices?.get(archivePath);
        if (!service) {
          service = new JevService(
            new Archive(archivePath),
            process.env.TYPESAFE_API_KEY ?? process.env.JEV_API_KEY,
          );
          services.__jevServices?.set(archivePath, service);
          const owned = service;
          const interval = setInterval(() => owned.sweep(), 5000);
          interval.unref();
          process.once('exit', () => {
            clearInterval(interval);
            owned.archive.close();
          });
        }
      }
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (blocked(url)) {
          send(res, 403, { error: 'Private local archive' });
          return;
        }
        if (!url.startsWith('/api/jev/')) {
          next();
          return;
        }
        if (!service) {
          send(res, 404, { error: 'Start with pnpm dev:jev' });
          return;
        }
        const addr = req.socket.remoteAddress;
        const sameSite = req.headers['sec-fetch-site'] === 'same-origin';
        const authenticated = req.headers['x-jev-session'] === token;
        if (
          !['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(addr ?? '') ||
          req.headers.host !== `127.0.0.1:${port}` ||
          (!sameSite && !authenticated) ||
          ((req.method !== 'GET' || req.headers.origin) && req.headers.origin !== origin)
        ) {
          send(res, 403, { error: 'Local origin required' });
          return;
        }
        const path = new URL(url, origin).pathname;
        if (path === '/api/jev/session' && req.method === 'GET' && sameSite) {
          send(res, 200, { token, ...service.availability() });
          return;
        }
        if (!authenticated) {
          send(res, 403, { error: 'Session required' });
          return;
        }
        if (req.method !== 'GET' && req.headers['content-type'] !== 'application/json') {
          send(res, 415, { error: 'JSON required' });
          return;
        }
        try {
          if (path === '/api/jev/runs' && req.method === 'POST') {
            send(res, 201, service.create(await body(req, 4 * 1024 * 1024)));
            return;
          }
          if (path === '/api/jev/best' && req.method === 'GET') {
            const hash = new URL(url, origin).searchParams.get('hash');
            const best =
              [...service.archive.runs.keys()]
                .map((id) => service!.archive.summary(id))
                .filter(
                  (r) =>
                    r.fixtureHash === hash && r.scoreMode && r.policy === 'jev' && r.status === 'finished',
                )
                .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] ?? null;
            send(res, 200, { best });
            return;
          }
          if (path === '/api/jev/runs' && req.method === 'GET') {
            const q = new URL(url, origin).searchParams;
            const offset = Math.max(0, Math.min(100000, Number(q.get('offset') ?? 0) || 0));
            const search = (q.get('q') ?? '').slice(0, 100).toLowerCase();
            const all = [...service.archive.runs.keys()]
              .map((id) => service!.archive.summary(id))
              .filter((r) =>
                [r.id, r.fixture, r.title, r.url, r.policy, r.model, r.status, r.createdAt]
                  .join(' ')
                  .toLowerCase()
                  .includes(search),
              )
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            send(res, 200, {
              runs: all.slice(offset, offset + 20),
              total: all.length,
              ...service.availability(),
            });
            return;
          }
          const m = path.match(/^\/api\/jev\/runs\/([a-f0-9-]{36})(?:\/(command|decide))?$/);
          if (m) {
            const [, id, action] = m;
            if (req.method === 'GET' && !action) {
              send(res, 200, service.archive.detail(id));
              return;
            }
            if (req.method === 'POST' && action === 'command') {
              send(res, 200, service.command(id, await body(req)));
              return;
            }
            if (req.method === 'POST' && action === 'decide') {
              send(res, 200, await service.decide(id, await body(req)));
              return;
            }
          }
          send(res, 404, { error: 'Unknown endpoint' });
        } catch (e) {
          send(res, 400, { error: e instanceof Error ? e.message : 'Request failed' });
        }
      });
    },
  };
}
