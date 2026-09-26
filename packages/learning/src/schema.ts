/**
 * `wwm-learning/0.2`: the learning document every consumer reads (the lesson pages, the WWM game, a portable
 * download). An activity is a short sequence of rounds; the theme carries the guide and the scenery as
 * declarative vector data; the voice block maps script lines to pre-generated clips. See
 * docs/education/html-contract.md.
 */
import { z } from 'zod';
import { LEGACY_VERSION, legacyPathSchema } from './legacy.ts';

export const LEARNING_VERSION = 'wwm-learning/0.2' as const;
export const LEARNING_SCRIPT_ID = 'wwm-learning';
export const MAX_DOCUMENT_BYTES = 200_000;
export const MAX_THEME_BYTES = 12_000;

const text = z.string().trim().min(1).max(1000);
/** Anything Pip says: short enough to voice. */
const line = z.string().trim().min(1).max(300);
const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);

// ── theme ─────────────────────────────────────────────────────────────────────────────────────────────────

export const PALETTE_KEYS = [
  'sky',
  'cloud',
  'ink',
  'paper',
  'islandTop',
  'islandSide',
  'islandEdge',
  'bridge',
  'gem',
  'gemEdge',
  'gemShine',
  'ballShell',
  'ballShine',
  'ballSeam',
  'gate',
  'glow',
  'shapeBlue',
  'shapeGreen',
  'shapeYellow',
  'shapeRed',
] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];
export const SPRITE_NAMES = ['pip', 'gem', 'island', 'plank', 'gate', 'cloud'] as const;
export type SpriteName = (typeof SPRITE_NAMES)[number];

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const coord = z.number().min(-100).max(200);
const paint = {
  fill: z.enum(PALETTE_KEYS).optional(),
  stroke: z.enum(PALETTE_KEYS).optional(),
  width: z.number().min(0).max(20).optional(),
  opacity: z.number().min(0).max(1).optional(),
};
/** Only absolute/relative move, line, curve and close commands with numbers: no arcs, no text, no URLs. */
const pathData = z
  .string()
  .max(600)
  .regex(/^[MLHVCQSTZmlhvcqstz0-9 ,.-]+$/);

export const partSchema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('circle'), cx: coord, cy: coord, r: z.number().min(0).max(100), ...paint })
    .strict(),
  z
    .object({
      type: z.literal('ellipse'),
      cx: coord,
      cy: coord,
      rx: z.number().min(0).max(100),
      ry: z.number().min(0).max(100),
      ...paint,
    })
    .strict(),
  z
    .object({
      type: z.literal('rect'),
      x: coord,
      y: coord,
      w: z.number().min(0).max(200),
      h: z.number().min(0).max(200),
      rx: z.number().min(0).max(50).optional(),
      ...paint,
    })
    .strict(),
  z
    .object({
      type: z.literal('polygon'),
      points: z
        .array(z.tuple([coord, coord]))
        .min(3)
        .max(24),
      ...paint,
    })
    .strict(),
  z.object({ type: z.literal('path'), d: pathData, ...paint }).strict(),
]);
export type SpritePart = z.infer<typeof partSchema>;
const spriteSchema = z.object({ parts: z.array(partSchema).min(1).max(24) }).strict();

export const themeSchema = z
  .object({
    id,
    name: line.max(60),
    guide: z
      .object({
        name: line.max(30),
        sprite: z.literal('pip'),
        /** Lines the guide says around every activity (voiced like the rest of the script). */
        lines: z.object({ hello: line, bonus: line, gate: line, rollOn: line }).strict(),
      })
      .strict(),
    palette: z
      .object(Object.fromEntries(PALETTE_KEYS.map((key) => [key, hex])) as Record<PaletteKey, typeof hex>)
      .strict(),
    sprites: z
      .object(
        Object.fromEntries(SPRITE_NAMES.map((key) => [key, spriteSchema])) as Record<
          SpriteName,
          typeof spriteSchema
        >,
      )
      .strict(),
  })
  .strict()
  .superRefine((theme, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(theme)).length > MAX_THEME_BYTES)
      ctx.addIssue({ code: 'custom', message: `A theme must be at most ${MAX_THEME_BYTES} bytes.` });
  });
export type Theme = z.infer<typeof themeSchema>;

// ── rounds ────────────────────────────────────────────────────────────────────────────────────────────────

export const tokenSchema = z
  .object({
    shape: z.enum(['circle', 'square', 'triangle', 'gem']),
    color: z.enum(['blue', 'green', 'yellow', 'red', 'teal']),
  })
  .strict();
export type Token = z.infer<typeof tokenSchema>;

export const ARRANGEMENTS = ['dice', 'row', 'spread', 'tight', 'scatter'] as const;
export const GEM_SIZES = ['small', 'medium', 'large'] as const;
/** A group of identical gems on an island. Positions come from `layoutGroup`, so every consumer agrees. */
export const groupSchema = z
  .object({
    count: z.number().int().min(1).max(10),
    arrangement: z.enum(ARRANGEMENTS),
    size: z.enum(GEM_SIZES),
    seed: z.number().int().min(0).max(4_294_967_295).optional(),
  })
  .strict();
export type GemGroup = z.infer<typeof groupSchema>;

const roundBase = {
  id,
  prompt: line,
  /** A ladder: a nudge, then a strategy, then a worked example. */
  hints: z.array(line).min(1).max(3),
  success: line,
  /** Bonus rounds are offered, never required. */
  optional: z.boolean().optional(),
  /** Played only when the child needed the strategy (hint level ≥ 2) on the named earlier round. */
  onlyAfterHelpOn: id.optional(),
};

const chooseRound = z
  .object({
    ...roundBase,
    kind: z.literal('choose'),
    stimulus: z.array(tokenSchema).max(12),
    options: z
      .array(z.object({ id, label: line.max(60), tokens: z.array(tokenSchema).min(1).max(10) }).strict())
      .min(2)
      .max(4),
    answer: id,
  })
  .strict();
const compareRound = z
  .object({
    ...roundBase,
    kind: z.literal('compare'),
    islands: z.tuple([groupSchema, groupSchema]),
    allowSame: z.boolean(),
    answer: z.enum(['a', 'b', 'same']),
  })
  .strict();
const differenceRound = z
  .object({
    ...roundBase,
    kind: z.literal('difference'),
    islands: z.tuple([groupSchema, groupSchema]),
    choices: z.array(z.number().int().min(0).max(10)).min(2).max(4),
    answer: z.number().int().min(0).max(10),
  })
  .strict();

export const roundSchema = z
  .discriminatedUnion('kind', [chooseRound, compareRound, differenceRound])
  .superRefine((round, ctx) => {
    if (round.kind === 'choose') {
      if (new Set(round.options.map((option) => option.id)).size !== round.options.length)
        ctx.addIssue({ code: 'custom', message: 'Option IDs must be unique.' });
      if (!round.options.some((option) => option.id === round.answer))
        ctx.addIssue({ code: 'custom', message: 'The answer must reference an option.' });
    } else if (round.kind === 'compare') {
      const [a, b] = round.islands;
      const truth = a.count > b.count ? 'a' : a.count < b.count ? 'b' : 'same';
      if (round.answer !== truth)
        ctx.addIssue({ code: 'custom', message: `The answer must be "${truth}" for these gem counts.` });
      if (truth === 'same' && !round.allowSame)
        ctx.addIssue({ code: 'custom', message: 'Equal islands need the "same" choice.' });
    } else {
      const [a, b] = round.islands;
      if (round.answer !== Math.abs(a.count - b.count))
        ctx.addIssue({ code: 'custom', message: 'The answer must be the difference between the islands.' });
      if (!round.choices.includes(round.answer))
        ctx.addIssue({ code: 'custom', message: 'The answer must be one of the choices.' });
      if (new Set(round.choices).size !== round.choices.length)
        ctx.addIssue({ code: 'custom', message: 'Choices must be unique.' });
    }
  });
export type Round = z.infer<typeof roundSchema>;
export type RoundKind = Round['kind'];
export const ROUND_KINDS = ['choose', 'compare', 'difference'] as const satisfies readonly RoundKind[];

// ── activities and the path ───────────────────────────────────────────────────────────────────────────────

export const activitySchema = z
  .object({
    id,
    title: text,
    domain: z.enum(['counting', 'comparison', 'geometry', 'patterns', 'sorting']),
    objective: text,
    introduction: text,
    rounds: z.array(roundSchema).min(1).max(8),
    /** Strategy tools a consumer should offer. `match` pairs gems across islands. */
    tools: z.array(z.literal('match')).max(1),
    /** Pip's last line once every round is done. */
    finale: line,
    parentNote: text,
    offlineActivity: text,
    prerequisites: z.array(id).max(6),
  })
  .strict()
  .superRefine((activity, ctx) => {
    const seen = new Set<string>();
    for (const round of activity.rounds) {
      if (seen.has(round.id)) ctx.addIssue({ code: 'custom', message: 'Round IDs must be unique.' });
      if (round.onlyAfterHelpOn && !seen.has(round.onlyAfterHelpOn))
        ctx.addIssue({ code: 'custom', message: 'onlyAfterHelpOn must reference an earlier round.' });
      seen.add(round.id);
    }
    const first = activity.rounds[0];
    if (!first || first.optional || first.onlyAfterHelpOn)
      ctx.addIssue({ code: 'custom', message: 'The first round must always be played.' });
    const firstOptional = activity.rounds.findIndex((round) => round.optional);
    if (firstOptional >= 0 && activity.rounds.slice(firstOptional).some((round) => !round.optional))
      ctx.addIssue({ code: 'custom', message: 'Optional (bonus) rounds come last.' });
    if (activity.tools.includes('match') && !activity.rounds.some((round) => round.kind !== 'choose'))
      ctx.addIssue({ code: 'custom', message: 'The match tool needs a round with islands.' });
  });
export type Activity = z.infer<typeof activitySchema>;

export const clipSchema = z
  .object({
    /** Script line id, e.g. `compare-groups.r3.prompt`. */
    line: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,79}$/),
    /** The exact text voiced; a clip is used only when it still matches the line. */
    text: line,
    /** First 32 hex characters of sha256(text, voice, model, settings); the audio file name. */
    hash: z.string().regex(/^[a-f0-9]{32}$/),
    ms: z.number().int().min(1).max(60_000),
    /** Start time (ms) of each whitespace-separated word of `text`. */
    words: z.array(z.number().int().min(0).max(60_000)).max(80),
  })
  .strict();
export type VoiceClip = z.infer<typeof clipSchema>;

export const voiceSchema = z
  .object({
    provider: z.literal('elevenlabs'),
    voiceId: z.string().regex(/^[A-Za-z0-9]{8,40}$/),
    model: z.string().regex(/^[a-z0-9_]{3,40}$/),
    /** Short hash of the voice settings, part of every clip hash. */
    settings: z.string().regex(/^[a-f0-9]{8,64}$/),
    clips: z.array(clipSchema).max(600),
  })
  .strict();
export type Voice = z.infer<typeof voiceSchema>;

export const pathSchema = z
  .object({
    format: z.literal(LEARNING_VERSION),
    id,
    version: z.literal('2.0.0'),
    title: text,
    description: text,
    language: z.literal('en'),
    suggestedAges: z.tuple([z.literal(4), z.literal(6)]),
    reviewStatus: z.literal('pilot-needs-educator-review'),
    provenance: z.enum(['original-baseline', 'parent-personalized-introductions']),
    theme: themeSchema,
    voice: voiceSchema.optional(),
    activities: z.array(activitySchema).min(1).max(20),
  })
  .strict()
  .superRefine((path, ctx) => {
    const seen = new Set<string>();
    for (const activity of path.activities) {
      if (seen.has(activity.id)) ctx.addIssue({ code: 'custom', message: 'Activity IDs must be unique.' });
      for (const prerequisite of activity.prerequisites) {
        if (!seen.has(prerequisite))
          ctx.addIssue({ code: 'custom', message: 'Prerequisites must reference earlier activities.' });
      }
      seen.add(activity.id);
    }
  });

export type LearningPath = z.infer<typeof pathSchema>;

// ── reading and writing ───────────────────────────────────────────────────────────────────────────────────

let upgrade: ((legacy: z.infer<typeof legacyPathSchema>) => unknown) | undefined;
/** migrate.ts registers the 0.1 → 0.2 upgrade here (avoids an import cycle). */
export function registerLegacyUpgrade(fn: (legacy: z.infer<typeof legacyPathSchema>) => unknown): void {
  upgrade = fn;
}

/** Validate a 0.2 document, or upgrade a valid 0.1 document. Anything else fails closed. */
export function parseLearningPath(value: unknown): LearningPath {
  if (value && typeof value === 'object' && 'format' in value && value.format === LEGACY_VERSION) {
    if (!upgrade) throw new Error('Legacy learning documents are not supported here.');
    return pathSchema.parse(upgrade(legacyPathSchema.parse(value)));
  }
  return pathSchema.parse(value);
}

export function parseLearningJson(json: string): LearningPath {
  if (new TextEncoder().encode(json).length > MAX_DOCUMENT_BYTES)
    throw new Error('Learning document is too large.');
  return parseLearningPath(JSON.parse(json));
}

export function learningScript(path: LearningPath): string {
  const json = JSON.stringify(parseLearningPath(path))
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
  return `<script id="${LEARNING_SCRIPT_ID}" type="application/json">${json}</script>`;
}

/** Read declared data only. Never run source-page scripts or infer objectives from appearance. */
export function readLearningDocument(document: Document): LearningPath {
  const nodes = document.querySelectorAll(`script#${LEARNING_SCRIPT_ID}[type="application/json"]`);
  if (nodes.length !== 1) throw new Error('Expected exactly one learning document.');
  return parseLearningJson(nodes[0]?.textContent ?? '');
}

/**
 * Read a learning document from HTML text (a downloaded file, a same-origin fetch) without a DOM: only the
 * inert JSON script is extracted; nothing else in the markup is interpreted.
 */
export function readLearningHtml(html: string): LearningPath {
  const pattern = new RegExp(
    `<script\\s+id="${LEARNING_SCRIPT_ID}"\\s+type="application/json"\\s*>([\\s\\S]*?)</script>`,
    'gi',
  );
  const matches = [...html.matchAll(pattern)];
  if (matches.length !== 1) throw new Error('Expected exactly one learning document.');
  return parseLearningJson(matches[0]?.[1] ?? '');
}

/** Compatibility is explicit: an activity is offered only if the consumer supports every one of its rounds. */
export function compatibleActivities(path: LearningPath, kinds: readonly string[]): Activity[] {
  return path.activities.filter((activity) => activity.rounds.every((round) => kinds.includes(round.kind)));
}

/** The choice ids a round accepts: option ids, `a`/`b`/`same`, or a number as text. */
export function choiceIds(round: Round): string[] {
  if (round.kind === 'choose') return round.options.map((option) => option.id);
  if (round.kind === 'compare') return round.allowSame ? ['a', 'same', 'b'] : ['a', 'b'];
  return round.choices.map(String);
}

export function checkRound(round: Round, choice: string): 'correct' | 'try-again' {
  if (!choiceIds(round).includes(choice)) throw new Error('Unknown choice.');
  return choice === String(round.answer) ? 'correct' : 'try-again';
}

export function findRound(activity: Activity, roundId: string): Round {
  const round = activity.rounds.find((candidate) => candidate.id === roundId);
  if (!round) throw new Error(`Unknown round ${roundId}.`);
  return round;
}
