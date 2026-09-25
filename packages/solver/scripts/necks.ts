/**
 * Dev: for every narrow-neck failure in an eval report, the shortest gap (px) between the cut-off walkable
 * parts of the island.  node packages/solver/scripts/necks.ts /tmp/wwm-evalA/report.json
 */
import { readFileSync } from 'node:fs';
import type { StageData } from '@wwm/schema';
import { buildStage } from '@wwm/stage-builder';
import { loadCapture } from '@wwm/stage-builder/node';
import { buildNavGrid, cellCenter, walkable } from '../src/nav.ts';

const rep = JSON.parse(readFileSync(process.argv[2] ?? '/tmp/wwm-evalA/report.json', 'utf8')) as {
  records: {
    slug: string;
    slice: number;
    difficulty: StageData['difficulty'];
    seed: number;
    failure?: { kind: string; islandId: number };
  }[];
};
const seen = new Set<string>();
const gaps: number[] = [];
for (const r of rep.records) {
  if (r.failure?.kind !== 'narrow-neck' || r.difficulty !== 'normal') continue;
  const { capture, image } = loadCapture(r.slug);
  const s = buildStage({ capture, image, sliceIndex: r.slice, seed: r.seed, difficulty: r.difficulty }).stage;
  const key = `${s.stageId}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const g = buildNavGrid(s);
  const label = (g.islandIndex.get(r.failure.islandId) ?? -2) + 1;
  // components of this island
  const comp = new Int32Array(g.w * g.h).fill(-1);
  const cells: number[][] = [];
  for (let i = 0; i < g.w * g.h; i++) {
    if (comp[i] !== -1 || g.label[i] !== label || !walkable(g, i)) continue;
    const id = cells.length;
    const list: number[] = [];
    const st = [i];
    comp[i] = id;
    while (st.length) {
      const c = st.pop() as number;
      list.push(c);
      const x = c % g.w;
      const y = Math.floor(c / g.w);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const j = (y + dy) * g.w + x + dx;
          if (j < 0 || j >= g.w * g.h || comp[j] !== -1 || g.label[j] !== label || !walkable(g, j)) continue;
          comp[j] = id;
          st.push(j);
        }
    }
    cells.push(list);
  }
  let best = Number.POSITIVE_INFINITY;
  for (let a = 0; a < cells.length; a++)
    for (let b = a + 1; b < cells.length; b++)
      for (const ca of cells[a] as number[]) {
        const pa = cellCenter(g, ca);
        for (const cb of cells[b] as number[]) {
          const pb = cellCenter(g, cb);
          const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
          if (d < best) best = d;
        }
      }
  gaps.push(best);
  console.log(
    `${r.slug} s${r.slice} seed ${r.seed} island ${r.failure.islandId}: ${cells.length} parts, min gap ${best.toFixed(1)} px`,
  );
}
gaps.sort((a, b) => a - b);
console.log('gaps', gaps.map((x) => x.toFixed(0)).join(' '));
