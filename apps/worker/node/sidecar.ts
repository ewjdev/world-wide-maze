/**
 * Capture sidecar: a tiny Node HTTP server that runs a `Capturer` (normally `LocalChromiumCapturer`) for a
 * Worker configured with `CAPTURE_BACKEND=sidecar`. Binds to loopback only.
 *   POST /capture  {url, budgetMs, now?}  → 200 application/x-wwm-capture (capture/wire.ts)
 *                                          | 4xx/5xx {code, message}
 */
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Capturer } from '../src/capture/types.ts';
import { encodeCaptureOutput } from '../src/capture/wire.ts';
import { ERROR_STATUS, toServiceError } from '../src/errors.ts';

export interface SidecarHandle {
  url: string;
  close(): Promise<void>;
}

async function readJson(req: IncomingMessage, max = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > max) throw new Error('body too large');
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function startCaptureSidecar(opts: {
  capturer: Capturer;
  port?: number;
}): Promise<SidecarHandle> {
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method !== 'POST' || req.url !== '/capture') {
        res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');
        return;
      }
      try {
        const body = (await readJson(req)) as { url?: unknown; budgetMs?: unknown; now?: unknown };
        if (typeof body.url !== 'string') throw new Error('url required');
        const budget = Math.min(60_000, Math.max(1000, Number(body.budgetMs) || 20_000));
        const now = typeof body.now === 'string' ? body.now : undefined;
        const out = await opts.capturer.capture({
          url: body.url,
          deadline: Date.now() + budget,
          ...(now ? { now: () => new Date(now) } : {}),
        });
        const bytes = encodeCaptureOutput(out);
        res.writeHead(200, {
          'content-type': 'application/x-wwm-capture',
          'content-length': bytes.byteLength,
        });
        res.end(bytes);
      } catch (e) {
        const err = toServiceError(e);
        res.writeHead(ERROR_STATUS[err.code], { 'content-type': 'application/json' });
        res.end(JSON.stringify(err.toJSON()));
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
