/**
 * Test-only route planner (NOT the Phase 09 solver): BFS over islands via bridges/elevators from start to
 * goal, then a clearance-aware grid BFS inside each island between the mouths, simplified by line of sight.
 * Just enough to prove a stage is physically traversable with the waypoint pilot.
 */
import { distanceToPolygonEdge, type Island, pointInPolygon, type StageData, type Vec2 } from '@wwm/schema';

interface Edge {
  to: number;
  a: Vec2; // mouth on the current island
  b: Vec2; // mouth on the next island
}

function islandSequence(stage: StageData): Edge[] {
  const adj = new Map<number, Edge[]>();
  const add = (from: number, e: Edge) => adj.set(from, [...(adj.get(from) ?? []), e]);
  for (const b of stage.bridges) {
    add(b.from, { to: b.to, a: b.a, b: b.b });
    add(b.to, { to: b.from, a: b.b, b: b.a });
  }
  for (const e of stage.elevators) {
    add(e.islandFrom, { to: e.islandTo, a: e.a, b: e.b });
    add(e.islandTo, { to: e.islandFrom, a: e.b, b: e.a });
  }
  const prev = new Map<number, { from: number; edge: Edge }>();
  const queue = [stage.start.islandId];
  const seen = new Set(queue);
  while (queue.length) {
    const cur = queue.shift() as number;
    for (const e of adj.get(cur) ?? []) {
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      prev.set(e.to, { from: cur, edge: e });
      queue.push(e.to);
    }
  }
  const edges: Edge[] = [];
  for (let at = stage.goal.islandId; at !== stage.start.islandId; ) {
    const p = prev.get(at);
    if (!p) throw new Error(`goal island ${stage.goal.islandId} unreachable`);
    edges.unshift(p.edge);
    at = p.from;
  }
  return edges;
}

/** Grid path inside one island from `s` to `t` (px), keeping `clear` px from the edge where possible. */
function pathInIsland(island: Island, s: Vec2, t: Vec2, cell = 2, clear = 6): Vec2[] {
  const xs = island.contour.map((p) => p[0]);
  const ys = island.contour.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const w = Math.ceil((Math.max(...xs) - x0) / cell) + 1;
  const h = Math.ceil((Math.max(...ys) - y0) / cell) + 1;
  const ok = new Uint8Array(w * h);
  const center = (i: number): Vec2 => [x0 + (i % w) * cell, y0 + Math.floor(i / w) * cell];
  for (let i = 0; i < w * h; i++) {
    const c = center(i);
    if (
      pointInPolygon(c, island.contour, island.holes) &&
      distanceToPolygonEdge(c, island.contour, island.holes) >= clear
    )
      ok[i] = 1;
  }
  const nearest = (p: Vec2) => {
    let best = -1;
    let bd = Number.POSITIVE_INFINITY;
    for (let i = 0; i < w * h; i++) {
      if (!ok[i]) continue;
      const c = center(i);
      const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };
  const si = nearest(s);
  const ti = nearest(t);
  if (si < 0 || ti < 0) return [s, t];
  const from = new Int32Array(w * h).fill(-1);
  from[si] = si;
  const q = [si];
  for (let qi = 0; qi < q.length && from[ti] < 0; qi++) {
    const c = q[qi] as number;
    const cx = c % w;
    const cy = Math.floor(c / w);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (!ok[n] || from[n] >= 0) continue;
      from[n] = c;
      q.push(n);
    }
  }
  if (from[ti] < 0) return [s, t];
  const cells: number[] = [];
  for (let c = ti; c !== si; c = from[c] as number) cells.unshift(c);
  cells.unshift(si);
  // Line-of-sight simplification over walkable cells.
  const walkable = (a: Vec2, b: Vec2) => {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (cell / 2));
    for (let k = 0; k <= n; k++) {
      const p: Vec2 = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
      const gx = Math.round((p[0] - x0) / cell);
      const gy = Math.round((p[1] - y0) / cell);
      if (!ok[gy * w + gx]) return false;
    }
    return true;
  };
  const pts = cells.map(center);
  const out: Vec2[] = [pts[0] as Vec2];
  let anchor = 0;
  for (let k = 2; k < pts.length; k++) {
    if (!walkable(pts[anchor] as Vec2, pts[k] as Vec2)) {
      out.push(pts[k - 1] as Vec2);
      anchor = k - 1;
    }
  }
  out.push(pts[pts.length - 1] as Vec2);
  return out;
}

/** Waypoints (stage px) from the start to the goal through every connector on the island path. */
export function plannedRoute(stage: StageData, leadPx = 8): Vec2[] {
  const islands = new Map(stage.islands.map((i) => [i.id, i] as const));
  const edges = islandSequence(stage);
  const wps: Vec2[] = [];
  let at: Vec2 = stage.start.pos;
  let cur = stage.start.islandId;
  for (const e of edges) {
    const dx = e.b[0] - e.a[0];
    const dy = e.b[1] - e.a[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const exit: Vec2 = [e.a[0] - ux * leadPx, e.a[1] - uy * leadPx];
    wps.push(...pathInIsland(islands.get(cur) as Island, at, exit).slice(1), e.a, e.b);
    at = [e.b[0] + ux * leadPx, e.b[1] + uy * leadPx];
    wps.push(at);
    cur = e.to;
  }
  wps.push(...pathInIsland(islands.get(cur) as Island, at, stage.goal.pos).slice(1));
  return wps;
}
