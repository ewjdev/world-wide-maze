/**
 * Goal. E (`game/object/goal`): a ribbon spiralling 20 WU up around the goal, printed with the site's title
 * in red / yellow / green letters with a white stroke, fading out towards the top; plus a flared wireframe
 * cylinder ("vase"). Both reveal with a `visibility` tween. We add a glowing pad ring (N).
 * The 20 WU spiral doubles as the beacon that is visible from far away.
 */
import { GOAL_RADIUS_M } from '@wwm/schema';
import { float, mix, positionLocal, select, smoothstep, texture, uniform, uv, vec3 } from 'three/tsl';
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
} from 'three/webgpu';
import { GOAL_LETTERS, GOAL_WIRE, WU } from '../palette.ts';
import type { Bin } from './bin.ts';
import { type N, type SharedUniforms, setEmissive } from './shared.ts';

export interface Goal {
  group: Group;
  visibility: N;
  triangles: number;
}

export function buildGoal(title: string, u: SharedUniforms, bin: Bin): Goal {
  const group = new Group();
  group.name = 'goal';
  const visibility = uniform(1);

  // ── title ribbon (E geometry, verbatim maths in WU, then scaled) ──
  const c = 0.7;
  const l = 0.5;
  const pos: number[] = [];
  const uvs: number[] = [];
  let m = 0;
  let t = 0;
  let steps = 0;
  const ring: [number, number, number, number, number, number][] = [];
  while (m < 20) {
    let f = 0.9 + (m - 4) ** 2 * 0.02;
    const top: [number, number, number] = [Math.cos(t) * f, m, Math.sin(t) * f];
    f = 0.9 + (m - 4 - c) ** 2 * 0.02;
    const bot: [number, number, number] = [Math.cos(t) * f, m - c, Math.sin(t) * f];
    ring.push([...top, ...bot]);
    const a = l / (f * 2 * Math.PI);
    t += a * Math.PI * 2;
    m += a * 2;
    steps++;
  }
  const { tex, textWidth } = makeTitleTexture(title);
  bin.add(tex);
  const repeat = (l * steps) / ((c / 64) * textWidth);
  for (let i = 1; i < ring.length; i++) {
    const p = ring[i - 1] as number[];
    const q = ring[i] as number[];
    const u0 = (1 - (i - 1) / steps) * repeat;
    const u1 = (1 - i / steps) * repeat;
    const quad = [
      [q[0], q[1], q[2], u1, 0],
      [p[0], p[1], p[2], u0, 0],
      [p[3], p[4], p[5], u0, 1],
      [q[3], q[4], q[5], u1, 1],
    ] as number[][];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const v = quad[k] as number[];
      pos.push((v[0] as number) * WU, (v[1] as number) * WU, (v[2] as number) * WU);
      uvs.push(v[3] as number, v[4] as number);
    }
  }
  const rg = bin.add(new BufferGeometry());
  rg.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  rg.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  const rm = bin.add(new MeshBasicNodeMaterial({ side: DoubleSide, transparent: true, depthWrite: false }));
  rm.name = 'goal-ribbon';
  const tc = texture(tex, uv());
  const yWU = positionLocal.y.div(WU);
  const whiten = smoothstep(0, 1, yWU.div(20).mul(5).sub(0.3));
  rm.colorNode = mix(vec3(1, 1, 1), tc.rgb, whiten);
  const reveal = uv().x.greaterThanEqual(float(repeat).mul(float(1).sub(visibility)));
  rm.opacityNode = select(tc.a.lessThan(0.3), float(0), float(1))
    .mul(float(1).sub(smoothstep(12, 20, yWU)))
    .mul(select(reveal, float(1), float(0)));
  rm.alphaTest = 0.01;
  const ribbon = new Mesh(rg, rm);
  ribbon.name = 'goal-ribbon';
  ribbon.renderOrder = 2;
  group.add(ribbon);

  // ── flared wire "vase" (E: CylinderGeometry(1, 1, 20, 12, 30, open), r × (0.8 + (y + 6)² · 0.02)) ──
  const cg = bin.add(new CylinderGeometry(1, 1, 20, 12, 30, true));
  const p = cg.attributes.position as BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const n = y + 6;
    const k = 0.8 + n * n * 0.02;
    p.setXYZ(i, p.getX(i) * k * WU, (y + 10) * WU, p.getZ(i) * k * WU);
  }
  const wm = bin.add(new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, wireframe: true }));
  wm.name = 'goal-wire';
  const wyWU = positionLocal.y.div(WU);
  const wireCol = hex(GOAL_WIRE);
  wm.colorNode = wireCol;
  setEmissive(wm, wireCol.mul(0.8));
  wm.opacityNode = float(1).sub(smoothstep(8, 20, wyWU)).mul(0.85).mul(smoothstep(0, 1, visibility.mul(20).sub(wyWU)));
  const wire = new Mesh(cg, wm);
  wire.name = 'goal-wire';
  wire.renderOrder = 3;
  group.add(wire);

  // ── pad ring on the island (N) ──
  const pg = bin.add(new RingGeometry(GOAL_RADIUS_M * 0.82, GOAL_RADIUS_M, 48, 1));
  pg.rotateX(-Math.PI / 2);
  pg.translate(0, 0.02, 0);
  const pm = bin.add(new MeshBasicNodeMaterial({ transparent: true, depthWrite: false }));
  pm.name = 'goal-pad';
  const pulse = u.time.mul(3).sin().mul(0.25).add(0.75);
  pm.colorNode = vec3(1, 1, 1);
  setEmissive(pm, wireCol.mul(pulse).mul(1.4));
  pm.opacityNode = visibility;
  const pad = new Mesh(pg, pm);
  pad.name = 'goal-pad';
  group.add(pad);

  group.traverse((o) => {
    o.frustumCulled = false;
  });
  return { group, visibility, triangles: pos.length / 9 + 12 * 30 * 2 + 96 };
}

function hex(h: number) {
  return vec3(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255).pow(2.2);
}

/** E: 1024×64 canvas, bold 40 px, letters cycling red/yellow/green with a 3 px white stroke. */
function makeTitleTexture(title: string): { tex: CanvasTexture; textWidth: number } {
  const mk = (w: number, h: number) =>
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const r = mk(1024, 64);
  const ctx = r.getContext('2d') as CanvasRenderingContext2D;
  ctx.font = 'bold 40px Helvetica, Arial, sans-serif';
  let text = title.trim() || 'World Wide Maze';
  if (ctx.measureText(text).width > 1004) {
    while (ctx.measureText(`${text}...`).width + (text.length + 3) > 1004) text = text.slice(0, -1);
    text += '...';
  }
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  let x = 5;
  let i = 0;
  for (const ch of text) {
    if (!/[\s　]/.test(ch)) {
      ctx.strokeStyle = '#ffffff';
      ctx.strokeText(ch, x, 45);
      ctx.fillStyle = GOAL_LETTERS[i++ % 3] as string;
      ctx.fillText(ch, x, 45);
    }
    x += ctx.measureText(ch).width + 1;
  }
  const out = mk(512, 64);
  const o = out.getContext('2d') as CanvasRenderingContext2D;
  const a = Math.min(x, 1024 - 20) + 20;
  o.drawImage(r as CanvasImageSource, 0, 0, a, 64, 0, 0, 512, 64);
  const tex = new CanvasTexture(out as never);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.flipY = false;
  tex.anisotropy = 4;
  return { tex, textWidth: a };
}
