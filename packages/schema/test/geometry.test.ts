import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  bridgeRect,
  distanceToRing,
  isCCW,
  pointInPolygon,
  pointInRing,
  rectToRing,
  ringSelfIntersects,
  ringsOverlap,
  segmentsIntersect,
  signedArea,
  type Vec2,
} from '../src/index.ts';

const sq = rectToRing({ x: 0, y: 0, w: 10, h: 10 });

describe('geometry', () => {
  test('orientation convention: rectToRing is contract-CCW (positive shoelace area)', () => {
    expect(signedArea(sq)).toBe(100);
    expect(isCCW(sq)).toBe(true);
    expect(isCCW([...sq].reverse())).toBe(false);
  });

  test('point in polygon with holes', () => {
    const hole = [...rectToRing({ x: 3, y: 3, w: 4, h: 4 })].reverse();
    expect(pointInRing([5, 5], sq)).toBe(true);
    expect(pointInPolygon([5, 5], sq, [hole])).toBe(false);
    expect(pointInPolygon([1, 1], sq, [hole])).toBe(true);
    expect(pointInRing([11, 5], sq)).toBe(false);
  });

  test('segments intersect (touching counts)', () => {
    expect(segmentsIntersect([0, 0], [10, 10], [0, 10], [10, 0])).toBe(true);
    expect(segmentsIntersect([0, 0], [5, 0], [5, 0], [5, 5])).toBe(true);
    expect(segmentsIntersect([0, 0], [4, 0], [5, 0], [5, 5])).toBe(false);
  });

  test('self-intersection and overlap', () => {
    expect(ringSelfIntersects(sq)).toBe(false);
    expect(
      ringSelfIntersects([
        [0, 0],
        [10, 10],
        [10, 0],
        [0, 10],
      ]),
    ).toBe(true);
    expect(ringsOverlap(sq, rectToRing({ x: 5, y: 5, w: 10, h: 10 }))).toBe(true);
    expect(ringsOverlap(sq, rectToRing({ x: 2, y: 2, w: 2, h: 2 }))).toBe(true); // containment
    expect(ringsOverlap(sq, rectToRing({ x: 20, y: 0, w: 5, h: 5 }))).toBe(false);
  });

  test('bridgeRect has the requested width', () => {
    const r = bridgeRect([0, 0], [100, 0], 40);
    expect(Math.abs(signedArea(r))).toBeCloseTo(4000);
  });

  test('property: distanceToRing is 0 on vertices and positive inside', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.5, max: 9.5, noNaN: true }),
        fc.double({ min: 0.5, max: 9.5, noNaN: true }),
        (x, y) => {
          const p: Vec2 = [x, y];
          const d = distanceToRing(p, sq);
          expect(d).toBeCloseTo(Math.min(x, y, 10 - x, 10 - y), 9);
        },
      ),
    );
  });
});
