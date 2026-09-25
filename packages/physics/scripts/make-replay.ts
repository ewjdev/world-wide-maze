/**
 * Regenerates fixtures/replays/handmade-simple.keyboard.json by flying a scripted waypoint route with the
 * test pilot (keyboard-range tilt, chase-camera frameYaw, POWER held). Run: `pnpm --filter @wwm/physics replay:make`.
 * The route crosses a flat bridge, climbs the ramp, rides the elevator, picks up both large items and reaches
 * the goal.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { InputSample, StageData, Vec2 } from '@wwm/schema';
import { createSimulation } from '../src/simulation.ts';
import { flyWaypoints } from '../test/helpers/pilot.ts';

export const HANDMADE_ROUTE: Vec2[] = [
  [140, 80],
  [180, 80],
  [240, 170],
  [400, 170],
  [480, 170],
  [480, 250],
  [480, 330],
  [480, 450],
  [570, 540],
  [450, 540],
  [400, 540],
  [350, 540],
  [300, 540],
  [220, 580],
  [160, 580],
  [100, 580],
  [290, 720],
];

export function formatReplay(inputs: readonly InputSample[]): string {
  return `[\n${inputs.map((s) => JSON.stringify(s)).join(',\n')}\n]\n`;
}

const stageUrl = new URL('../../../fixtures/stages/handmade-simple.json', import.meta.url);
const outUrl = new URL('../../../fixtures/replays/handmade-simple.keyboard.json', import.meta.url);

if (import.meta.url === `file://${process.argv[1]}`) {
  const stage = JSON.parse(readFileSync(stageUrl, 'utf8')) as StageData;
  const sim = await createSimulation();
  await sim.load(stage);
  const run = flyWaypoints(sim, stage, HANDMADE_ROUTE);
  sim.dispose();
  if (run.goalTick < 0) throw new Error('route did not reach the goal');
  for (const e of run.events) console.log(e.tick, JSON.stringify(e.event));
  writeFileSync(outUrl, formatReplay(run.inputs));
  console.log(
    `wrote ${run.inputs.length} samples (${(run.inputs.length / 120).toFixed(1)} s), goal at tick ${run.goalTick}`,
  );
}
