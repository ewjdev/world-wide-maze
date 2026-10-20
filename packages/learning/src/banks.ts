/**
 * Fresh examples (Phase 31). An activity may ask for `fresh: { objective, count }`: after its required rounds, a
 * consumer plays `count` rounds drawn from that objective's bank, preferring items this child hasn't met. The
 * expanded activity is an ordinary `Activity`, so `step()`, scripts, voice fallback and levels with
 * `steps: 'rounds'` work unchanged. Explicit level step lists don't include fresh rounds.
 */
import { generateRound } from './generators.ts';
import { type Activity, activitySchema, type LearningPath, type Round } from './schema.ts';

/** Where a round in an expanded activity came from, and what evidence about it should say. */
export interface RoundOrigin {
  objective: string;
  source: 'lesson' | 'bank' | 'generator';
  /** `roundHash` of the round as written. */
  item: string;
  /** True when this child hadn't met the item before this play-through. */
  fresh: boolean;
}

/** The objective a round gives evidence for: its own, else the activity's first, else the activity id. */
export function objectiveOf(activity: Activity, round: Round): string {
  return round.objective ?? activity.objectives?.[0] ?? activity.id;
}

const IDENTITY_FIELDS = new Set(['id', 'objective', 'input', 'optional', 'onlyAfterHelpOn']);
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  return value;
}

/** What the child sees and hears, as canonical JSON: ids and play settings don't make a different item. */
export function roundKey(round: Round): string {
  const content = Object.fromEntries(Object.entries(round).filter(([key]) => !IDENTITY_FIELDS.has(key)));
  return JSON.stringify(canonical(content));
}

/** First 32 hex characters of SHA-256 over `roundKey`: the item identity evidence refers to. */
export async function roundHash(round: Round): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(roundKey(round)));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/** A well-mixed seed for the nth draw. */
const mix = (seed: number, n: number) => (Math.imul(seed ^ (n * 0x9e3779b9), 0x85ebca6b) ^ n) >>> 0;
const MAX_TRIES = 64;

/**
 * Draw `count` fresh examples for an objective, deterministic in `seed`. Items in `seen` (item hashes) and rounds
 * the activity already has are skipped while alternatives exist; once a bank runs out, seen items come back with
 * `fresh: false`.
 */
export async function drawFresh(
  path: LearningPath,
  activity: Activity,
  options: { objective: string; count: number; seed: number; seen?: ReadonlySet<string> },
): Promise<{ round: Round; origin: RoundOrigin }[]> {
  const bank = path.banks?.find((candidate) => candidate.objective === options.objective);
  if (!bank) throw new Error(`No bank for objective "${options.objective}".`);
  const authored = new Set(activity.rounds.map(roundKey));
  const source = 'items' in bank ? 'bank' : 'generator';
  const candidates = 'items' in bank ? order(bank.items, options.seed) : [];
  const unseen: { round: Round; item: string }[] = [];
  const repeats: { round: Round; item: string }[] = [];
  const taken = new Set<string>();
  for (let n = 0; unseen.length < options.count && n < (candidates.length || MAX_TRIES); n++) {
    const round =
      'items' in bank ? candidates[n] : generateRound(bank.generator, mix(options.seed, n), 'fresh');
    if (!round) break;
    const key = roundKey(round);
    if (authored.has(key) || taken.has(key)) continue;
    taken.add(key);
    const item = await roundHash(round);
    (options.seen?.has(item) ? repeats : unseen).push({ round, item });
  }
  return [...unseen, ...repeats].slice(0, options.count).map(({ round, item }, index) => ({
    round: { ...plain(round), id: `fresh-${index + 1}`, objective: options.objective },
    origin: { objective: options.objective, source, item, fresh: !options.seen?.has(item) },
  }));
}

/** The bank's items in a seeded order. */
function order(items: readonly Round[], seed: number): Round[] {
  return items
    .map((round, index) => ({ round, rank: mix(seed, index + 1) }))
    .sort((x, y) => x.rank - y.rank)
    .map(({ round }) => round);
}

/**
 * The activity as played by one child: authored rounds, then its fresh examples before any bonus round. Returns
 * the origin of every round, so evidence can say which objective and item each one was.
 */
export async function expandActivity(
  path: LearningPath,
  activity: Activity,
  options: { seed: number; seen?: ReadonlySet<string> },
): Promise<{ activity: Activity; origins: Map<string, RoundOrigin> }> {
  const origins = new Map<string, RoundOrigin>();
  for (const round of activity.rounds) {
    const item = await roundHash(round);
    origins.set(round.id, {
      objective: objectiveOf(activity, round),
      source: 'lesson',
      item,
      fresh: !options.seen?.has(item),
    });
  }
  if (!activity.fresh) return { activity, origins };
  const fresh = await drawFresh(path, activity, { ...options, ...activity.fresh });
  for (const { round, origin } of fresh) origins.set(round.id, origin);
  const bonusAt = activity.rounds.findIndex((round) => round.optional);
  const at = bonusAt < 0 ? activity.rounds.length : bonusAt;
  const rounds = [
    ...activity.rounds.slice(0, at),
    ...fresh.map(({ round }) => round),
    ...activity.rounds.slice(at),
  ];
  // The fresh examples are now drawn, so the expanded activity no longer asks for them.
  const { fresh: _drawn, ...rest } = activity;
  return { activity: activitySchema.parse({ ...rest, rounds }), origins };
}

/** A bank item as a plain round: bonus and follow-up settings don't carry over. */
function plain(round: Round): Round {
  const { optional: _optional, onlyAfterHelpOn: _onlyAfterHelpOn, ...rest } = round;
  return rest as Round;
}
