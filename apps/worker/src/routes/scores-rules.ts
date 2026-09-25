/**
 * Leaderboard rules (Phase 10), pure so they are unit-testable outside workerd:
 * - name validation (E: 2013 name entry accepted `[a-z0-9_]`; contracts §9: 1–32 characters) + a profanity filter
 * - plausibility: the best score a stage allows, and the fastest time a ball could physically finish it
 * - replay verification: re-simulate a submitted replay with @wwm/physics and recompute the score.
 */
import {
  type InputSample,
  LARGE_SCORE,
  PX_PER_METER,
  ReplaySchema,
  SIM_HZ,
  SMALL_SCORE,
  type StageData,
  TIME_SCORE,
} from '@wwm/schema';

// ── board settings ──────────────────────────────────────────────────────────────────────────────────

export const BOARD_SIZE = 50;
/** Score submissions per IP per window (Limiter DO `score:<ip>`). */
export const SUBMIT_LIMIT = 20;
export const SUBMIT_WINDOW_MS = 10 * 60_000;

// ── names ──────────────────────────────────────────────────────────────────────────────────────────

export const NAME_RE = /^[a-z0-9_]{1,32}$/;

/**
 * Blocked stems, matched against the name after leetspeak folding and with underscores removed. Kept short
 * and conservative on purpose: substring filters over-block ("Scunthorpe"), so a stem goes here only when it
 * is offensive wherever it appears. `ALLOWED` rescues ordinary words that contain a stem.
 */
const BLOCKED = [
  'fuck',
  'fuk',
  'fck',
  'shit',
  'cunt',
  'bitch',
  'whore',
  'slut',
  'cock',
  'dick',
  'pussy',
  'penis',
  'vagina',
  'wank',
  'twat',
  'bollock',
  'asshole',
  'arsehole',
  'dildo',
  'porn',
  'rape',
  'rapist',
  'nazi',
  'hitler',
  'nigg',
  'nigga',
  'faggot',
  'fagot',
  'retard',
  'chink',
  'kike',
  'tranny',
  'kkk',
  'heil',
  'jizz',
  'tits',
  'molest',
  'pedo',
];
const ALLOWED = [
  'scunthorpe',
  'cocktail',
  'peacock',
  'hancock',
  'hitchcock',
  'dickens',
  'dickson',
  'dickinson',
  'shitake',
  'shiitake',
  'therapist',
  'grape',
  'drape',
  'scrape',
  'trapez',
  'rapeseed',
  'torpedo',
  'speedo',
  'encyclopedi',
  'pedometer',
  'wankel',
];
const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '9': 'g',
};

/** `name` folded for matching: underscores dropped, digits read as letters, repeated letters squeezed. */
export function foldName(name: string): string {
  const s = name.replace(/_/g, '').replace(/[0-9]/g, (d) => LEET[d] ?? '');
  return s.replace(/(.)\1+/g, '$1');
}

export function isProfane(name: string): boolean {
  const raw = name.replace(/_/g, '');
  for (const variant of new Set([foldName(name), raw.replace(/[0-9]/g, (d) => LEET[d] ?? ''), raw])) {
    let s = variant;
    for (const ok of ALLOWED) s = s.split(ok).join('·');
    if (BLOCKED.some((b) => s.includes(b))) return true;
  }
  return false;
}

export type NameCheck = { ok: true } | { ok: false; reason: 'format' | 'profanity' };

export function checkName(name: string): NameCheck {
  if (!NAME_RE.test(name)) return { ok: false, reason: 'format' };
  if (isProfane(name)) return { ok: false, reason: 'profanity' };
  return { ok: true };
}

// ── plausibility ───────────────────────────────────────────────────────────────────────────────────

/**
 * Upper bound on the ball's horizontal speed (m/s). Tilt rotates gravity by at most 45° (MAX_TILT_PITCH), so the
 * horizontal pull is ≤ 46.3·sin 45° ≈ 32.7 m/s²; linear damping 1.204/s caps a sliding (not even rolling) ball
 * at ≈ 27 m/s. 30 m/s leaves headroom for falls and jumps converting height into speed on the way down.
 * Derived (R) from contracts §1 constants and fidelity-spec §2; Phase 09 par times will replace this bound.
 */
export const MAX_BALL_SPEED_MPS = 30;

export interface StageLimits {
  small: number;
  large: number;
  /** Largest item score: every item collected. */
  itemMax: number;
  /** Fastest physically possible start → goal (straight line at MAX_BALL_SPEED_MPS), ms. */
  minTimeMs: number;
  /** itemMax + the time bonus for finishing in minTimeMs. */
  maxScore: number;
  timeLimitSec: number;
}

export function stageLimits(stage: StageData, parTimeMs?: number): StageLimits {
  const small = stage.items.filter((i) => i.kind === 'small').length;
  const large = stage.items.length - small;
  const itemMax = small * SMALL_SCORE + large * LARGE_SCORE;
  const [sx, sy] = stage.start.pos;
  const [gx, gy] = stage.goal.pos;
  const distM = Math.hypot(gx - sx, gy - sy) / PX_PER_METER;
  const physicalMs = (distM / MAX_BALL_SPEED_MPS) * 1000;
  // Brief: time ≥ par × 0.5 once Phase 09 publishes par times.
  const minTimeMs = Math.max(physicalMs, parTimeMs !== undefined ? parTimeMs * 0.5 : 0);
  const bonusSec = Math.max(0, Math.floor(stage.timeLimitSec - minTimeMs / 1000));
  return {
    small,
    large,
    itemMax,
    minTimeMs,
    maxScore: itemMax + TIME_SCORE * bonusSec,
    timeLimitSec: stage.timeLimitSec,
  };
}

export type PlausibilityCheck = { ok: true } | { ok: false; reason: string };

/**
 * A stage-board entry (always a finished stage) or one stage of a run. `finished` = the entry claims a time
 * bonus (score above the item maximum) or is a stage-board entry; only finished stages have a minimum time,
 * because a run that ends in game over scores items only, however short it was.
 */
export function checkStageScore(
  limits: StageLimits,
  score: number,
  timeMs: number,
  finished: boolean,
): PlausibilityCheck {
  if (!Number.isInteger(score) || score < 0) return { ok: false, reason: 'score must be a whole number ≥ 0' };
  if (!Number.isFinite(timeMs) || timeMs < 0) return { ok: false, reason: 'time must be ≥ 0' };
  if (score > limits.maxScore)
    return { ok: false, reason: `score ${score} exceeds this stage's maximum of ${limits.maxScore}` };
  if ((finished || score > limits.itemMax) && timeMs < limits.minTimeMs)
    return {
      ok: false,
      reason: `time ${Math.round(timeMs)} ms is faster than physically possible (${Math.ceil(limits.minTimeMs)} ms)`,
    };
  return { ok: true };
}

// ── replays ────────────────────────────────────────────────────────────────────────────────────────

/** Most samples we accept: 4 attempts × 300 s at SIM_HZ (≈ 2.5 MB of JSON per 36k samples). */
export const MAX_REPLAY_SAMPLES = 4 * 300 * SIM_HZ;

/**
 * contracts §9 (v0.2.2): score submissions carry `replay?: {physicsVersion, inputs}`. `@wwm/schema` 0.2.4 still
 * types `replay` as a bare `InputSample[]` (CCR-10-1 in docs/build-log/phase-10.md), so both shapes are
 * accepted; a bare array has no physics version and is stored unverified.
 */
export interface ReplayEnvelope {
  physicsVersion: string | null;
  inputs: InputSample[];
  /** contracts v0.2.6: when the stage timer started. Clamped to ≤ the first POWER press (can't inflate). */
  timerStartTick?: number;
}

export function parseReplay(raw: unknown): ReplayEnvelope | null {
  if (raw === undefined || raw === null) return null;
  if (Array.isArray(raw)) {
    const r = ReplaySchema.max(MAX_REPLAY_SAMPLES).safeParse(raw);
    if (!r.success) throw new Error(`replay: ${r.error.issues[0]?.message ?? 'invalid'}`);
    return { physicsVersion: null, inputs: r.data };
  }
  const o = raw as { physicsVersion?: unknown; inputs?: unknown; timerStartTick?: unknown };
  if (
    typeof o !== 'object' ||
    typeof o.physicsVersion !== 'string' ||
    !/^[\w.+-]{1,32}$/.test(o.physicsVersion)
  )
    throw new Error('replay: expected {physicsVersion, inputs}');
  const r = ReplaySchema.max(MAX_REPLAY_SAMPLES).safeParse(o.inputs);
  if (!r.success) throw new Error(`replay: ${r.error.issues[0]?.message ?? 'invalid'}`);
  const t = o.timerStartTick;
  if (t !== undefined && !(Number.isInteger(t) && (t as number) >= 0))
    throw new Error('replay: timerStartTick must be a non-negative integer');
  return {
    physicsVersion: o.physicsVersion,
    inputs: r.data,
    ...(t !== undefined ? { timerStartTick: t as number } : {}),
  };
}

/** Slack between the simulated timer and the game's timer (cage drop, POWER press, frame rounding), seconds. */
export const TIMER_SLACK_SEC = 3;

export interface ReplayScore {
  goal: boolean;
  small: number;
  large: number;
  itemScore: number;
  /** Time bonus if the game's timer ran for exactly the simulated ticks since it last (re)started. */
  timeBonus: number;
  score: number;
  ticks: number;
}

type TickedEvent = { tick: number; event: { type: string; kind?: string; itemId?: number } };

/**
 * Score a replay's event stream with the 2013 rules (fidelity-spec §4–5): items + 5 × whole seconds left at the
 * goal. The timer starts at `timerStartTick` (clamped) or else the first POWER press, and resets to the full limit after each respawn (`lost`).
 */
export function scoreReplayEvents(
  events: readonly TickedEvent[],
  inputs: readonly InputSample[],
  timeLimitSec: number,
  goalTick: number,
  ticks: number,
  timerStartTick?: number,
): ReplayScore {
  const seen = new Set<number>();
  let small = 0;
  let large = 0;
  // The timer starts at GO or at the first POWER press, never later than the first POWER press — so a
  // client-supplied `timerStartTick` can only lower the bonus, not inflate it.
  const firstPower = inputs.findIndex((s) => s.power);
  const powerStart = firstPower < 0 ? 0 : firstPower;
  let timerStart = timerStartTick === undefined ? powerStart : Math.min(timerStartTick, powerStart);
  for (const { tick, event } of events) {
    if (goalTick >= 0 && tick > goalTick) break;
    if (event.type === 'item' && event.itemId !== undefined && !seen.has(event.itemId)) {
      seen.add(event.itemId);
      if (event.kind === 'large') large++;
      else small++;
    } else if (event.type === 'lost') timerStart = tick;
  }
  const itemScore = small * SMALL_SCORE + large * LARGE_SCORE;
  const goal = goalTick >= 0;
  const elapsedSec = goal ? (goalTick - timerStart) / SIM_HZ : 0;
  const timeBonus = goal ? TIME_SCORE * Math.max(0, Math.floor(timeLimitSec - elapsedSec)) : 0;
  return { goal, small, large, itemScore, timeBonus, score: itemScore + timeBonus, ticks };
}

/** The claimed score matches the replay: items exactly, the time bonus within TIMER_SLACK_SEC. */
export function replayMatches(claimed: number, r: ReplayScore): boolean {
  if (!r.goal) return claimed === r.itemScore;
  const bonus = claimed - r.itemScore;
  return (
    bonus >= 0 && Math.abs(bonus - r.timeBonus) <= TIME_SCORE * TIMER_SLACK_SEC && bonus % TIME_SCORE === 0
  );
}

// ── misc ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Dev-only fallback for the `IP_HASH_SALT` secret. Staging and production must set the secret
 * (`wrangler secret put IP_HASH_SALT --env <env>`, see infra/README.md); without it the hash of an IPv4
 * address could be reversed by trying all 2^32 addresses (security review #11).
 */
export const DEV_IP_HASH_SALT = 'wwm-dev-only-ip-hash-salt';

let warnedNoSalt = false;
/** The HMAC key for IP hashes: the `IP_HASH_SALT` secret, else the dev default (with one warning). */
export function ipHashSecret(
  env: { IP_HASH_SALT?: string },
  log?: { warn(msg: string, f?: Record<string, unknown>): void },
): string {
  const s = env.IP_HASH_SALT;
  if (s && s.length >= 16) return s;
  if (!warnedNoSalt) {
    warnedNoSalt = true;
    log?.warn('IP_HASH_SALT is not set (or shorter than 16 chars); using the dev default');
  }
  return DEV_IP_HASH_SALT;
}

/**
 * HMAC-SHA-256(secret, day | ip), 32 hex chars. Rotates daily so stored hashes can't be joined across days,
 * and needs the secret, so they can't be brute-forced back to an address.
 */
export async function hashIp(
  ip: string,
  secret: string = DEV_IP_HASH_SALT,
  now = new Date(),
): Promise<string> {
  const day = now.toISOString().slice(0, 10);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const buf = await crypto.subtle.sign('HMAC', key, enc.encode(`wwm-scores|${day}|${ip}`));
  return [...new Uint8Array(buf)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Size of `@dimforge/rapier3d-deterministic-compat@0.20.0`'s WASM binary (see scores-wasm.ts). */
export const RAPIER_WASM_BYTES = 2_048_139;
