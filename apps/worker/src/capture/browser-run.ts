/**
 * Capturer (a): Cloudflare Browser Run through `@cloudflare/playwright` (chosen over `@cloudflare/puppeteer`
 * because `@wwm/capture-script` and the local fixture tool already speak Playwright, so the whole capture
 * sequence is shared; both forks expose CDP, which the SSRF guard needs).
 *
 * Session reuse: we `acquire` a session with a keep-alive and `connect` to it with `persistent: true`
 * (accepted by `connect()` but missing from its typings in 1.3.6; without it the session dies with the
 * WebSocket). `browser.close()` on a connected browser then only drops our WebSocket, so the session stays
 * warm until its keep-alive expires. A free session (no active connection) is reused before acquiring a
 * new one. Each capture still gets a fresh incognito context, so no cookies or storage cross captures.
 *
 * `wrangler dev` runs this against a local Chrome that wrangler downloads (no Cloudflare account needed).
 */
import {
  acquire,
  type Browser,
  type BrowserWorker,
  connect,
  type Page,
  sessions,
} from '@cloudflare/playwright';
import { type CoreOptions, captureWithBrowser } from './core.ts';
import type { CaptureOutput, CaptureRequest, Capturer } from './types.ts';

export interface BrowserRunOptions extends CoreOptions {
  /** Session idle keep-alive (10 000–600 000 ms). Default 120 000. */
  keepAliveMs?: number;
  log?: (msg: string, fields?: Record<string, unknown>) => void;
}

/** `connect()` options including the untyped `persistent` flag (see header). */
function persistentSession(sessionId: string): { sessionId: string } {
  const opts = { sessionId, persistent: true };
  return opts;
}

export class BrowserRunCapturer implements Capturer {
  readonly name = 'browser-run';
  constructor(
    private readonly binding: BrowserWorker,
    private readonly opts: BrowserRunOptions,
  ) {}

  private async connectReused(): Promise<Browser> {
    try {
      const all = await sessions(this.binding);
      const free = all.filter((s) => !s.connectionId);
      this.opts.log?.('browser sessions', { total: all.length, free: free.length });
      for (const s of free) {
        try {
          const b = await connect(this.binding, persistentSession(s.sessionId));
          this.opts.log?.('browser session reused', { sessionId: s.sessionId });
          return b;
        } catch {
          // Session raced away (closed or taken): try the next one.
        }
      }
    } catch (e) {
      // sessions() unavailable: fall through to a fresh session.
      this.opts.log?.('browser sessions unavailable', { error: String(e) });
    }
    const { sessionId } = await acquire(this.binding, { keep_alive: this.opts.keepAliveMs ?? 120_000 });
    this.opts.log?.('browser session acquired', { sessionId });
    return connect(this.binding, persistentSession(sessionId));
  }

  async capture(req: CaptureRequest): Promise<CaptureOutput> {
    const browser = await this.connectReused();
    try {
      return await captureWithBrowser<Page>(browser, req, this.opts);
    } finally {
      await browser.close().catch(() => {});
    }
  }
}
