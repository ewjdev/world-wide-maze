/** Portal windows (N; plans/portal-windows-execution.md): atlas layout, picture crop, postcard monogram, codes. */
import { MAX_PORTALS } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import {
  monogramLetter,
  PREVIEW_CELL,
  PREVIEW_CODE,
  PREVIEW_COLS,
  PREVIEW_PAD,
  previewAtlasSize,
  previewCell,
  previewCrop,
} from '../src/world/portals.ts';

describe('preview atlas', () => {
  test('one cell per portal, PREVIEW_COLS to a row', () => {
    expect(previewAtlasSize(1)).toEqual({ width: PREVIEW_CELL, height: PREVIEW_CELL });
    expect(previewAtlasSize(3)).toEqual({ width: 3 * PREVIEW_CELL, height: PREVIEW_CELL });
    expect(previewAtlasSize(4)).toEqual({ width: 3 * PREVIEW_CELL, height: 2 * PREVIEW_CELL });
    expect(previewAtlasSize(MAX_PORTALS)).toEqual({ width: 3 * PREVIEW_CELL, height: 2 * PREVIEW_CELL });
  });

  test('cells tile the atlas without overlap, and every cell fits inside it', () => {
    const n = MAX_PORTALS;
    const { width, height } = previewAtlasSize(n);
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) {
      const c = previewCell(i);
      expect(c.x + c.size).toBeLessThanOrEqual(width);
      expect(c.y + c.size).toBeLessThanOrEqual(height);
      expect(c.x % PREVIEW_CELL).toBe(0);
      expect(c.y % PREVIEW_CELL).toBe(0);
      seen.add(`${c.x},${c.y}`);
    }
    expect(seen.size).toBe(n);
    expect(previewCell(PREVIEW_COLS)).toMatchObject({ x: 0, y: PREVIEW_CELL });
  });

  test('the sampled region leaves a gutter on every side (no mip bleed from neighbours)', () => {
    const c = previewCell(0);
    expect(c.inner).toBe(PREVIEW_CELL - 2 * PREVIEW_PAD);
    expect(PREVIEW_PAD).toBeGreaterThanOrEqual(8);
  });
});

describe('preview crop', () => {
  test('a tall page shows its top square', () => {
    expect(previewCrop(1280, 6000)).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 1280 });
  });

  test('a wide picture is centred horizontally', () => {
    expect(previewCrop(1600, 800)).toEqual({ sx: 400, sy: 0, sw: 800, sh: 800 });
  });

  test('a square picture is used whole', () => {
    expect(previewCrop(384, 384)).toEqual({ sx: 0, sy: 0, sw: 384, sh: 384 });
  });
});

describe('postcard and codes', () => {
  test('the monogram skips common subdomains', () => {
    expect(monogramLetter('en.wikipedia.org')).toBe('W');
    expect(monogramLetter('gov.uk')).toBe('G');
    expect(monogramLetter('www2.example.com')).toBe('E');
    expect(monogramLetter('')).toBe('?');
  });

  test('state.w codes are distinct, and 0 is the Phase 13 vortex', () => {
    expect(PREVIEW_CODE.none).toBe(0);
    expect(new Set(Object.values(PREVIEW_CODE)).size).toBe(3);
  });
});
