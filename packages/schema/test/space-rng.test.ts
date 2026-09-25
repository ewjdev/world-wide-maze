import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  BALL_RADIUS_M,
  BALL_RADIUS_PX,
  createRng,
  hashString,
  LEVEL_HEIGHT_M,
  levelToWorldY,
  metersToPx,
  mulberry32,
  PX_PER_METER,
  pageToWorld,
  pxToMeters,
  worldToPage,
  worldYToLevel,
} from '../src/index.ts';

const coord = fc.double({ min: -1e6, max: 1e6, noNaN: true });

describe('space (contracts §1)', () => {
  test('pageToWorld follows the contract formulas', () => {
    expect(pageToWorld([400, 800], 2)).toEqual([400 / PX_PER_METER, 2 * LEVEL_HEIGHT_M, 800 / PX_PER_METER]);
    expect(pageToWorld([0, 0])).toEqual([0, 0, 0]);
    expect(BALL_RADIUS_PX).toBe(BALL_RADIUS_M * PX_PER_METER);
  });

  test('property: worldToPage(pageToWorld(p)) ≈ p', () => {
    fc.assert(
      fc.property(coord, coord, fc.integer({ min: -5, max: 10 }), (x, y, level) => {
        const [px, py] = worldToPage(pageToWorld([x, y], level));
        expect(px).toBeCloseTo(x, 6);
        expect(py).toBeCloseTo(y, 6);
      }),
    );
  });

  test('property: pageToWorld(worldToPage(w)) ≈ w (x, z)', () => {
    fc.assert(
      fc.property(coord, coord, coord, (x, y, z) => {
        const w = pageToWorld(worldToPage([x, y, z]));
        expect(w[0]).toBeCloseTo(x, 6);
        expect(w[2]).toBeCloseTo(z, 6);
      }),
    );
  });

  test('property: length and level conversions invert', () => {
    fc.assert(
      fc.property(coord, (v) => {
        expect(metersToPx(pxToMeters(v))).toBeCloseTo(v, 6);
        expect(worldYToLevel(levelToWorldY(v))).toBeCloseTo(v, 6);
      }),
    );
  });

  test('+x right and +y down in page map to +X and +Z in world', () => {
    const a = pageToWorld([0, 0]);
    const b = pageToWorld([PX_PER_METER, PX_PER_METER]);
    expect(b[0] - a[0]).toBe(1);
    expect(b[2] - a[2]).toBe(1);
  });
});

describe('rng', () => {
  test('mulberry32 reference values (seed 1)', () => {
    const g = mulberry32(1);
    // Outputs of the canonical mulberry32 (bryc/code, PRNGs.md) for seed 1.
    expect([g(), g(), g()].map((x) => Math.round(x * 4294967296))).toEqual([
      2693262067, 11749833, 2265367787,
    ]);
  });

  test('same seed → same stream; different seed → different stream', () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const sa = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(sa);
    expect(Array.from({ length: 20 }, () => c.next())).not.toEqual(sa);
  });

  test('property: next() ∈ [0,1), int() within inclusive bounds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: -50, max: 50 }),
        fc.nat(100),
        (seed, lo, span) => {
          const r = createRng(seed);
          for (let i = 0; i < 50; i++) {
            const x = r.next();
            expect(x >= 0 && x < 1).toBe(true);
            const n = r.int(lo, lo + span);
            expect(Number.isInteger(n) && n >= lo && n <= lo + span).toBe(true);
          }
        },
      ),
    );
  });

  test('fork(label) is independent of parent consumption and label-specific', () => {
    const r1 = createRng(7);
    const r2 = createRng(7);
    for (let i = 0; i < 100; i++) r2.next();
    const f1 = r1.fork('items');
    const f2 = r2.fork('items');
    expect(Array.from({ length: 10 }, () => f1.next())).toEqual(Array.from({ length: 10 }, () => f2.next()));
    const g = createRng(7).fork('bridges');
    const h = createRng(7).fork('items');
    expect(g.next()).not.toBe(h.next());
    expect(createRng(7).fork('a').fork('b').seed).toBe(createRng(7).fork('a').fork('b').seed);
  });

  test('shuffle is a permutation and deterministic', () => {
    const base = Array.from({ length: 30 }, (_, i) => i);
    const s1 = createRng(9).shuffle([...base]);
    const s2 = createRng(9).shuffle([...base]);
    expect(s1).toEqual(s2);
    expect([...s1].sort((a, b) => a - b)).toEqual(base);
    expect(s1).not.toEqual(base);
  });

  test('pick/int error on empty input', () => {
    expect(() => createRng(1).pick([])).toThrow();
    expect(() => createRng(1).int(5, 4)).toThrow();
  });

  test('hashString is FNV-1a', () => {
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('a')).toBe(0xe40c292c);
  });
});
