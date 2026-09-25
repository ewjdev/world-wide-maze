/** Unit tests for the raster steps: grid, background, semantic, morphology, distance, islands. */
import { describe, expect, test } from 'vitest';
import { classifyBackground, dominantColor } from '../src/background.ts';
import { parseColor, rgbToLab } from '../src/color.ts';
import { distanceTransform } from '../src/distance.ts';
import { createGrid, forEachSample, rectToCells } from '../src/grid.ts';
import { extractIslands, labelComponents, splitOversized, thickenThin } from '../src/islands.ts';
import { close, dilate, erode, fillHoles, open } from '../src/morphology.ts';
import { DEFAULT_PARAMS } from '../src/params.ts';
import { semanticFill } from '../src/semantic.ts';
import { sliceElements } from '../src/slice-elements.ts';
import { maskFrom, maskToRows, synthCapture } from './helpers.ts';

describe('color', () => {
  test('parseColor handles hex, short hex, rgb() and transparent rgba()', () => {
    expect(parseColor('#ff6600')).toEqual([255, 102, 0]);
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3]);
    expect(parseColor('rgba(1, 2, 3, 0)')).toBeNull();
    expect(parseColor(undefined)).toBeNull();
  });
  test('Lab of white and black', () => {
    expect(rgbToLab(255, 255, 255)[0]).toBeCloseTo(100, 0);
    expect(rgbToLab(0, 0, 0)[0]).toBeCloseTo(0, 5);
  });
});

describe('grid', () => {
  test('cell averages and sampling honour screenshot scale', () => {
    for (const scale of [1, 2]) {
      const { image } = synthCapture(12, 6, [{ rect: { x: 0, y: 0, w: 6, h: 6 }, color: [0, 0, 0] }], {
        scale,
      });
      const g = createGrid(image, scale, 12, 6, 0, 3);
      expect([g.cols, g.rows]).toEqual([4, 2]);
      expect(g.cellRgb[0]).toBe(0); // cell (0,0) black
      expect(g.cellRgb[3 * 3]).toBe(255); // cell (3,0) white
      let n = 0;
      forEachSample(g, 0, 0, () => n++);
      expect(n).toBe(9);
    }
  });
  test('slice offset reads the right image rows', () => {
    const { image } = synthCapture(6, 12, [{ rect: { x: 0, y: 6, w: 6, h: 6 }, color: [0, 0, 0] }]);
    const g = createGrid(image, 1, 6, 6, 6, 3);
    expect(g.cellRgb[0]).toBe(0);
  });
  test('rectToCells clamps', () => {
    expect(rectToCells({ cols: 4, rows: 4, cell: 3 }, { x: -5, y: 4, w: 100, h: 1 })).toEqual({
      c0: 0,
      c1: 4,
      r0: 1,
      r1: 2,
    });
  });
});

describe('background', () => {
  test('dominant color is the page background; blocks are foreground', () => {
    const { capture, image } = synthCapture(
      60,
      30,
      [{ rect: { x: 30, y: 0, w: 15, h: 15 }, color: [200, 0, 0] }],
      {
        bg: [240, 240, 240],
      },
    );
    const g = createGrid(image, 1, 60, 30, 0, 3);
    expect(dominantColor(g)).toEqual([240, 240, 240]);
    const els = sliceElements(capture, { index: 0, count: 1, y: 0, height: 30 }, 60).elements;
    const r = classifyBackground(g, els, capture.backgroundColor, 60 * 30, DEFAULT_PARAMS);
    expect(r.backgroundMask[0]).toBe(1);
    expect(r.backgroundMask[10]).toBe(0); // cell (10,0) = x 30..33, red
  });
  test("a large element's own bg becomes local background (colored sections don't become islands)", () => {
    const { capture, image } = synthCapture(
      60,
      60,
      [
        { rect: { x: 0, y: 30, w: 60, h: 30 }, color: [0, 40, 120], bg: '#002878' },
        { rect: { x: 21, y: 39, w: 12, h: 12 }, color: [255, 255, 255] },
      ],
      { bg: [255, 255, 255] },
    );
    const g = createGrid(image, 1, 60, 60, 0, 3);
    const els = sliceElements(capture, { index: 0, count: 1, y: 0, height: 60 }, 60).elements;
    const r = classifyBackground(g, els, capture.backgroundColor, 60 * 60, DEFAULT_PARAMS);
    expect(r.regionElementIds).toEqual([0]);
    expect(r.backgroundMask[12 * 20 + 2]).toBe(1); // blue band = background
    expect(r.backgroundMask[14 * 20 + 8]).toBe(0); // white box on the band = foreground
  });
});

describe('semantic', () => {
  const setup = (blocks: Parameters<typeof synthCapture>[2]) => {
    const { capture, image } = synthCapture(90, 60, blocks);
    const g = createGrid(image, 1, 90, 60, 0, 3);
    const els = sliceElements(capture, { index: 0, count: 1, y: 0, height: 60 }, 90).elements;
    const bg = classifyBackground(g, els, capture.backgroundColor, 90 * 60, DEFAULT_PARAMS);
    return { g, els, bg };
  };
  test('visible images are filled solid; invisible ones are skipped', () => {
    const { g, els, bg } = setup([
      { rect: { x: 0, y: 0, w: 30, h: 30 }, kind: 'image', color: [250, 250, 250] }, // faint but with a mark
      { rect: { x: 3, y: 3, w: 9, h: 9 }, color: [0, 0, 0] },
      { rect: { x: 45, y: 0, w: 30, h: 30 }, kind: 'image', paint: false },
    ]);
    const s = semanticFill(g, els, bg.backgroundMask, DEFAULT_PARAMS);
    expect(s.filledElementIds).toEqual([0]);
    expect(s.mask[5 * 30 + 5]).toBe(1);
    expect(s.mask[5 * 30 + 20]).toBe(0);
  });
  test('lines of one text element join into a paragraph block', () => {
    const lines = [
      { x: 6, y: 6, w: 60, h: 12 },
      { x: 6, y: 24, w: 40, h: 12 },
    ];
    const { g, els, bg } = setup([
      { rect: { x: 6, y: 6, w: 60, h: 30 }, kind: 'text', lines, paint: false },
      ...lines.map((l) => ({ rect: l })),
    ]);
    const s = semanticFill(g, els, bg.backgroundMask, DEFAULT_PARAMS);
    // the leading between the lines (y 18..24) is filled over the shared x-range
    expect(s.mask[Math.floor(21 / 3) * 30 + 5]).toBe(1);
    // …but not beyond the shorter line
    expect(s.mask[Math.floor(21 / 3) * 30 + 20]).toBe(0);
  });
});

describe('morphology', () => {
  test('dilate / erode / open / close / fillHoles', () => {
    const { mask, cols, rows } = maskFrom(['.......', '.......', '...#...', '.......', '.......']);
    expect(maskToRows(dilate(mask, cols, rows, 1, 0), cols, rows)[2]).toBe('..###..');
    expect(maskToRows(erode(dilate(mask, cols, rows, 1), cols, rows, 1), cols, rows)).toEqual(
      maskToRows(mask, cols, rows),
    );
    const bar = maskFrom(['#######', '#######', '.......', '#.#####']);
    expect(maskToRows(open(bar.mask, bar.cols, bar.rows, 1, 0), bar.cols, bar.rows)).toEqual([
      '#######',
      '#######',
      '.......',
      '..#####',
    ]);
    const gap = maskFrom(['##.##']);
    expect(maskToRows(close(gap.mask, gap.cols, gap.rows, 1, 0), gap.cols, gap.rows)).toEqual(['#####']);
    const ring = maskFrom(['#####', '#...#', '#####']);
    expect(maskToRows(fillHoles(ring.mask, ring.cols, ring.rows, 3), ring.cols, ring.rows)).toEqual([
      '#####',
      '#####',
      '#####',
    ]);
    expect(maskToRows(fillHoles(ring.mask, ring.cols, ring.rows, 2), ring.cols, ring.rows)).toEqual([
      '#####',
      '#...#',
      '#####',
    ]);
  });
});

describe('distance transform', () => {
  test('exact Euclidean distances to the nearest water cell (grid border = water)', () => {
    const { mask, cols, rows } = maskFrom(['.....', '.###.', '.###.', '.###.', '.....']);
    const d = distanceTransform(mask, cols, rows);
    expect(d[2 * 5 + 2]).toBeCloseTo(2, 6);
    expect(d[1 * 5 + 1]).toBeCloseTo(1, 6);
    expect(d[0]).toBe(0);
    const full = distanceTransform(new Uint8Array(9).fill(1), 3, 3);
    expect(full[4]).toBeCloseTo(2, 6);
  });
});

describe('islands', () => {
  test('labeling is 4-connected and in raster order', () => {
    const { mask, cols, rows } = maskFrom(['##..#', '#...#', '..#..']);
    const { labels, count } = labelComponents(mask, cols, rows);
    expect(count).toBe(3);
    expect([labels[0], labels[4], labels[12]]).toEqual([1, 2, 3]);
    // U-shape merges through the bottom (union-find second pass)
    const u = maskFrom(['#.#', '###']);
    expect(labelComponents(u.mask, u.cols, u.rows).count).toBe(1);
  });
  test('components too thin for a 2 D disc are dropped', () => {
    const { mask, cols, rows } = maskFrom([
      '..............',
      '.##########...',
      '.##########...',
      '..............',
      '.##########...',
      '.##########...',
      '.##########...',
      '.##########...',
      '.##########...',
      '.##########...',
      '.##########...',
      '.##########...',
      '.##########...',
      '..............',
    ]);
    const r = extractIslands(mask, cols, rows, 3, { ...DEFAULT_PARAMS, minIslandAreaPx2: 0 });
    expect(r.count).toBe(1);
    expect(r.droppedMask[1 * cols + 1]).toBe(1);
  });
  test('oversized components are split into tiles', () => {
    const cols = 200;
    const rows = 200;
    const mask = new Uint8Array(cols * rows).fill(1);
    const n = splitOversized(mask, cols, rows, 3, {
      ...DEFAULT_PARAMS,
      splitAreaPx2: 100_000,
      splitTilePx: 300,
    });
    expect(n).toBe(1);
    expect(labelComponents(mask, cols, rows).count).toBe(4);
  });
  test('thin components are thickened without touching neighbors', () => {
    const { mask, cols, rows } = maskFrom([
      '..........',
      '..........',
      '..........',
      '..######..',
      '..........',
      '..........',
      '..######..',
      '..######..',
      '..######..',
      '..........',
    ]);
    const n = thickenThin(mask, cols, rows, 3, 12, 3);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(labelComponents(mask, cols, rows).count).toBe(2); // still separate
    expect(mask[1 * cols + 4]).toBe(1); // grew upward
  });
});
