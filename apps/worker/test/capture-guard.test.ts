/**
 * Capture with real Chromium (capturer b), including SSRF enforcement on every browser request:
 * redirect hops, subresources, iframes, fetch/beacon/EventSource, dedicated workers and WebSockets.
 * The "internal" server stands in for a private service and must never be reached.
 */
import { CAPTURE_DPR, MAX_STAGE_HEIGHT_PX, sliceCount } from '@wwm/schema';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { LocalChromiumCapturer } from '../node/local-chromium.ts';
import { captureWithBrowser } from '../src/capture/core.ts';
import { ServiceError } from '../src/errors.ts';
import { decodePng } from '../src/image/png.ts';
import { createStaticResolver } from '../src/policy/dns.ts';
import {
  HAS_CHROMIUM,
  startFixtureSite,
  startInternalServer,
  type TestServer,
} from './helpers/fixture-site.ts';
import {
  type CountingServer,
  FRAME_BYPASS_CASES,
  startCountingInternalServer,
  startFrameBypassSite,
} from './helpers/frame-bypass-site.ts';

// Each capture has a 20 s budget (and the first one launches Chromium), so the tests get more than Vitest's
// default 5 s: on a busy CI runner the long-page capture alone took over 5 s.
describe.skipIf(!HAS_CHROMIUM)('local Chromium capture + SSRF guard', { timeout: 30_000 }, () => {
  let internal: TestServer;
  let site: TestServer;
  let capturer: LocalChromiumCapturer;

  beforeAll(async () => {
    internal = await startInternalServer();
    site = await startFixtureSite(internal.origin);
    capturer = new LocalChromiumCapturer({
      guard: {
        resolver: createStaticResolver({ 'rebind.attacker.dev': ['127.0.0.1'] }),
        allowHosts: [site.host],
      },
    });
  });
  afterAll(async () => {
    await capturer?.close();
    await site?.close();
    await internal?.close();
  });

  const capture = (path: string, budgetMs = 20_000) =>
    capturer.capture({ url: `${site.origin}${path}`, deadline: Date.now() + budgetMs });

  const codeOf = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'ok';
    } catch (e) {
      return e instanceof ServiceError ? e.code : `other: ${(e as Error).message}`;
    }
  };

  test('captures a long page: bundle, 1× analysis PNG, one DPR-2 WebP texture per slice', async () => {
    const out = await capture('/long');
    const { bundle } = out;
    expect(bundle.page.width).toBe(1280);
    expect(bundle.page.height).toBeGreaterThan(MAX_STAGE_HEIGHT_PX);
    expect(bundle.screenshot).toMatchObject({ path: 'screenshot.png', format: 'png', scale: 1, width: 1280 });
    expect(bundle.screenshot.height).toBe(bundle.page.height);
    const img = await decodePng(out.screenshotPng);
    expect([img.width, img.height]).toEqual([bundle.screenshot.width, bundle.screenshot.height]);
    expect(out.textures).toHaveLength(sliceCount(bundle));
    let y = 0;
    for (const t of out.textures) {
      expect(t.y).toBe(y);
      expect(t.width).toBe(1280 * CAPTURE_DPR);
      expect(t.heightPx).toBe(t.height * CAPTURE_DPR);
      expect(t.scale).toBe(CAPTURE_DPR);
      y += t.height;
    }
    expect(y).toBe(bundle.page.height);
    expect(out.status).toBe(200);
    expect(bundle.elements.some((e) => e.kind === 'heading')).toBe(true);
  });

  test('every request to a private address is blocked: redirects, subresources, frames, fetch, workers, sockets', async () => {
    const before = internal.hits.length;
    const out = await capture('/leaky');
    await new Promise((r) => setTimeout(r, 300));
    expect(internal.hits.slice(before)).toEqual([]);
    expect(out.requests.blocked).toBeGreaterThanOrEqual(5);
    const blocked = out.requests.blockedUrls.join('\n');
    expect(blocked).toContain('/img-via-redirect'); // the redirect HOP was intercepted, not just the first URL
    expect(blocked).toContain('/fetch-via-redirect');
    expect(blocked).toContain('/frame');
    // The page still rendered (the guard fails only the forbidden requests).
    expect(out.bundle.title).toBe('Leaky fixture');
  });

  test('top-level redirect to a private address → URL_FORBIDDEN, target never reached', async () => {
    const before = internal.hits.length;
    expect(await codeOf(capture(`/redirect?to=${encodeURIComponent(`${internal.origin}/admin`)}`))).toBe(
      'URL_FORBIDDEN',
    );
    expect(await codeOf(capture('/redirect?to=http%3A%2F%2F169.254.169.254%2Flatest%2Fmeta-data%2F'))).toBe(
      'URL_FORBIDDEN',
    );
    expect(await codeOf(capture('/redirect?to=http%3A%2F%2Frebind.attacker.dev%2F'))).toBe('URL_FORBIDDEN');
    expect(await codeOf(capture('/redirect?to=file%3A%2F%2F%2Fetc%2Fpasswd'))).not.toBe('ok');
    expect(internal.hits.length).toBe(before);
  });

  test('bot walls and error statuses → CAPTURE_BLOCKED', async () => {
    expect(await codeOf(capture('/status403'))).toBe('CAPTURE_BLOCKED');
    expect(await codeOf(capture('/challenge'))).toBe('CAPTURE_BLOCKED');
  });

  test('a page that never loads → CAPTURE_TIMEOUT within the budget', async () => {
    const t0 = Date.now();
    expect(await codeOf(capture('/slow', 4000))).toBe('CAPTURE_TIMEOUT');
    expect(Date.now() - t0).toBeLessThan(8000);
  });
});

/**
 * Child-realm bypasses: a page takes WebSocket / WebSocketStream / Worker / SharedWorker / RTCPeerConnection
 * from a realm the top-level init script may not cover (sync about:blank iframe, srcdoc/data:/blob:/
 * javascript: frames, cross-site OOPIF, nested frames, <object>/<embed>, popups) and aims them at the
 * internal server, which counts HTTP requests, WebSocket upgrades and raw TCP connections.
 *
 * The browser is launched WITHOUT `HARDENING_ARGS` (Browser Run doesn't get our Chromium flags), so only
 * the shared `core.ts` defences count.
 */
describe.skipIf(!HAS_CHROMIUM)('SSRF guard: iframe / popup / child-realm bypasses', () => {
  let internal: CountingServer;
  let fixture: Awaited<ReturnType<typeof startFrameBypassSite>>;
  let browser: Browser;

  beforeAll(async () => {
    internal = await startCountingInternalServer();
    fixture = await startFrameBypassSite(internal);
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    await fixture?.close();
    await internal?.close();
  });

  const settle = () => new Promise((r) => setTimeout(r, 500));

  test('control: without the capture guard, the same attacks DO reach the internal server', async () => {
    const ctx = await browser.newContext();
    const page: Page = await ctx.newPage();
    const before = { hits: internal.hits.length, conns: internal.connections() };
    await page.goto(`${fixture.site.origin}/case/cross`);
    await page.waitForTimeout(1000);
    await ctx.close();
    const hits = internal.hits.slice(before.hits);
    expect(hits).toEqual(
      expect.arrayContaining(['ws:/ws-cross', 'ws:/ws-cross-blank', 'ws:/wss-cross', 'ws:/ws-worker-cross']),
    );
    expect(internal.connections() - before.conns).toBeGreaterThan(hits.length); // TURN over TCP is visible too
  });

  test.each(FRAME_BYPASS_CASES)(
    '%s: the internal server sees 0 requests, upgrades and connections',
    async (name) => {
      const before = { hits: internal.hits.length, conns: internal.connections() };
      const siteBefore = fixture.site.hits.length + fixture.cross.hits.length;
      const out = await captureWithBrowser<Page>(
        browser,
        { url: `${fixture.site.origin}/case/${name}`, deadline: Date.now() + 20_000 },
        {
          guard: {
            resolver: createStaticResolver({}),
            allowHosts: [fixture.site.host, fixture.cross.host],
          },
        },
      );
      await settle();
      expect(out.bundle.title).toBe(`Case ${name}`);
      expect({
        hits: internal.hits.slice(before.hits),
        connections: internal.connections() - before.conns,
      }).toEqual({
        hits: [],
        connections: 0,
      });
      // Not vacuous: the cross-site frames and popups were actually loaded.
      const loaded = [...fixture.site.hits, ...fixture.cross.hits].length - siteBefore;
      expect(loaded).toBeGreaterThanOrEqual(1);
      const crossTag = { cross: 'cross', nested: 'nested-cross', object: 'object', popup: 'popup-link' }[
        name as string
      ];
      if (crossTag) expect(fixture.cross.hits).toContain(`/attack?tag=${crossTag}`);
    },
  );
});
