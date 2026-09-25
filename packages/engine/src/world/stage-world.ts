/**
 * Static stage objects: island tops (the website), sides, bridges, rails, elevator platforms, and the
 * upright "page frame" used by the intro. Each type is one merged mesh (tops: one draw per texture tile).
 */
import {
  LEVEL_HEIGHT_M,
  PX_PER_METER,
  RAIL_HEIGHT_M,
  SLAB_THICKNESS_M,
  type StageData,
  type Vec2,
} from '@wwm/schema';
import {
  attribute,
  float,
  fract,
  max,
  mix,
  positionLocal,
  select,
  smoothstep,
  texture,
  uniform,
  uniformArray,
  uv,
  vec3,
} from 'three/tsl';
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Material,
  Mesh,
  MeshBasicNodeMaterial,
  NearestFilter,
  SRGBColorSpace,
  Texture,
} from 'three/webgpu';
import type { MeshData } from '../geom/mesh.ts';
import { MeshBuilder, type V3 } from '../geom/mesh.ts';
import { buildStageMeshes, elevatorFootprint, GROUP_BRIDGE, railAlong } from '../geom/structures.ts';
import { clipTriangleToBand, fan, type TilePlan, tileUv } from '../geom/tiling.ts';
import { HSV, RAIL_THICKNESS_M } from '../palette.ts';
import type { Bin } from './bin.ts';
import {
  ballShadow,
  deckPosition,
  facetShade,
  fragmentedColor,
  type N,
  railPosition,
  type SharedUniforms,
  setEmissive,
  slabPosition,
} from './shared.ts';

export const LAYER_ENV = 1;

export function toGeometry(md: MeshData, bin: Bin): BufferGeometry {
  const g = bin.add(new BufferGeometry());
  g.setAttribute('position', new BufferAttribute(md.position, 3));
  g.setAttribute('normal', new BufferAttribute(md.normal, 3));
  g.setAttribute('uv', new BufferAttribute(md.uv, 2));
  g.setAttribute('seed', new BufferAttribute(md.seed, 1));
  g.setAttribute('anim', new BufferAttribute(md.anim, 2));
  g.setAttribute('base', new BufferAttribute(md.base, 1));
  g.setAttribute('hsv', new BufferAttribute(md.hsv, 3));
  g.setAttribute('glow', new BufferAttribute(md.glow, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export interface StageTextures {
  tiles: Texture[];
  setPixelLook(on: boolean): void;
}

/** Wrap the tile images as sRGB, mipmapped, max-anisotropy textures (v = 0 at the top row: flipY off). */
export function makeStageTextures(images: TexImageSource[], anisotropy: number, bin: Bin): StageTextures {
  const tiles = images.map((img) => {
    const t = bin.add(new Texture(img as never));
    t.colorSpace = SRGBColorSpace;
    t.flipY = false;
    t.generateMipmaps = true;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.anisotropy = anisotropy;
    t.needsUpdate = true;
    return t;
  });
  return {
    tiles,
    setPixelLook(on) {
      for (const t of tiles) {
        t.magFilter = on ? NearestFilter : LinearFilter;
        t.needsUpdate = true;
      }
    },
  };
}

export interface StageObjects {
  tops: Mesh;
  sides: Mesh;
  bridges: Mesh;
  rails: Mesh;
  elevators: Mesh | null;
  frame: Mesh;
  frameOpacity: N;
  elevatorY: N;
  elevatorIds: Map<number, number>;
  triangles: number;
}

export function buildStageObjects(
  stage: StageData,
  plan: TilePlan,
  tex: StageTextures,
  u: SharedUniforms,
  bin: Bin,
): StageObjects {
  const meshes = buildStageMeshes(stage, plan);

  // ── tops: one geometry, a group (and material) per tile ──
  const topGeo = mergeWithGroups(meshes.tops, bin);
  const topMats = tex.tiles.map((t) => bin.add(topMaterial(t, u)));
  const tops = new Mesh(topGeo, topMats.length === 1 ? (topMats[0] as Material) : topMats);
  tops.name = 'island-tops';

  const sides = new Mesh(toGeometry(meshes.sides, bin), bin.add(sideMaterial(u)));
  sides.name = 'island-sides';
  const bridges = new Mesh(toGeometry(meshes.bridges, bin), bin.add(bridgeMaterial(u)));
  bridges.name = 'bridges';
  const rails = new Mesh(toGeometry(meshes.rails, bin), bin.add(railMaterial(u)));
  rails.name = 'rails';

  // ── elevator platforms: two per elevator sharing one footprint (contracts v0.2.2). Platform A's top is
  // the sim's y; platform B's top is levelLow + levelHigh − y. One draw: each vertex looks its height up.
  const ids = new Map<number, number>();
  const ys: number[] = [];
  const sums: number[] = [];
  const eb = new MeshBuilder();
  eb.face.group = GROUP_BRIDGE;
  eb.face.hsv = HSV.red;
  const eidx: number[] = [];
  for (const [i, el] of stage.elevators.entries()) {
    ids.set(el.id, i);
    ys.push(el.levelLow * LEVEL_HEIGHT_M);
    sums.push((el.levelLow + el.levelHigh) * LEVEL_HEIGHT_M);
    const fpx = elevatorFootprint(el.a, el.b, el.width);
    const fp = fpx.map((p) => [p[0] / PX_PER_METER, p[1] / PX_PER_METER] as const);
    for (const plat of [0, 1]) {
      const before = eb.triangleCount;
      eb.face.glow = 0;
      eb.face.seed = (i * 0.37 + plat * 0.5) % 1;
      eb.face.base = 0;
      eb.prism(
        fp,
        [-SLAB_THICKNESS_M, -SLAB_THICKNESS_M, -SLAB_THICKNESS_M, -SLAB_THICKNESS_M],
        [0, 0, 0, 0],
      );
      // glowing strips on the top perimeter
      eb.face.glow = 1;
      const cx = fp.reduce((acc, p) => acc + p[0], 0) / 4;
      const cz = fp.reduce((acc, p) => acc + p[1], 0) / 4;
      for (let k = 0; k < 4; k++) {
        const a = fp[k] as readonly [number, number];
        const b = fp[(k + 1) % 4] as readonly [number, number];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const len = Math.hypot(dx, dz) || 1;
        let nx = (-dz / len) * 0.07;
        let nz = (dx / len) * 0.07;
        if ((cx - a[0]) * nx + (cz - a[1]) * nz < 0) {
          nx = -nx;
          nz = -nz;
        }
        eb.prism(
          [
            [a[0], a[1]],
            [b[0], b[1]],
            [b[0] + nx, b[1] + nz],
            [a[0] + nx, a[1] + nz],
          ],
          [0, 0, 0, 0],
          [0.03, 0.03, 0.03, 0.03],
        );
      }
      // side rails along the length, just outside the width (as the physics platform rails)
      eb.face.glow = 0;
      const railOff = (RAIL_THICKNESS_M / 2) * PX_PER_METER;
      const f0 = fpx[0] as Vec2;
      const f1 = fpx[1] as Vec2;
      const f2 = fpx[2] as Vec2;
      const f3 = fpx[3] as Vec2;
      // unit vector across the platform (from the +n side to the −n side)
      const ax = (f3[0] - f0[0]) / (el.width || 1);
      const ay = (f3[1] - f0[1]) / (el.width || 1);
      for (const [p0, p1, sgn] of [
        [f0, f1, -1],
        [f3, f2, 1],
      ] as const) {
        const q0: V3 = [
          (p0[0] + ax * railOff * sgn) / PX_PER_METER,
          0,
          (p0[1] + ay * railOff * sgn) / PX_PER_METER,
        ];
        const q1: V3 = [
          (p1[0] + ax * railOff * sgn) / PX_PER_METER,
          0,
          (p1[1] + ay * railOff * sgn) / PX_PER_METER,
        ];
        railAlong(eb, [q0, q1], RAIL_HEIGHT_M);
      }
      for (let t = before; t < eb.triangleCount; t++) eidx.push(i, plat, i, plat, i, plat);
    }
  }
  let elevators: Mesh | null = null;
  const elevatorY = uniformArray(ys.length ? ys : [0], 'float');
  const elevatorSum = uniformArray(sums.length ? sums : [0], 'float');
  if (stage.elevators.length) {
    const md = eb.build();
    const g = toGeometry(md, bin);
    g.setAttribute('eidx', new BufferAttribute(new Float32Array(eidx), 2));
    elevators = new Mesh(g, bin.add(elevatorMaterial(u, elevatorY, elevatorSum)));
    elevators.name = 'elevators';
    elevators.frustumCulled = false;
  }

  // ── intro page frame: the whole stage image, hinged on its bottom edge ──
  const frameOpacity = uniform(1);
  const W = stage.size.width;
  const H = stage.size.height;
  const fb = plan.tiles.map(() => new MeshBuilder());
  const D = H / PX_PER_METER;
  for (const [ti, tile] of plan.tiles.entries()) {
    const mb = fb[ti] as MeshBuilder;
    for (const tri of [
      [
        [0, 0],
        [W, 0],
        [W, H],
      ],
      [
        [0, 0],
        [W, H],
        [0, H],
      ],
    ] as [number, number][][]) {
      const poly = clipTriangleToBand(tri as never, tile.stageY0, tile.stageY1);
      for (const f of fan(poly)) {
        const uvs = f.map((p) => tileUv(p, tile, plan));
        const P = f.map((p) => [p[0] / PX_PER_METER, 0, p[1] / PX_PER_METER - D] as const);
        mb.tri(P[0] as never, P[1] as never, P[2] as never, uvs[0], uvs[1], uvs[2], [0, 1, 0]);
      }
    }
  }
  const frameGeo = mergeWithGroups(
    fb.map((b) => b.build()),
    bin,
  );
  const frameMats = tex.tiles.map((t) => bin.add(frameMaterial(t, frameOpacity)));
  const frame = new Mesh(frameGeo, frameMats.length === 1 ? (frameMats[0] as Material) : frameMats);
  frame.name = 'page-frame';
  frame.position.set(0, 0, D);
  frame.visible = false;
  frame.renderOrder = -1;

  for (const m of [tops, sides, bridges]) m.layers.enable(LAYER_ENV);

  const triangles =
    meshes.tops.reduce((s, m) => s + m.triangles, 0) +
    meshes.sides.triangles +
    meshes.bridges.triangles +
    meshes.rails.triangles;
  return {
    tops,
    sides,
    bridges,
    rails,
    elevators,
    frame,
    frameOpacity,
    elevatorY,
    elevatorIds: ids,
    triangles,
  };
}

/** Concatenate per-tile buffers into one geometry with one group per tile. */
function mergeWithGroups(parts: MeshData[], bin: Bin): BufferGeometry {
  const total = parts.reduce((s, p) => s + p.triangles, 0);
  const pos = new Float32Array(total * 9);
  const nor = new Float32Array(total * 9);
  const uvs = new Float32Array(total * 6);
  const anim = new Float32Array(total * 6);
  const base = new Float32Array(total * 3);
  const g = bin.add(new BufferGeometry());
  let o = 0;
  for (const [i, p] of parts.entries()) {
    pos.set(p.position, o * 3);
    nor.set(p.normal, o * 3);
    uvs.set(p.uv, o * 2);
    anim.set(p.anim, o * 2);
    base.set(p.base, o);
    g.addGroup(o, p.triangles * 3, i);
    o += p.triangles * 3;
  }
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('uv', new BufferAttribute(uvs, 2));
  g.setAttribute('anim', new BufferAttribute(anim, 2));
  g.setAttribute('base', new BufferAttribute(base, 1));
  g.computeBoundingSphere();
  return g;
}

function topMaterial(map: Texture, u: SharedUniforms): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.name = 'island-top';
  // E: islandfacematerial — the page texture with the shader ball shadow. Unlit so the site's colours
  // are exactly the site's colours.
  m.colorNode = texture(map, uv()).rgb.mul(ballShadow(u));
  m.positionNode = slabPosition(u);
  m.polygonOffset = true;
  m.polygonOffsetFactor = 1;
  m.polygonOffsetUnits = 1;
  return m;
}

function frameMaterial(map: Texture, opacity: N): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({ side: DoubleSide, transparent: true, depthWrite: true });
  m.name = 'page-frame';
  m.colorNode = texture(map, uv()).rgb;
  m.opacityNode = opacity;
  return m;
}

function sideMaterial(u: SharedUniforms): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.name = 'island-side';
  const v = uv().y;
  // white line along the top edge (E: `common.whiteline` overlay), softer one at the bottom
  const top = float(1).sub(smoothstep(0.1, 0.16, v));
  const bottom = smoothstep(0.9, 0.95, v).mul(0.55);
  const line = max(top, bottom);
  const base = fragmentedColor(u).mul(facetShade());
  m.colorNode = mix(base, vec3(1, 1, 1), line).mul(ballShadow(u));
  m.positionNode = slabPosition(u);
  return m;
}

function bridgeMaterial(u: SharedUniforms): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.name = 'bridge';
  const t = uv();
  const isTop = t.x.lessThan(1.5);
  const edge = max(float(1).sub(smoothstep(0.05, 0.085, t.x)), smoothstep(0.915, 0.95, t.x));
  const plank = float(1)
    .sub(smoothstep(0.0, 0.05, fract(t.y.mul(1.0))))
    .mul(0.18);
  const base = fragmentedColor(u).mul(facetShade());
  const deck = mix(base.mul(float(1).add(plank)), vec3(1, 1, 1), edge);
  m.colorNode = select(isTop, deck, base).mul(ballShadow(u));
  m.positionNode = deckPosition(u);
  return m;
}

function railMaterial(u: SharedUniforms): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.name = 'rail';
  m.colorNode = fragmentedColor(u).mul(facetShade()).mul(ballShadow(u));
  m.positionNode = railPosition(u);
  return m;
}

function elevatorMaterial(u: SharedUniforms, ys: N, sums: N): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.name = 'elevator';
  const glow = attribute('glow', 'float');
  const idx: N = attribute('eidx', 'vec2');
  const yA = ys.element(idx.x.toInt());
  const y = select(idx.y.lessThan(0.5), yA, sums.element(idx.x.toInt()).sub(yA));
  const base = fragmentedColor(u).mul(facetShade());
  m.colorNode = mix(base, vec3(1, 0.82, 0.8), glow.mul(0.6)).mul(ballShadow(u));
  // edge strips glow (E: elevators are one of the glow objects in the rebuild brief)
  setEmissive(m, vec3(1, 0.25, 0.22).mul(glow).mul(u.power.mul(0.4).add(0.9)));
  m.positionNode = positionLocal.add(vec3(0, y, 0)).sub(vec3(0, float(1).sub(u.bridges).mul(40), 0));
  return m;
}
