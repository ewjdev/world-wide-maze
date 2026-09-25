/**
 * Render one stage (with the nav-grid overlay and the solver's run) to a PNG for debugging.
 *   node tools/batch-eval/src/cli/thumb.ts <slug>[:slice[:difficulty[:seed]]] [out.png] [--width 900] [--no-solve]
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { StageData, Vec2 } from '@wwm/schema';
import { buildNavGrid, planRoute, solveStage } from '@wwm/solver';
import { buildStage } from '@wwm/stage-builder';
import { encodePng, loadCapture } from '@wwm/stage-builder/node';
import { renderThumb } from '../thumb.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    width: { type: 'string', default: '900' },
    crop: { type: 'string' },
    'no-solve': { type: 'boolean', default: false },
  },
});
const spec = positionals[0] ?? 'hn-front';
const out = positionals[1] ?? `/tmp/wwm-thumb-${spec.replace(/:/g, '_')}.png`;
const [slug, slice = '0', diff = 'normal', seed = '1'] = spec.split(':');
const { capture, image } = loadCapture(slug as string);
const stage: StageData = buildStage({
  capture,
  image,
  sliceIndex: Number(slice),
  seed: Number(seed),
  difficulty: diff as StageData['difficulty'],
}).stage;
const grid = buildNavGrid(stage);
const route = planRoute(grid, { from: stage.start.pos });
const solve = values['no-solve'] ? undefined : await solveStage(stage, { grid });
if (solve)
  console.log(
    `${spec}: ${solve.success ? 'OK' : 'FAIL'} ${solve.timeSec.toFixed(1)} s falls ${solve.falls} ${solve.failure ? JSON.stringify(solve.failure) : ''}`,
  );
const r = renderThumb(stage, {
  width: Number(values.width),
  image,
  imageScale: capture.screenshot.scale,
  grid,
  route: route ? route.legs.map((l) => l.verts.map((v) => v.p as Vec2)) : [],
  ...(solve ? { solve } : {}),
});
if (values.crop) {
  // crop x,y,w,h in stage px
  const [cx, cy, cw, ch] = values.crop.split(',').map(Number) as [number, number, number, number];
  const k = r.width / stage.size.width;
  const x0 = Math.round(cx * k);
  const y0 = Math.round(cy * k);
  const w = Math.min(r.width - x0, Math.round(cw * k));
  const h = Math.min(r.height - y0, Math.round(ch * k));
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    data.set(r.data.subarray(((y0 + y) * r.width + x0) * 4, ((y0 + y) * r.width + x0 + w) * 4), y * w * 4);
  writeFileSync(out, encodePng({ width: w, height: h, data }));
} else writeFileSync(out, encodePng({ width: r.width, height: r.height, data: r.data }));
console.log(`wrote ${out}`);
