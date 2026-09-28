import type { PracticeReason, RaceGate, RaceProgress, RaceStep } from './types.ts';

export function createProgress(): RaceProgress {
  return { tick: 0, nextGate: 0, sectorTicks: [], finishTick: null, reasons: [] };
}
export function markPractice(progress: RaceProgress, reason: PracticeReason): RaceProgress {
  return progress.reasons.includes(reason)
    ? progress
    : { ...progress, reasons: [...progress.reasons, reason] };
}
/** Physical segments only: callers rebase previous after any teleport. Goal sensors are deliberately ignored. */
export function advanceProgress(
  progress: RaceProgress,
  gates: readonly RaceGate[],
  step: RaceStep,
): RaceProgress {
  if (progress.finishTick !== null) return progress;
  if (step.tick !== progress.tick + 1) throw new Error('Race steps must be contiguous');
  let result = { ...progress, tick: step.tick, sectorTicks: [...progress.sectorTicks] };
  if (step.fell) result = markPractice(result, 'fall');
  const crossings: { index: number; fraction: number }[] = [];
  gates.forEach((gate, index) => {
    const [nx, nz] = gate.normal;
    const a = (step.previous[0] - gate.center[0]) * nx + (step.previous[2] - gate.center[2]) * nz;
    const b = (step.current[0] - gate.center[0]) * nx + (step.current[2] - gate.center[2]) * nz;
    if (a >= 0 || b < 0) return;
    const fraction = -a / (b - a);
    const x = step.previous[0] + fraction * (step.current[0] - step.previous[0]) - gate.center[0];
    const z = step.previous[2] + fraction * (step.current[2] - step.previous[2]) - gate.center[2];
    const y = step.previous[1] + fraction * (step.current[1] - step.previous[1]) - gate.center[1];
    if (Math.abs(x * -nz + z * nx) <= gate.halfWidth && Math.abs(y) <= gate.halfHeight) {
      crossings.push({ index, fraction });
    }
  });
  crossings.sort((a, b) => a.fraction - b.fraction);
  for (const crossing of crossings) {
    if (crossing.index !== result.nextGate) continue;
    result.nextGate++;
    if (gates[crossing.index].kind === 'finish') result.finishTick = step.tick;
    else result.sectorTicks.push(step.tick);
  }
  return result;
}
export function validateGates(gates: readonly RaceGate[]): string[] {
  const errors: string[] = [];
  if (!gates.length || gates.at(-1)?.kind !== 'finish' || gates.slice(0, -1).some((g) => g.kind !== 'sector'))
    errors.push('Exactly one finish must be last');
  const ids = new Set<string>();
  gates.forEach((gate, index) => {
    if (ids.has(gate.id)) errors.push(`Duplicate gate ${gate.id}`);
    ids.add(gate.id);
    if (
      ![...gate.center, ...gate.normal, gate.halfWidth, gate.halfHeight].every(Number.isFinite) ||
      gate.halfWidth <= 0 ||
      gate.halfHeight <= 0 ||
      Math.abs(Math.hypot(...gate.normal) - 1) > 1e-6
    )
      errors.push(`Invalid gate ${gate.id}`);
    for (const previous of gates.slice(0, index)) {
      const parallel =
        Math.abs(previous.normal[0] * gate.normal[1] - previous.normal[1] * gate.normal[0]) < 1e-7;
      const distance =
        (previous.center[0] - gate.center[0]) * gate.normal[0] +
        (previous.center[2] - gate.center[2]) * gate.normal[1];
      const lateral = Math.abs(
        (previous.center[0] - gate.center[0]) * -gate.normal[1] +
          (previous.center[2] - gate.center[2]) * gate.normal[0],
      );
      const vertical = Math.abs(previous.center[1] - gate.center[1]);
      if (
        parallel &&
        Math.abs(distance) < 1e-7 &&
        lateral <= previous.halfWidth + gate.halfWidth &&
        vertical <= previous.halfHeight + gate.halfHeight
      )
        errors.push(`Coincident gates ${previous.id}/${gate.id}`);
    }
  });
  return errors;
}
