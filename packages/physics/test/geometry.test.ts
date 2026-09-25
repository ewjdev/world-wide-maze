import { validateStage } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { dcos, dsin } from '../src/dmath.ts';
import { bridgeSpecs, elevatorFootprint, inFootprint, islandTrimesh, staticSpecs } from '../src/geometry.ts';
import { DEFAULT_PARAMS } from '../src/params.ts';
import { HANDMADE, island, rect } from './helpers/stages.ts';

type V3 = [number, number, number];

function vert(v: Float32Array, idx: number): V3 {
  return [v[idx * 3] ?? 0, v[idx * 3 + 1] ?? 0, v[idx * 3 + 2] ?? 0];
}

function triNormal(v: Float32Array, i: Uint32Array, t: number): V3 {
  const [a, b, c] = [0, 1, 2].map((k) => vert(v, i[t * 3 + k] ?? 0)) as [V3, V3, V3];
  const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const w: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
}

describe('deterministic trig', () => {
  test('dsin/dcos match Math within 1e-14 on the range the sim uses', () => {
    for (let x = -40; x <= 40; x += 0.0137) {
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-14);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-14);
    }
  });
});

describe('island trimesh', () => {
  test('closed prism with outward normals; top at level, bottom one slab below', () => {
    const isl = island(0, rect(0, 0, 135, 270), 3);
    const { vertices, indices } = islandTrimesh(isl, 0.463);
    expect(indices.length / 3).toBe(2 + 2 + 8); // top 2, bottom 2, sides 4×2
    const ys = new Set<number>();
    for (let k = 1; k < vertices.length; k += 3) ys.add(Math.round((vertices[k] as number) * 1000) / 1000);
    expect([...ys].sort()).toEqual([2.537, 3]);
    // centroid is (5, 2.77, 10): every face normal must point away from it
    for (let t = 0; t < indices.length / 3; t++) {
      const n = triNormal(vertices, indices, t);
      const p = vert(vertices, indices[t * 3] ?? 0);
      const d: V3 = [p[0] - 5, p[1] - 2.77, p[2] - 10];
      expect(n[0] * d[0] + n[1] * d[1] + n[2] * d[2]).toBeGreaterThan(0);
    }
  });

  test('handles negative-area (2013-oriented) contours and holes', () => {
    const outer = rect(0, 0, 270, 270).reverse();
    const hole = rect(100, 100, 50, 50);
    const isl = island(0, outer, 1, { holes: [hole] });
    const { indices } = islandTrimesh(isl, 0.463);
    // top: 8 tris with a square hole, bottom 8, sides (4 + 4) × 2
    expect(indices.length / 3).toBe(8 + 8 + 16);
  });
});

describe('stage colliders', () => {
  test('handmade-simple builds islands, rails and bridge decks', () => {
    expect(validateStage(HANDMADE).ok).toBe(true);
    const specs = staticSpecs(HANDMADE, DEFAULT_PARAMS);
    expect(specs.filter((s) => s.role.type === 'island')).toHaveLength(HANDMADE.islands.length);
    expect(specs.filter((s) => s.role.type === 'bridge').length).toBeGreaterThanOrEqual(
      HANDMADE.bridges.length,
    );
    expect(specs.filter((s) => s.role.type === 'rail').length).toBeGreaterThan(10);
  });

  test('ramp deck top runs from levelA to levelB', () => {
    const ramp = HANDMADE.bridges.find((b) => b.type === 'ramp');
    if (!ramp) throw new Error('fixture has a ramp');
    const islands = new Map(HANDMADE.islands.map((i) => [i.id, i]));
    const [deck] = bridgeSpecs(ramp, islands, DEFAULT_PARAMS);
    if (!deck) throw new Error('deck');
    // top of the deck at its centre = mean level
    const q = deck.rot;
    // local +Y axis of the box in world
    const upY = 1 - 2 * (q[0] * q[0] + q[2] * q[2]);
    const topCentreY = deck.center[1] + deck.half[1] * upY;
    expect(topCentreY).toBeCloseTo((ramp.levelA + ramp.levelB) / 2, 3);
  });

  test('elevator footprint ends at the upper island edge and is ≥ 15 px₂₀₁₃ long', () => {
    const e = HANDMADE.elevators[0];
    if (!e) throw new Error('fixture has an elevator');
    const f = elevatorFootprint(e, DEFAULT_PARAMS);
    expect(f.halfLen * 2 * 13.5).toBeCloseTo(18.75, 5);
    expect(inFootprint(f, 350 / 13.5, 540 / 13.5)).toBe(true);
    expect(inFootprint(f, 340 / 13.5, 540 / 13.5)).toBe(false);
  });
});
