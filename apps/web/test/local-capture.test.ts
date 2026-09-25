/**
 * Phase 14 receiver logic: who may hand a capture to /play/local, and what a valid handoff is.
 * The browser path (extension → receiver → playable maze, bookmarklet sketch mode) is apps/extension's e2e.
 */
import { readFileSync } from 'node:fs';
import { normalizeUrl } from '@wwm/capture-script';
import { CAPTURE_LIMITS, type CaptureBundle, computeCaptureId } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { bookmarkletCode, bookmarkletHref } from '../src/local-capture/bookmarklet.ts';
import {
  isCaptureMessage,
  isTrustedSource,
  LOCAL_LIMITS,
  LocalCaptureError,
  MSG,
  validateCaptureMessage,
} from '../src/local-capture/protocol.ts';
import { inkOn, luminance, paintSketch, SKETCH_SCALE, sketchBundle } from '../src/local-capture/sketch.ts';
import { LOCAL_STRINGS } from '../src/local-capture/strings.ts';

const HN = JSON.parse(
  readFileSync(new URL('../../../fixtures/captures/hn-front/capture.json', import.meta.url), 'utf8'),
) as CaptureBundle;

const bytes = (n: number) => new ArrayBuffer(n);
const msg = (over: Record<string, unknown> = {}) => ({
  type: MSG.capture,
  version: 1,
  bundle: HN,
  image: { mime: 'image/png', bytes: bytes(1024) },
  ...over,
});
const expectReject = async (p: Promise<unknown>, reason: LocalCaptureError['reason']) => {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(LocalCaptureError);
  expect((e as LocalCaptureError).reason).toBe(reason);
};

describe('isTrustedSource', () => {
  const win = { name: 'game tab' };
  const opener = { name: 'bookmarklet tab' };
  const origin = 'http://localhost:5173';

  test('the extension content script: same window and same origin', () => {
    expect(isTrustedSource({ source: win as never, origin }, { window: win, opener: null, origin })).toBe(
      'extension',
    );
  });
  test('the bookmarklet: the opener, from any origin', () => {
    const self = { window: win, opener, origin };
    expect(isTrustedSource({ source: opener as never, origin: 'https://news.example' }, self)).toBe(
      'bookmarklet',
    );
  });
  test.each([
    [
      'same window, wrong origin (a spoofed origin cannot happen, but the rule holds)',
      win,
      'https://evil.example',
    ],
    ['another window, same origin (e.g. an iframe or another tab)', { name: 'frame' }, origin],
    ['another window, other origin', { name: 'evil' }, 'https://evil.example'],
    ['no source', null, origin],
  ])('rejects %s', (_label, source, from) => {
    expect(
      isTrustedSource({ source: source as never, origin: from }, { window: win, opener, origin }),
    ).toBeNull();
  });
  test('no opener: an opener-looking message is still rejected', () => {
    expect(
      isTrustedSource(
        { source: opener as never, origin: 'https://a.example' },
        { window: win, opener: null, origin },
      ),
    ).toBeNull();
  });
});

describe('validateCaptureMessage', () => {
  test('a valid extension capture: URL normalized, captureId recomputed (never trusted)', async () => {
    const forged = { ...HN, url: 'https://News.YCombinator.com/?utm_source=x#top', captureId: 'x' };
    const cap = await validateCaptureMessage(msg({ bundle: forged }), 'extension', normalizeUrl);
    expect(cap.bundle.url).toBe('https://news.ycombinator.com/');
    expect(cap.bundle.captureId).toBe(await computeCaptureId('https://news.ycombinator.com/', HN.capturedAt));
    expect(cap.image?.mime).toBe('image/png');
    expect(cap.via).toBe('extension');
  });
  test('a DOM-only bookmarklet capture is sketch mode (image null)', async () => {
    const cap = await validateCaptureMessage(msg({ image: null }), 'bookmarklet', normalizeUrl);
    expect(cap.image).toBeNull();
  });
  test('the extension must send a screenshot', async () => {
    await expectReject(validateCaptureMessage(msg({ image: null }), 'extension', normalizeUrl), 'image');
  });
  test.each([
    ['wrong type', { type: 'wwm:other' }, 'shape'],
    ['wrong version', { version: 2 }, 'shape'],
    ['bad schema tag', { bundle: { ...HN, schema: 'nope' } }, 'schema'],
    [
      'too many elements (v0.2.7 limit)',
      { bundle: { ...HN, elements: Array(CAPTURE_LIMITS.elements + 1).fill(HN.elements[0]) } },
      'schema',
    ],
    ['non-http page', { bundle: { ...HN, url: 'file:///Users/me/secret.html' } }, 'schema'],
    [
      'huge page',
      { bundle: { ...HN, page: { width: LOCAL_LIMITS.pageWidth + 1, height: 800 } } },
      'too-large',
    ],
    ['gif', { image: { mime: 'image/gif', bytes: bytes(10) } }, 'image'],
    ['no bytes', { image: { mime: 'image/png', bytes: 'AAAA' } }, 'image'],
    [
      'too many bytes',
      { image: { mime: 'image/png', bytes: bytes(LOCAL_LIMITS.imageBytes + 1) } },
      'too-large',
    ],
    [
      'screenshot not page × scale',
      { bundle: { ...HN, screenshot: { ...HN.screenshot, width: 999 } } },
      'image',
    ],
  ])('rejects %s', async (_l, over, reason) => {
    await expectReject(
      validateCaptureMessage(msg(over as Record<string, unknown>), 'extension', normalizeUrl),
      reason as LocalCaptureError['reason'],
    );
  });
  test('isCaptureMessage only looks at the type', () => {
    expect(isCaptureMessage({ type: 'wwm:capture' })).toBe(true);
    expect(isCaptureMessage({ type: 'wwm:ready' })).toBe(false);
    expect(isCaptureMessage('wwm:capture')).toBe(false);
    expect(isCaptureMessage(null)).toBe(false);
  });
});

describe('bookmarklet', () => {
  test('compiles, embeds the game origin, and only talks to that origin and the tab it opened', () => {
    const code = bookmarkletCode('https://maze.example');
    expect(() => new Function(code)).not.toThrow();
    expect(code).toContain('"https://maze.example"');
    expect(code).toContain('w.postMessage(m,O)');
    expect(code).toContain('e.source!==w||e.origin!==O');
    expect(code).toContain('image:null');
    const href = bookmarkletHref('https://maze.example');
    expect(href.startsWith('javascript:')).toBe(true);
    expect(decodeURIComponent(href.slice('javascript:'.length))).toBe(code);
  });
  test('stays a reasonable bookmark size', () => {
    expect(bookmarkletHref('https://maze.example').length).toBeLessThan(64_000);
  });
});

describe('sketch mode', () => {
  test('contrast ink follows the surface', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1);
    expect(inkOn('#ffffff')).toBe('#1c2127');
    expect(inkOn('#101820')).toBe('#f4f5f6');
  });
  test('paints every box and its text, in page coordinates', () => {
    const calls: string[] = [];
    let fill = '';
    const g = {
      set fillStyle(v: string) {
        fill = v;
      },
      get fillStyle() {
        return fill;
      },
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textBaseline: 'middle' as CanvasTextBaseline,
      fillRect: (x: number, y: number, w: number, h: number) =>
        calls.push(`rect ${fill} ${x},${y},${w},${h}`),
      strokeRect: () => calls.push('stroke'),
      fillText: (t: string) => calls.push(`text ${fill} ${t}`),
      measureText: (t: string) => ({ width: t.length * 7 }),
      save() {},
      restore() {},
      beginPath() {},
      rect() {},
      clip() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      scale() {},
    };
    paintSketch(g, HN);
    expect(calls[0]).toBe(`rect ${HN.backgroundColor} 0,0,${HN.page.width},${HN.page.height}`);
    // the orange HN header bar in its own colour, with its text in dark ink on it
    expect(calls.some((c) => c.startsWith('rect #ff6600'))).toBe(true);
    expect(calls.some((c) => c.startsWith('text') && c.includes('Hacker News'))).toBe(true);
    const sb = sketchBundle(HN);
    expect(sb.screenshot).toMatchObject({ width: HN.page.width * SKETCH_SCALE, scale: SKETCH_SCALE });
  });
});

describe('strings', () => {
  test('en and ja have the same keys', () => {
    expect(Object.keys(LOCAL_STRINGS.ja).sort()).toEqual(Object.keys(LOCAL_STRINGS.en).sort());
    expect(LOCAL_STRINGS.ja.extSteps).toHaveLength(LOCAL_STRINGS.en.extSteps.length);
  });
});
