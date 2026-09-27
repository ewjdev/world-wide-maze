/**
 * Phase 22 M0 spike (2): how often can the ball get from one island to another *without* a bridge or lift, by
 * jumping a gap or dropping onto a lower island? This sizes the game's "region guard" (a backstop, not built here).
 *
 *   node packages/physics/scripts/bypass-spike.ts [--limit 50] [--json out.json]
 *
 * Method:
 * 1. The jump envelope D(Δh) is measured with the real simulation (jump-envelope.ts): the farthest gap (m) the ball
 *    crosses when the landing floor is Δh higher (or lower), clearing a 0.556 m guardrail at both edges. Three skill
 *    tiers: "standing" = JUMP from rest, then full tilt in the air; "casual" = a 1 s run-up at full tilt (12 m/s);
 *    "expert" = top speed (19 m/s).
 * 2. Stages: the batch-eval capture set (fixtures/captures), built with the real builder at difficulty normal,
 *    seed 1, slices in order, until `--limit` stages.
 * 3. For every ordered island pair (A, B) the plan-view gap is the minimum distance between their outlines (0 when
 *    they overlap, e.g. a higher island's edge over a lower one). A → B is a *hop* when gap ≤ D(level_B − level_A).
 *    Obstacles in between and the run-up room on A are ignored, so this is an upper bound.
 * 4. Lock relevance: the connectors on the start → goal BFS path whose removal disconnects the goal (single-edge
 *    cuts, where a lock would go). A cut is *escapable* when a hop leaves the start side, and *bypassable* when hops
 *    (with the remaining connectors) reach the goal island.
 */
import { writeFileSync } from 'node:fs';
import { type Difficulty, type Island, type StageData, sliceCount, type Vec2 } from '@wwm/schema';
import { pxToMeters } from '@wwm/schema/space';
import { buildStage } from '@wwm/stage-builder';
import { listCaptureSlugs, loadCapture } from '@wwm/stage-builder/node';
import { type Envelope, measureEnvelope } from './jump-envelope.ts';

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const LIMIT = Number(flag('--limit') ?? 50);
const DIFFICULTY: Difficulty = 'normal';

// ── envelope ────────────────────────────────────────────────────────────────────────────────────────────
const env: Envelope = await measureEnvelope();
const RAIL = 0.556;
/** Highest step the ball can land on: apex (ball bottom) − the rail it has to clear. */
const maxClimb = env.maxApexBottomM - RAIL;
function reachFn(runUp: string): (dh: number) => number {
  const row = env.byRunUp[runUp];
  if (!row) throw new Error(runUp);
  const hs = env.dh; // descending
  const ds = row.railed;
  return (dh: number) => {
    if (dh > maxClimb) return 0;
    if (dh >= (hs[0] as number)) {
      // taper from D(hs[0]) to 0 at maxClimb
      const d0 = ds[0] as number;
      return d0 * ((maxClimb - dh) / (maxClimb - (hs[0] as number)));
    }
    for (let i = 1; i < hs.length; i++) {
      const h0 = hs[i - 1] as number;
      const h1 = hs[i] as number;
      if (dh <= h0 && dh >= h1) {
        const t = (h0 - dh) / (h0 - h1);
        return (ds[i - 1] as number) + ((ds[i] as number) - (ds[i - 1] as number)) * t;
      }
    }
    return ds[ds.length - 1] as number; // deeper drops: at least the −8 m reach
  };
}
const TIERS = { standing: reachFn('0'), casual: reachFn('1'), expert: reachFn('8') };

// ── geometry ────────────────────────────────────────────────────────────────────────────────────────────
function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}
function inside(p: Vec2, ring: readonly Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as Vec2;
    const b = ring[j] as Vec2;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function bbox(r: readonly Vec2[]) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of r) {
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  }
  return { x0, y0, x1, y1 };
}
/** Min plan-view distance between two island outlines (px); 0 when they overlap. */
function gapPx(A: Island, B: Island, cap: number): number {
  const a = bbox(A.contour);
  const b = bbox(B.contour);
  const bx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1);
  const by = Math.max(0, a.y0 - b.y1, b.y0 - a.y1);
  if (Math.hypot(bx, by) > cap) return Number.POSITIVE_INFINITY;
  if (A.contour.some((p) => inside(p, B.contour)) || B.contour.some((p) => inside(p, A.contour))) return 0;
  let best = Number.POSITIVE_INFINITY;
  const edges = (r: readonly Vec2[]) => r.map((p, i) => [p, r[(i + 1) % r.length] as Vec2] as const);
  for (const p of A.contour) for (const [s, e] of edges(B.contour)) best = Math.min(best, segDist(p, s, e));
  for (const p of B.contour) for (const [s, e] of edges(A.contour)) best = Math.min(best, segDist(p, s, e));
  return best;
}

// ── graph ───────────────────────────────────────────────────────────────────────────────────────────────
interface Conn {
  key: string;
  a: number;
  b: number;
}
function connectors(s: StageData): Conn[] {
  return [
    ...s.bridges.map((b) => ({ key: `bridge ${b.id}`, a: b.from, b: b.to })),
    ...s.elevators.map((e) => ({ key: `elevator ${e.id}`, a: e.islandFrom, b: e.islandTo })),
  ];
}
function reach(from: number, conns: Conn[], hops: [number, number][], skip?: string): Set<number> {
  const adj = new Map<number, number[]>();
  const add = (x: number, y: number) => adj.set(x, [...(adj.get(x) ?? []), y]);
  for (const c of conns) {
    if (c.key === skip) continue;
    add(c.a, c.b);
    add(c.b, c.a);
  }
  for (const [x, y] of hops) add(x, y);
  const seen = new Set([from]);
  const q = [from];
  while (q.length) {
    const i = q.shift() as number;
    for (const j of adj.get(i) ?? []) {
      if (seen.has(j)) continue;
      seen.add(j);
      q.push(j);
    }
  }
  return seen;
}
function bfsPath(s: StageData, conns: Conn[]): Conn[] {
  const prev = new Map<number, { from: number; c: Conn }>();
  const start = s.start.islandId;
  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const i = q.shift() as number;
    for (const c of conns) {
      const j = c.a === i ? c.b : c.b === i ? c.a : -1;
      if (j < 0 || seen.has(j)) continue;
      seen.add(j);
      prev.set(j, { from: i, c });
      q.push(j);
    }
  }
  const path: Conn[] = [];
  for (let at = s.goal.islandId; at !== start; ) {
    const p = prev.get(at);
    if (!p) return [];
    path.unshift(p.c);
    at = p.from;
  }
  return path;
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────────────────
interface StageRow {
  id: string;
  islands: number;
  connectors: number;
  tiers: Record<
    string,
    { hopPairs: number; nonConnectedHopPairs: number; cuts: number; escapable: number; bypassable: number }
  >;
}
const rows: StageRow[] = [];
/** per tier: the smallest gap (m) of the hops that escape each escapable cut */
const escGaps: Record<string, number[]> = {};
const slugs = listCaptureSlugs();
outer: for (let slice = 0; slice < 8; slice++) {
  for (const slug of slugs) {
    if (rows.length >= LIMIT) break outer;
    const { capture, image } = loadCapture(slug);
    if (slice >= sliceCount(capture)) continue;
    let stage: StageData;
    try {
      stage = buildStage({ capture, image, sliceIndex: slice, seed: 1, difficulty: DIFFICULTY }).stage;
    } catch {
      continue;
    }
    const conns = connectors(stage);
    const direct = new Set(conns.flatMap((c) => [`${c.a}>${c.b}`, `${c.b}>${c.a}`]));
    const row: StageRow = {
      id: `${slug}#${slice}`,
      islands: stage.islands.length,
      connectors: conns.length,
      tiers: {},
    };
    const capPx = TIERS.expert(-8) * 13.5;
    const gaps = new Map<string, number>();
    for (const A of stage.islands)
      for (const B of stage.islands)
        if (A.id < B.id) gaps.set(`${A.id}>${B.id}`, pxToMeters(gapPx(A, B, capPx)));
    const path = bfsPath(stage, conns);
    for (const [tier, D] of Object.entries(TIERS)) {
      const hops: [number, number][] = [];
      let nonConnected = 0;
      for (const A of stage.islands)
        for (const B of stage.islands) {
          if (A.id === B.id) continue;
          const g = gaps.get(A.id < B.id ? `${A.id}>${B.id}` : `${B.id}>${A.id}`) ?? Infinity;
          if (g <= D(B.level - A.level)) {
            hops.push([A.id, B.id]);
            if (!direct.has(`${A.id}>${B.id}`)) nonConnected++;
          }
        }
      let cuts = 0;
      let escapable = 0;
      let bypassable = 0;
      for (const c of path) {
        const side = reach(stage.start.islandId, conns, [], c.key);
        if (side.has(stage.goal.islandId)) continue; // not a single-edge cut
        cuts++;
        const out = hops.filter(([x, y]) => side.has(x) && !side.has(y));
        if (out.length > 0) {
          escapable++;
          const g = Math.min(
            ...out.map(([x, y]) => gaps.get(x < y ? `${x}>${y}` : `${y}>${x}`) ?? Number.POSITIVE_INFINITY),
          );
          const list = escGaps[tier] ?? [];
          list.push(g);
          escGaps[tier] = list;
        }
        if (reach(stage.start.islandId, conns, hops, c.key).has(stage.goal.islandId)) bypassable++;
      }
      row.tiers[tier] = {
        hopPairs: hops.length,
        nonConnectedHopPairs: nonConnected,
        cuts,
        escapable,
        bypassable,
      };
    }
    rows.push(row);
    const t = row.tiers;
    console.log(
      `${row.id.padEnd(34)} islands ${String(row.islands).padStart(3)} conns ${String(row.connectors).padStart(3)} | ` +
        Object.entries(t)
          .map(
            ([k, v]) =>
              `${k}: hops ${v.nonConnectedHopPairs} cuts ${v.cuts} esc ${v.escapable} byp ${v.bypassable}`,
          )
          .join(' | '),
    );
  }
}

const summary: Record<string, unknown> = { stages: rows.length, envelope: env };
for (const tier of Object.keys(TIERS)) {
  const ts = rows.map((r) => r.tiers[tier] as StageRow['tiers'][string]);
  const cuts = ts.reduce((s, t) => s + t.cuts, 0);
  const esc = ts.reduce((s, t) => s + t.escapable, 0);
  const byp = ts.reduce((s, t) => s + t.bypassable, 0);
  const withHop = ts.filter((t) => t.nonConnectedHopPairs > 0).length;
  const withCut = ts.filter((t) => t.cuts > 0);
  const stagesByp = withCut.filter((t) => t.bypassable > 0).length;
  const pairs = ts.reduce((s, t) => s + t.nonConnectedHopPairs, 0);
  const s = {
    stagesWithAnyHop: withHop,
    hopPairsPerStage: pairs / Math.max(1, rows.length),
    cuts,
    escapableCuts: esc,
    bypassableCuts: byp,
    stagesWithCuts: withCut.length,
    stagesWithBypassableCut: stagesByp,
  };
  const g = (escGaps[tier] ?? []).sort((x, y) => x - y);
  const q = (f: number) => g[Math.min(g.length - 1, Math.floor(f * g.length))] ?? Number.NaN;
  const gapStats = {
    zero: g.filter((x) => x === 0).length,
    under1m: g.filter((x) => x < 1).length,
    under2m: g.filter((x) => x < 2).length,
    median: q(0.5),
    p90: q(0.9),
  };

  console.log(
    `\n${tier}: ${withHop}/${rows.length} stages (${((100 * withHop) / rows.length).toFixed(0)}%) have a hop between ` +
      `islands with no direct connector (${s.hopPairsPerStage.toFixed(1)} ordered pairs per stage).\n` +
      `  single-edge cuts on the start→goal path: ${cuts} in ${withCut.length} stages; escapable by a hop ${esc} ` +
      `(${((100 * esc) / Math.max(1, cuts)).toFixed(0)}%), bypassable to the goal ${byp} (${((100 * byp) / Math.max(1, cuts)).toFixed(0)}%); ` +
      `stages with a bypassable cut ${stagesByp}/${withCut.length}.`,
  );
  summary[tier] = { ...s, escapeGapM: gapStats };
  console.log(
    `  ${tier} escape gaps: ${gapStats.zero} overlap (drop onto a lower island below), ${gapStats.under1m} < 1 m, ${gapStats.under2m} < 2 m; median ${gapStats.median.toFixed(2)} m, p90 ${gapStats.p90.toFixed(2)} m`,
  );
}
const jf = flag('--json');
if (jf) writeFileSync(jf, JSON.stringify({ summary, rows }, null, 2));
