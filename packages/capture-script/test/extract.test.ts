import { existsSync } from 'node:fs';
import {
  CAPTURE_DPR,
  type CaptureBundle,
  type DomElement,
  MAX_PAGE_HEIGHT_PX,
  parseCapture,
} from '@wwm/schema';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  capturePage,
  dismissCookieBanners,
  type ExtractedPage,
  extractPage,
  freezeMotion,
  hideFixedElements,
  normalizeUrl,
  pageExpression,
  pngSize,
} from '../src/index.ts';

// Browser tests need Playwright Chromium (`pnpm --filter @wwm/fixture-capture browsers`). They are skipped
// locally when it isn't installed; CI installs it and sets CI=true so a missing browser fails loudly.
const HAS_CHROMIUM = existsSync(chromium.executablePath()) || !!process.env.CI;

describe('pure helpers', () => {
  test('normalizeUrl', () => {
    expect(normalizeUrl('HTTPS://Example.COM:443/a?b=2&a=1&utm_source=x#frag')).toBe(
      'https://example.com/a?a=1&b=2',
    );
    expect(normalizeUrl('http://example.com:80')).toBe('http://example.com/');
    expect(() => normalizeUrl('not a url')).toThrow();
  });

  test('pageExpression shims the bundler __name helper', () => {
    // Simulates what esbuild keepNames emits inside a function body.
    const fn = new Function('return (a) => { const f = __name(() => a * 2, "f"); return f(); }')() as (
      a: number,
    ) => number;
    expect(() => fn(2)).toThrow(ReferenceError);
    const evaluate = new Function(`return ${pageExpression(fn, 21)};`) as () => number;
    expect(evaluate()).toBe(42);
  });

  test('extractPage defaults match @wwm/schema constants', () => {
    const src = extractPage.toString();
    const num = (name: string) => Number(src.match(new RegExp(`${name} \\?\\? ([0-9.e]+)`))?.[1]);
    expect(num('maxPageHeight')).toBe(MAX_PAGE_HEIGHT_PX);
    expect(num('maxTextLength')).toBe(120);
  });
});

const PAGE_HTML = `<!doctype html><html><head><title>  Test   Page </title><style>
  body { margin: 0; font: 16px/1.4 sans-serif; background: rgb(250, 250, 240); }
  header { position: fixed; top: 0; left: 0; right: 0; height: 50px; background: #123456; color: #fff; z-index: 10; }
  main { padding: 80px 40px; }
  .card { background: oklch(0.7 0.1 200); width: 300px; height: 120px; margin: 10px 0; }
  .ad-slot { width: 300px; height: 250px; background: #eee; }
  .clip { width: 200px; height: 50px; overflow: hidden; }
  .clip p { margin: 0; height: 400px; }
  .hidden { display: none; }
  .invisible { visibility: hidden; }
  .offscreen { position: absolute; left: -5000px; top: 100px; width: 100px; height: 100px; background: red; }
  .tall { height: 12000px; }
  .sticky { position: sticky; top: 0; background: #ff0; }
</style></head><body>
<header><nav><a href="/a">Alpha</a> <a href="/b">Beta</a></nav></header>
<main>
  <h1 id="h">Hello World</h1>
  <p id="para">Some <b>bold</b> text with a <a href="/x">link</a> inside, long enough to wrap onto more than one
  line in a narrow column so we can count lines. Some <b>bold</b> text with a <a href="/x">link</a> inside, long enough
  to wrap onto more than one line in a narrow column so we can count lines.</p>
  <div id="spanwrap"><span>Only inline children here</span></div>
  <div class="card" id="card"></div>
  <img id="img" alt="A picture" width="200" height="100" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">
  <button id="btn">Press <em>me</em></button>
  <input id="inp" placeholder="Type here">
  <input type="hidden" value="secret">
  <div class="ad-slot" id="ad"></div>
  <div class="clip"><p id="clipped">clipped text</p></div>
  <div class="hidden"><p>never</p></div>
  <p class="invisible">invisible</p>
  <div class="offscreen"></div>
  <div class="sticky" id="sticky">Sticky note</div>
  <div id="outer">Outer text <div id="inner">inner text</div></div>
  <div class="tall"></div>
</main>
<footer>Footer</footer>
</body></html>`;

describe.skipIf(!HAS_CHROMIUM)('in a real browser', () => {
  let browser: Browser;
  let page: Page;
  let out: ExtractedPage;

  const byText = (t: string) => out.elements.find((e) => e.text?.includes(t));
  const kinds = (k: DomElement['kind']) => out.elements.filter((e) => e.kind === k);

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await page.setContent(PAGE_HTML);
    out = (await page.evaluate(pageExpression(extractPage, {}))) as ExtractedPage;
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  test('page metadata', () => {
    expect(out.schema).toBe('wwm.capture/1');
    expect(out.title).toBe('Test Page');
    expect(out.viewport).toEqual({ width: 1280, height: 800 });
    expect(out.page.width).toBe(1280);
    expect(out.page.height).toBe(MAX_PAGE_HEIGHT_PX); // 12000px page capped
    expect(out.backgroundColor).toBe('#fafaf0');
  });

  test('ids are sequential and rects are inside the page', () => {
    out.elements.forEach((e, i) => {
      expect(e.id).toBe(i);
      expect(e.rect.x).toBeGreaterThanOrEqual(0);
      expect(e.rect.y).toBeGreaterThanOrEqual(0);
      expect(e.rect.x + e.rect.w).toBeLessThanOrEqual(out.page.width + 0.01);
      expect(e.rect.y + e.rect.h).toBeLessThanOrEqual(out.page.height + 0.01);
      expect(e.rect.w * e.rect.h).toBeGreaterThan(0);
    });
  });

  test('classification', () => {
    expect(byText('Hello World')?.kind).toBe('heading');
    expect(kinds('header')).toHaveLength(1);
    expect(kinds('nav')).toHaveLength(1);
    expect(kinds('footer')).toHaveLength(0); // below the 6000px cap → dropped
    expect(kinds('image').map((e) => e.text)).toContain('A picture');
    expect(byText('Press me')?.kind).toBe('button');
    expect(kinds('input').map((e) => e.text)).toEqual(['Type here']);
    expect(kinds('adlike')).toHaveLength(1);
    expect(kinds('link').map((e) => e.text)).toEqual(['Alpha', 'Beta', 'link', 'link']);
    expect(byText('Only inline children')?.kind).toBe('text');
  });

  test('skips hidden, invisible and off-page elements', () => {
    expect(byText('never')).toBeUndefined();
    expect(byText('invisible')).toBeUndefined();
    expect(out.elements.some((e) => e.bg === '#ff0000')).toBe(false);
  });

  test('fixed and sticky are flagged (with descendants), z hint resolved', () => {
    const header = kinds('header')[0];
    expect(header?.fixed).toBe(true);
    expect(header?.z).toBe(10);
    expect(kinds('nav')[0]?.fixed).toBe(true);
    expect(byText('Sticky note')?.fixed).toBe(true);
    expect(byText('Hello World')?.fixed).toBe(false);
  });

  test('backgrounds resolve to #rrggbb, including oklch()', () => {
    expect(kinds('header')[0]?.bg).toBe('#123456');
    const card = out.elements.find((e) => e.kind === 'block' && e.rect.w === 300 && e.rect.h === 120);
    expect(card?.bg).toMatch(/^#[0-9a-f]{6}$/);
  });

  test('paragraph text lines: inline runs merged per visual line, one rect per line', () => {
    const p = byText('Some bold text');
    expect(p?.kind).toBe('text');
    expect(p?.text?.length).toBeLessThanOrEqual(120);
    expect(p?.fontSize).toBe(16);
    const lines = p?.lines ?? [];
    expect(lines.length).toBeGreaterThanOrEqual(2);
    // Lines don't overlap vertically (bold/link fragments were merged into their line).
    for (let i = 1; i < lines.length; i++) {
      const a = lines[i - 1];
      const b = lines[i];
      if (a && b) expect(b.y).toBeGreaterThanOrEqual(a.y + a.h - 1);
    }
    // All lines inside the element rect.
    for (const l of lines) {
      expect(l.x).toBeGreaterThanOrEqual((p?.rect.x ?? 0) - 0.01);
      expect(l.y + l.h).toBeLessThanOrEqual((p?.rect.y ?? 0) + (p?.rect.h ?? 0) + 0.01);
    }
  });

  test('text fully contained in a text parent is merged into it', () => {
    const outer = byText('Outer text');
    expect(outer?.text).toContain('inner text');
    expect(out.elements.filter((e) => e.text === 'inner text')).toHaveLength(0);
    expect(outer?.lines?.length).toBe(2);
  });

  test('overflow clipping limits descendant rects', () => {
    const clipped = byText('clipped text');
    expect(clipped?.rect.h).toBeLessThanOrEqual(50);
  });

  test('the assembled bundle passes parseCapture', () => {
    const bundle: CaptureBundle = {
      ...out,
      captureId: 'x',
      capturedAt: new Date().toISOString(),
      screenshot: { path: 'screenshot.png', width: 1280, height: out.page.height, format: 'png', scale: 1 },
    };
    expect(() => parseCapture(bundle)).not.toThrow();
  });

  test('prepare helpers: cookie banner, motion freeze, fixed hiding', async () => {
    const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await p.setContent(`<html><body style="overflow:hidden">
      <div id="onetrust-consent-sdk"><button id="onetrust-reject-all-handler" onclick="window.rejected=1">Reject</button></div>
      <div id="spin" style="animation: s 1s infinite linear; width:10px;height:10px"></div>
      <style>@keyframes s { to { transform: rotate(360deg) } }</style>
      <div style="position:fixed;top:0;width:100px;height:20px">fixed</div>
      <div style="position:sticky;top:0;height:20px">sticky</div>
    </body></html>`);
    const r = await dismissCookieBanners(p);
    expect(r.clicked).toBe('#onetrust-reject-all-handler');
    expect(r.removed).toBe(1);
    expect(await p.evaluate('window.rejected')).toBe(1);
    expect(await p.evaluate('getComputedStyle(document.body).overflow')).toBe('visible');
    await freezeMotion(p);
    expect(await p.evaluate("getComputedStyle(document.getElementById('spin')).animationPlayState")).toBe(
      'paused',
    );
    expect(await hideFixedElements(p)).toBe(2);
    await p.close();
  });

  test('cookie text fallback: rejects inside a consent container, ignores other buttons', async () => {
    const p = await browser.newPage();
    await p.setContent(`<body>
      <button onclick="window.wrong=1">Accept</button>
      <div class="site-cookie-banner"><p>We use cookies</p>
        <button onclick="window.accepted=1">Accept all cookies</button>
        <button onclick="window.rejected=1">Reject additional cookies</button></div>
    </body>`);
    const r = await dismissCookieBanners(p);
    expect(r.clicked).toBe('text:Reject additional cookies');
    expect(await p.evaluate('[window.rejected, window.accepted, window.wrong]')).toEqual([
      1,
      undefined,
      undefined,
    ]);
    expect(await p.evaluate("document.querySelector('.site-cookie-banner')")).toBeNull();
    await p.close();
  });

  test('link targets (contracts §10.1): absolute, normalized, http(s) only, same-page anchors dropped', async () => {
    const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await p.route('https://Wwm.test/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<html><body style="margin:0;font:16px sans-serif">
          <p><a id="rel" href="/docs/page?b=2&a=1&utm_source=x#frag">Relative docs</a></p>
          <p><a href="HTTPS://Other.EXAMPLE:443/path">Off-site story</a></p>
          <p><a href="#section">Same-page anchor</a></p>
          <p><a href="https://wwm.test/here?q=1#top">The page itself</a></p>
          <p><a href="javascript:void(0)">Script link</a></p>
          <p><a href="mailto:someone@example.com">Mail</a></p>
          <p><a href="https://user:pw@example.com/">Credentials</a></p>
          <p><a href="https://example.com/${'x'.repeat(2100)}">Too long</a></p>
          <p><a href="https://example.com/btn"><button>Wrapped button</button></a></p>
          <p><span role="link">Role link</span></p>
        </body></html>`,
      }),
    );
    await p.goto('https://wwm.test/here?q=1');
    const got = (await p.evaluate(pageExpression(extractPage, {}))) as ExtractedPage;
    const href = (t: string) =>
      got.elements.find((e) => (e.kind === 'link' || e.kind === 'button') && e.text?.includes(t))?.href;
    expect(href('Relative docs')).toBe('https://wwm.test/docs/page?a=1&b=2');
    expect(href('Relative docs')).toBe(normalizeUrl('https://wwm.test/docs/page?b=2&a=1&utm_source=x#frag'));
    expect(href('Off-site story')).toBe('https://other.example/path');
    for (const t of ['Same-page anchor', 'The page itself', 'Script link', 'Mail', 'Credentials', 'Too long'])
      expect(href(t), t).toBeUndefined();
    expect(href('Wrapped button')).toBe('https://example.com/btn');
    expect(href('Role link')).toBeUndefined();
    // Only links (and buttons) carry a target.
    for (const e of got.elements) if (e.href) expect(['link', 'button']).toContain(e.kind);
    await p.close();
  }, 60_000);

  test('capturePage end-to-end: 1280-wide PNG, capped height, valid bundle', async () => {
    const p = await browser.newPage();
    await p.route('https://wwm.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: PAGE_HTML }),
    );
    const r = await capturePage(p, 'https://wwm.test/page?utm_source=x#top', {
      screenshotPath: 'screenshot.png',
      now: () => new Date('2026-09-25T00:00:00.000Z'),
    });
    const png = Buffer.from(r.png);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1280);
    expect(png.readUInt32BE(20)).toBe(MAX_PAGE_HEIGHT_PX);
    expect(r.bundle.url).toBe('https://wwm.test/page');
    expect(r.bundle.capturedAt).toBe('2026-09-25T00:00:00.000Z');
    expect(r.bundle.captureId).toMatch(/^[0-9a-f]{64}$/);
    expect(r.hiddenFixed).toBeGreaterThanOrEqual(2);
    expect(r.bundle.screenshot).toMatchObject({ width: 1280, height: MAX_PAGE_HEIGHT_PX, scale: 1 });
    expect(() => parseCapture(r.bundle)).not.toThrow();
    await p.close();
  }, 60_000);

  test('capturePage at CAPTURE_DPR: image is CSS size × scale, element rects stay in CSS px', async () => {
    const ctx = await browser.newContext({ deviceScaleFactor: CAPTURE_DPR });
    const p = await ctx.newPage();
    await p.route('https://wwm.test/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body style="margin:0"><p style="margin:100px">Hello at 2x</p><div style="height:1500px"></div></body></html>',
      }),
    );
    const r = await capturePage(p, 'https://wwm.test/dpr', { screenshotPath: 'screenshot.png' });
    const png = Buffer.from(r.png);
    expect(r.bundle.screenshot.scale).toBe(CAPTURE_DPR);
    expect(r.bundle.page.width).toBe(1280);
    expect(png.readUInt32BE(16)).toBe(1280 * CAPTURE_DPR);
    expect(png.readUInt32BE(20)).toBe(r.bundle.page.height * CAPTURE_DPR);
    expect(r.bundle.screenshot).toMatchObject({
      width: 1280 * CAPTURE_DPR,
      height: r.bundle.page.height * CAPTURE_DPR,
    });
    const hello = r.bundle.elements.find((e) => e.text?.includes('Hello at 2x'));
    expect(hello?.rect.x).toBe(100);
    expect(() => parseCapture(r.bundle)).not.toThrow();
    await ctx.close();
  }, 60_000);
});

test('pngSize reads the IHDR size and rejects non-PNG bytes', () => {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47], 0);
  new DataView(b.buffer).setUint32(16, 2560);
  new DataView(b.buffer).setUint32(20, 3400);
  expect(pngSize(b)).toEqual({ width: 2560, height: 3400 });
  expect(pngSize(new Uint8Array(24))).toBeNull();
});
