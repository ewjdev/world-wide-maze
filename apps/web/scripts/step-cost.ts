/**
 * Phase 08b measurement: main-thread cost of one physics step on every fixture stage (the lockstep driver's
 * per-frame budget). `node --experimental-strip-types scripts/step-cost.ts` from apps/web.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSimulation } from '@wwm/physics';
import type { StageData } from '@wwm/schema';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const files = [
  'fixtures/stages/handmade-simple.json',
  ...readdirSync(`${root}fixtures/builder`).map((f) => `fixtures/builder/${f}`),
];
for (const f of files) {
  const stage = JSON.parse(readFileSync(`${root}${f}`, 'utf8')) as StageData;
  const sim = await createSimulation();
  await sim.load(stage);
  const n = 2400;
  let max = 0;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const a = performance.now();
    sim.step({
      tiltX: Math.sin(i / 90) * 0.3,
      tiltZ: 0.3,
      frameYaw: 0,
      power: i % 400 < 300,
      jump: i % 500 === 0,
    });
    max = Math.max(max, performance.now() - a);
  }
  const ms = (performance.now() - t0) / n;
  console.log(
    `${f.padEnd(52)} ${(ms * 1000).toFixed(1).padStart(6)} µs/step  max ${max.toFixed(2)} ms  → ${(ms * 2).toFixed(3)} ms per 60 Hz frame`,
  );
  sim.dispose();
}
