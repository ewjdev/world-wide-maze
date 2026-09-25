/**
 * Items. E: small items are teal icosahedra (hue from 0x31A4AE, noise-varied) hovering 0.6 WU above the
 * surface, all merged into one GPU mesh animated by a shader (`smallitemgroup`); large items are rotating
 * faceted icosahedra in a shell that explode on pickup (`largeenergy`, 0x3bc6d2 / 0x206a71).
 *
 * Both kinds are one InstancedMesh each; per-instance data lives in instanced attributes and collection
 * writes the collect time into one of them (the shader pops the item), so there is no per-item draw.
 */
import { LEVEL_HEIGHT_M, PX_PER_METER, type StageData } from '@wwm/schema';
import {
  clamp,
  cos,
  float,
  instancedDynamicBufferAttribute,
  mix,
  normalLocal,
  positionLocal,
  select,
  sin,
  vec3,
  vertexStage,
} from 'three/tsl';
import {
  Color,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicNodeMaterial,
  Vector3,
} from 'three/webgpu';
import { ITEM_LARGE, ITEM_LARGE_DARK, ITEM_SMALL } from '../palette.ts';
import type { Bin } from './bin.ts';
import { hsv2rgb, type N, type SharedUniforms, setEmissive } from './shared.ts';

/** E: item sensors are centred 0.54 WU above the surface = the ball centre height. */
export const ITEM_HOVER_M = 0.5;
const SMALL_R = 0.17;
const LARGE_R = 0.4;

export interface Items {
  small: InstancedMesh;
  large: InstancedMesh;
  largeShell: InstancedMesh;
  /** item id → world position (for effects) */
  positions: Map<number, Vector3>;
  kinds: Map<number, 'small' | 'large'>;
  collect(id: number, now: number): boolean;
  reset(): void;
  triangles: number;
}

export function buildItems(stage: StageData, u: SharedUniforms, bin: Bin): Items {
  const levelOf = new Map(stage.islands.map((i) => [i.id, i.level]));
  const small = stage.items.filter((i) => i.kind === 'small');
  const large = stage.items.filter((i) => i.kind === 'large');
  const positions = new Map<number, Vector3>();
  const kinds = new Map<number, 'small' | 'large'>();
  const slot = new Map<number, { kind: 'small' | 'large'; index: number }>();

  const make = (list: typeof small, kind: 'small' | 'large') => {
    const n = Math.max(1, list.length);
    const data = new Float32Array(n * 4); // xyz + phase
    const state = new Float32Array(n * 4).fill(-1); // x = collectedAt (−1 = live)
    for (const [i, it] of list.entries()) {
      const y = (levelOf.get(it.islandId) ?? 0) * LEVEL_HEIGHT_M + ITEM_HOVER_M;
      const x = it.pos[0] / PX_PER_METER;
      const z = it.pos[1] / PX_PER_METER;
      data.set([x, y, z, (it.id * 0.618034) % 1], i * 4);
      positions.set(it.id, new Vector3(x, y, z));
      kinds.set(it.id, kind);
      slot.set(it.id, { kind, index: i });
    }
    return { data: new InstancedBufferAttribute(data, 4), state: new InstancedBufferAttribute(state, 4), n };
  };
  const S = make(small, 'small');
  const L = make(large, 'large');

  const smallGeo = bin.add(new IcosahedronGeometry(SMALL_R, 0));
  const smallMat = bin.add(itemMaterial(u, S.data, S.state, 'small'));
  const smallMesh = new InstancedMesh(smallGeo, smallMat, S.n);
  smallMesh.count = small.length;
  smallMesh.frustumCulled = false;
  smallMesh.name = 'items-small';

  const largeGeo = bin.add(new IcosahedronGeometry(LARGE_R, 0));
  const largeMat = bin.add(itemMaterial(u, L.data, L.state, 'large'));
  const largeMesh = new InstancedMesh(largeGeo, largeMat, L.n);
  largeMesh.count = large.length;
  largeMesh.frustumCulled = false;
  largeMesh.name = 'items-large';

  const shellGeo = bin.add(new IcosahedronGeometry(LARGE_R * 1.6, 1));
  const shellMat = bin.add(itemMaterial(u, L.data, L.state, 'shell'));
  shellMat.wireframe = true;
  shellMat.transparent = true;
  shellMat.depthWrite = false;
  const shell = new InstancedMesh(shellGeo, shellMat, L.n);
  shell.count = large.length;
  shell.frustumCulled = false;
  shell.name = 'items-large-shell';

  const all = [S, L];
  return {
    small: smallMesh,
    large: largeMesh,
    largeShell: shell,
    positions,
    kinds,
    collect(id, now) {
      const s = slot.get(id);
      if (!s) return false;
      const st = s.kind === 'small' ? S.state : L.state;
      if ((st.array[s.index * 4] as number) >= 0) return false;
      st.array[s.index * 4] = now;
      st.addUpdateRange(s.index * 4, 4);
      st.needsUpdate = true;
      return true;
    },
    reset() {
      for (const x of all) {
        (x.state.array as Float32Array).fill(-1);
        x.state.clearUpdateRanges();
        x.state.needsUpdate = true;
      }
    },
    triangles: small.length * 20 + large.length * (20 + 80),
  };
}

function itemMaterial(
  u: SharedUniforms,
  data: InstancedBufferAttribute,
  state: InstancedBufferAttribute,
  kind: 'small' | 'large' | 'shell',
): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.name = `item-${kind}`;
  const d: N = instancedDynamicBufferAttribute(data);
  const s: N = instancedDynamicBufferAttribute(state);
  const phase = d.w;
  const collectedAt = s.x;
  const live = collectedAt.lessThan(0);
  // pop: swell then vanish over 0.35 s (small) / 0.5 s (large)
  const dur = kind === 'small' ? 0.35 : 0.5;
  const k = clamp(u.time.sub(collectedAt).div(dur), 0, 1);
  const pop = float(1).add(k.mul(1.3)).mul(float(1).sub(k));
  const appear = u.appear;
  const scale = select(live, float(1), pop).mul(appear).mul(u.mapScale);
  const spin = u.time.mul(kind === 'small' ? 1.6 : kind === 'large' ? 0.9 : -0.5).add(phase.mul(6.283));
  const tilt = kind === 'small' ? 0.5 : 0.35;
  const rot = (v: N): N => {
    // rotate about Y by spin, then about X by a fixed tilt
    const c = cos(spin);
    const sn = sin(spin);
    const x1 = v.x.mul(c).add(v.z.mul(sn));
    const z1 = v.z.mul(c).sub(v.x.mul(sn));
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    return vec3(x1, v.y.mul(ct).sub(z1.mul(st)), v.y.mul(st).add(z1.mul(ct)));
  };
  const bob = sin(u.time.mul(2.1).add(phase.mul(6.283))).mul(kind === 'small' ? 0.07 : 0.12);
  m.positionNode = rot(positionLocal.mul(scale))
    .add(d.xyz)
    .add(vec3(0, bob, 0));
  const n = rot(normalLocal);
  const shade: N = vertexStage(
    n
      .dot(vec3(0.3, 0.9, 0.3).normalize())
      .mul(0.3)
      .add(0.75),
  );
  if (kind === 'small') {
    const c = new Color(ITEM_SMALL);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    // E: noise-varied teal; the variation is per instance here
    const hue = float(hsl.h).add(sin(phase.mul(40)).mul(0.03));
    const col = hsv2rgb(hue, float(0.72), float(0.78)).mul(shade);
    m.colorNode = col;
    setEmissive(m, col.mul(0.35));
  } else if (kind === 'large') {
    const a = new Color(ITEM_LARGE);
    const b = new Color(ITEM_LARGE_DARK);
    const col = mix(vec3(b.r, b.g, b.b), vec3(a.r, a.g, a.b), shade).mul(1.1);
    m.colorNode = col;
    setEmissive(m, vec3(a.r, a.g, a.b).mul(0.55));
  } else {
    m.colorNode = vec3(1, 1, 1);
    setEmissive(m, vec3(0.45, 0.85, 0.9).mul(0.6));
    m.opacityNode = float(0.7);
  }
  return m;
}
