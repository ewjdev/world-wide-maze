import { compatible, makeCompatibility, validateAttempt } from './attempt.ts';
import { advanceProgress, createProgress, markPractice, validateGates } from './progress.ts';
import { inputAt } from './recording.ts';
import { createRaceSimulation } from './simulation.ts';
import type { RaceAttempt, RaceCourse, RaceGhostTrack } from './types.ts';

export const MAX_POSE_BYTES = 8 * 1024 * 1024;
/** One job, at most half the shared two-track allocation budget. Replay ignores ordinary goal events. */
export async function replayRace(
  course: RaceCourse,
  attempt: RaceAttempt,
  options: { signal?: AbortSignal } = {},
): Promise<RaceGhostTrack> {
  if (
    !validateAttempt(attempt) ||
    !compatible(attempt.compatibility, makeCompatibility(course.courseId, !!course.stunts))
  )
    throw new Error('Incompatible or malformed Race attempt');
  const gateErrors = validateGates(course.gates);
  if (gateErrors.length) throw new Error(gateErrors.join('; '));
  const count = attempt.recording.ticks + 1;
  if (count * 29 > MAX_POSE_BYTES / 2) throw new Error('Ghost exceeds pose budget');
  const pos = new Float32Array(count * 3);
  const quat = new Float32Array(count * 4);
  const discontinuities = new Uint8Array(count);
  const sim = await createRaceSimulation(course);
  try {
    await sim.load(course.stage);
    let previous = sim.getBallState();
    pos.set(previous.pos);
    quat.set(previous.quat);
    let progress = createProgress();
    let recoveryIndex = 0;
    for (let tick = 1; tick < count; tick++) {
      if (options.signal?.aborted) throw new DOMException('Ghost preparation cancelled', 'AbortError');
      const recovery = attempt.recording.recoveries[recoveryIndex];
      if (recovery?.beforeTick === tick) {
        sim.reset(recovery.destination);
        previous = sim.getBallState();
        progress = markPractice(progress, recovery.reason);
        discontinuities[tick] = 1;
        recoveryIndex++;
      }
      const result = sim.step(inputAt(attempt.recording, tick - 1));
      progress = advanceProgress(progress, course.gates, {
        tick,
        previous: previous.pos,
        current: result.ball.pos,
        fell: result.events.some((e) => e.type === 'fell'),
      });
      pos.set(result.ball.pos, tick * 3);
      quat.set(result.ball.quat, tick * 4);
      previous = result.ball;
      if (progress.finishTick !== null && tick !== attempt.recording.ticks)
        throw new Error('Recording continues after Race finish');
    }
    // Prefixes cannot prove a later finish. Non-geometric practice reasons are session metadata.
    const expectedSectors = attempt.progress.sectorTicks.filter((t) => t <= attempt.recording.ticks);
    if (
      JSON.stringify(progress.sectorTicks) !== JSON.stringify(expectedSectors) ||
      (!attempt.recording.truncated && progress.finishTick !== attempt.progress.finishTick)
    )
      throw new Error('Race replay does not reproduce its sector/finish ticks');
    return {
      attemptId: attempt.id,
      hz: attempt.compatibility.hz,
      pos,
      quat,
      discontinuities,
      ticks: attempt.recording.ticks,
      progress,
    };
  } finally {
    sim.dispose();
  }
}
/** Null after the recorded end. Recoveries snap at the recovered tick, never cross the teleport. */
export function sampleRaceTrack(
  track: RaceGhostTrack,
  tick: number,
): { pos: [number, number, number]; quat: [number, number, number, number] } | null {
  if (tick > track.ticks || tick < 0) return null;
  const i = Math.floor(tick);
  const j = Math.min(i + 1, track.ticks);
  const fraction = track.discontinuities[j] ? 0 : tick - i;
  const pos = [0, 0, 0] as [number, number, number];
  const quat = [0, 0, 0, 1] as [number, number, number, number];
  for (let k = 0; k < 3; k++)
    pos[k] = track.pos[i * 3 + k] + (track.pos[j * 3 + k] - track.pos[i * 3 + k]) * fraction;
  for (let k = 0; k < 4; k++) quat[k] = track.quat[i * 4 + k];
  return { pos, quat };
}
