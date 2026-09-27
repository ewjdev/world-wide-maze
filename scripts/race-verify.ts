/** Replay frozen solver inputs through authoritative Race gates and a second clean simulation. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSimulation } from '../packages/physics/src/index.ts';
import {
  advanceProgress,
  createProgress,
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
  const sim = await createSimulation();
  let progress = createProgress();
  const recorder = new RaceRecorder();
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
      previous = step.ball;
      if (progress.finishTick !== null) break;
    }
    if (!progress.finishTick || progress.reasons.length)
      throw new Error(`Race route did not finish cleanly: ${slug} ${JSON.stringify(progress)}`);
    const attempt: RaceAttempt = {
      schema: 'wwm.race-attempt/1',
      id: `${slug}-solver`,
      createdAt: 0,
      compatibility: makeCompatibility(course.courseId),
      inputSource: 'keyboard',
      outcome: 'finished',
      progress,
      recording: recorder.finish(),
    };
    const track = await replayRace(course, attempt);
    const result = {
      courseId: course.courseId,
      progress,
      replayProgress: track.progress,
      verifiedTicks: track.ticks,
      inputBytes: attempt.recording.data.byteLength,
      poseBytes: track.pos.byteLength + track.quat.byteLength + track.discontinuities.byteLength,
      method:
        'Real Rapier solver input stream, Race per-step reducer, exact second-simulation Race replay. Automated traversal only; human flow not assessed.',
    };
    await writeFile(resolve(dir, 'race-validation.json'), JSON.stringify(result, null, 2));
    console.log(slug, `${progress.finishTick / 120}s`, 'sectors', progress.sectorTicks, 'replay verified');
  } finally {
    sim.dispose();
  }
}
