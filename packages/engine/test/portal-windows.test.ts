/** Portal windows (N; plans/portal-windows-execution.md): atlas layout, picture crop, postcard monogram, codes. */
import { MAX_PORTALS, PX_PER_METER } from '@wwm/schema';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { describe, expect, test } from 'vitest';
import { CHASE } from '../src/camera/chase.ts';
import { introCameraKeys, introPageRect, introTimeline } from '../src/camera/intro.ts';
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

describe('introPageRect (the matched cut target)', () => {
  const W = 1280 / PX_PER_METER;
  const D = 986 / PX_PER_METER;
  const pageY = 0;
  /** Project the upright page's corners with intro key 0's camera, the way the engine draws frame 0. */
  function projected(viewW: number, viewH: number) {
    const tl = introTimeline('fast');
    const keys = introCameraKeys(
      {
        width: W,
        depth: D,
        pageY,
        meanY: 0,
        start: new Vector3(1, 0, 1),
        goal: new Vector3(W - 1, 0, D - 1),
        chasePos: new Vector3(),
        chaseTarget: new Vector3(),
        fovDeg: CHASE.fov,
        aspect: viewW / viewH,
      },
      tl,
    );
    const k0 = keys[0] as { pos: Vector3; target: Vector3 };
    const cam = new PerspectiveCamera(CHASE.fov, viewW / viewH, 0.1, 1000);
    cam.position.copy(k0.pos);
    cam.lookAt(k0.target);
    cam.updateMatrixWorld();
    const px = (x: number, y: number) => {
      const v = new Vector3(x, y, D).project(cam);
      return [((v.x + 1) / 2) * viewW, ((1 - v.y) / 2) * viewH] as const;
    };
    const [x0, y0] = px(0, pageY + D);
    const [x1, y1] = px(W, pageY);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  test.each([
    ['landscape', 1280, 800],
    ['portrait', 390, 844],
  ])('%s: equals the projected corners of the upright page', (_, vw, vh) => {
    const r = introPageRect(W, D, CHASE.fov, vw, vh);
    const p = projected(vw, vh);
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(r[k]).toBeCloseTo(p[k], 3);
    // and the page fits inside the view with the key's margin
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(vw + 1e-6);
    expect(r.y + r.height).toBeLessThanOrEqual(vh + 1e-6);
  });
});
