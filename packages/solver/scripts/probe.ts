/**
 * Dev: geometry near a point + a solver run's ball states near it.
 *   node packages/solver/scripts/probe.ts <slug>:<slice>[:diff[:seed]] x y [radius]
 */
import { createSimulation, runInputs } from '@wwm/physics';
import type { StageData } from '@wwm/schema';
import { distanceToPolyline } from '@wwm/schema';
import { buildStage } from '@wwm/stage-builder';
import { loadCapture } from '@wwm/stage-builder/node';
import { solveStage } from '../src/solve.ts';

const [spec = 'eval-debian:0', xs = '595', ys = '166', rs = '40'] = process.argv.slice(2);
const [slug, slice = '0', diff = 'normal', seed = '1'] = spec.split(':');
const { capture, image } = loadCapture(slug as string);
const s: StageData = buildStage({
  capture,
  image,
  sliceIndex: Number(slice),
  seed: Number(seed),
  difficulty: diff as StageData['difficulty'],
}).stage;
const P: [number, number] = [Number(xs), Number(ys)];
const R = Number(rs);
for (const b of s.bridges) {
  const d = distanceToPolyline(P, [b.a, b.b]);
  if (d < R + b.width) console.log('bridge', JSON.stringify(b), 'dist', d.toFixed(1));
}
for (const e of s.elevators) {
  const d = distanceToPolyline(P, [e.a, e.b]);
  if (d < R + 40) console.log('elevator', JSON.stringify(e), 'dist', d.toFixed(1));
}
for (const i of s.islands) {
  const d = distanceToPolyline(P, [...i.contour, i.contour[0] as [number, number]]);
  if (d < R) {
    console.log('island', i.id, 'level', i.level, 'dist', d.toFixed(1), 'verts', i.contour.length);
    const near = (q: [number, number]) => Math.hypot(q[0] - P[0], q[1] - P[1]) < R * 1.5;
    console.log('  contour near', JSON.stringify(i.contour.filter(near)));
    for (const g of i.guardrails)
      if (g.some(near)) console.log('  rail pts near', JSON.stringify(g.filter(near)));
  }
  for (const g of i.guardrails) {
    const dg = distanceToPolyline(P, g);
    if (dg < R / 2)
      console.log(
        '  rail of',
        i.id,
        'dist',
        dg.toFixed(1),
        'ends',
        JSON.stringify(g[0]),
        JSON.stringify(g[g.length - 1]),
      );
  }
}
const r = await solveStage(s, { variants: [{ name: 'normal' }], squeeze: false });
console.log('solve', r.success, r.failure);
const sim = await createSimulation();
await sim.load(s);
let n = 0;
runInputs(sim, r.inputs, {
  onStep: (tick, st) => {
    const px = st.ball.pos[0] * 13.5;
    const py = st.ball.pos[2] * 13.5;
    if (Math.hypot(px - P[0], py - P[1]) < R / 2 && tick % 20 === 0 && n++ < 40) {
      const inp = r.inputs[tick - 1];
      console.log(
        tick,
        `pos ${px.toFixed(1)},${py.toFixed(1)} y ${st.ball.pos[1].toFixed(2)} v ${st.ball.vel.map((v) => v.toFixed(2)).join(',')} g ${st.ball.grounded}`,
        `in tx ${inp?.tiltX} tz ${inp?.tiltZ} yaw ${inp?.frameYaw}`,
      );
    }
    return false;
  },
});
