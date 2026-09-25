/**
 * Step 11: guardrails (E: 2013 rails are sub-paths of the island outline covering ≈ 90 % of it, cut open where
 * bridges and elevators attach). Each ring (contour and holes) is clipped against the mouth boxes of the links
 * that touch the island; what remains becomes open polylines whose vertices lie exactly on the outline.
 */
import type { Vec2 } from '@wwm/schema';

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Parameter interval [t0, t1] of segment p→q inside an axis-aligned box (Liang–Barsky), or null. */
function clipInterval(p: Vec2, q: Vec2, b: Box): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const checks: [number, number][] = [
    [-dx, p[0] - b.x0],
    [dx, b.x1 - p[0]],
    [-dy, p[1] - b.y0],
    [dy, b.y1 - p[1]],
  ];
  for (const [pp, qq] of checks) {
    if (pp === 0) {
      if (qq < 0) return null;
      continue;
    }
    const t = qq / pp;
    if (pp < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  return t1 > t0 ? [t0, t1] : null;
}

const lerp = (p: Vec2, q: Vec2, t: number): Vec2 => [
  Math.round((p[0] + (q[0] - p[0]) * t) * 100) / 100,
  Math.round((p[1] + (q[1] - p[1]) * t) * 100) / 100,
];

function polylineLength(line: readonly Vec2[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++)
    s += Math.hypot(
      (line[i] as Vec2)[0] - (line[i - 1] as Vec2)[0],
      (line[i] as Vec2)[1] - (line[i - 1] as Vec2)[1],
    );
  return s;
}

/**
 * Cut a closed ring by boxes. Returns open polylines covering the ring outside every box. With no cuts the result is
 * the whole ring as one polyline that returns to its first point.
 */
export function cutRing(ring: readonly Vec2[], boxes: readonly Box[], minLength = 2): Vec2[][] {
  const n = ring.length;
  // per edge: the kept sub-intervals
  const pieces: { edge: number; t0: number; t1: number }[] = [];
  for (let i = 0; i < n; i++) {
    const p = ring[i] as Vec2;
    const q = ring[(i + 1) % n] as Vec2;
    const cuts: [number, number][] = [];
    for (const b of boxes) {
      const iv = clipInterval(p, q, b);
      if (iv) cuts.push(iv);
    }
    cuts.sort((u, v) => u[0] - v[0]);
    let t = 0;
    for (const [c0, c1] of cuts) {
      if (c0 > t) pieces.push({ edge: i, t0: t, t1: c0 });
      t = Math.max(t, c1);
    }
    if (t < 1) pieces.push({ edge: i, t0: t, t1: 1 });
  }
  if (pieces.length === 0) return [];
  const full = pieces.length === n && pieces.every((pc) => pc.t0 === 0 && pc.t1 === 1);
  if (full) return [[...ring.map((p) => [p[0], p[1]] as Vec2), [(ring[0] as Vec2)[0], (ring[0] as Vec2)[1]]]];

  // chain consecutive pieces (piece ends at t1 = 1 and the next starts at t0 = 0 on the following edge)
  const chains: { edge: number; t0: number; t1: number }[][] = [];
  let cur: { edge: number; t0: number; t1: number }[] = [];
  for (const pc of pieces) {
    const prev = cur[cur.length - 1];
    if (prev && prev.t1 === 1 && pc.t0 === 0 && pc.edge === prev.edge + 1) cur.push(pc);
    else {
      if (cur.length > 0) chains.push(cur);
      cur = [pc];
    }
  }
  if (cur.length > 0) chains.push(cur);
  // wrap: last chain continues into the first
  if (chains.length > 1) {
    const last = chains[chains.length - 1] as { edge: number; t0: number; t1: number }[];
    const first = chains[0] as { edge: number; t0: number; t1: number }[];
    const l = last[last.length - 1];
    const f = first[0];
    if (l && f && l.edge === n - 1 && l.t1 === 1 && f.edge === 0 && f.t0 === 0) {
      chains[0] = [...last, ...first];
      chains.pop();
    }
  }
  const out: Vec2[][] = [];
  for (const chain of chains) {
    const line: Vec2[] = [];
    for (const pc of chain) {
      const p = ring[pc.edge] as Vec2;
      const q = ring[(pc.edge + 1) % n] as Vec2;
      const s = pc.t0 === 0 ? ([p[0], p[1]] as Vec2) : lerp(p, q, pc.t0);
      const e = pc.t1 === 1 ? ([q[0], q[1]] as Vec2) : lerp(p, q, pc.t1);
      const last = line[line.length - 1];
      if (!last || last[0] !== s[0] || last[1] !== s[1]) line.push(s);
      line.push(e);
    }
    if (line.length >= 2 && polylineLength(line) >= minLength) out.push(line);
  }
  return out;
}

/** Guardrails for one island: all rings cut by the mouth boxes of its links. */
export function buildRails(
  contour: readonly Vec2[],
  holes: readonly (readonly Vec2[])[],
  mouths: readonly Box[],
): Vec2[][] {
  const rails: Vec2[][] = [];
  for (const ring of [contour, ...holes]) rails.push(...cutRing(ring, mouths));
  return rails;
}

export function ringLength(ring: readonly Vec2[]): number {
  return polylineLength([...ring, ring[0] as Vec2]);
}

export { polylineLength };
