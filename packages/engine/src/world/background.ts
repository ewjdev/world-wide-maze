/**
 * The 2013 "ocean": not water but a huge faceted pastel triangle plane far below the islands, with wire
 * lines and dots, ripples when a ball is lost, floating dots ("stars") and a ring of clouds on the horizon.
 * E: `game/object/background`, `seamaterial`, `dotmaterial`, `ripplematerial`, `clouds` (bundle-notes §11).
 * Art is new; colours are the recovered COLOR_TRIANGLE / COLOR_WIRE.
 */
import { mulberry32 } from '@wwm/schema';
import {
  attribute,
  float,
  fwidth,
  instancedBufferAttribute,
  max,
  min,
  mix,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec3,
  vertexStage,
} from 'three/tsl';
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  Sprite,
  SpriteNodeMaterial,
  SRGBColorSpace,
  type Vector3,
  Vector4,
} from 'three/webgpu';
import { COLOR_TRIANGLE, COLOR_WIRE, GROUND_SIZE_M, WU } from '../palette.ts';
import type { Bin } from './bin.ts';
import type { N, SharedUniforms } from './shared.ts';
import { LAYER_ENV } from './stage-world.ts';

export interface Background {
  group: Group;
  ground: Mesh;
  motes: Sprite;
  clouds: Mesh;
  /** 1 = wires, dots, motes; 0 = cheap tier */
  rich: N;
  ripple(x: number, z: number, now: number): void;
  triangles: number;
}

export function buildBackground(
  center: Vector3,
  groundY: number,
  islandsLowY: number,
  u: SharedUniforms,
  bin: Bin,
): Background {
  const rng = mulberry32(0xb4c6);
  const group = new Group();
  group.name = 'background';
  const rich = uniform(1);
  const rippleU = uniform(new Vector4(0, 0, -100, 0));

  // ── faceted plane ──
  const N = 44;
  const S = GROUND_SIZE_M;
  const cell = S / N;
  const verts: [number, number][] = [];
  for (let j = 0; j <= N; j++)
    for (let i = 0; i <= N; i++) {
      const edge = i === 0 || j === 0 || i === N || j === N;
      const jx = edge ? 0 : (rng() - 0.5) * cell * 0.7;
      const jz = edge ? 0 : (rng() - 0.5) * cell * 0.7;
      verts.push([center.x - S / 2 + i * cell + jx, center.z - S / 2 + j * cell + jz]);
    }
  const tris: number[] = [];
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i;
      const b = a + 1;
      const c = a + N + 1;
      const d = c + 1;
      if (rng() < 0.5) tris.push(a, c, b, b, c, d);
      else tris.push(a, c, d, a, d, b);
    }
  const T = tris.length / 3;
  const pos = new Float32Array(T * 9);
  const col = new Float32Array(T * 9);
  const wire = new Float32Array(T * 9);
  const bary = new Float32Array(T * 9);
  const seed = new Float32Array(T * 3);
  const c = new Color();
  for (let t = 0; t < T; t++) {
    c.set(COLOR_TRIANGLE[Math.floor(rng() * COLOR_TRIANGLE.length)] as string);
    const cr = c.r;
    const cg = c.g;
    const cb = c.b;
    c.set(COLOR_WIRE[Math.floor(rng() * COLOR_WIRE.length)] as string);
    const s = rng();
    for (let k = 0; k < 3; k++) {
      const v = verts[tris[t * 3 + k] as number] as [number, number];
      const o = (t * 3 + k) * 3;
      pos[o] = v[0];
      pos[o + 1] = groundY;
      pos[o + 2] = v[1];
      col[o] = cr;
      col[o + 1] = cg;
      col[o + 2] = cb;
      wire[o] = c.r;
      wire[o + 1] = c.g;
      wire[o + 2] = c.b;
      bary[o + k] = 1;
      seed[t * 3 + k] = s;
    }
  }
  const g = bin.add(new BufferGeometry());
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('facet', new BufferAttribute(col, 3));
  g.setAttribute('wire', new BufferAttribute(wire, 3));
  g.setAttribute('bary', new BufferAttribute(bary, 3));
  g.setAttribute('seed', new BufferAttribute(seed, 1));
  g.computeBoundingSphere();

  const gm = bin.add(new MeshBasicNodeMaterial());
  gm.name = 'ocean';
  // gentle swell: a height per *vertex position* so shared corners stay welded
  const p = positionLocal;
  const h = sin(p.x.mul(0.013).add(p.z.mul(0.017)).add(u.time.mul(0.35)))
    .mul(sin(p.x.mul(0.021).sub(p.z.mul(0.009)).add(u.time.mul(0.27))))
    .mul(6);
  // ripple (E: droplet ripple on ball loss): a ring expanding at 30 m/s for 4 s
  const age = u.time.sub(rippleU.z);
  const dist = p.xz.distance(rippleU.xy);
  const ring = float(1).sub(smoothstep(0, 14, dist.sub(age.mul(30)).abs()));
  const rippleAmt = ring
    .mul(float(1).sub(smoothstep(0, 4, age)))
    .mul(rippleU.w)
    .mul(age.greaterThan(0).select(1, 0));
  gm.positionNode = vec3(p.x, p.y.add(h).add(rippleAmt.mul(9)), p.z);
  const facet: N = attribute('facet', 'vec3');
  const sd: N = attribute('seed', 'float');
  const shimmer = vertexStage(
    sin(sd.mul(91.7).add(u.time.mul(0.5)))
      .mul(0.045)
      .add(1),
  );
  const b: N = attribute('bary', 'vec3');
  const edgeDist = min(min(b.x, b.y), b.z);
  const w = fwidth(edgeDist).mul(1.3);
  const lineMask = float(1).sub(smoothstep(w.mul(0.3), w, edgeDist));
  const dot = smoothstep(0.955, 0.975, max(max(b.x, b.y), b.z));
  const camDist = positionWorld.distance(vec3(center.x, center.y, center.z));
  const detailFade = float(1).sub(smoothstep(500, 1100, camDist));
  const wireCol: N = attribute('wire', 'vec3');
  const base = facet.mul(shimmer);
  const withWire = mix(base, wireCol, lineMask.mul(0.55).mul(rich).mul(detailFade));
  const withDots = mix(withWire, wireCol.mul(0.9), dot.mul(rich).mul(detailFade));
  gm.colorNode = mix(withDots, vec3(1, 1, 1), rippleAmt.mul(0.7));
  const ground = new Mesh(g, gm);
  ground.name = 'ocean';
  ground.frustumCulled = false;
  ground.layers.enable(LAYER_ENV);
  group.add(ground);

  // ── floating dots between the ocean and the islands (E: "stars": 3000 particle trails) ──
  const MOTES = 1400;
  const mp = new Float32Array(MOTES * 4);
  const mc = new Float32Array(MOTES * 4);
  const lo = groundY + 25;
  const hi = islandsLowY - 12;
  for (let i = 0; i < MOTES; i++) {
    const r = Math.sqrt(rng()) * 700;
    const a = rng() * Math.PI * 2;
    mp[i * 4] = center.x + Math.cos(a) * r;
    mp[i * 4 + 1] = lo + rng() * Math.max(10, hi - lo);
    mp[i * 4 + 2] = center.z + Math.sin(a) * r;
    mp[i * 4 + 3] = rng() * 100;
    c.set(COLOR_WIRE[Math.floor(rng() * COLOR_WIRE.length)] as string);
    mc[i * 4] = c.r;
    mc[i * 4 + 1] = c.g;
    mc[i * 4 + 2] = c.b;
    mc[i * 4 + 3] = 0.5 + rng() * 1.3;
  }
  const mpos: N = instancedBufferAttribute(new InstancedBufferAttribute(mp, 4));
  const mcol: N = instancedBufferAttribute(new InstancedBufferAttribute(mc, 4));
  const mm = bin.add(new SpriteNodeMaterial({ transparent: false }));
  mm.name = 'motes';
  const drift = vec3(
    sin(u.time.mul(0.21).add(mpos.w)).mul(3),
    sin(u.time.mul(0.33).add(mpos.w.mul(1.7))).mul(2),
    0,
  );
  mm.positionNode = mpos.xyz.add(drift);
  mm.scaleNode = mcol.w.mul(rich);
  const d = uv().sub(0.5).length();
  mm.colorNode = mcol.xyz;
  mm.opacityNode = float(1).sub(smoothstep(0.4, 0.5, d));
  mm.alphaTest = 0.5;
  const motes = new Sprite(mm);
  motes.count = MOTES;
  motes.frustumCulled = false;
  motes.name = 'motes';
  group.add(motes);

  // ── ring of clouds on the horizon (E: 30 clouds, radius 1000–1300 WU, 80–580 WU up, facing centre) ──
  const atlas = bin.add(makeCloudAtlas(rng));
  const cloudGeo = bin.add(new BufferGeometry());
  const cp: number[] = [];
  const cu: number[] = [];
  const frames = [
    [0, 0, 0.5, 0.5],
    [0.5, 0, 1, 0.5],
    [0, 0.5, 0.5, 1],
    [0.5, 0.5, 1, 1],
  ] as const;
  const sizes = [
    [84, 65],
    [238, 169],
    [320, 162],
    [236, 160],
  ] as const;
  const COUNT = 30;
  for (let i = 0; i < COUNT; i++) {
    const kind = i % 4;
    const a = (i / COUNT + rng() * 0.1) * Math.PI * 2;
    const r = (1300 - i * 10) * WU;
    const x = center.x + Math.cos(a) * r;
    const z = center.z + Math.sin(a) * r;
    const y = groundY + (rng() * 500 + 80) * WU;
    const s = (0.5 + rng() * 1.5) * WU;
    const flip = rng() < 0.5 ? -1 : 1;
    const [fw, fh] = sizes[kind] as readonly [number, number];
    const w = fw * s * 1.4;
    const hh = fh * s * 1.4;
    // tangent (facing the centre)
    const tx = -Math.sin(a) * flip;
    const tz = Math.cos(a) * flip;
    const [u0, v0, u1, v1] = frames[kind] as readonly [number, number, number, number];
    const quad = [
      [x - (tx * w) / 2, y - hh / 2, z - (tz * w) / 2, u0, v1],
      [x + (tx * w) / 2, y - hh / 2, z + (tz * w) / 2, u1, v1],
      [x + (tx * w) / 2, y + hh / 2, z + (tz * w) / 2, u1, v0],
      [x - (tx * w) / 2, y + hh / 2, z - (tz * w) / 2, u0, v0],
    ];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const q = quad[k] as number[];
      cp.push(q[0] as number, q[1] as number, q[2] as number);
      cu.push(q[3] as number, q[4] as number);
    }
  }
  cloudGeo.setAttribute('position', new BufferAttribute(new Float32Array(cp), 3));
  cloudGeo.setAttribute('uv', new BufferAttribute(new Float32Array(cu), 2));
  const cm = bin.add(new MeshBasicNodeMaterial({ side: DoubleSide, transparent: true, fog: false }));
  cm.name = 'clouds';
  const ct = texture(atlas, uv());
  cm.colorNode = ct.rgb;
  cm.opacityNode = ct.a.mul(0.92);
  cm.alphaTest = 0.02;
  cm.depthWrite = false;
  const clouds = new Mesh(cloudGeo, cm);
  clouds.name = 'clouds';
  clouds.frustumCulled = false;
  clouds.layers.enable(LAYER_ENV);
  group.add(clouds);

  return {
    group,
    ground,
    motes,
    clouds,
    rich,
    ripple(x, z, now) {
      rippleU.value.set(x, z, now, 1);
    },
    triangles: T + COUNT * 2,
  };
}

/** Four soft cloud puffs in a 2×2 atlas (drawn procedurally; no 2013 art). */
function makeCloudAtlas(rng: () => number): CanvasTexture {
  const size = 512;
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  for (let k = 0; k < 4; k++) {
    const ox = (k % 2) * 256;
    const oy = Math.floor(k / 2) * 256;
    const puffs = 7 + Math.floor(rng() * 5);
    // shadowed underside first, then the lit tops
    for (const pass of [0, 1]) {
      for (let i = 0; i < puffs; i++) {
        const t = i / (puffs - 1);
        const x = ox + 40 + t * 176 + (rng() - 0.5) * 20;
        const baseY = oy + 170;
        const r = 26 + Math.sin(t * Math.PI) * 46 * (0.7 + rng() * 0.5);
        const y = baseY - r * 0.55 - (rng() * 12 + (pass ? 6 : 0));
        const grd = ctx.createRadialGradient(x, y - r * 0.3, r * 0.1, x, y, r);
        if (pass === 0) {
          grd.addColorStop(0, 'rgba(226,232,242,0.95)');
          grd.addColorStop(1, 'rgba(226,232,242,0)');
        } else {
          grd.addColorStop(0, 'rgba(255,255,255,1)');
          grd.addColorStop(0.7, 'rgba(252,252,255,0.85)');
          grd.addColorStop(1, 'rgba(250,250,255,0)');
        }
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const t = new CanvasTexture(canvas as never);
  t.colorSpace = SRGBColorSpace;
  t.flipY = false;
  return t;
}
