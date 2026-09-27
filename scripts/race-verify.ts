/** Replay frozen solver inputs through authoritative Race gates and a second clean simulation. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  advanceProgress,
  createProgress,
  createRaceSimulation,
  makeCompatibility,
  type RaceAttempt,
  type RaceCourse,
  RaceRecorder,
  replayRace,
  validateGates,
} from '../packages/race/src/index.ts';

for (const slug of ['flow-sprint', 'switchback', 'longline']) {
  const dir = resolve(import.meta.dirname, '../fixtures/race', slug);
  const course = JSON.parse(await readFile(resolve(dir, 'course.json'), 'utf8')) as RaceCourse;
  const { inputs } = JSON.parse(await readFile(resolve(dir, 'solver-inputs.json'), 'utf8'));
  if (validateGates(course.gates).length) throw new Error(validateGates(course.gates).join('; '));
  const sim = await createRaceSimulation(course);
  let progress = createProgress();
  const recorder = new RaceRecorder(undefined, !!course.stunts);
  const trace: number[][] = [];
  const events: unknown[] = [];
  try {
    await sim.load(course.stage);
    let previous = sim.getBallState();
    for (const input of inputs) {
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
      if (progress.finishTick !== null) break;
    }
    if (!progress.finishTick || progress.reasons.length)
      throw new Error(`Race route did not finish cleanly: ${slug} ${JSON.stringify(progress)}`);
    const attempt: RaceAttempt = {
      schema: 'wwm.race-attempt/1',
      id: `${slug}-solver`,
      createdAt: 0,
      compatibility: makeCompatibility(course.courseId, !!course.stunts),
      inputSource: 'keyboard',
      outcome: 'finished',
      progress,
      recording: recorder.finish(),
    };
    const track = await replayRace(course, attempt);
    const result = {
      courseId: course.courseId,
      progress,
      mechanics: sim.getMechanics(),
      events,
      replayProgress: track.progress,
      verifiedTicks: track.ticks,
      inputBytes: attempt.recording.data.byteLength,
      poseBytes: track.pos.byteLength + track.quat.byteLength + track.discontinuities.byteLength,
      method:
        'Real Rapier solver input stream, Race per-step reducer, exact second-simulation Race replay. Automated traversal only; human flow not assessed.',
    };
    for (let i = 0; i < trace.length; i++)
      for (let axis = 0; axis < 3; axis++) {
        if (Math.abs(track.pos[(i + 1) * 3 + axis] - trace[i][axis]) > 0.00001)
          throw new Error(`${slug}: replay pose drift`);
      }
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
