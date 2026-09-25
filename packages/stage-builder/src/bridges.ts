/**
 * Step 8a: candidate bridges (E: 2013 "each island looks left, right, up and down for its nearest neighbor").
 * Bridges are cardinal only (0/90/180/270°, E). For every grid row (column) we cast a ray from each island's
 * right (bottom) edge to the next land cell; each (A, B, axis) pair keeps its best band: the shortest gap whose
 * full deck width (+ side clearance) is free of third islands and touches both islands at the mouths.
 * Every accepted candidate is re-checked against the smoothed contours with the contract's own geometry.
 */
import { bridgeRect, pointInRing, ringsOverlap, type Vec2 } from '@wwm/schema';
import type { BuildParams } from './params.ts';

export interface IslandShape {
  contour: Vec2[];
  holes: Vec2[][];
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface Candidate {
  /** Island indices (0-based); `from` is left/top of `to`. */
  from: number;
  to: number;
  a: Vec2;
  b: Vec2;
  width: number;
  axis: 'x' | 'y';
  /** Water gap crossed, px. */
  gap: number;
}

interface Ray {
  line: number; // row (axis x) or column (axis y)
  k: number; // last cell of A along the ray
  m: number; // first cell of B
}

export interface CandidateOptions {
  cols: number;
  rows: number;
  cell: number;
  width: number;
  height: number;
}

function rectBox(a: Vec2, b: Vec2, w: number) {
  const r = bridgeRect(a, b, w);
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const [x, y] of r) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { ring: r, x0, y0, x1, y1 };
}

/** Does the bridge deck overlap any island other than `from` / `to` (using the final contours)? */
export function deckCrossesThirdIsland(
  a: Vec2,
  b: Vec2,
  width: number,
  from: number,
  to: number,
  shapes: readonly IslandShape[],
  margin = 1,
): boolean {
  const box = rectBox(a, b, width + 2 * margin);
  for (let i = 0; i < shapes.length; i++) {
    if (i === from || i === to) continue;
    const s = shapes[i] as IslandShape;
    if (s.bbox.x1 < box.x0 || s.bbox.x0 > box.x1 || s.bbox.y1 < box.y0 || s.bbox.y0 > box.y1) continue;
    if (ringsOverlap(box.ring, s.contour)) return true;
  }
  return false;
}

export function findCandidates(
  labels: Int32Array,
  shapes: readonly IslandShape[],
  opts: CandidateOptions,
  params: BuildParams,
): Candidate[] {
  const { cols, rows, cell } = opts;
  const maxGapCells = Math.floor(params.maxBridgeSpanPx / cell);
  const out: Candidate[] = [];

  for (const axis of ['x', 'y'] as const) {
    const lines = axis === 'x' ? rows : cols;
    const len = axis === 'x' ? cols : rows;
    const idx =
      axis === 'x'
        ? (line: number, p: number) => line * cols + p
        : (line: number, p: number) => p * cols + line;
    const rays = new Map<string, Ray[]>();
    for (let line = 0; line < lines; line++) {
      for (let p = 0; p + 1 < len; p++) {
        const A = labels[idx(line, p)] as number;
        if (A === 0 || labels[idx(line, p + 1)] !== 0) continue;
        let m = p + 1;
        while (m < len && labels[idx(line, m)] === 0) m++;
        if (m >= len) break;
        const B = labels[idx(line, m)] as number;
        if (B !== A && m - (p + 1) <= maxGapCells) {
          const key = `${A},${B}`;
          const list = rays.get(key);
          const ray = { line, k: p, m };
          if (list) list.push(ray);
          else rays.set(key, [ray]);
        }
        p = m - 1;
      }
    }

    const maxW = Math.floor(params.bridgeWidthMaxPx / cell);
    const minW = Math.ceil(params.bridgeWidthMinPx / cell);
    const side = params.bridgeSideClearCells;
    for (const [key, list] of rays) {
      const [A, B] = key.split(',').map(Number) as [number, number];
      // Prefer the shortest gap, then the middle of the contact run.
      const mid = ((list[0] as Ray).line + (list[list.length - 1] as Ray).line) / 2;
      const order = list
        .map((r) => ({ r, gap: r.m - r.k - 1, off: Math.abs(r.line - mid) }))
        .sort((u, v) => u.gap - v.gap || u.off - v.off || u.r.line - v.r.line);
      let found: Candidate | null = null;
      const tried = new Set<number>();
      for (const { r } of order) {
        if (tried.size >= 16) break;
        if (tried.has(r.line)) continue;
        tried.add(r.line);
        for (let w = maxW; w >= minW && !found; w--) {
          const s0 = r.line - Math.floor(w / 2);
          const s1 = s0 + w; // exclusive
          if (s0 - side < 0 || s1 + side > lines) continue;
          let ok = true;
          let contactA = 0;
          let contactB = 0;
          for (let l = s0 - side; l < s1 + side && ok; l++) {
            for (let p = r.k; p <= r.m; p++) {
              const v = labels[idx(l, p)] as number;
              if (v !== 0 && v !== A && v !== B) {
                ok = false;
                break;
              }
            }
            if (l >= s0 && l < s1) {
              if (labels[idx(l, r.k)] === A) contactA++;
              if (labels[idx(l, r.m)] === B) contactB++;
            }
          }
          if (!ok) continue;
          if (contactA < params.bridgeMinContact * w || contactB < params.bridgeMinContact * w) continue;
          // deck ends pushed into each island by the inset
          const center = (s0 + w / 2) * cell;
          const pa = Math.max(0, (r.k + 1) * cell - params.bridgeInsetPx);
          const pb = Math.min(axis === 'x' ? opts.width : opts.height, r.m * cell + params.bridgeInsetPx);
          const a: Vec2 = axis === 'x' ? [pa, center] : [center, pa];
          const b: Vec2 = axis === 'x' ? [pb, center] : [center, pb];
          const width = w * cell;
          const from = A - 1;
          const to = B - 1;
          if (deckCrossesThirdIsland(a, b, width, from, to, shapes)) continue;
          const sa = shapes[from] as IslandShape;
          const sb = shapes[to] as IslandShape;
          if (!pointInRing(a, sa.contour) || !pointInRing(b, sb.contour)) continue;
          found = { from, to, a, b, width, axis, gap: (r.m - r.k - 1) * cell };
        }
        if (found) break;
      }
      if (found) out.push(found);
    }
  }
  // Keep the best (shortest gap, then widest) candidate per island pair.
  const best = new Map<string, Candidate>();
  for (const c of out) {
    const key = `${Math.min(c.from, c.to)},${Math.max(c.from, c.to)}`;
    const cur = best.get(key);
    if (!cur || c.gap < cur.gap || (c.gap === cur.gap && c.width > cur.width)) best.set(key, c);
  }
  return [...best.values()].sort((u, v) => u.from - v.from || u.to - v.to || (u.axis < v.axis ? -1 : 1));
}

/** Axis-aligned box of a (cardinal) deck, inflated by `margin`. */
export function deckBox(c: { a: Vec2; b: Vec2; width: number }, margin = 0) {
  const horizontal = c.a[1] === c.b[1];
  const hw = c.width / 2 + margin;
  if (horizontal) {
    return {
      x0: Math.min(c.a[0], c.b[0]) - margin,
      x1: Math.max(c.a[0], c.b[0]) + margin,
      y0: c.a[1] - hw,
      y1: c.a[1] + hw,
    };
  }
  return {
    x0: c.a[0] - hw,
    x1: c.a[0] + hw,
    y0: Math.min(c.a[1], c.b[1]) - margin,
    y1: Math.max(c.a[1], c.b[1]) + margin,
  };
}

export function boxesOverlap(
  p: { x0: number; y0: number; x1: number; y1: number },
  q: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  return p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
}
