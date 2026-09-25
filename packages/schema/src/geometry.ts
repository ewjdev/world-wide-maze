/**
 * Small 2D geometry helpers in PAGE space (px, y down), shared so every phase agrees on definitions.
 *
 * Orientation convention (used by contracts §3 "contour CCW, holes CW"): orientation is decided by the
 * shoelace signed area computed on the raw (x, y) numbers, `signedArea > 0` ⇔ "CCW". Because page y points
 * down, a "CCW" ring appears clockwise when drawn on screen. See packages/schema/README.md.
 */
import type { Rect, Vec2 } from './types.ts';

/** Shoelace signed area of a closed ring (the last point connects back to the first). */
export function signedArea(ring: readonly Vec2[]): number {
  let s = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p = ring[i] as Vec2;
    const q = ring[(i + 1) % n] as Vec2;
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

/** Contract "CCW" (outer contours): positive shoelace area on raw page coordinates. */
export function isCCW(ring: readonly Vec2[]): boolean {
  return signedArea(ring) > 0;
}

/** Ray-casting point-in-polygon for a closed ring. Points exactly on the boundary may go either way. */
export function pointInRing(p: Vec2, ring: readonly Vec2[]): boolean {
  let inside = false;
  const [x, y] = p;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[i] as Vec2;
    const b = ring[j] as Vec2;
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Inside the outer contour and not inside any hole. */
export function pointInPolygon(
  p: Vec2,
  contour: readonly Vec2[],
  holes: readonly (readonly Vec2[])[] = [],
): boolean {
  if (!pointInRing(p, contour)) return false;
  for (const h of holes) if (pointInRing(p, h)) return false;
  return true;
}

/** Euclidean distance from p to segment ab. */
export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + t * dx - p[0];
  const cy = a[1] + t * dy - p[1];
  return Math.hypot(cx, cy);
}

/** Minimum distance from p to the boundary of a closed ring. */
export function distanceToRing(p: Vec2, ring: readonly Vec2[]): number {
  let d = Number.POSITIVE_INFINITY;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    d = Math.min(d, distanceToSegment(p, ring[i] as Vec2, ring[(i + 1) % n] as Vec2));
  }
  return d;
}

/** Minimum distance from p to an open polyline. */
export function distanceToPolyline(p: Vec2, line: readonly Vec2[]): number {
  if (line.length === 1) return Math.hypot(p[0] - (line[0] as Vec2)[0], p[1] - (line[0] as Vec2)[1]);
  let d = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < line.length; i++) {
    d = Math.min(d, distanceToSegment(p, line[i] as Vec2, line[i + 1] as Vec2));
  }
  return d;
}

/** Minimum distance from p to the polygon boundary (contour and holes). */
export function distanceToPolygonEdge(
  p: Vec2,
  contour: readonly Vec2[],
  holes: readonly (readonly Vec2[])[] = [],
): number {
  let d = distanceToRing(p, contour);
  for (const h of holes) d = Math.min(d, distanceToRing(p, h));
  return d;
}

function cross(o: Vec2, a: Vec2, b: Vec2): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function onSegment(p: Vec2, a: Vec2, b: Vec2): boolean {
  return (
    Math.min(a[0], b[0]) <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= p[1] &&
    p[1] <= Math.max(a[1], b[1])
  );
}

/** Closed-segment intersection test (touching counts). */
export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && onSegment(a, c, d)) return true;
  if (d2 === 0 && onSegment(b, c, d)) return true;
  if (d3 === 0 && onSegment(c, a, b)) return true;
  if (d4 === 0 && onSegment(d, a, b)) return true;
  return false;
}

/** Does segment ab intersect any edge of the closed ring? */
export function segmentIntersectsRing(a: Vec2, b: Vec2, ring: readonly Vec2[]): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    if (segmentsIntersect(a, b, ring[i] as Vec2, ring[(i + 1) % n] as Vec2)) return true;
  }
  return false;
}

/** Does segment ab intersect any segment of the open polyline? */
export function segmentIntersectsPolyline(a: Vec2, b: Vec2, line: readonly Vec2[]): boolean {
  for (let i = 0; i + 1 < line.length; i++) {
    if (segmentsIntersect(a, b, line[i] as Vec2, line[i + 1] as Vec2)) return true;
  }
  return false;
}

/** True if two closed rings overlap (edge crossing or one contains the other). */
export function ringsOverlap(r1: readonly Vec2[], r2: readonly Vec2[]): boolean {
  const n = r1.length;
  for (let i = 0; i < n; i++) {
    if (segmentIntersectsRing(r1[i] as Vec2, r1[(i + 1) % n] as Vec2, r2)) return true;
  }
  return pointInRing(r1[0] as Vec2, r2) || pointInRing(r2[0] as Vec2, r1);
}

/**
 * True if the closed ring has a self-intersection (non-adjacent edges touching or crossing,
 * or a repeated vertex). O(n²); fine for simplified contours.
 */
export function ringSelfIntersects(ring: readonly Vec2[]): boolean {
  const n = ring.length;
  if (n < 3) return true;
  for (let i = 0; i < n; i++) {
    const a = ring[i] as Vec2;
    const b = ring[(i + 1) % n] as Vec2;
    if (a[0] === b[0] && a[1] === b[1]) return true; // degenerate edge
    for (let j = i + 1; j < n; j++) {
      // skip adjacent edges (they share a vertex by construction)
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsIntersect(a, b, ring[j] as Vec2, ring[(j + 1) % n] as Vec2)) return true;
    }
  }
  return false;
}

/**
 * The rectangle swept by a bridge: centerline a→b with the given full width, as a 4-point ring.
 * Returns an empty array for a zero-length centerline.
 */
export function bridgeRect(a: Vec2, b: Vec2, width: number): Vec2[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return [];
  const nx = (-dy / len) * (width / 2);
  const ny = (dx / len) * (width / 2);
  return [
    [a[0] + nx, a[1] + ny],
    [b[0] + nx, b[1] + ny],
    [b[0] - nx, b[1] - ny],
    [a[0] - nx, a[1] - ny],
  ];
}

/** Segment a→b translated sideways by `offset` px (positive = left of travel direction in raw coords). */
export function offsetSegment(a: Vec2, b: Vec2, offset: number): [Vec2, Vec2] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * offset;
  const ny = (dx / len) * offset;
  return [
    [a[0] + nx, a[1] + ny],
    [b[0] + nx, b[1] + ny],
  ];
}

/** Axis-aligned rect → closed ring with positive (contract "CCW") orientation. */
export function rectToRing(r: Rect): Vec2[] {
  return [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h],
    [r.x, r.y + r.h],
  ];
}

/** Axis-aligned bounds of a set of points. */
export function boundsOf(points: readonly Vec2[]): Rect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
