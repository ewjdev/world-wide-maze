/**
 * Runtime locks (Phase 22, N; contracts §10.4). A closed bridge or elevator lock is a tall **gate of bars** across
 * the connector in the lesson's gate colour, standing exactly where @wwm/physics blocks (`barrierPose` from
 * `@wwm/physics/locks`), with a **padlock badge** (Pip or a gem inside the lock body) and a **label card**
 * ("Pip gate 2", "4 gems") hanging on it. A goal lock is the badge + card over the goal (the goal itself greys out,
 * world/goal.ts). Opening drops the bars into the deck like a portcullis while the badge pops and fades.
 *
 * Everything is ONE InstancedMesh (one draw call), built like world/portals.ts: the geometry carries a `part`
 * attribute, per-lock data lives in instanced attributes, labels come from one canvas atlas (a row per lock).
 * Gates keep their own yaw; the badge and card turn to face the camera. In the map view the badges grow so the
 * padlocks read on their bridges from far away.
 *
 * `buildBeacon` is the light beam over a spot (the gate or post that opens the lock the child just touched).
 */
import { barrierPose } from '@wwm/physics/locks';
import { LEVEL_HEIGHT_M, type LockSpec, PX_PER_METER, type StageData } from '@wwm/schema';
import {
  abs,
  atan,
  attribute,
  cameraPosition,
  clamp,
  cos,
  exp,
  float,
  instancedDynamicBufferAttribute,
  max,
  min,
  mix,
  positionLocal,
  select,
  sin,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshBasicNodeMaterial,
  SRGBColorSpace,
  type Vector3,
} from 'three/webgpu';
import type { Bin } from './bin.ts';
import { drawPip, SANS } from './portals.ts';
import { type N, type SharedUniforms, setEmissive } from './shared.ts';

export type LockVisualState = 'closed' | 'opening' | 'open';
export type LockIcon = 'pip' | 'gem';
/** What the engine draws for one lock (`Engine.setLocks`). */
export interface LockVisual {
  lock: LockSpec;
  /** Card text, e.g. "Pip gate 2" or "4 gems". */
  label: string;
  /** Gate colour, `#rrggbb` (the lesson theme's gate colour). */
  color: string;
  /** What sits inside the padlock: Pip (a Pip gate opens it) or a gem (a collect mission opens it). */
  icon: LockIcon;
}

/**
 * Badge (padlock) size and height of its centre above the floor (m). The chase camera sits ≈ 3.2 m above the
 * floor looking 35° down with a 70° FOV, so its top edge is level: signs must stay below ≈ 3 m to be seen.
 */
export const BADGE_M = 1.6;
export const BADGE_Y = 1.45;
/** Label card size (m) and its centre above the badge centre. */
const CARD_W = 2.8;
const CARD_H = 0.93;
const CARD_DY = 1.2;
/** Goal locks: badge centre height over the goal pad (m). */
const GOAL_BADGE_Y = 1.55;
/** Opening animation length (s); shorter and without the drop under reduced motion. */
export const OPENING_SEC = 1.1;
const OPENING_SEC_REDUCED = 0.45;
const ATLAS_W = 1024;
const ROW_H = 256;
const BEAM_H = 30;

/** Per-lock placement (pure: no GPU, no DOM). */
export interface LockInstance {
  id: number;
  kind: LockSpec['kind'];
  /** Gate centre at floor level (world m); the goal position for goal locks. */
  center: [number, number, number];
  yaw: number;
  width: number;
  height: number;
  thickness: number;
  /** false for goal locks (badge + card only) */
  gate: boolean;
  /** Badge centre (world m). */
  badge: [number, number, number];
  color: [number, number, number];
}

function hexRgb(h: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  const c = m ? Number.parseInt(m[1] as string, 16) : 0xe5a810;
  return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
}

/** Where each lock is drawn. Locks that don't match the stage are dropped (physics rejects them at load). */
export function planLocks(stage: StageData, visuals: readonly LockVisual[]): LockInstance[] {
  const out: LockInstance[] = [];
  for (const v of visuals) {
    const color = hexRgb(v.color);
    if (v.lock.kind === 'goal') {
      const level = stage.islands.find((i) => i.id === stage.goal.islandId)?.level ?? 0;
      const x = stage.goal.pos[0] / PX_PER_METER;
      const z = stage.goal.pos[1] / PX_PER_METER;
      const y = level * LEVEL_HEIGHT_M;
      out.push({
        id: v.lock.id,
        kind: 'goal',
        center: [x, y, z],
        yaw: 0,
        width: 0,
        height: 0,
        thickness: 0,
        gate: false,
        badge: [x, y + GOAL_BADGE_Y, z],
        color,
      });
      continue;
    }
    const b = barrierPose(stage, v.lock);
    if (!b) continue;
    const [cx, y, cz] = b.center;
    // the badge hangs on the gate's island-facing side
    const back = b.thickness / 2 + 0.14;
    out.push({
      id: v.lock.id,
      kind: v.lock.kind,
      center: [cx, y, cz],
      yaw: b.yaw,
      width: b.width,
      height: b.height,
      thickness: b.thickness,
      gate: true,
      badge: [cx - b.dir[0] * back, y + BADGE_Y, cz - b.dir[1] * back],
      color,
    });
  }
  return out;
}

const STATE_CODE: Record<LockVisualState, number> = { closed: 0, opening: 1, open: 2 };

export interface Locks {
  mesh: InstancedMesh;
  instances: LockInstance[];
  setState(id: number, s: LockVisualState, now: number): void;
  pulse(id: number, now: number): void;
  state(id: number): LockVisualState | undefined;
  triangles: number;
}

export function buildLocks(
  stage: StageData,
  visuals: readonly LockVisual[],
  u: SharedUniforms,
  bin: Bin,
  reducedMotion: boolean,
): Locks | null {
  const inst = planLocks(stage, visuals);
  if (inst.length === 0) return null;
  const n = inst.length;
  const i0 = new Float32Array(n * 4); // centre xyz + yaw
  const i1 = new Float32Array(n * 4); // width, height, thickness, atlas row
  const i2 = new Float32Array(n * 4); // rgb + gate flag
  const i3 = new Float32Array(n * 4); // badge xyz
  const st = new Float32Array(n * 4); // pulse time, state, opening start
  const slot = new Map<number, number>();
  const states = new Map<number, LockVisualState>();
  for (const [i, l] of inst.entries()) {
    i0.set([...l.center, l.yaw], i * 4);
    i1.set([l.width, l.height, l.thickness, i], i * 4);
    i2.set([...l.color, l.gate ? 1 : 0], i * 4);
    i3.set([...l.badge, 0], i * 4);
    st.set([-100, 0, -100, 0], i * 4);
    slot.set(l.id, i);
    states.set(l.id, 'closed');
  }
  const a0 = new InstancedBufferAttribute(i0, 4);
  const a1 = new InstancedBufferAttribute(i1, 4);
  const a2 = new InstancedBufferAttribute(i2, 4);
  const a3 = new InstancedBufferAttribute(i3, 4);
  const sa = new InstancedBufferAttribute(st, 4);
  const byId = new Map(visuals.map((v) => [v.lock.id, v] as const));
  const atlas = bin.add(makeAtlas(inst.map((l) => byId.get(l.id) as LockVisual)));
  const geo = bin.add(lockGeometry());
  const mat = bin.add(lockMaterial(u, a0, a1, a2, a3, sa, atlas, n, reducedMotion));
  const mesh = new InstancedMesh(geo, mat, n);
  mesh.count = n;
  mesh.frustumCulled = false;
  mesh.name = 'locks';
  mesh.renderOrder = 3;

  const write = (id: number, k: number, v: number) => {
    const i = slot.get(id);
    if (i === undefined) return;
    sa.array[i * 4 + k] = v;
    sa.addUpdateRange(i * 4, 4);
    sa.needsUpdate = true;
  };
  return {
    mesh,
    instances: inst,
    setState(id, s, now) {
      if (!slot.has(id)) return;
      const prev = states.get(id);
      states.set(id, s);
      write(id, 1, STATE_CODE[s]);
      if (s === 'opening' && prev !== 'opening') write(id, 2, now);
    },
    pulse: (id, now) => write(id, 0, now),
    state: (id) => states.get(id),
    triangles: n * ((geo.attributes.position as BufferAttribute).count / 3),
  };
}

// ── geometry ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Parts: 0 gate posts, 1 bars, 2 crossbars (all in a unit box: x = along the connector −0.5..0.5 × thickness,
 * y = 0..1 × height, z = across −0.5..0.5 × width), 3 badge quad, 4 card quad (metres, facing +Z).
 */
function lockGeometry(): BufferGeometry {
  const pos: number[] = [];
  const uvs: number[] = [];
  const part: number[] = [];
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, k: number) => {
    const c = [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y1, z0],
      [x0, y1, z0],
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    ];
    // faces (outward winding irrelevant: DoubleSide); uv.y = height fraction for the shading gradient
    for (const f of [
      [0, 1, 2, 3],
      [5, 4, 7, 6],
      [4, 0, 3, 7],
      [1, 5, 6, 2],
      [3, 2, 6, 7],
      [4, 5, 1, 0],
    ]) {
      const [a, b, cc, d] = f.map((i) => c[i] as number[]) as [number[], number[], number[], number[]];
      for (const v of [a, b, cc, a, cc, d]) {
        pos.push(v[0] as number, v[1] as number, v[2] as number);
        uvs.push(0, v[1] as number);
        part.push(k);
      }
    }
  };
  // posts at both ends (slightly deeper than the bars)
  const PW = 0.045;
  box(-0.5, 0.5, 0, 1.03, -0.5, -0.5 + PW, 0);
  box(-0.5, 0.5, 0, 1.03, 0.5 - PW, 0.5, 0);
  // vertical bars
  const BARS = 7;
  const BW = 0.022;
  for (let i = 1; i <= BARS; i++) {
    const z = -0.5 + PW + ((1 - 2 * PW) * i) / (BARS + 1);
    box(-0.28, 0.28, 0, 0.985, z - BW / 2, z + BW / 2, 1);
  }
  // crossbars: low, middle, top
  for (const [y, h] of [
    [0.1, 0.035],
    [0.55, 0.03],
    [0.955, 0.04],
  ] as const)
    box(-0.36, 0.36, y - h / 2, y + h / 2, -0.5 + PW * 0.5, 0.5 - PW * 0.5, 2);
  // badge and card quads (uv.y = 0 at the top: atlas flipY off)
  const quad = (x0: number, y0: number, x1: number, y1: number, k: number) => {
    const P = [
      [x0, y0, 0, 0, 1],
      [x1, y0, 0, 1, 1],
      [x1, y1, 0, 1, 0],
      [x0, y1, 0, 0, 0],
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const v = P[i] as number[];
      pos.push(v[0] as number, v[1] as number, v[2] as number);
      uvs.push(v[3] as number, v[4] as number);
      part.push(k);
    }
  };
  quad(-BADGE_M / 2, -BADGE_M / 2, BADGE_M / 2, BADGE_M / 2, 3);
  quad(-CARD_W / 2, CARD_DY - CARD_H / 2, CARD_W / 2, CARD_DY + CARD_H / 2, 4);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setAttribute('part', new BufferAttribute(new Float32Array(part), 1));
  g.computeBoundingSphere();
  return g;
}

// ── material ──────────────────────────────────────────────────────────────────────────────────────────

/** three.js rotation.y by `yaw` of the local point p (x' = x cos + z sin, z' = z cos − x sin). */
function rotY(p: N, yaw: N): N {
  const c = cos(yaw);
  const s = sin(yaw);
  return vec3(p.x.mul(c).add(p.z.mul(s)), p.y, p.z.mul(c).sub(p.x.mul(s)));
}

function lockMaterial(
  u: SharedUniforms,
  a0: InstancedBufferAttribute,
  a1: InstancedBufferAttribute,
  a2: InstancedBufferAttribute,
  a3: InstancedBufferAttribute,
  sa: InstancedBufferAttribute,
  atlas: CanvasTexture,
  rows: number,
  reducedMotion: boolean,
): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: true, side: DoubleSide });
  m.name = 'locks';
  m.forceSinglePass = true; // one draw call (a transparent double-sided material is otherwise drawn twice)
  const d0: N = instancedDynamicBufferAttribute(a0);
  const d1: N = instancedDynamicBufferAttribute(a1);
  const d2: N = instancedDynamicBufferAttribute(a2);
  const d3: N = instancedDynamicBufferAttribute(a3);
  const s: N = instancedDynamicBufferAttribute(sa);
  const part: N = attribute('part', 'float');
  const t: N = attribute('uv', 'vec2');
  const isPart = (k: number): N => abs(part.sub(k)).lessThan(0.5);
  const isGate = part.lessThan(2.5);
  const motion = float(reducedMotion ? 0 : 1);

  const opening = abs(s.y.sub(1)).lessThan(0.5);
  const open = s.y.greaterThan(1.5);
  const dur = reducedMotion ? OPENING_SEC_REDUCED : OPENING_SEC;
  const k = select(open, float(1), select(opening, clamp(u.time.sub(s.z).div(dur), 0, 1), float(0)));
  const hot = exp(clamp(u.time.sub(s.x), 0, 10).mul(-3)).mul(
    select(s.x.greaterThan(-50), float(1), float(0)),
  );
  const mapK = clamp(u.mapScale.sub(1).div(2.2), 0, 1);

  // ── vertex ──
  const p0: N = positionLocal;
  // gate: scale the unit box, drop into the floor while opening (a portcullis), turn by the lock's yaw
  const drop = k.mul(k).mul(d1.y.add(0.8)).mul(motion);
  const shake = sin(u.time.mul(60)).mul(hot).mul(0.04).mul(motion); // a rattle when the ball hits it
  const gl = vec3(p0.x.mul(d1.z), p0.y.mul(d1.y).mul(u.appear).sub(drop), p0.z.mul(d1.x).add(shake)).mul(
    select(d2.w.greaterThan(0.5), select(open, float(0), float(1)), float(0)),
  );
  const gateW = rotY(gl, d0.w).add(d0.xyz);
  // badge / card: face the camera (yaw billboard), grow + lift in the map view, pop while opening
  const toCam = cameraPosition.xz.sub(d3.xz);
  const camYaw = atan(toCam.x, toCam.y);
  const wobble = sin(u.time.mul(22)).mul(hot).mul(0.18).mul(motion);
  const pop = float(1).add(k.mul(0.45).mul(motion)).add(hot.mul(0.28));
  const signScale = pop
    .mul(float(1).add(mapK.mul(2.6)))
    .mul(u.appear)
    .mul(select(open, float(0), float(1)));
  const sl = vec3(p0.x, p0.y, p0.z).mul(signScale);
  const tilted = vec3(
    sl.x.mul(cos(wobble)).sub(sl.y.mul(sin(wobble))),
    sl.x.mul(sin(wobble)).add(sl.y.mul(cos(wobble))),
    sl.z,
  );
  const signW = rotY(tilted, camYaw)
    .add(d3.xyz)
    .add(vec3(0, mapK.mul(3.2), 0));
  m.positionNode = select(isGate, gateW, signW);

  // ── colour ──
  const base: N = d2.xyz.pow(2.2); // sRGB → linear
  const grad = t.y.mul(0.25).add(0.82); // a touch brighter towards the top
  const gateCol = select(
    isPart(0),
    base.mul(0.62),
    select(isPart(1), base.mul(grad), mix(base, vec3(1, 1, 1), 0.5)),
  );
  const flash = mix(gateCol, vec3(1, 1, 1), hot.mul(0.45));
  const row = d1.w;
  const inBadge = isPart(3);
  const au = select(inBadge, t.x.mul(0.25), t.x.mul(0.75).add(0.25));
  const lab: N = texture(atlas, vec2(au, t.y.add(row).div(rows)));
  const shown = clamp(select(isGate, flash, lab.rgb), 0, 1);
  const gateA = float(1).sub(smoothstep(reducedMotion ? 0 : 0.55, 1, k));
  const badgeA = float(1).sub(smoothstep(0.35, 0.85, k));
  const cardA = float(1)
    .sub(smoothstep(0.05, 0.45, k))
    .mul(float(1).sub(mapK));
  const alpha = select(isGate, gateA, lab.a.mul(select(inBadge, badgeA, cardA)));
  m.opacityNode = clamp(alpha.mul(max(u.appear, float(0))), 0, 1);
  // bars glow softly in the gate colour (brighter on a hit); the badge and card stay crisp
  const em = select(isGate, base.mul(float(0.22).add(hot.mul(0.8))).mul(gateA), vec3(0, 0, 0));
  const glowC = min(clamp(em, 0, 1), shown);
  m.colorNode = shown.sub(glowC);
  setEmissive(m, glowC);
  m.alphaTest = 0.02;
  return m;
}

// ── atlas ─────────────────────────────────────────────────────────────────────────────────────────────

function mk(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  return typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
}

/** A faceted gem like the in-game items (teal, white highlights). */
function drawGem(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const top = cy - r * 0.62;
  const mid = cy - r * 0.12;
  const bot = cy + r * 0.9;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.5, top);
  ctx.lineTo(cx + r * 0.5, top);
  ctx.lineTo(cx + r, mid);
  ctx.lineTo(cx, bot);
  ctx.lineTo(cx - r, mid);
  ctx.closePath();
  ctx.fillStyle = '#31a4ae';
  ctx.fill();
  ctx.lineWidth = r * 0.1;
  ctx.strokeStyle = '#20262d';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.5, top);
  ctx.lineTo(cx - r * 0.2, mid);
  ctx.lineTo(cx, top);
  ctx.lineTo(cx + r * 0.2, mid);
  ctx.lineTo(cx + r * 0.5, top);
  ctx.moveTo(cx - r, mid);
  ctx.lineTo(cx + r, mid);
  ctx.moveTo(cx - r * 0.2, mid);
  ctx.lineTo(cx, bot);
  ctx.lineTo(cx + r * 0.2, mid);
  ctx.lineWidth = r * 0.06;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.5, top);
  ctx.lineTo(cx - r * 0.2, mid);
  ctx.lineTo(cx - r, mid);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** The padlock badge in a 256 × 256 cell at (x0, y0): white disc, gate-colour ring, padlock with Pip or a gem. */
function drawBadge(ctx: CanvasRenderingContext2D, x0: number, y0: number, col: string, icon: LockIcon): void {
  const cx = x0 + 128;
  const cy = y0 + 128;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, 118, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.97)';
  ctx.fill();
  ctx.lineWidth = 14;
  ctx.strokeStyle = col;
  ctx.stroke();
  // shackle
  const sy = cy - 44;
  ctx.beginPath();
  ctx.moveTo(cx - 46, cy - 14);
  ctx.lineTo(cx - 46, sy);
  ctx.arc(cx, sy, 46, Math.PI, 0);
  ctx.lineTo(cx + 46, cy - 14);
  ctx.lineWidth = 22;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#3a434d';
  ctx.stroke();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#9aa4ae';
  ctx.beginPath();
  ctx.moveTo(cx - 46, cy - 18);
  ctx.lineTo(cx - 46, sy);
  ctx.arc(cx, sy, 46, Math.PI, Math.PI * 1.35);
  ctx.stroke();
  // body
  ctx.beginPath();
  ctx.roundRect(cx - 86, cy - 26, 172, 126, 26);
  ctx.fillStyle = col;
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#20262d';
  ctx.stroke();
  // the icon on a light plate inside the body
  ctx.beginPath();
  ctx.arc(cx, cy + 37, 52, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fill();
  if (icon === 'gem') drawGem(ctx, cx, cy + 34, 38);
  else drawPip(ctx, cx, cy + 37, 60);
  ctx.restore();
}

/** One 1024 × 256 row per lock: the padlock badge (left 256) and the label card (right 768). */
function makeAtlas(items: LockVisual[]): CanvasTexture {
  const cv = mk(ATLAS_W, ROW_H * items.length);
  const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, cv.width, cv.height);
  for (const [i, it] of items.entries()) {
    const y0 = i * ROW_H;
    const col = /^#[0-9a-f]{6}$/i.test(it.color) ? it.color : '#e5a810';
    drawBadge(ctx, 0, y0, col, it.icon);
    // card
    const x = 256 + 14;
    const w = 768 - 28;
    const y = y0 + 14;
    const h = ROW_H - 28;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = col;
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#20262d';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const maxW = w - 90;
    let size = 96;
    ctx.font = `800 ${size}px ${SANS}`;
    while (size > 54 && ctx.measureText(it.label).width > maxW) {
      size -= 4;
      ctx.font = `800 ${size}px ${SANS}`;
    }
    let text = it.label;
    while (text.length > 1 && ctx.measureText(text).width > maxW) text = `${text.slice(0, -2)}…`;
    ctx.fillText(text, x + w / 2, y + h / 2 + size * 0.05);
  }
  const tex = new CanvasTexture(cv as never);
  tex.colorSpace = SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  return tex;
}

// ── beacon ────────────────────────────────────────────────────────────────────────────────────────────

export interface Beacon {
  mesh: Mesh;
  /** Place the beam at a world point (floor), or hide it. */
  set(at: Vector3 | null, now: number): void;
}

/**
 * A soft golden light beam standing on a spot, with a ring on the floor (like the portals' map beams, but visible
 * in every view). One small mesh, one draw call while shown.
 */
export function buildBeacon(u: SharedUniforms, bin: Bin, reducedMotion: boolean): Beacon {
  const pos: number[] = [];
  const uvs: number[] = [];
  const part: number[] = [];
  const W = 0.55;
  for (const q of [0, 1, 2]) {
    // three crossed vertical quads read as a volume from any side
    const ang = (q * Math.PI) / 3;
    const cx = Math.cos(ang) * W;
    const cz = Math.sin(ang) * W;
    const P = [
      [-cx, 0, -cz, 0, 0],
      [cx, 0, cz, 1, 0],
      [cx, BEAM_H, cz, 1, 1],
      [-cx, BEAM_H, -cz, 0, 1],
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const v = P[i] as number[];
      pos.push(v[0] as number, v[1] as number, v[2] as number);
      uvs.push(v[3] as number, v[4] as number);
      part.push(0);
    }
  }
  const SEG = 48;
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2;
    const a1 = ((i + 1) / SEG) * Math.PI * 2;
    const r0 = 0.95;
    const r1 = 1.35;
    const p = (r: number, a: number) => [Math.cos(a) * r, 0.04, Math.sin(a) * r];
    for (const [v, uu] of [
      [p(r0, a0), 0],
      [p(r1, a0), 1],
      [p(r1, a1), 1],
      [p(r0, a0), 0],
      [p(r1, a1), 1],
      [p(r0, a1), 0],
    ] as const) {
      pos.push(...(v as number[]));
      uvs.push(uu, 0);
      part.push(1);
    }
  }
  const g = bin.add(new BufferGeometry());
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setAttribute('part', new BufferAttribute(new Float32Array(part), 1));
  g.computeBoundingSphere();
  const born = uniform(-100);
  const m = bin.add(new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide }));
  m.name = 'lock-beacon';
  m.forceSinglePass = true;
  const t: N = attribute('uv', 'vec2');
  const isBeam = attribute('part', 'float').lessThan(0.5);
  const mapK = clamp(u.mapScale.sub(1).div(2.2), 0, 1);
  const grow = clamp(u.time.sub(born).div(0.5), 0, 1);
  const p0: N = positionLocal;
  const widen = float(1).add(mapK.mul(2.5));
  m.positionNode = vec3(p0.x.mul(widen), p0.y.mul(select(isBeam, grow, float(1))), p0.z.mul(widen));
  const gold = vec3(1, 0.78, 0.22).pow(2.2);
  const breathe = reducedMotion ? float(1) : sin(u.time.mul(4)).mul(0.2).add(0.8);
  const across = float(1)
    .sub(abs(t.x.sub(0.5)).mul(2))
    .pow(1.5);
  const beamA = across.mul(float(1).sub(t.y).pow(1.2)).mul(0.75).mul(breathe);
  const ringA = float(1)
    .sub(abs(t.x.sub(0.5)).mul(2))
    .mul(0.95)
    .mul(breathe);
  const a = select(isBeam, beamA, ringA).mul(grow);
  const col = mix(gold, vec3(1, 1, 1), select(isBeam, across.mul(0.5), float(0.25)));
  m.opacityNode = clamp(a, 0, 1);
  const glow = min(col.mul(a).mul(1.2), col);
  m.colorNode = col.sub(glow);
  setEmissive(m, glow);
  const mesh = new Mesh(g, m);
  mesh.name = 'lock-beacon';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.visible = false;
  return {
    mesh,
    set(at, now) {
      if (!at) {
        mesh.visible = false;
        return;
      }
      if (!mesh.visible || mesh.position.distanceToSquared(at) > 1e-6) born.value = now;
      mesh.position.copy(at);
      mesh.visible = true;
    },
  };
}
