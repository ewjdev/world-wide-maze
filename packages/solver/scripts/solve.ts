/**
 * Dev CLI: solve stages and print the result.
 *   node packages/solver/scripts/solve.ts handmade | aid | <capture slug>[:slice[:difficulty[:seed]]] ...
 */
import { readFileSync } from 'node:fs';
import type { StageData } from '@wwm/schema';
import { buildStage } from '@wwm/stage-builder';
import { loadCapture, loadReferenceStage } from '@wwm/stage-builder/node';
import { buildNavGrid } from '../src/nav.ts';
import { solveStage } from '../src/solve.ts';

const root = new URL('../../../', import.meta.url);
for (const arg of process.argv.slice(2)) {
  let stage: StageData;
  if (arg === 'handmade')
    stage = JSON.parse(
      readFileSync(new URL('fixtures/stages/handmade-simple.json', root), 'utf8'),
    ) as StageData;
  else if (arg === 'aid') stage = loadReferenceStage() as StageData;
  else {
    const [slug, slice = '0', diff = 'normal', seed = '1'] = arg.split(':');
    const { capture, image } = loadCapture(slug as string);
    stage = buildStage({
      capture,
      image,
      sliceIndex: Number(slice),
      seed: Number(seed),
      difficulty: diff as StageData['difficulty'],
    }).stage;
  }
  const mc = process.env.MINCLEAR ? { minClear: Number(process.env.MINCLEAR) } : {};
  const r = await solveStage(stage, { maxSimSec: arg === 'aid' ? 400 : 240, grid: buildNavGrid(stage, mc) });
  console.log(
    `${arg}: ${r.success ? 'OK' : 'FAIL'} ${r.timeSec.toFixed(1)} s falls ${r.falls} items ${r.items} route ${r.routeM.toFixed(0)} m ` +
      `cpu ${r.cpuMs.toFixed(0)} ms variant ${r.variant} ${r.failure ? JSON.stringify(r.failure) : ''}`,
  );
  for (const a of r.attempts)
    console.log(
      `   ${a.variant}: ${a.success ? 'ok' : 'fail'} ${a.timeSec.toFixed(1)}s falls ${a.falls} replans ${a.replans} cpu ${a.cpuMs.toFixed(0)} ${
        a.failure ? `${a.failure.kind} @${a.failure.at.map(Math.round)} ${a.failure.detail ?? ''}` : ''
      }`,
    );
}
