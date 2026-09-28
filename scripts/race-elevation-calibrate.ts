/** Ordinary-input elevation calibration. No pose/velocity injection is used in these runs. */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createSimulation,
  RACE_ELEVATION_PROFILE,
  surfaceTravelGrade,
} from '../packages/physics/src/index.ts';
import { island, makeStage, rect } from '../packages/physics/test/helpers/stages.ts';
import type { InputSample } from '../packages/schema/src/index.ts';

const PX = 13.5;
const idle: InputSample = { tiltX: 0, tiltZ: 0, frameYaw: -Math.PI / 2, power: false, jump: false };
function track(run: number, angle: number, climbing = false) {
  const rise = (run * Math.tan((angle * Math.PI) / 180)) / 1.5;
  const top = climbing ? 0 : rise;
  const bottom = climbing ? rise : 0;
  return makeStage({
    islands: [
      island(0, rect(0, 0, 20 * PX, 20 * PX), top, { guardrails: [] }),
      island(1, rect((20 + run) * PX, 0, 250 * PX, 250 * PX), bottom, { guardrails: [] }),
    ],
    bridges: [
      {
        id: 0,
        from: 0,
        to: 1,
        a: [20 * PX, 10 * PX],
        b: [(20 + run) * PX, 10 * PX],
        width: 12 * PX,
        levelA: top,
        levelB: bottom,
        type: 'ramp',
        rails: false,
        elevationProfile: 'smoothstep',
      },
    ],
    start: [10 * PX, 10 * PX],
    width: (run + 280) * PX,
    height: 250 * PX,
  });
}
async function run(
  runM: number,
  angle: number,
  climbing = false,
  brake = false,
  tilt = 0.436,
  restart = false,
  turn = false,
) {
  const sim = await createSimulation({ raceElevation: true });
  await sim.load(track(runM, angle, climbing));
  let maxSpeed = 0;
  let unsupportedRampTicks = 0;
  let longestAirTicks = 0;
  let currentAirTicks = 0;
  let exitSpeed: number | null = null;
  let exitX: number | null = null;
  let stopDistance: number | null = null;
  let speedAtTenMetersAfterExit: number | null = null;
  let failed = false;
  let restartTick: number | null = null;
  let restartSpeed: number | null = null;
  let maximumLocalGrade = 0;
  let turnStart: { x: number; z: number; tick: number } | null = null;
  let turnEnvelope: {
    seconds: number;
    forwardMeters: number;
    lateralMeters: number;
    finalSpeed: number;
  } | null = null;
  const samples: unknown[] = [];
  for (let tick = 0; tick < 4800; tick++) {
    const before = sim.getBallState();
    if (restart && restartTick === null && before.pos[0] >= 20 + runM / 2) restartTick = tick;
    const restartPause = restartTick !== null && tick < restartTick + 120;
    if (restartTick !== null && tick === restartTick + 120)
      restartSpeed = Math.hypot(before.vel[0], before.vel[2]);
    const braking = brake && exitX !== null;
    if (turn && exitX !== null && !turnStart) turnStart = { x: before.pos[0], z: before.pos[2], tick };
    const result = sim.step({
      ...idle,
      frameYaw: turnStart ? Math.PI : idle.frameYaw,
      power: !braking && !restartPause,
      tiltZ: tilt,
    });
    const b = result.ball;
    const speed = Math.hypot(b.vel[0], b.vel[2]);
    maxSpeed = Math.max(speed, maxSpeed);
    if (turnStart && Math.atan2(b.vel[2], b.vel[0]) >= (80 * Math.PI) / 180) {
      turnEnvelope = {
        seconds: (tick - turnStart.tick + 1) / 120,
        forwardMeters: b.pos[0] - turnStart.x,
        lateralMeters: b.pos[2] - turnStart.z,
        finalSpeed: speed,
      };
      break;
    }
    const grade = surfaceTravelGrade(sim.getSurfaceSupport(), b.vel);
    maximumLocalGrade = Math.max(maximumLocalGrade, Math.abs(grade));
    if (b.pos[0] > 20 && b.pos[0] < 20 + runM) {
      currentAirTicks = sim.getSurfaceSupport() ? 0 : currentAirTicks + 1;
      if (!sim.getSurfaceSupport()) unsupportedRampTicks++;
      longestAirTicks = Math.max(longestAirTicks, currentAirTicks);
    }
    if (b.pos[0] >= 20 + runM && exitX === null) {
      exitX = b.pos[0];
      exitSpeed = speed;
    }
    if (exitX !== null && b.pos[0] >= exitX + 10 && speedAtTenMetersAfterExit === null)
      speedAtTenMetersAfterExit = speed;
    if (braking && speed < 1) {
      stopDistance = b.pos[0] - (exitX ?? 0);
      break;
    }
    if (tick % 120 === 0)
      samples.push({
        seconds: tick / 120,
        x: b.pos[0],
        y: b.pos[1],
        speed,
        grade,
        support: sim.getSurfaceSupport()?.surfaceId ?? null,
      });
    if (result.events.some((e) => e.type === 'fell')) {
      failed = true;
      break;
    }
    if (b.pos[0] > 20 + runM + 100) break;
    if (tick > 1200 && Math.abs(before.pos[0] - b.pos[0]) < 0.00001) break;
  }
  const result = {
    runM,
    inputTiltDegrees: (tilt * 180) / Math.PI,
    restart,
    restartSpeed,
    turn,
    turnEnvelope,
    maximumAngleDegrees: angle,
    climbing,
    brake,
    maxSpeed,
    exitSpeed,
    speedAtTenMetersAfterExit,
    stopDistance,
    unsupportedRampTicks,
    longestAirSeconds: longestAirTicks / 120,
    maximumObservedGrade: maximumLocalGrade,
    minimumAnalyticCrestRadiusM: runM / (4 * Math.tan((angle * Math.PI) / 180)),
    reachedExit: exitX !== null,
    failed,
    final: sim.getBallState(),
    samples,
  };
  sim.dispose();
  return result;
}
const cases = [];
for (const length of [40, 80, 120, 180]) cases.push(await run(length, 20));
cases.push(await run(120, 20, false, true));
cases.push(await run(80, 20, true));
cases.push(await run(80, 12, true));
cases.push(await run(80, 20, true, false, 0.436, true));
cases.push(await run(80, 20, false, false, Math.PI / 4));
cases.push(await run(120, 20, false, false, 0.436, false, true));
const report = {
  profile: RACE_ELEVATION_PROFILE,
  numericalTolerance:
    'Authored analytic profiles have a nominal maximum of 20 degrees. Float32 collider tessellation/contact normals have approximately 0.01 degree numerical variation at the boundary; maximumObservedGrade reports actual Rapier contact normals, not authored analytic grade.',
  limitations:
    'Calibration measures ordinary-input attainability and footprint, not human controllability. Long straight calibration ramps are not catalog courses. Phone max-tilt descent shows brief separation at sampled crest/contact transitions; keyboard descents remain supported. Turn envelope is the footprint to an 80-degree heading change under a 90-degree commanded turn, not a constant-radius turning claim.',
  method:
    'Fixed 120 Hz Rapier, ordinary bounded input (25 degree keyboard or 45 degree maximum phone tilt; explicit per-case field), no turbo and no injected pose or velocity. Calibration corridors are deliberately straight and are not catalog courses.',
  cases,
};
await writeFile(
  resolve(import.meta.dirname, '../fixtures/race/elevation-calibration.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    cases.map(({ samples: _samples, final: _final, ...summary }) => summary),
    null,
    2,
  ),
);
