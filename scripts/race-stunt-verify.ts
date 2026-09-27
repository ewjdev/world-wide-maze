/** Reproducible player-input validation of all three Island Leap routes, using real Rapier. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  advanceProgress,
  createProgress,
  createRaceSimulation,
  makeCompatibility,
  type RaceAttempt,
  type RaceCourse,
  type RaceInputSample,
  RaceRecorder,
  replayRace,
} from '../packages/race/src/index.ts';
import { PX_PER_METER, pointInPolygon } from '../packages/schema/src/index.ts';

const dir = resolve(import.meta.dirname, '../fixtures/race/island-leap');
const course: RaceCourse = JSON.parse(await readFile(resolve(dir, 'course.json'), 'utf8'));
const reports = [];
for (const route of ['safe', 'near', 'far'] as const) {
  const sim = await createRaceSimulation(course);
  await sim.load(course.stage);
  let progress = createProgress();
  const recorder = new RaceRecorder(undefined, true);
  const inputs: RaceInputSample[] = [];
  const trace: number[][] = [];
  const events: unknown[] = [];
  let sent = false;
  let waypoint = 0;
  let clearance = Infinity;
  let clearanceSamples = 0;
  const targets = [
    [890, 260],
    [890, 590],
    [1460, 590],
    [1460, 260],
    [1700, 260],
  ];
  try {
    for (let tick = 1; tick <= 12000; tick++) {
      const before = sim.getBallState();
      const px = before.pos[0] * PX_PER_METER;
      let input: RaceInputSample = {
        tiltX: 0,
        tiltZ: 0.436,
        frameYaw: -Math.PI / 2,
        power: true,
        jump: false,
      };
      if (route === 'safe' && px > 680) {
        let target = targets[waypoint];
        let dx = target[0] / PX_PER_METER - before.pos[0],
          dz = target[1] / PX_PER_METER - before.pos[2];
        const dist = Math.hypot(dx, dz);
        if (dist < 0.4 && waypoint < targets.length - 1) {
          waypoint++;
          target = targets[waypoint];
          dx = target[0] / PX_PER_METER - before.pos[0];
          dz = target[1] / PX_PER_METER - before.pos[2];
        }
        const distance = Math.hypot(dx, dz) || 1;
        const speed = Math.min(5, distance * 2);
        const vx = (dx / distance) * speed,
          vz = (dz / distance) * speed;
        const ax = 4 * (vx - before.vel[0]) + 1.2 * vx,
          az = 4 * (vz - before.vel[2]) + 1.2 * vz;
        const tilt = (a: number) =>
          Math.asin(Math.max(-Math.sin(0.436), Math.min(Math.sin(0.436), a / ((46.3 * 5) / 7))));
        input = { tiltX: tilt(ax), tiltZ: tilt(-az), frameYaw: 0, power: true, jump: false };
      }
      if (route === 'far' && !sent && px > 1135) {
        input.turbo = true;
        sent = true;
      }
      inputs.push(input);
      recorder.record(input);
      const step = sim.step(input);
      const mechanics = sim.getMechanics();
      progress = advanceProgress(progress, course.gates, {
        tick,
        previous: before.pos,
        current: step.ball.pos,
        fell: step.events.some((e) => e.type === 'fell' || e.type === 'lost'),
      });
      trace.push([...step.ball.pos, ...step.ball.vel, Number(step.ball.grounded)]);
      if (step.events.length || mechanics.lastEvent)
        events.push({ tick, events: step.events, mechanic: mechanics.lastEvent, pos: step.ball.pos });
      const near = course.stage.islands[2];
      if (
        route === 'far' &&
        pointInPolygon(
          [step.ball.pos[0] * PX_PER_METER, step.ball.pos[2] * PX_PER_METER],
          near.contour,
          near.holes,
        )
      ) {
        clearance = Math.min(clearance, step.ball.pos[1] - 0.5 - near.level);
        clearanceSamples++;
      }
      if (progress.finishTick) break;
      if (progress.reasons.length)
        throw new Error(`${route} fell tick${tick} at${step.ball.pos} waypoint${waypoint}`);
    }
    if (!progress.finishTick)
      throw new Error(
        `${route} did notfinish ${JSON.stringify(progress)} ${JSON.stringify(sim.getBallState())}`,
      );
    const mechanics = sim.getMechanics();
    if (route !== 'safe' && (mechanics.launches !== 1 || mechanics.landings !== 1))
      throw new Error(`${route} failed launch/landing ${JSON.stringify(mechanics)}`);
    if (route === 'far' && (!clearanceSamples || clearance <= 0.5))
      throw new Error(`Far route did not physically clear near island ${clearance}`);
    const attempt: RaceAttempt = {
      schema: 'wwm.race-attempt/1',
      id: `island-leap-${route}`,
      createdAt: 0,
      compatibility: makeCompatibility(course.courseId, true),
      inputSource: 'keyboard',
      outcome: 'finished',
      progress,
      recording: recorder.finish(),
    };
    const replay = await replayRace(course, attempt);
    for (let i = 0; i < trace.length; i++)
      for (let axis = 0; axis < 3; axis++)
        if (Math.abs(replay.pos[(i + 1) * 3 + axis] - trace[i][axis]) > 0.00001)
          throw new Error(`${route} replay drift tick${i + 1}`);
    const report = {
      route,
      courseId: course.courseId,
      progress,
      mechanics,
      events,
      clearedIslandId: route === 'far' ? 2 : null,
      minClearanceM: route === 'far' ? clearance : null,
      clearanceSamples: route === 'far' ? clearanceSamples : 0,
      replayVerified: true,
      method:
        'Real fixed-step Rapier player inputs; ordered Race gates; identical-pose second-simulation replay. Automated feasibility, not human difficulty acceptance.',
    };
    await writeFile(
      resolve(dir, `${route}-inputs.json`),
      JSON.stringify({ courseId: course.courseId, inputs }),
    );
    await writeFile(
      resolve(dir, `${route}-trace.json`),
      JSON.stringify({
        courseId: course.courseId,
        columns: ['x', 'y', 'z', 'vx', 'vy', 'vz', 'grounded'],
        ticks: trace,
      }),
    );
    await writeFile(resolve(dir, `${route}-validation.json`), JSON.stringify(report, null, 2));
    reports.push(report);
    console.log(route, progress.finishTick / 120, mechanics, 'clearance', route === 'far' ? clearance : null);
  } finally {
    sim.dispose();
  }
}
await writeFile(
  resolve(dir, 'race-validation.json'),
  JSON.stringify({ courseId: course.courseId, routes: reports }, null, 2),
);
