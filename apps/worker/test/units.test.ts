import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { type CaptureBundle, type JobEvent, parseCapture } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { detectBlocked } from '../src/capture/bot-wall.ts';
import type { CaptureOutput } from '../src/capture/types.ts';
import { decodeCaptureOutput, encodeCaptureOutput, errorFromWire } from '../src/capture/wire.ts';
import { errorResponse, ServiceError } from '../src/errors.ts';
import { computeRunId, defaultSeed, runCacheKey } from '../src/ids.ts';
import { decodePng, readPngHeader } from '../src/image/png.ts';
import { webpSize } from '../src/image/webp.ts';
import { JobEventHub, parseSse, sseFrame } from '../src/job-events.ts';

const fixture = (slug: string) => new URL(`../../../fixtures/captures/${slug}/`, import.meta.url);

// ── PNG ─────────────────────────────────────────────────────────────────────────────────────────────

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
/** Reference encoder: each row uses filter (y % 5), exercising Sub/Up/Average/Paeth. */
function encodePng(w: number, h: number, channels: 3 | 4, px: Uint8Array): Uint8Array {
  const stride = w * channels;
  const raw = new Uint8Array(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    const f = y % 5;
    raw[y * (stride + 1)] = f;
    for (let i = 0; i < stride; i++) {
      const x = px[y * stride + i] as number;
      const a = i >= channels ? (px[y * stride + i - channels] as number) : 0;
      const b = y > 0 ? (px[(y - 1) * stride + i] as number) : 0;
      const c = y > 0 && i >= channels ? (px[(y - 1) * stride + i - channels] as number) : 0;
      const p = a + b - c;
      const pr =
        Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c)
          ? a
          : Math.abs(p - b) <= Math.abs(p - c)
            ? b
            : c;
      const pred = [0, a, b, (a + b) >> 1, pr][f] as number;
      raw[y * (stride + 1) + 1 + i] = (x - pred) & 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, channels === 4 ? 6 : 2, 0, 0, 0], 8);
  const z = deflateSync(raw);
  // Split IDAT in two to exercise multi-chunk streams.
  const mid = Math.floor(z.length / 2);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', z.subarray(0, mid)),
    chunk('IDAT', z.subarray(mid)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('PNG decoder', () => {
  test.each([3, 4] as const)('round-trips every filter type (%i channels)', async (channels) => {
    const w = 37;
    const h = 23;
    const px = new Uint8Array(w * h * channels);
    let s = 12345;
    for (let i = 0; i < px.length; i++) {
      s = (s * 1103515245 + 12345) >>> 0;
      px[i] = i % 7 === 0 ? (s >>> 24) & 0xff : (i * 31) & 0xff;
    }
    const img = await decodePng(encodePng(w, h, channels, px));
    expect([img.width, img.height]).toEqual([w, h]);
    for (let p = 0; p < w * h; p++) {
      for (let c = 0; c < 3; c++) expect(img.data[p * 4 + c]).toBe(px[p * channels + c]);
      expect(img.data[p * 4 + 3]).toBe(channels === 4 ? px[p * channels + 3] : 255);
    }
  });

  test('decodes a real Chromium screenshot (hn-front fixture)', async () => {
    const bytes = new Uint8Array(readFileSync(new URL('screenshot.png', fixture('hn-front'))));
    const header = readPngHeader(bytes);
    const img = await decodePng(bytes);
    expect([img.width, img.height]).toEqual([header.width, header.height]);
    expect(img.data.length).toBe(img.width * img.height * 4);
  });

  test('rejects non-PNG and oversize images', async () => {
    await expect(decodePng(new Uint8Array(40))).rejects.toThrow(/not a PNG/);
    const tiny = encodePng(4, 4, 4, new Uint8Array(64));
    await expect(decodePng(tiny, { maxPixels: 10 })).rejects.toThrow(/exceeds/);
  });
});

describe('WebP size', () => {
  test('VP8 / VP8L / VP8X headers', () => {
    const riff = (tag: string, body: number[]) =>
      new Uint8Array([
        ...new TextEncoder().encode('RIFF'),
        0,
        0,
        0,
        0,
        ...new TextEncoder().encode(`WEBP${tag}`),
        ...body,
      ]);
    // VP8X: canvas 2560×3400 stored as (w−1, h−1) 24-bit LE at offset 24/27.
    const x = riff('VP8X', [0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0x09, 0x00, 0x47, 0x0d, 0x00, 0, 0, 0]);
    expect(webpSize(x)).toEqual({ width: 2560, height: 3400 });
    const lossy = riff('VP8 ', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x00, 0x0a, 0x40, 0x06, 0, 0]);
    expect(webpSize(lossy)).toEqual({ width: 2560, height: 1600 });
    const bits = (100 - 1) | ((50 - 1) << 14);
    const lossless = riff('VP8L', [
      0,
      0,
      0,
      0,
      0x2f,
      bits & 0xff,
      (bits >> 8) & 0xff,
      (bits >> 16) & 0xff,
      (bits >> 24) & 0xff,
      0,
      0,
      0,
      0,
      0,
    ]);
    expect(webpSize(lossless)).toEqual({ width: 100, height: 50 });
    expect(webpSize(new Uint8Array(40))).toBeNull();
  });
});

// ── wire format ─────────────────────────────────────────────────────────────────────────────────────

describe('capture wire format', () => {
  test('round-trips bundle, screenshot and textures', () => {
    const bundle = parseCapture(
      JSON.parse(readFileSync(new URL('capture.json', fixture('example-sparse')), 'utf8')),
    );
    const out: CaptureOutput = {
      bundle,
      screenshotPng: new Uint8Array([1, 2, 3, 4, 5]),
      textures: [
        {
          sliceIndex: 0,
          y: 0,
          height: 800,
          width: 2560,
          heightPx: 1600,
          scale: 2,
          contentType: 'image/webp',
          bytes: new Uint8Array([9, 8, 7]),
        },
      ],
      status: 200,
      timingsMs: { total: 12 },
      requests: { allowed: 3, blocked: 1, blockedUrls: ['http://10.0.0.1/ (private)'] },
    };
    const back = decodeCaptureOutput(encodeCaptureOutput(out));
    expect(back).toEqual(out);
    expect(() => decodeCaptureOutput(new Uint8Array(20))).toThrow(/bad header/);
  });

  test('sidecar errors map back to contract codes', () => {
    expect(errorFromWire(422, { code: 'CAPTURE_BLOCKED', message: 'x' })).toMatchObject({
      code: 'CAPTURE_BLOCKED',
    });
    expect(errorFromWire(500, { nope: 1 })).toMatchObject({ code: 'BUILD_FAILED' });
  });
});

// ── errors, ids ─────────────────────────────────────────────────────────────────────────────────────

describe('errors and ids', () => {
  test('error responses carry {code, message}, the mapped status, and Retry-After when rate limited', async () => {
    const r = errorResponse(new ServiceError('RATE_LIMITED', 'slow down', 42.2));
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('43');
    expect(await r.json()).toEqual({ code: 'RATE_LIMITED', message: 'slow down' });
    expect(errorResponse(new ServiceError('URL_FORBIDDEN', 'no')).status).toBe(400);
    expect(errorResponse(new ServiceError('CAPTURE_TIMEOUT', 'no')).status).toBe(504);
  });

  test('run ids and cache keys', async () => {
    const a = await computeRunId('cap', 1, '1.0.0', 'normal');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await computeRunId('cap', 2, '1.0.0', 'normal')).not.toBe(a);
    expect(defaultSeed('https://example.com/')).toBe(defaultSeed('https://example.com/'));
    expect(runCacheKey('https://example.com/', 'easy', '1.0.0')).toBe('run:https://example.com/:easy:1.0.0');
    expect(runCacheKey('https://example.com/', 'easy', '1.0.0', 7)).toBe(
      'run:https://example.com/:easy:1.0.0:seed=7',
    );
  });
});

// ── bot walls ───────────────────────────────────────────────────────────────────────────────────────

describe('bot-wall heuristics', () => {
  const sparse = parseCapture(
    JSON.parse(readFileSync(new URL('capture.json', fixture('example-sparse')), 'utf8')),
  );
  const page = (
    title: string,
    texts: string[],
    n = texts.length,
  ): Pick<CaptureBundle, 'title' | 'elements' | 'page'> => ({
    title,
    page: { width: 1280, height: 800 },
    elements: Array.from({ length: n }, (_, i) => ({
      id: i,
      kind: 'text' as const,
      rect: { x: 0, y: i * 10, w: 100, h: 10 },
      depth: 1,
      z: 0,
      fixed: false,
      ...(texts[i] ? { text: texts[i] } : {}),
    })),
  });
  test('a tiny legitimate page (example.com, 4 elements) passes', () => {
    expect(detectBlocked({ status: 200, bundle: sparse })).toBeNull();
  });
  test('error statuses, challenge markers and empty pages are blocked', () => {
    expect(detectBlocked({ status: 403, bundle: sparse })).toMatch(/403/);
    expect(detectBlocked({ status: 200, bundle: page('Just a moment...', ['x']) })).toMatch(/bot check/);
    expect(detectBlocked({ status: 200, bundle: page('Shop', ['Verify you are human']) })).toMatch(
      /bot check/,
    );
    expect(detectBlocked({ status: 200, bundle: page('Blank', []) })).toMatch(/nothing/);
  });
  test('a long page that merely mentions captcha is fine', () => {
    expect(
      detectBlocked({ status: 200, bundle: page('Captcha — Wikipedia', ['CAPTCHA is a test'], 200) }),
    ).toBeNull();
  });
});

// ── SSE ─────────────────────────────────────────────────────────────────────────────────────────────

describe('job event stream', () => {
  const progress = (step: string, pct: number): JobEvent => ({ type: 'progress', step, pct });

  test('frame format: event = type, data = the rest', () => {
    expect(sseFrame(progress('capturing', 5))).toBe(
      'event: progress\ndata: {"step":"capturing","pct":5}\n\n',
    );
  });

  test('late subscribers get a replay; streams end after the terminal event; one terminal only', async () => {
    const hub = new JobEventHub([progress('queued', 0)]);
    const live = hub.stream().text();
    hub.push(progress('capturing', 5));
    hub.push({ type: 'done', runId: 'r', stageIds: ['s'] });
    hub.push({ type: 'error', code: 'BUILD_FAILED', message: 'ignored' });
    const late = await hub.stream().text();
    for (const text of [await live, late])
      expect(parseSse(text)).toEqual([
        progress('queued', 0),
        progress('capturing', 5),
        { type: 'done', runId: 'r', stageIds: ['s'] },
      ]);
    expect(hub.finished).toBe(true);
  });
});
