import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ELEVATOR_MIN_PLATFORM_PX,
  PX_PER_METER,
  SLAB_THICKNESS_M,
  type StageData,
  type Vec2,
} from '@wwm/schema';
import { Euler, Object3D, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { describe, expect, test } from 'vitest';
import { CHASE, ChaseCamera, tickLerpAlpha, tiltQuaternion, yawFromDirection } from '../src/camera/chase.ts';
import { fitDistance, introTimeline, progress, sampleKeys } from '../src/camera/intro.ts';
import { buildHeightfield, lineOfSight, sampleTop } from '../src/geom/heightfield.ts';
import { MeshBuilder, mergeMeshData } from '../src/geom/mesh.ts';
import {
  buildStageMeshes,
  elevatorFootprint,
  gapIntoIsland,
  offsetOutward,
  triangulateIsland,
} from '../src/geom/structures.ts';
import { clipTriangleToBand, fan, planTiles, tileUv, triArea } from '../src/geom/tiling.ts';
import { ENGINE_NAME } from '../src/index.ts';
import { MAX_TIER, QualityLadder } from '../src/quality.ts';

const stage = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../fixtures/stages/handmade-simple.json', import.meta.url)),
    'utf8',
  ),
) as StageData;

test('package name', () => {
  expect(ENGINE_NAME).toBe('@wwm/engine');
});

describe('texture tiling', () => {
  test('one tile when the image fits', () => {
    const p = planTiles(1280, 1600, 2, 4096);
    expect(p.tiles).toHaveLength(1);
    expect(p.downscale).toBe(1);
    expect(p.tiles[0]).toMatchObject({ row0: 0, row1: 1600 });
  });

  test('tall images split into ≤ maxSize bands that cover every row exactly once', () => {
    expect(planTiles(2560, 9000, 2, 4096).tiles).toHaveLength(3);
    const p = planTiles(2560, 3400, 2, 1024); // width 2560 > 1024: downscale 0.4 → 1360 rows → 2 bands
    expect(p.tiles).toHaveLength(2);
    expect(p.downscale).toBeCloseTo(1024 / 2560);
    let row = 0;
    for (const t of p.tiles) {
      expect(t.row0).toBe(row);
      expect(t.row1 - t.row0).toBeLessThanOrEqual(1024);
      row = t.row1;
    }
    expect(row).toBe(Math.round(3400 * p.downscale));
    // band edges in stage px line up with rows / scale
    expect(p.tiles[1]?.stageY0).toBeCloseTo((p.tiles[1]?.row0 ?? 0) / p.scale);
  });

  test('UVs: v = 0 at the tile top row, u spans the width', () => {
    const p = planTiles(1280, 1600, 2, 800);
    const t1 = p.tiles[1];
    if (!t1) throw new Error('expected 2 tiles');
    expect(tileUv([0, t1.row0 / p.scale], t1, p)).toEqual([0, 0]);
    const [u, v] = tileUv([640, t1.row1 / p.scale], t1, p);
    expect(u).toBeCloseTo(1);
    expect(v).toBeCloseTo(1);
  });

  test('clipping a triangle into bands preserves its area', () => {
    const tri: [Vec2, Vec2, Vec2] = [
      [10, 5],
      [300, 180],
      [40, 390],
    ];
    const bands: [number, number][] = [
      [Number.NEGATIVE_INFINITY, 100],
      [100, 250],
      [250, Number.POSITIVE_INFINITY],
    ];
    let area = 0;
    for (const [a, b] of bands) for (const f of fan(clipTriangleToBand(tri, a, b))) area += triArea(f);
    expect(area).toBeCloseTo(triArea(tri), 6);
    expect(clipTriangleToBand(tri, 500, 600)).toHaveLength(0);
  });
});

describe('stage meshes', () => {
  const plan = planTiles(stage.texture.width, stage.texture.height, stage.texture.scale, 4096);
  const m = buildStageMeshes(stage, plan);

  test('one top buffer per tile; tops face up, bottoms face down', () => {
    expect(m.tops).toHaveLength(1);
    const top = m.tops[0];
    if (!top) throw new Error('no tops');
    let up = 0;
    let down = 0;
    for (let i = 0; i < top.normal.length; i += 3) {
      const ny = top.normal[i + 1] as number;
      if (ny > 0.99) up++;
      else if (ny < -0.99) down++;
    }
    expect(up).toBe(down);
    expect(up + down).toBe(top.triangles * 3);
  });

  test('island top area equals the contour area and UVs stay in [0, 1]', () => {
    const top = m.tops[0];
    if (!top) throw new Error('no tops');
    let area = 0;
    for (let t = 0; t < top.triangles; t++) {
      const o = t * 9;
      if ((top.normal[o + 1] as number) < 0) continue;
      const p = (k: number): Vec2 => [
        top.position[o + k * 3] as number,
        top.position[o + k * 3 + 2] as number,
      ];
      area += triArea([p(0), p(1), p(2)]);
    }
    const expected = stage.islands.reduce((s, i) => {
      const [x0, y0] = i.contour[0] as Vec2;
      const [x1, y1] = i.contour[2] as Vec2;
      return s + (Math.abs(x1 - x0) * Math.abs(y1 - y0)) / PX_PER_METER ** 2;
    }, 0);
    expect(area).toBeCloseTo(expected, 3);
    for (const v of top.uv) {
      expect(v).toBeGreaterThanOrEqual(-1e-6);
      expect(v).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  test('tiling does not change the geometry, only splits it', () => {
    const tiled = buildStageMeshes(stage, planTiles(stage.texture.width, stage.texture.height, 2, 512));
    expect(tiled.tops.length).toBeGreaterThan(1);
    const areaOf = (parts: typeof tiled.tops) =>
      parts.reduce((s, md) => {
        for (let t = 0; t < md.triangles; t++) {
          const o = t * 9;
          const p = (k: number): Vec2 => [
            md.position[o + k * 3] as number,
            md.position[o + k * 3 + 2] as number,
          ];
          s += triArea([p(0), p(1), p(2)]);
        }
        return s;
      }, 0);
    expect(areaOf(tiled.tops)).toBeCloseTo(areaOf(m.tops), 3);
  });

  test('slab thickness, rails and merge counts', () => {
    // all island side quads span exactly the slab thickness
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 1; i < m.sides.position.length; i += 3) {
      minY = Math.min(minY, m.sides.position[i] as number);
      maxY = Math.max(maxY, m.sides.position[i] as number);
    }
    expect(minY).toBeCloseTo(0 - SLAB_THICKNESS_M, 5);
    expect(maxY).toBeCloseTo(4, 5);
    expect(m.bridges.triangles).toBeGreaterThan(0);
    expect(m.rails.triangles).toBeGreaterThan(0);
    const merged = mergeMeshData([m.sides, m.bridges, m.rails]);
    expect(merged.triangles).toBe(m.sides.triangles + m.bridges.triangles + m.rails.triangles);
    expect(merged.position.length).toBe(merged.triangles * 9);
    expect(merged.hsv.length).toBe(merged.triangles * 9);
  });

  test('triangulation handles holes', () => {
    const outer: Vec2[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    const hole: Vec2[] = [
      [40, 40],
      [40, 60],
      [60, 60],
      [60, 40],
    ];
    const tris = triangulateIsland(outer, [hole]);
    const area = tris.reduce((s, t) => s + triArea(t), 0);
    expect(area).toBeCloseTo(100 * 100 - 20 * 20, 6);
  });
});

describe('physics-matching helpers (contracts v0.2.2)', () => {
  test('elevator footprint ends at b with length max(|b−a|, min)', () => {
    const fp = elevatorFootprint([360, 540], [344, 540], 48);
    const xs = fp.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(344, 6);
    expect(Math.max(...xs)).toBeCloseTo(344 + ELEVATOR_MIN_PLATFORM_PX, 6);
    const ys = fp.map((p) => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(48, 6);
  });

  test('gapIntoIsland and outward rail offsets', () => {
    const island = stage.islands[0];
    if (!island) throw new Error('no island');
    expect(gapIntoIsland([275, 90], [1, 0], island)).toBe(0); // already inside
    expect(gapIntoIsland([290, 90], [-1, 0], island)).toBe(11); // first px strictly inside x < 280
    // bottom edge y = 300 runs right→left in the fixture: the offset line must move to y > 300
    const off = offsetOutward(
      [
        [280, 300],
        [40, 300],
      ],
      island,
      5,
    );
    expect(off[0]?.[1]).toBeCloseTo(305, 6);
  });
});

describe('heightfield', () => {
  const hf = buildHeightfield(stage);
  test('samples island levels and misses the gaps', () => {
    expect(sampleTop(hf, 100 / PX_PER_METER, 170 / PX_PER_METER)).toBeCloseTo(0);
    expect(sampleTop(hf, 190 / PX_PER_METER, 690 / PX_PER_METER)).toBeCloseTo(4);
    expect(sampleTop(hf, 480 / PX_PER_METER, 380 / PX_PER_METER)).toBeCloseTo(0.75, 1); // ramp midpoint
    expect(Number.isNaN(sampleTop(hf, 320 / PX_PER_METER, 360 / PX_PER_METER))).toBe(true);
  });
  test('line of sight is blocked by a slab', () => {
    const under: [number, number, number] = [10, -0.2, 10];
    const above: [number, number, number] = [10, 5, 10];
    expect(lineOfSight(hf, above, [10, 0.5, 11])).toBe(1);
    expect(lineOfSight(hf, above, under)).toBeLessThan(1);
  });
});

describe('camera', () => {
  test('yaw convention = three.js camera.rotation.y (YXZ); yaw 0 looks up the page (−Z)', () => {
    expect(yawFromDirection(0, -1)).toBeCloseTo(0);
    for (const target of [
      new Vector3(-3, 0, -1),
      new Vector3(2, 1, 5),
      new Vector3(-4, -1, 3),
      new Vector3(5, 0, 0.2),
    ]) {
      const cam = new PerspectiveCamera();
      cam.lookAt(target);
      const e = new Euler().setFromQuaternion(cam.quaternion, 'YXZ');
      expect(yawFromDirection(target.x, target.z)).toBeCloseTo(e.y, 6);
    }
  });

  test('tilt quaternion: +tiltZ tips gravity forward, +tiltX to the right, in the yaw frame', () => {
    for (const yaw of [0, 0.7, -2.1]) {
      const fwd = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const g1 = new Vector3(0, -1, 0).applyQuaternion(tiltQuaternion(0, 0.4, yaw));
      expect(g1.dot(fwd)).toBeCloseTo(Math.sin(0.4), 6);
      const g2 = new Vector3(0, -1, 0).applyQuaternion(tiltQuaternion(0.3, 0, yaw));
      expect(g2.dot(right)).toBeCloseTo(Math.sin(0.3), 6);
    }
  });

  test('chase camera settles on the 2013 leash: 4.63 m at 35°, behind the travel direction', () => {
    const cam = new ChaseCamera();
    const ball = new Vector3(0, 0.5, 0);
    cam.reset(ball, new Vector3(0, 0.5, -10));
    for (let i = 0; i < 300; i++) {
      ball.z -= 0.05; // roll up the page
      cam.update(ball, 1 / 60, null);
    }
    for (let i = 0; i < 120; i++) cam.update(ball, 1 / 60, null);
    const off = cam.position.clone().sub(ball);
    expect(off.length()).toBeCloseTo(CHASE.distance, 2);
    expect(Math.asin(off.y / off.length())).toBeCloseTo(CHASE.elevation, 2);
    expect(off.z).toBeGreaterThan(0); // behind: the ball moved towards −Z
    expect(cam.yaw()).toBeCloseTo(0, 2);
  });

  test('frame-rate independent smoothing matches 0.11 per 60 Hz tick', () => {
    expect(tickLerpAlpha(0.11, 1 / 60)).toBeCloseTo(0.11, 10);
    const twoAt120 = 1 - (1 - tickLerpAlpha(0.11, 1 / 120)) ** 2;
    expect(twoAt120).toBeCloseTo(0.11, 10);
  });

  test('camera up is untouched by an identity lean', () => {
    const cam = new ChaseCamera();
    cam.update(new Vector3(), 1 / 60, null);
    expect(cam.up.toArray()).toEqual([0, 1, 0]);
    void Object3D;
  });
});

describe('intro timeline', () => {
  test('fast mode stays within 8 s; full mode keeps the 2013 order', () => {
    const fast = introTimeline('fast');
    const full = introTimeline('full');
    expect(fast.total).toBeLessThanOrEqual(8);
    for (const tl of [fast, full]) {
      expect(tl.fold.start).toBeLessThan(tl.extrude.start);
      expect(tl.extrude.start).toBeLessThan(tl.bridges.start);
      expect(tl.bridges.start).toBeLessThanOrEqual(tl.appear.start);
      expect(tl.appear.end).toBeLessThanOrEqual(tl.fly.start + 0.5);
      expect(tl.fly.end).toBeLessThanOrEqual(tl.ballDrop.start);
      expect(tl.ballDrop.end).toBeCloseTo(tl.total);
    }
    expect(full.extrude.end - full.extrude.start).toBeCloseTo(3); // E: islands extrude over 3 s
    expect(full.ballDrop.end - full.ballDrop.start).toBeCloseTo(3); // E: cage drop 3 s
    expect(progress(full.fold.start - 1, full.fold)).toBe(0);
    expect(progress(full.fold.end + 1, full.fold)).toBe(1);
  });

  test('camera keys interpolate through their points', () => {
    const keys = [
      { t: 0, pos: new Vector3(0, 0, 0), target: new Vector3() },
      { t: 1, pos: new Vector3(10, 0, 0), target: new Vector3() },
      { t: 3, pos: new Vector3(10, 10, 0), target: new Vector3() },
    ];
    const p = new Vector3();
    const q = new Vector3();
    sampleKeys(keys, 1, p, q);
    expect(p.x).toBeCloseTo(10);
    sampleKeys(keys, 5, p, q);
    expect(p.toArray()).toEqual([10, 10, 0]);
    expect(fitDistance(10, 10, 90, 1)).toBeCloseTo(5);
  });
});

describe('quality ladder', () => {
  const run = (l: QualityLadder, fps: number, sec: number) => {
    for (let t = 0; t < sec; t += 1 / fps) l.sample(1 / fps);
  };

  test('steps down through the 2013 rungs and recovers with hysteresis', () => {
    const l = new QualityLadder('auto');
    run(l, 60, 5);
    expect(l.tier).toBe(0);
    run(l, 42, 5); // < 45: env map off
    expect(l.tier).toBe(1);
    expect(l.features.envMapUpdates).toBe(false);
    run(l, 35, 5); // < 40: render scale 0.7, FXAA off
    expect(l.tier).toBe(2);
    expect(l.features.renderScale).toBe(0.7);
    run(l, 20, 12); // < 30, then < 24 → down to the bottom
    expect(l.tier).toBe(MAX_TIER);
    run(l, 60, 60);
    expect(l.tier).toBe(0);
    expect(l.log.length).toBeGreaterThanOrEqual(6);
  });

  test('borderline fps does not oscillate', () => {
    const l = new QualityLadder('auto');
    run(l, 44, 6);
    const t = l.tier;
    run(l, 50, 30); // above 45 but below the +10 recovery margin
    expect(l.tier).toBe(t);
  });

  test('fixed settings never change', () => {
    const l = new QualityLadder('high');
    run(l, 10, 10);
    expect(l.tier).toBe(0);
    expect(new QualityLadder('low').tier).toBe(3);
  });
});

test('mesh builder winds faces towards the requested side', () => {
  const mb = new MeshBuilder();
  mb.tri([0, 0, 0], [1, 0, 0], [0, 0, 1], undefined, undefined, undefined, [0, 1, 0]);
  const md = mb.build();
  expect(md.normal[1]).toBeCloseTo(1);
});
