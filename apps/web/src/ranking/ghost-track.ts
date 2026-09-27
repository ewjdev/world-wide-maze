import type { InputSample, StageData } from '@wwm/schema';
import { SIM_HZ } from '@wwm/schema';

export interface GhostTrack {
  physicsVersion: string;
  hz: number;
  /** xyz per tick, world metres. */
  pos: Float32Array;
  /** xyzw per tick. */
  quat: Float32Array;
  ticks: number;
  /** Tick of the goal event, or -1. */
  goalTick: number;
}

/** Deterministic reference recorder. Classic browser gameplay calls this inside its ghost worker. */
export async function recordGhostTrack(
  stage: StageData,
  inputs: readonly InputSample[],
): Promise<GhostTrack> {
  const { replay, PHYSICS_VERSION } = await import('@wwm/physics');
  const pos = new Float32Array(inputs.length * 3);
  const quat = new Float32Array(inputs.length * 4);
  const r = await replay(stage, inputs, {
    stopAtGoal: true,
    onStep: (tick, s) => {
      const i = tick - 1;
      pos.set(s.ball.pos, i * 3);
      quat.set(s.ball.quat, i * 4);
      return undefined;
    },
  });
  return {
    physicsVersion: PHYSICS_VERSION,
    hz: SIM_HZ,
    pos: pos.subarray(0, r.ticks * 3),
    quat: quat.subarray(0, r.ticks * 4),
    ticks: r.ticks,
    goalTick: r.goalTick,
  };
}
