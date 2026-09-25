/**
 * Step 6: island outlines.
 * Boundary tracing on the cell lattice (the exact outline of the binary mask, i.e. marching squares without
 * interpolation) → Douglas–Peucker → a light corner bevel (one bounded Chaikin cut per corner).
 * Orientation follows the contract: outer rings have positive shoelace area (`isCCW`), holes negative.
 * Every simplified ring is checked for self-intersection and falls back to the exact outline if needed.
 */
import { ringSelfIntersects, signedArea, type Vec2 } from '@wwm/schema';
import { labelComponents } from './islands.ts';

/**
 * Remove diagonal-only contacts (2×2 checkerboards), so traced rings are simple. Within one island a water cell
 * is filled. Between two different islands (4-connected components) a land cell is cleared instead (03b,
 * BI-1): filling would fuse them through a one-cell neck the ball can't pass, e.g. two HN rows touching at a
 * corner.
 */
export function removeDiagonalPinches(mask: Uint8Array, cols: number, rows: number): number {
  const { labels } = labelComponents(mask, cols, rows);
  let fixes = 0;
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 0; r + 1 < rows; r++) {
      for (let c = 0; c + 1 < cols; c++) {
        const i = r * cols + c;
        const a = mask[i];
        const b = mask[i + 1];
        const d = mask[i + cols];
        const e = mask[i + cols + 1];
        if (a && e && !b && !d) {
          if (labels[i] === labels[i + cols + 1]) mask[i + 1] = 1;
          else mask[i + cols + 1] = 0;
          fixes++;
          changed = true;
        } else if (b && d && !a && !e) {
          if (labels[i + 1] === labels[i + cols]) mask[i] = 1;
          else mask[i + cols] = 0;
          fixes++;
          changed = true;
        }
      }
    }
  }
  return fixes;
}

const DX = [1, 0, -1, 0]; // E S W N (y down)
const DY = [0, 1, 0, -1];

/**
 * Trace all boundary rings of `label` within the cell bbox. Vertices are lattice points (cell units).
 * Interior is on the right of travel (y down), so outer rings have positive area and holes negative.
 * Collinear vertices are removed.
 */
export function traceRings(
  labels: Int32Array,
  cols: number,
  rows: number,
  label: number,
  bbox: { c0: number; r0: number; c1: number; r1: number },
): Vec2[][] {
  const at = (c: number, r: number) =>
    c >= 0 && r >= 0 && c < cols && r < rows && labels[r * cols + c] === label;
  const W = cols + 1;
  // Edges: from vertex key, direction.
  const out = new Map<number, number[]>(); // vertex key → list of edge dirs (encoded key*4+dir in `pending`)
  let total = 0;
  const add = (x: number, y: number, dir: number) => {
    const k = y * W + x;
    const list = out.get(k);
    if (list) list.push(dir);
    else out.set(k, [dir]);
    total++;
  };
  for (let r = bbox.r0; r < bbox.r1; r++) {
    for (let c = bbox.c0; c < bbox.c1; c++) {
      if (!at(c, r)) continue;
      if (!at(c, r - 1)) add(c, r, 0); // top edge, heading E
      if (!at(c + 1, r)) add(c + 1, r, 1); // right edge, heading S
      if (!at(c, r + 1)) add(c + 1, r + 1, 2); // bottom edge, heading W
      if (!at(c - 1, r)) add(c, r + 1, 3); // left edge, heading N
    }
  }
  const rings: Vec2[][] = [];
  const keys = [...out.keys()].sort((a, b) => a - b);
  let used = 0;
  for (const startKey of keys) {
    for (;;) {
      const startList = out.get(startKey);
      if (!startList || startList.length === 0) break;
      const startDir = startList.shift() as number;
      used++;
      const ring: Vec2[] = [];
      let x = startKey % W;
      let y = (startKey - x) / W;
      let dir = startDir;
      ring.push([x, y]);
      for (let guard = 0; guard <= total + 1; guard++) {
        x += DX[dir] as number;
        y += DY[dir] as number;
        const k = y * W + x;
        const list = out.get(k);
        if (!list || list.length === 0) break; // closed (start edge already consumed)
        // prefer right turn, then straight, then left
        const prefs = [(dir + 1) & 3, dir, (dir + 3) & 3];
        let chosen = -1;
        for (const p of prefs) {
          const idx = list.indexOf(p);
          if (idx >= 0) {
            list.splice(idx, 1);
            chosen = p;
            break;
          }
        }
        if (chosen < 0) break;
        used++;
        if (chosen !== dir) ring.push([x, y]);
        dir = chosen;
      }
      // the start vertex may be collinear (we started mid-edge-run); drop it if so
      if (ring.length >= 3) {
        const a = ring[ring.length - 1] as Vec2;
        const b = ring[0] as Vec2;
        const c2 = ring[1] as Vec2;
        if ((a[0] === b[0] && b[0] === c2[0]) || (a[1] === b[1] && b[1] === c2[1])) ring.shift();
      }
      if (ring.length >= 3) rings.push(ring);
    }
  }
  void used;
  return rings;
}

function perpDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}

function dpOpen(pts: Vec2[], i0: number, i1: number, eps: number, keep: Uint8Array): void {
  let maxD = 0;
  let idx = -1;
  for (let i = i0 + 1; i < i1; i++) {
    const d = perpDist(pts[i] as Vec2, pts[i0] as Vec2, pts[i1] as Vec2);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (idx >= 0 && maxD > eps) {
    keep[idx] = 1;
    dpOpen(pts, i0, idx, eps, keep);
    dpOpen(pts, idx, i1, eps, keep);
  }
}

/** Douglas–Peucker on a closed ring (split at vertex 0 and the vertex farthest from it). */
export function simplifyRing(ring: Vec2[], eps: number): Vec2[] {
  const n = ring.length;
  if (n <= 4 || eps <= 0) return ring.slice();
  const p0 = ring[0] as Vec2;
  let far = 0;
  let farD = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot((ring[i] as Vec2)[0] - p0[0], (ring[i] as Vec2)[1] - p0[1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const pts = [...ring, p0];
  const keep = new Uint8Array(n + 1);
  keep[0] = 1;
  keep[far] = 1;
  keep[n] = 1;
  dpOpen(pts, 0, far, eps, keep);
  dpOpen(pts, far, n, eps, keep);
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(ring[i] as Vec2);
  return out.length >= 3 ? out : ring.slice();
}

/** Replace each corner with a short bevel (a bounded Chaikin cut). */
export function bevelRing(ring: Vec2[], bevel: number): Vec2[] {
  const n = ring.length;
  if (bevel <= 0 || n < 3) return ring.slice();
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p = ring[(i + n - 1) % n] as Vec2;
    const v = ring[i] as Vec2;
    const q = ring[(i + 1) % n] as Vec2;
    const l1 = Math.hypot(p[0] - v[0], p[1] - v[1]);
    const l2 = Math.hypot(q[0] - v[0], q[1] - v[1]);
    const cross = (v[0] - p[0]) * (q[1] - v[1]) - (v[1] - p[1]) * (q[0] - v[0]);
    const cut = Math.min(bevel, l1 / 3, l2 / 3);
    if (Math.abs(cross) < 1e-9 || cut < 0.25) {
      out.push(v);
      continue;
    }
    out.push([v[0] + ((p[0] - v[0]) / l1) * cut, v[1] + ((p[1] - v[1]) / l1) * cut]);
    out.push([v[0] + ((q[0] - v[0]) / l2) * cut, v[1] + ((q[1] - v[1]) / l2) * cut]);
  }
  return out;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function toPx(ring: Vec2[], cell: number, width: number, height: number): Vec2[] {
  return ring.map(([x, y]) => [Math.min(width, x * cell), Math.min(height, y * cell)] as Vec2);
}

function finish(ring: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const [x, y] of ring) {
    const p: Vec2 = [round2(x), round2(y)];
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
}

export interface IslandOutline {
  contour: Vec2[];
  holes: Vec2[][];
  /** Exact lattice outline (px), used as a fallback when smoothing causes overlaps. */
  rawContour: Vec2[];
  rawHoles: Vec2[][];
}

/** Smooth one ring, falling back step by step if the result is not simple or flips orientation. */
function smooth(raw: Vec2[], eps: number, bevel: number, sign: number): Vec2[] {
  const candidates = [
    () => bevelRing(simplifyRing(raw, eps), bevel),
    () => simplifyRing(raw, eps),
    () => raw,
  ];
  for (const make of candidates) {
    const r = finish(make());
    if (r.length >= 3 && Math.sign(signedArea(r)) === sign && !ringSelfIntersects(r)) return r;
  }
  return finish(raw);
}

export function outlineIsland(
  labels: Int32Array,
  cols: number,
  rows: number,
  label: number,
  bbox: { c0: number; r0: number; c1: number; r1: number },
  cell: number,
  width: number,
  height: number,
  eps: number,
  bevel: number,
): IslandOutline | null {
  const rings = traceRings(labels, cols, rows, label, bbox).map((r) => toPx(r, cell, width, height));
  let outerIdx = -1;
  let best = 0;
  rings.forEach((r, i) => {
    const a = signedArea(r);
    if (a > best) {
      best = a;
      outerIdx = i;
    }
  });
  if (outerIdx < 0) return null;
  const rawContour = finish(rings[outerIdx] as Vec2[]);
  const rawHoles = rings.filter((r, i) => i !== outerIdx && signedArea(r) < 0).map(finish);
  return {
    contour: smooth(rings[outerIdx] as Vec2[], eps, bevel, 1),
    holes: rawHoles.map((h) => smooth(h, eps, bevel, -1)),
    rawContour,
    rawHoles,
  };
}
