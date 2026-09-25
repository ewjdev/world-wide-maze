/**
 * Rapier build evaluation: deterministic-compat vs standard compat, on the handmade replay and a
 * 400k-triangle synthetic stage. Run: `pnpm --filter @wwm/physics bench:builds`.
 */
import { readFileSync } from 'node:fs';
import type { InputSample, StageData, Vec2 } from '@wwm/schema';
import type { RapierBuild } from '../src/rapier.ts';
import { replay } from '../src/replay.ts';
import { createSimulation } from '../src/simulation.ts';
import { circle, HANDMADE, HANDMADE_REPLAY_URL, island, makeStage } from '../test/helpers/stages.ts';

const inputs = JSON.parse(readFileSync(HANDMADE_REPLAY_URL, 'utf8')) as InputSample[];

function big(): StageData {
  const islands = [];
  let id = 0;
  for (let gy = 0; gy < 8; gy++)
    for (let gx = 0; gx < 8; gx++) {
      const ring = circle(80 + gx * 150, 80 + gy * 150, 60, 400);
      islands.push(island(id++, ring, 0, { guardrails: [[...ring, ring[0] as Vec2]] }));
    }
  return makeStage({ islands, start: [80, 80] });
}

async function timeSteps(build: RapierBuild, stage: StageData, n: number): Promise<number> {
  const sim = await createSimulation({ rapier: build });
  await sim.load(stage);
  sim.step({ tiltX: 0, tiltZ: 0, frameYaw: 0, power: false, jump: false });
  const t0 = performance.now();
  for (let i = 0; i < n; i++)
    sim.step({ tiltX: 0.1, tiltZ: 0.3, frameYaw: i / 45, power: true, jump: i % 240 === 0 });
  const ms = (performance.now() - t0) / n;
  sim.dispose();
  return ms;
}

const results: Record<string, unknown>[] = [];
const finals: Record<string, number[]> = {};
for (const build of ['deterministic', 'standard'] as const) {
  const t0 = performance.now();
  const r = await replay(HANDMADE, inputs, { rapier: build });
  const replayMs = performance.now() - t0;
  finals[build] = r.final.pos;
  results.push({
    build,
    'replay (5441 ticks) ms': replayMs.toFixed(0),
    'goal tick': r.goalTick,
    'handmade µs/step': ((replayMs / inputs.length) * 1000).toFixed(1),
    '400k-tri µs/step': ((await timeSteps(build, big(), 2400)) * 1000).toFixed(1),
  });
}
console.table(results);
console.log('final pos deterministic', finals.deterministic, '\nfinal pos standard     ', finals.standard);
