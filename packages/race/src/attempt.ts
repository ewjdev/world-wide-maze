import { DEFAULT_PARAMS, PHYSICS_VERSION } from '@wwm/physics';
import { SIM_HZ } from '@wwm/schema';
import { validateRecording } from './recording.ts';
import type { RaceAttempt, RaceCompatibility } from './types.ts';

export const RACE_RULES_VERSION = 'wwm.race-rules/3';
export const RACE_STUNT_RULES_VERSION = 'wwm.race-rules/4';
export function makeCompatibility(courseId: string, stuntsEnabled = false): RaceCompatibility {
  return {
    courseId,
    physicsVersion: PHYSICS_VERSION,
    physicsConfig: JSON.stringify(Object.entries(DEFAULT_PARAMS).sort(([a], [b]) => a.localeCompare(b))),
    rulesVersion: stuntsEnabled ? RACE_STUNT_RULES_VERSION : RACE_RULES_VERSION,
    hz: SIM_HZ,
  };
}
export function compatibilityKey(c: RaceCompatibility): string {
  return JSON.stringify([c.courseId, c.physicsVersion, c.physicsConfig, c.rulesVersion, c.hz]);
}
export function compatible(a: RaceCompatibility, b: RaceCompatibility): boolean {
  return compatibilityKey(a) === compatibilityKey(b);
}
export function isEligible(a: RaceAttempt): boolean {
  return (
    a.outcome === 'finished' &&
    a.progress.finishTick !== null &&
    a.progress.finishTick === a.progress.tick &&
    a.progress.tick === a.recording.ticks &&
    !a.recording.truncated &&
    a.recording.recoveries.length === 0 &&
    a.progress.reasons.length === 0
  );
}
export function betterAttempt(candidate: RaceAttempt, previous: RaceAttempt | null): boolean {
  return (
    isEligible(candidate) &&
    (!previous ||
      (compatible(candidate.compatibility, previous.compatibility) &&
        (candidate.progress.finishTick as number) < (previous.progress.finishTick as number)))
  );
}
const reasons = ['fall', 'recovery', 'pause', 'focus-loss', 'controller-disconnect', 'recording-limit'];
export function validateAttempt(value: unknown): value is RaceAttempt {
  if (!value || typeof value !== 'object') return false;
  const a = value as RaceAttempt;
  const c = a.compatibility;
  const p = a.progress;
  if (
    a.schema !== 'wwm.race-attempt/1' ||
    typeof a.id !== 'string' ||
    a.id.length < 1 ||
    a.id.length > 128 ||
    !Number.isFinite(a.createdAt) ||
    !['keyboard', 'phone', 'mixed'].includes(a.inputSource) ||
    !['finished', 'abandoned'].includes(a.outcome) ||
    !c ||
    !p ||
    !validateRecording(a.recording)
  )
    return false;
  if (
    ![c.courseId, c.physicsVersion, c.physicsConfig, c.rulesVersion].every(
      (v) => typeof v === 'string' && v.length > 0 && v.length <= 16_384,
    ) ||
    c.hz !== SIM_HZ
  )
    return false;
  const turboRules = [RACE_STUNT_RULES_VERSION, 'wwm.race-rules/2'].includes(c.rulesVersion);
  if (turboRules !== (a.recording.format === 'wwm.race-input/2')) return false;
  if (
    !Number.isSafeInteger(p.tick) ||
    p.tick < a.recording.ticks ||
    !Number.isInteger(p.nextGate) ||
    p.nextGate < 0 ||
    !Array.isArray(p.sectorTicks) ||
    p.sectorTicks.length > 1000 ||
    !Array.isArray(p.reasons) ||
    p.reasons.length > reasons.length ||
    !p.reasons.every((r) => reasons.includes(r)) ||
    new Set(p.reasons).size !== p.reasons.length
  )
    return false;
  let last = 0;
  for (const tick of p.sectorTicks) {
    if (!Number.isSafeInteger(tick) || tick < last || tick <= 0 || tick > p.tick) return false;
    last = tick;
  }
  if (
    p.finishTick !== null &&
    (!Number.isSafeInteger(p.finishTick) ||
      p.finishTick !== p.tick ||
      p.finishTick <= 0 ||
      p.finishTick < last)
  )
    return false;
  if (
    (a.outcome === 'finished') !== (p.finishTick !== null) ||
    p.nextGate !== p.sectorTicks.length + Number(p.finishTick !== null)
  )
    return false;
  if (!a.recording.truncated && p.tick !== a.recording.ticks) return false;
  if (a.recording.truncated && !p.reasons.includes('recording-limit')) return false;
  if (a.recording.recoveries.length > 0 && !p.reasons.some((r) => r === 'fall' || r === 'recovery'))
    return false;
  return true;
}
