/**
 * Capture with real Chromium (capturer b), including SSRF enforcement on every browser request:
 * redirect hops, subresources, iframes, fetch/beacon/EventSource, dedicated workers and WebSockets.
 * The "internal" server stands in for a private service and must never be reached.
 */
import { CAPTURE_DPR, MAX_STAGE_HEIGHT_PX, sliceCount } from '@wwm/schema';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { LocalChromiumCapturer } from '../node/local-chromium.ts';
import { ServiceError } from '../src/errors.ts';
import { decodePng } from '../src/image/png.ts';
import { createStaticResolver } from '../src/policy/dns.ts';
import {
  HAS_CHROMIUM,
  startFixtureSite,
  startInternalServer,
  type TestServer,
} from './helpers/fixture-site.ts';

describe.skipIf(!HAS_CHROMIUM)('local Chromium capture + SSRF guard', () => {
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
