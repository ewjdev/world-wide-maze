import type { StageData } from '@wwm/schema';
import { buildStage } from '@wwm/stage-builder';
import { loadCapture, loadReferenceStage } from '@wwm/stage-builder/node';
import { buildNavGrid, cellOf } from '../src/nav.ts';

const spec = process.argv[2] ?? 'hn-front';
const [slug, slice = '0', diff = 'normal', seed = '1'] = spec.split(':');
function load(): StageData {
  if (spec === 'aid') return loadReferenceStage() as StageData;
  const { capture, image } = loadCapture(slug as string);
  return buildStage({
    capture,
    image,
    sliceIndex: Number(slice),
    seed: Number(seed),
    difficulty: diff as StageData['difficulty'],
  }).stage;
}
const s = load();
const g = buildNavGrid(s);
const cx = Number(process.argv[3] ?? 333);
const cy = Number(process.argv[4] ?? 181);
const r = Number(process.argv[5] ?? 8);
const c0 = cellOf(g, [cx, cy]);
const gx = c0 % g.w;
const gy = Math.floor(c0 / g.w);
for (let y = gy - r; y <= gy + r; y++) {
  let row = `${String(y * g.cell).padStart(5)} `;
  for (let x = gx - r; x <= gx + r; x++) {
    const i = y * g.w + x;
    const l = g.label[i] as number;
    const c = g.clear[i] as number;
    const ch =
      l === 0
        ? ' .'
        : g.lift[i]
          ? ' L'
          : l < 0
            ? c >= g.minClear
              ? ' B'
              : ' b'
            : c >= g.minClear
              ? ' I'
              : ' i';
    row += ch;
  }
  console.log(row);
}
console.log('labels at center', g.label[c0], 'clear', g.clear[c0]);

import { planRoute } from '../src/plan.ts';

const up = planRoute(g, { from: [cx, cy - 20], to: [cx, cy + 20] });
console.log(
  'plan across',
  up ? up.legs.map((l) => l.verts.map((v) => v.p.map(Math.round).join(','))).join(' | ') : null,
);
const lab = (p: [number, number]) => g.label[cellOf(g, p)];
console.log(
  'labels',
  lab([cx, cy - 20]),
  lab([cx, cy]),
  lab([cx, cy + 20]),
  s.bridges[2],
  s.islands[3]?.id,
  s.islands[4]?.id,
);
const st = planRoute(g, { from: s.start.pos, to: [cx, cy + 20] });
console.log(
  'from start',
  s.start.pos,
  st ? st.legs.map((l) => l.verts.map((v) => v.p.map(Math.round).join(','))).join(' | ') : null,
);
const st2 = planRoute(g, { from: s.start.pos, to: [cx, cy - 20] });
console.log(
  'from start to above',
  st2 ? st2.legs.map((l) => l.verts.map((v) => v.p.map(Math.round).join(','))).join(' | ') : null,
);
for (const q of [
  [717, 125],
  [600, 161],
  [500, 161],
  [400, 161],
] as [number, number][]) {
  const z = planRoute(g, { from: q, to: [cx, cy - 20] });
  console.log('from', q, 'label', lab(q), z ? 'ok' : null);
}
