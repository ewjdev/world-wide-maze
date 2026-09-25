/**
 * Contract v0.2.7: CaptureBundle size limits (CCR-12-3) and zod's jitless mode (CCR-12-1).
 */
import { describe, expect, test } from 'vitest';
import { globalConfig } from 'zod/v4/core';
import {
  CAPTURE_LIMITS,
  type CaptureBundle,
  CaptureBundleSchema,
  type DomElement,
  parseCapture,
} from '../src/index.ts';

const el = (id: number, extra: Partial<DomElement> = {}): DomElement => ({
  id,
  kind: 'text',
  rect: { x: 0, y: id, w: 10, h: 1 },
  depth: 0,
  z: 0,
  fixed: false,
  ...extra,
});

const bundle = (over: Partial<CaptureBundle> = {}): CaptureBundle => ({
  schema: 'wwm.capture/1',
  captureId: 'c',
  url: 'https://example.com/',
  title: 'Example',
  capturedAt: '2026-09-25T00:00:00Z',
  viewport: { width: 1280, height: 800 },
  page: { width: 1280, height: 800 },
  screenshot: { path: 'screenshot.png', width: 1280, height: 800, format: 'png', scale: 1 },
  backgroundColor: '#ffffff',
  elements: [el(0)],
  ...over,
});

const ok = (b: CaptureBundle) => CaptureBundleSchema.safeParse(b).success;

describe('CaptureBundle size limits (v0.2.7, CCR-12-3)', () => {
  test('the limits have the contract values', () => {
    expect(CAPTURE_LIMITS).toEqual({
      elements: 20_000,
      title: 512,
      url: 2048,
      text: 120,
      linesPerElement: 200,
    });
  });

  test('elements ≤ 20,000', () => {
    const at = Array.from({ length: CAPTURE_LIMITS.elements }, (_, i) => el(i));
    expect(ok(bundle({ elements: at }))).toBe(true);
    expect(ok(bundle({ elements: [...at, el(at.length)] }))).toBe(false);
  });

  test('title ≤ 512 and url ≤ 2,048 characters', () => {
    expect(ok(bundle({ title: 't'.repeat(512) }))).toBe(true);
    expect(ok(bundle({ title: 't'.repeat(513) }))).toBe(false);
    const url = (n: number) => `https://example.com/${'a'.repeat(n - 20)}`;
    expect(url(2048)).toHaveLength(2048);
    expect(ok(bundle({ url: url(2048) }))).toBe(true);
    expect(ok(bundle({ url: url(2049) }))).toBe(false);
  });

  test('text ≤ 120 and lines ≤ 200 per element', () => {
    expect(ok(bundle({ elements: [el(0, { text: 'x'.repeat(120) })] }))).toBe(true);
    expect(ok(bundle({ elements: [el(0, { text: 'x'.repeat(121) })] }))).toBe(false);
    const lines = (n: number) => Array.from({ length: n }, (_, i) => ({ x: 0, y: i, w: 5, h: 1 }));
    expect(ok(bundle({ elements: [el(0, { lines: lines(200) })] }))).toBe(true);
    expect(ok(bundle({ elements: [el(0, { lines: lines(201) })] }))).toBe(false);
  });

  test('parseCapture throws on an oversized bundle', () => {
    expect(() => parseCapture(bundle({ title: 't'.repeat(600) }))).toThrow();
  });
});

describe('zod jitless (v0.2.7, CCR-12-1)', () => {
  test('importing @wwm/schema switches zod to jitless, so it never probes `new Function`', () => {
    expect(globalConfig.jitless).toBe(true);
  });

  test('no Function constructor call while parsing (the CSP eval probe)', () => {
    const original = globalThis.Function;
    let calls = 0;
    const spy = new Proxy(original, {
      construct(target, args) {
        calls++;
        return Reflect.construct(target, args);
      },
      apply(target, self, args) {
        calls++;
        return Reflect.apply(target, self, args);
      },
    });
    globalThis.Function = spy;
    try {
      for (let i = 0; i < 3; i++) expect(ok(bundle({ captureId: `c${i}` }))).toBe(true);
    } finally {
      globalThis.Function = original;
    }
    expect(calls).toBe(0);
  });
});
