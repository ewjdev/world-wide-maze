/**
 * The capture sequence shared by every `Capturer` (Browser Run in Workers, local Playwright in Node).
 *
 * 1. SSRF enforcement on EVERY request: CDP `Fetch.enable` on the BROWSER target pauses each request of
 *    every page, frame, worker and redirect hop (Playwright's `route()` never sees redirect hops — verified,
 *    see README), and `RequestGuard` decides continue/fail. Non-HTTP APIs that bypass `Fetch`
 *    (WebSocket, WebTransport, WebRTC, dedicated/shared workers whose sockets we can't see) are removed
 *    from every frame by an init script; service workers and downloads are disabled on the context.
 * 2. `capturePage` from `@wwm/capture-script` (the same sequence as the fixtures) on a wrapped page:
 *    navigation waits for DOMContentLoaded then gives `load` whatever budget is left, and the full-page
 *    screenshot is taken at CSS scale (the 1× analysis image the builder decodes).
 * 3. Bot-wall detection, then one WebP texture per stage slice at the context's DPR, cropped by Chromium
 *    (CDP `Page.captureScreenshot` with a clip), so the Worker never decodes or re-encodes a DPR-2 image.
 */
import { capturePage } from '@wwm/capture-script';
import {
  CAPTURE_DPR,
  DEFAULT_VIEWPORT,
  MAX_PAGE_HEIGHT_PX,
  parseCapture,
  sliceCount,
  sliceRange,
} from '@wwm/schema';
import { ServiceError } from '../errors.ts';
import { readPngHeader } from '../image/png.ts';
import { webpSize } from '../image/webp.ts';
import { type CheckUrlDeps, createRequestGuard, type RequestGuard } from '../policy/url-policy.ts';
import { detectBlocked } from './bot-wall.ts';
import type { CaptureOutput, CaptureRequest, SliceTexture } from './types.ts';

// ── Minimal structural views of Playwright objects (both `playwright` and `@cloudflare/playwright`). ──

export interface RequestPausedEvent {
  requestId: string;
  request: { url: string };
  resourceType?: string;
}
export interface CdpSessionLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: 'Fetch.requestPaused', listener: (payload: RequestPausedEvent) => void): unknown;
  detach(): Promise<void>;
}
export interface ResponseLike {
  status(): number;
}
export interface PageHandle {
  goto(url: string, opts: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<ResponseLike | null>;
  waitForLoadState(state: 'load', opts: { timeout: number }): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  url(): string;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  screenshot(opts: {
    clip?: { x: number; y: number; width: number; height: number };
    fullPage?: boolean;
    type?: 'png' | 'jpeg';
    scale?: 'css' | 'device';
    timeout?: number;
  }): Promise<Uint8Array>;
}
export interface ContextOptions {
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  javaScriptEnabled: boolean;
  serviceWorkers: 'block';
  acceptDownloads: boolean;
  reducedMotion: 'reduce';
  colorScheme: 'light';
  locale: string;
  timezoneId: string;
}
export interface ContextHandle<P extends PageHandle = PageHandle> {
  newPage(): Promise<P>;
  newCDPSession(page: P): Promise<CdpSessionLike>;
  addInitScript(script: string): Promise<unknown>;
  close(): Promise<void>;
}
export interface BrowserHandle<P extends PageHandle = PageHandle> {
  newContext(opts: ContextOptions): Promise<ContextHandle<P>>;
  newBrowserCDPSession(): Promise<CdpSessionLike>;
}

export interface CoreOptions {
  guard: CheckUrlDeps;
  dpr?: number;
  textureQuality?: number;
}

/**
 * Network APIs whose traffic CDP `Fetch` cannot see (sockets, WebRTC, and workers, whose own sockets we
 * can't see either). `WebSocketStream` leaked from every realm before it was listed (capture-guard tests);
 * the Direct Sockets classes are listed defensively (Chromium exposes them only to isolated web apps).
 */
export const UNGUARDED_APIS = [
  'WebSocket',
  'WebSocketStream',
  'WebTransport',
  'RTCPeerConnection',
  'webkitRTCPeerConnection',
  'Worker',
  'SharedWorker',
  'TCPSocket',
  'TCPServerSocket',
  'UDPSocket',
] as const;

/**
 * Init script for every realm: removes `UNGUARDED_APIS` and disables `window.open` (popups are never
 * useful to a capture). Playwright's `addInitScript` runs it in every frame and popup of the context,
 * including a synchronously created about:blank iframe before the parent can touch its `contentWindow`,
 * srcdoc/data:/blob:/javascript: frames, `<object>`/`<embed>` and cross-site (out-of-process) iframes:
 * the child-realm tests in capture-guard.test.ts verify each of these against a counting internal server.
 */
export const DISABLE_UNGUARDED_APIS = `(() => {
  for (const k of ${JSON.stringify(UNGUARDED_APIS)}) {
    try { Object.defineProperty(globalThis, k, { value: undefined, configurable: false, writable: false }); } catch {}
  }
  try { Object.defineProperty(globalThis, 'open', { value: function open() { return null; }, configurable: false, writable: false }); } catch {}
})();`;

/** Enable browser-wide request interception and route every request through `guard`. */
export async function attachRequestGuard(
  cdp: CdpSessionLike,
  guard: RequestGuard,
): Promise<{ mainBlockedReason: () => string | null }> {
  let mainBlocked: string | null = null;
  cdp.on('Fetch.requestPaused', (e) => {
    void (async () => {
      const verdict = await guard.check(e.request.url);
      try {
        if (verdict.ok) await cdp.send('Fetch.continueRequest', { requestId: e.requestId });
        else {
          if (e.resourceType === 'Document' && mainBlocked === null) mainBlocked = verdict.reason;
          await cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'BlockedByClient' });
        }
      } catch {
        // Target closed or request already gone: nothing to do.
      }
    })();
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  return { mainBlockedReason: () => mainBlocked };
}

function remaining(deadline: number): number {
  return deadline - Date.now();
}

/** Reject with CAPTURE_TIMEOUT when the deadline passes first. */
export async function withDeadline<T>(p: Promise<T>, deadline: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ServiceError('CAPTURE_TIMEOUT', `${what} exceeded its time budget`)),
      Math.max(0, remaining(deadline)),
    );
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function classifyNavError(e: unknown, blockedReason: string | null): ServiceError {
  if (e instanceof ServiceError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  if (blockedReason !== null || /ERR_BLOCKED_BY_CLIENT/.test(msg))
    return new ServiceError(
      'URL_FORBIDDEN',
      `navigation blocked: ${blockedReason ?? 'forbidden destination'}`,
    );
  if (/Timeout|timed out/i.test(msg)) return new ServiceError('CAPTURE_TIMEOUT', 'page did not load in time');
  const net = /net::(ERR_[A-Z_]+)/.exec(msg)?.[1];
  return new ServiceError('CAPTURE_BLOCKED', `could not load the page${net ? ` (${net})` : ''}`);
}

/**
 * Run one capture on `browser`. The caller owns the browser (launch/connect/close). Everything created
 * here (CDP session, context) is torn down before returning, including on error and timeout.
 */
export async function captureWithBrowser<P extends PageHandle>(
  browser: BrowserHandle<P>,
  req: CaptureRequest,
  opts: CoreOptions,
): Promise<CaptureOutput> {
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const mark = (k: string, since: number) => {
    timings[k] = Date.now() - since;
  };
  const dpr = opts.dpr ?? CAPTURE_DPR;
  const guard = createRequestGuard(opts.guard);
  const bcdp = await browser.newBrowserCDPSession();
  let context: ContextHandle<P> | undefined;
  try {
    const guardState = await attachRequestGuard(bcdp, guard);
    context = await browser.newContext({
      viewport: { ...DEFAULT_VIEWPORT },
      deviceScaleFactor: dpr,
      javaScriptEnabled: true,
      serviceWorkers: 'block',
      acceptDownloads: false,
      reducedMotion: 'reduce',
      colorScheme: 'light',
      locale: 'en-US',
      timezoneId: 'UTC',
    });
    await context.addInitScript(DISABLE_UNGUARDED_APIS);
    const page = await context.newPage();
    mark('setup', t0);

    let status = 0;
    let navError: ServiceError | null = null;
    const tNav = Date.now();
    // CapturePageLike view of `page` with a budget-aware goto and a CSS-scale full-page screenshot.
    const wrapped = {
      evaluate: (expression: string) => page.evaluate(expression),
      url: () => page.url(),
      setViewportSize: (s: { width: number; height: number }) => page.setViewportSize(s),
      goto: async (url: string) => {
        try {
          const navBudget = Math.max(1000, Math.min(15_000, remaining(req.deadline) - 5000));
          const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navBudget });
          status = resp?.status() ?? 0;
        } catch (e) {
          navError = classifyNavError(e, guardState.mainBlockedReason());
          throw navError;
        }
        const loadBudget = Math.min(5000, remaining(req.deadline) - 7000);
        if (loadBudget > 0) await page.waitForLoadState('load', { timeout: loadBudget }).catch(() => {});
        mark('navigate', tNav);
        req.onStep?.('extracting');
        return null;
      },
      screenshot: (o: {
        clip?: { x: number; y: number; width: number; height: number };
        fullPage?: boolean;
      }) =>
        page.screenshot({
          ...o,
          type: 'png',
          scale: 'css',
          timeout: Math.max(1000, remaining(req.deadline)),
        }),
    };

    const tCap = Date.now();
    const result = await withDeadline(
      capturePage(wrapped, req.url, {
        screenshotPath: 'screenshot.png',
        maxPageHeight: MAX_PAGE_HEIGHT_PX,
        ...(req.now ? { now: req.now } : {}),
      }),
      req.deadline,
      'capture',
    ).catch((e: unknown) => {
      throw navError ?? classifyNavError(e, guardState.mainBlockedReason());
    });
    mark('prepareExtractScreenshot', tCap);

    // The final URL (after redirects) must itself be allowed.
    const finalCheck = await guard.check(page.url());
    if (!finalCheck.ok)
      throw new ServiceError('URL_FORBIDDEN', `redirected to a forbidden url: ${finalCheck.reason}`);

    // capturePage records scale = devicePixelRatio, but our screenshot is CSS-scale: describe it truthfully.
    const png = readPngHeader(result.png);
    const bundle = parseCapture({
      ...result.bundle,
      screenshot: {
        path: 'screenshot.png',
        width: png.width,
        height: png.height,
        format: 'png',
        scale: png.width / result.bundle.page.width,
      },
    });

    const blocked = detectBlocked({ status, bundle });
    if (blocked) throw new ServiceError('CAPTURE_BLOCKED', blocked);

    const tTex = Date.now();
    const pcdp = await context.newCDPSession(page);
    const textures: SliceTexture[] = [];
    for (let i = 0; i < sliceCount(bundle); i++) {
      const s = sliceRange(bundle, i);
      const shot = (await withDeadline(
        pcdp.send('Page.captureScreenshot', {
          format: 'webp',
          quality: opts.textureQuality ?? 85,
          // `clip.scale` is the absolute CSS→image scale (CDP ignores the emulated DPR here; verified).
          clip: { x: 0, y: s.y, width: bundle.page.width, height: s.height, scale: dpr },
          captureBeyondViewport: true,
        }),
        req.deadline,
        'texture capture',
      )) as { data: string };
      const bytes = base64ToBytes(shot.data);
      const size = webpSize(bytes);
      if (!size) throw new ServiceError('BUILD_FAILED', 'browser returned an invalid texture');
      textures.push({
        sliceIndex: i,
        y: s.y,
        height: s.height,
        width: size.width,
        heightPx: size.height,
        scale: size.width / bundle.page.width,
        contentType: 'image/webp',
        bytes,
      });
    }
    mark('textures', tTex);
    mark('total', t0);
    return {
      bundle,
      screenshotPng: result.png,
      textures,
      status,
      timingsMs: timings,
      requests: { ...guard.stats, blockedUrls: [...guard.stats.blockedUrls] },
    };
  } finally {
    await context?.close().catch(() => {});
    await bcdp.send('Fetch.disable').catch(() => {});
    await bcdp.detach().catch(() => {});
  }
}
