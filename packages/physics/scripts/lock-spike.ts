/**
 * Phase 22 M0 spike (1): ram a closed bridge gate on the handmade fixture at full speed with POWER + repeated JUMP,
 * from several approach angles, and print how far the ball got. All three island 0 → 1 bridges are locked (a cut),
 * the gate under test is bridge 1's at island 0.
 *
 *   node packages/physics/scripts/lock-spike.ts
 */
import type { LockSpec } from '@wwm/schema';
import { createSimulation } from '../src/simulation.ts';
import { ramGate } from '../test/helpers/lock-drive.ts';
import { HANDMADE } from '../test/helpers/stages.ts';

const LOCKS: LockSpec[] = [0, 1, 2].map((b) => ({ id: 10 + b, kind: 'bridge', targetId: b, islandId: 0 }));
const sim = await createSimulation();
console.log(
  'angle° | jump every s | run-up m | approach m/s | max past face m | max height m | locked | islands | fell',
);
for (const jumpEvery of [0.15, 0.3, 0.6])
  for (const angleDeg of [0, 15, -15, 30, -30, 45, -45, 60, -60]) {
    const r = await ramGate(sim, HANDMADE, LOCKS, 11, { angleDeg, jumpEvery, seconds: 8 });
    console.log(
      [
        angleDeg,
        jumpEvery,
        r.distM,
        r.approachSpeed.toFixed(1),
        r.maxPastFace.toFixed(3),
        r.maxHeight.toFixed(2),
        r.locked,
        r.islands.join('>'),
        r.fell,
      ].join(' | '),
    );
  }
console.log(
  '\nelevator gates (lift 0, 1.5 → 4 m): lock island | angle° | approach m/s | max past face m | max height m | locked | rides',
);
for (const islandId of [2, 3])
  for (const angleDeg of [0, 30, -30]) {
    const lock: LockSpec = { id: 20, kind: 'elevator', targetId: 0, islandId };
    const r = await ramGate(sim, HANDMADE, [lock], 20, { angleDeg, seconds: 8, distM: 8 });
    const rides = r.events.filter((e) => e.type === 'elevator').length;
    console.log(
      [
        islandId,
        angleDeg,
        r.approachSpeed.toFixed(1),
        r.maxPastFace.toFixed(3),
        r.maxHeight.toFixed(2),
        r.locked,
        rides,
      ].join(' | '),
    );
  }
const open = await ramGate(
  sim,
  HANDMADE,
  LOCKS.map((l) => ({ ...l })),
  11,
  { angleDeg: 0, openAtTick: 1, seconds: 4, targetPastM: 12 },
);
console.log(
  'control, gate opened at tick 1: islands',
  open.islands.join('>'),
  'max past face',
  open.maxPastFace.toFixed(1),
);
sim.dispose();
