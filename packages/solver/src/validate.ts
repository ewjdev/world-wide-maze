/**
 * Playability validation (task 4, with the G0 updates): the time limit stays a fixed 300 s; the solver's par
 * time is used to reject stages (par > PAR_REJECT_SEC keeps ≥ 2× headroom) and to derive difficulty stars.
 * `buildPlayableStage` rerolls seeds until a stage passes `validateStage` **and** the solver.
 */
import {
  type BuildInput,
  type BuildResult,
  type StageData,
  TIME_LIMIT_SEC_DEFAULT,
  validateStage,
} from '@wwm/schema';
import type { SolveFailure } from './diagnose.ts';
import { type SolveOptions, type SolveResult, solveStage } from './solve.ts';

/** Reject stages whose par exceeds half the fixed 300 s limit (G0: at least 2× headroom). */
export const PAR_REJECT_SEC = TIME_LIMIT_SEC_DEFAULT / 2;

/**
 * Difficulty stars 1–5 (N: chosen; 2013 showed stars but its formula is unknown). Par-time bands of 30 s,
 * plus one star if even the bot fell, plus one if the route needs a jump.
 */
export function difficultyStars(r: Pick<SolveResult, 'success' | 'timeSec' | 'falls' | 'jumps'>): number {
  if (!r.success) return 0;
  let s = 1;
  for (const band of [30, 60, 90, 120]) if (r.timeSec > band) s++;
  if (r.falls > 0) s++;
  if (r.jumps > 0) s++;
  return Math.min(5, s);
}

export interface PlayableReport {
  success: boolean;
  parTimeSec: number;
  falls: number;
  jumps: number;
  stars: number;
  /** Why the stage was rejected (if it was). */
  reason?: string;
  failure?: SolveFailure;
  attempts: SolveResult['attempts'];
  cpuMs: number;
  routeM: number;
}

export interface ValidatePlayableResult {
  ok: boolean;
  parTimeSec: number;
  report: PlayableReport;
  /** Full solver output (inputs = ghost run when ok). */
  solve: SolveResult;
}

export interface ValidatePlayableOptions extends SolveOptions {
  parRejectSec?: number;
}

export async function validatePlayable(
  stage: StageData,
  opts: ValidatePlayableOptions = {},
): Promise<ValidatePlayableResult> {
  const solve = await solveStage(stage, opts);
  const limit = opts.parRejectSec ?? PAR_REJECT_SEC;
  let reason: string | undefined;
  if (!solve.success) {
    const f = solve.failure;
    reason = f
      ? `solver failed: ${f.kind} on island ${f.islandId}${f.bridgeId !== undefined ? ` bridge ${f.bridgeId}` : ''}${
          f.elevatorId !== undefined ? ` elevator ${f.elevatorId}` : ''
        }${f.detail ? ` (${f.detail})` : ''}`
      : 'solver failed';
  } else if (solve.timeSec > limit) {
    reason = `par ${solve.timeSec.toFixed(1)} s > ${limit} s`;
  }
  const ok = reason === undefined;
  return {
    ok,
    parTimeSec: solve.timeSec,
    solve,
    report: {
      success: solve.success,
      parTimeSec: solve.timeSec,
      falls: solve.falls,
      jumps: solve.jumps,
      stars: difficultyStars(solve),
      ...(reason ? { reason } : {}),
      ...(solve.failure ? { failure: solve.failure } : {}),
      attempts: solve.attempts,
      cpuMs: solve.cpuMs,
      routeM: solve.routeM,
    },
  };
}

export class PlayabilityError extends Error {
  readonly code = 'UNPLAYABLE';
  readonly tried: { seed: number; reason: string }[];
  constructor(tried: { seed: number; reason: string }[]) {
    super(
      `no playable stage in ${tried.length} seeds: ${tried.map((t) => `${t.seed}: ${t.reason}`).join('; ')}`,
    );
    this.tried = tried;
  }
}

export interface BuildPlayableOptions extends ValidatePlayableOptions {
  /** The builder (contracts §4 `buildStage`). Required so the solver doesn't pin a builder version. */
  build: (input: BuildInput) => BuildResult;
  /** Seeds tried: input.seed … input.seed + maxSeeds − 1 (default 4). */
  maxSeeds?: number;
}

export interface PlayableStage {
  stage: StageData;
  debug: BuildResult['debug'];
  /** The input seed that produced it. */
  seed: number;
  validation: ValidatePlayableResult;
  tried: { seed: number; reason: string }[];
}

/**
 * Try seeds `input.seed … +maxSeeds−1` until one builds, passes `validateStage` and is solved within the par
 * limit. Throws `PlayabilityError` (code 'UNPLAYABLE') otherwise.
 */
export async function buildPlayableStage(
  input: BuildInput,
  opts: BuildPlayableOptions,
): Promise<PlayableStage> {
  const tried: { seed: number; reason: string }[] = [];
  const n = opts.maxSeeds ?? 4;
  for (let k = 0; k < n; k++) {
    const seed = (input.seed + k) >>> 0;
    let built: BuildResult;
    try {
      built = opts.build({ ...input, seed });
    } catch (e) {
      tried.push({ seed, reason: `build failed: ${(e as Error).message}` });
      continue;
    }
    const v = validateStage(built.stage);
    if (!v.ok) {
      tried.push({ seed, reason: `invalid: ${v.errors[0]?.message ?? 'validateStage failed'}` });
      continue;
    }
    const p = await validatePlayable(built.stage, opts);
    if (p.ok) return { stage: built.stage, debug: built.debug, seed, validation: p, tried };
    tried.push({ seed, reason: p.report.reason ?? 'unplayable' });
  }
  throw new PlayabilityError(tried);
}
