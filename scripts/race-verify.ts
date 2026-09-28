/** Generate ordinary bounded classic-course inputs and verify authoritative gates and independent replay. */
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
  validateGates,
} from '../packages/race/src/index.ts';
import { bridgeSections, PX_PER_METER } from '../packages/schema/src/index.ts';
import { createMazePolicy, type MazeWaypoint } from './race-maze-policy.ts';

for (const slug of ['flow-sprint', 'switchback', 'longline']) {
  const dir = resolve(import.meta.dirname, '../fixtures/race', slug);
  const course = JSON.parse(await readFile(resolve(dir, 'course.json'), 'utf8')) as RaceCourse;
  const points: MazeWaypoint[] = [];
  for (const bridge of course.stage.bridges) {
    const sections = bridgeSections(bridge);
    for (let i = 0; i < sections.length; i += Math.max(1, Math.floor(sections.length / 8))) {
      const section = sections[i];
      points.push({ x: section.pos[0], z: section.pos[1], radius: 0.7 });
    }
    points.push({ x: bridge.b[0], z: bridge.b[1], radius: 0.7 });
    const island = course.stage.islands.find((i) => i.id === bridge.to);
    if (!island) throw new Error('bridge destination missing');
    points.push({
      x: island.contour.reduce((sum, p) => sum + p[0], 0) / island.contour.length,
      z: island.contour.reduce((sum, p) => sum + p[1], 0) / island.contour.length,
      radius: 0.7,
    });
  }
  const finish = course.gates.at(-1);
  if (!finish) throw new Error('finish missing');
  points.push({
    x: (finish.center[0] + finish.normal[0] * 2) * PX_PER_METER,
    z: (finish.center[2] + finish.normal[1] * 2) * PX_PER_METER,
  });
  const policy = createMazePolicy(
    { id: 'solver', points, targetSpeed: 9.5 },
    { elevation: !!course.physicsProfile },
  );
  const inputs: RaceInputSample[] = [];
  if (validateGates(course.gates).length) throw new Error(validateGates(course.gates).join('; '));
  const sim = await createRaceSimulation(course);
  let progress = createProgress();
  const recorder = new RaceRecorder(undefined, !!course.stunts);
  const trace: number[][] = [];
  const events: unknown[] = [];
  try {
    await sim.load(course.stage);
    let previous = sim.getBallState();
    for (let tick = 0; tick < 18000; tick++) {
      const input = policy({ tick, ball: previous, mechanics: sim.getMechanics() });
      inputs.push(input);
      recorder.record(input);
      const step = sim.step(input);
      progress = advanceProgress(progress, course.gates, {
        tick: progress.tick + 1,
        previous: previous.pos,
        current: step.ball.pos,
        fell: step.events.some((e) => e.type === 'fell' || e.type === 'lost'),
      });
      trace.push([...step.ball.pos, ...step.ball.vel, Number(step.ball.grounded)]);
      const mechanics = sim.getMechanics();
      if (step.events.length || mechanics.lastEvent)
        events.push({ tick: progress.tick, events: step.events, mechanic: mechanics.lastEvent });
      previous = step.ball;
      if (progress.finishTick !== null || progress.reasons.length) break;
    }
    if (!progress.finishTick || progress.reasons.length)
      throw new Error(`Race route did not finish cleanly: ${slug} ${JSON.stringify(progress)}`);
    const attempt: RaceAttempt = {
      schema: 'wwm.race-attempt/1',
      id: `${slug}-solver`,
      createdAt: 0,
      compatibility: makeCompatibility(course.courseId, !!course.stunts, course.physicsProfile),
      inputSource: 'keyboard',
      outcome: 'finished',
      progress,
      recording: recorder.finish(),
    };
    const track = await replayRace(course, attempt);
    const result = {
      courseId: course.courseId,
      compatibility: attempt.compatibility,
      progress,
      mechanics: sim.getMechanics(),
      events,
      replayProgress: track.progress,
      verifiedTicks: track.ticks,
      inputBytes: attempt.recording.data.byteLength,
      poseBytes: track.pos.byteLength + track.quat.byteLength + track.discontinuities.byteLength,
      method:
        'Ordinary bounded waypoint input stream through real Rapier, Race per-step reducer, exact second-simulation Race replay. Automated traversal only; human flow not assessed.',
    };
    for (let i = 0; i < trace.length; i++)
      for (let axis = 0; axis < 3; axis++) {
        if (Math.abs(track.pos[(i + 1) * 3 + axis] - trace[i][axis]) > 0.00001)
          throw new Error(`${slug}: replay pose drift`);
      }
    await writeFile(
      resolve(dir, 'solver-inputs.json'),
      JSON.stringify({ courseId: course.courseId, inputs }),
    );
    await writeFile(
      resolve(dir, 'solver-trace.json'),
      JSON.stringify({ courseId: course.courseId, ticks: trace }),
    );
    await writeFile(resolve(dir, 'race-validation.json'), JSON.stringify(result, null, 2));
    console.log(slug, `${progress.finishTick / 120}s`, 'sectors', progress.sectorTicks, 'replay verified');
  } finally {
    sim.dispose();
  }
}
