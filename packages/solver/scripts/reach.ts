/**
 * Dev CLI: planner reachability report for a stage (which islands/bridges the ball can't get through).
 *   node packages/solver/scripts/reach.ts <capture slug>[:slice[:difficulty[:seed]]]
 */
import type { StageData } from '@wwm/schema';
import { buildStage } from '@wwm/stage-builder';
import { loadCapture } from '@wwm/stage-builder/node';
import { buildNavGrid, cellCenter, cellOf, walkable } from '../src/nav.ts';
import { planRoute } from '../src/plan.ts';

const [slug, slice = '0', diff = 'normal', seed = '1'] = (process.argv[2] ?? 'hn-front').split(':');
const { capture, image } = loadCapture(slug as string);
const s: StageData = buildStage({
  capture,
  image,
  sliceIndex: Number(slice),
  seed: Number(seed),
  difficulty: diff as StageData['difficulty'],
}).stage;
const g = buildNavGrid(s);
s.islands.forEach((isl, k) => {
  let best = -1;
  let bc = 0;
  for (let i = 0; i < g.w * g.h; i++)
    if (g.label[i] === k + 1 && walkable(g, i) && (g.clear[i] as number) > bc) {
      bc = g.clear[i] as number;
      best = i;
    }
  if (best < 0) {
    console.log('island', isl.id, 'has no walkable cell');
    return;
  }
  if (!planRoute(g, { from: s.start.pos, to: cellCenter(g, best) }))
    console.log('island', isl.id, 'unreachable; level', isl.level);
});
for (const b of s.bridges) {
  let mn = 1e9;
  for (let k = 0; k <= 20; k++) {
    const c = cellOf(g, [b.a[0] + ((b.b[0] - b.a[0]) * k) / 20, b.a[1] + ((b.b[1] - b.a[1]) * k) / 20]);
    mn = Math.min(mn, g.clear[c] as number);
  }
  if (mn < g.minClear)
    console.log(
      `bridge ${b.id} ${b.from}->${b.to} width ${b.width} len ${Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1]).toFixed(1)} ` +
        `centerline min clear ${mn.toFixed(1)} a ${JSON.stringify(b.a)} b ${JSON.stringify(b.b)}`,
    );
}
for (const p of g.portals) console.log('elevator', p.elevator.id, 'cells', p.lowCell, p.highCell);
// Walkable components per island (8-connected) at the planner threshold and a relaxed one.
function comps(k: number, thr: number): number {
  const seen = new Uint8Array(g.w * g.h);
  let n = 0;
  for (let i = 0; i < g.w * g.h; i++) {
    if (seen[i] || g.label[i] !== k + 1 || (g.clear[i] as number) < thr || g.lift[i]) continue;
    n++;
    const st = [i];
    seen[i] = 1;
    while (st.length) {
      const c = st.pop() as number;
      const x = c % g.w;
      const y = Math.floor(c / g.w);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
          const j = ny * g.w + nx;
          if (seen[j] || g.label[j] !== k + 1 || (g.clear[j] as number) < thr || g.lift[j]) continue;
          seen[j] = 1;
          st.push(j);
        }
    }
  }
  return n;
}
s.islands.forEach((isl, k) => {
  const a = comps(k, g.minClear);
  const b = comps(k, g.minClear - 2);
  const c = comps(k, 4);
  if (a > 1) console.log(`island ${isl.id}: ${a} walkable parts (relaxed -2px: ${b}, 4px: ${c})`);
});
