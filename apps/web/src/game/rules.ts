/**
 * The 2013 game rules, pure and unit-tested (docs/reference/fidelity-spec.md §4–§5, bundle-notes §5).
 * E = evidenced from the recovered build, R = reconstructed, N = new.
 */
import {
  LARGE_SCORE,
  NUM_BALLS,
  ONEUP_SCORE,
  SMALL_SCORE,
  type StageData,
  TIME_LIMIT_SEC_DEFAULT,
  TIME_SCORE,
  type Vec2,
} from '@wwm/schema';

/** E: small items are credited 300 ms after pickup (`setTimeout(addScore, 300)`). */
export const SMALL_CREDIT_DELAY_SEC = 0.3;
/** E: `last30` fires when the whole-second timer reaches 30. */
export const CAUTION_AT_SEC = 30;
/** E: after `lost`, the restart (or game over) happens 3 s later. */
export const RESTART_DELAY_SEC = 3;
/** E: TIME IS UP / GAME OVER sign duration. */
export const SIGN_SEC = 3;
/** E: the GOAL sign shows for 1.6 s after the fly-away. */
export const GOAL_SIGN_SEC = 1.6;
/** E: the spare-ball reserve cap. */
export const MAX_SPARES = NUM_BALLS;

export interface ScoreState {
  /** Run (session) total. */
  total: number;
  /** Spare balls (E: `numBallLeft`, starts at NUM_BALLS; game over when < 0). */
  spares: number;
}

export interface AddScoreResult extends ScoreState {
  oneUps: number;
}

/**
 * E (`addScore` @1043673): add points to the run total; each multiple of ONEUP_SCORE crossed gives +1 spare
 * while spares < 3. 2013 granted at most one per call; we grant one per multiple crossed, capped (R: identical
 * for every realistic call, since one call never adds ≥ 6000 points).
 */
export function addScore(s: ScoreState, points: number): AddScoreResult {
  const before = Math.floor(s.total / ONEUP_SCORE);
  const total = s.total + points;
  const after = Math.floor(total / ONEUP_SCORE);
  let spares = s.spares;
  let oneUps = 0;
  for (let k = before; k < after; k++) {
    if (spares < MAX_SPARES) {
      spares++;
      oneUps++;
    }
  }
  return { total, spares, oneUps };
}

export function timeBonus(timeInt: number): number {
  return Math.max(0, timeInt) * TIME_SCORE;
}

export function itemPoints(small: number, large: number): number {
  return small * SMALL_SCORE + large * LARGE_SCORE;
}

/** E (FLY_AWAY): stageScore = time bonus + 100 × large + 1 × small. Game over: items only. */
export function stageScore(timeInt: number, small: number, large: number, cleared: boolean): number {
  return (cleared ? timeBonus(timeInt) : 0) + itemPoints(small, large);
}

/** E: fireworks = round(timeRemains) mod 10. */
export function fireworksCount(timeRemains: number): number {
  return Math.round(Math.max(0, timeRemains)) % 10;
}

export type TimerEvent = 'last30' | 'timesup';

/**
 * E (`game/world` Timer @1027009): `timeRemains -= dt`, and the whole-second value only ever steps down to
 * `Math.round(timeRemains)`. It dispatches `last30` at 30 and `timesup` at 0. It is reset to the full limit
 * on OPENING and RESTARTING, and only runs while GAME is active.
 */
export class GameTimer {
  limit: number;
  remains: number;
  remainsInt: number;
  running = false;

  constructor(limit = TIME_LIMIT_SEC_DEFAULT) {
    this.limit = limit;
    this.remains = limit;
    this.remainsInt = limit;
  }

  reset(limit = this.limit): void {
    this.limit = limit;
    this.remains = limit;
    this.remainsInt = limit;
    this.running = false;
  }

  start(): void {
    if (this.remainsInt > 0) this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  /** Advance by `dt` seconds; returns the events crossed (in order). */
  tick(dt: number): TimerEvent[] {
    if (!this.running || dt <= 0) return [];
    const out: TimerEvent[] = [];
    this.remains = Math.max(0, this.remains - dt);
    const n = Math.round(this.remains);
    while (n < this.remainsInt) {
      this.remainsInt--;
      if (this.remainsInt === CAUTION_AT_SEC) out.push('last30');
      if (this.remainsInt === 0) {
        this.running = false;
        out.push('timesup');
        break;
      }
    }
    return out;
  }
}

/**
 * E (RESTARTING @1037706): the restart point of the last-touched island nearest to where the ball last
 * touched it; the stage start if no island was touched.
 */
export function restartPointFor(stage: StageData, islandId: number | null, lastPos: Vec2 | null): Vec2 {
  const island = islandId === null ? undefined : stage.islands.find((i) => i.id === islandId);
  if (!island || island.restartPoints.length === 0) return stage.start.pos;
  if (!lastPos) return island.restartPoints[0] as Vec2;
  let best = island.restartPoints[0] as Vec2;
  let bestD = Number.POSITIVE_INFINITY;
  for (const p of island.restartPoints) {
    const d = (p[0] - lastPos[0]) ** 2 + (p[1] - lastPos[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Items collected on the current stage (E: `numSmallItems` / `numLargeItems`, reset on OPENING). */
export interface StageItems {
  small: number;
  large: number;
  largeTotal: number;
  smallTotal: number;
}

export function countItems(stage: StageData): Pick<StageItems, 'largeTotal' | 'smallTotal'> {
  let largeTotal = 0;
  let smallTotal = 0;
  for (const it of stage.items) {
    if (it.kind === 'large') largeTotal++;
    else smallTotal++;
  }
  return { largeTotal, smallTotal };
}

/** A finished stage, as shown on the stage result screen. */
export interface StageResult {
  stageId: string;
  title: string;
  url: string;
  sliceIndex: number;
  sliceCount: number;
  cleared: boolean;
  timeInt: number;
  timeBonus: number;
  small: number;
  large: number;
  stageScore: number;
  /** Run total before the time bonus was added (the count-up starts here). */
  totalBefore: number;
  total: number;
  /** Spares gained by the time bonus (E: checked during the result count-up). */
  oneUps: number;
  /** Play time in ms (for the per-stage board, N). */
  timeMs: number;
}

/**
 * E (FLY_AWAY): items are already in the total, so only the time bonus is added at the goal, and the one-up
 * check for it runs during the result count-up.
 */
export function finishStage(
  s: ScoreState,
  args: { timeInt: number; small: number; large: number; cleared: boolean },
): { score: AddScoreResult; bonus: number; stageScore: number } {
  const bonus = args.cleared ? timeBonus(args.timeInt) : 0;
  const score = args.cleared ? addScore(s, bonus) : { ...s, oneUps: 0 };
  return { score, bonus, stageScore: stageScore(args.timeInt, args.small, args.large, args.cleared) };
}

/** E (ranking): nicknames are sanitised to `[a-z0-9_]`; other characters become `-`. N: 1–16 chars. */
export function sanitizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '-')
    .slice(0, 16);
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st … */
export function ordinal(n: number): string {
  const s = n % 100;
  if (s >= 11 && s <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
