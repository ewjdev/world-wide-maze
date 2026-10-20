/**
 * Phase 31 item-bank spike: can a model write fresh, valid example rounds for one objective?
 *
 * For each objective the model sees the authored activity as an exemplar and writes six new rounds. Every round goes
 * through `roundSchema` plus objective-specific checks the schema can't make. Failing rounds get up to two repair
 * turns. Results are written to `docs/education/item-bank-spike/<date>/`.
 *
 * Network access goes through the local `wrangler dev` helper Worker (proxy/) and AI Gateway `wwm`.
 * Usage: node src/spike.ts [--runs 3] [--model claude-sonnet-5-5]
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Activity,
  baselinePath,
  type Round,
  roundSchema,
  spellingFlags,
  spellingIssues,
} from '@wwm/learning';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const RUNS = Number(flag('runs', '3'));
const MODEL = flag('model', 'claude-sonnet-5-5');
const PER_SET = 6;
const MAX_REPAIRS = 2;
const PORT = 8798;
const base = `http://localhost:${PORT}`;

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const SPANISH_COLORS: Record<string, string> = {
  rojo: 'red',
  azul: 'blue',
  verde: 'green',
  amarillo: 'yellow',
};

interface Objective {
  activityId: string;
  kind: Round['kind'];
  brief: string;
  /** Issues the schema can't see. Empty when the round is acceptable. */
  check(round: Round): string[];
  /** Notes for a human reviewer that don't fail the round. */
  notes(round: Round): string[];
  /** A content signature for freshness and duplicate checks. */
  signature(round: Round): string;
}

const objectives: Objective[] = [
  {
    activityId: 'little-word-builders',
    kind: 'choose',
    brief: [
      'Write missing-letter rounds for common three-letter English consonant-vowel-consonant words a 4-year-old knows.',
      'Use the same shape as the exemplar: stimulusText is the word in capitals with letters separated by single',
      'spaces and exactly one letter replaced by "_"; practice is the whole word in en-US; options are single',
      'capital letters (2–3 of them) with lowercase ids and empty tokens; answer is the missing letter id.',
      'The prompt starts with one short meaning sentence that tells the child which word it is.',
      'Hints: a nudge, a strategy that involves the grown-up, then a worked example naming the letter.',
      'Vary which position is blank (first, middle, last).',
    ].join(' '),
    // M4 moved these checks into @wwm/learning: the word must be on the reviewed list (it replaced the
    // /usr/share/dict/words check the October 19 run used), and real-word distractors are flagged.
    check: (round) => spellingIssues(round),
    notes: spellingFlags,
    signature: (round) =>
      round.kind === 'choose' ? `${round.practice?.text.toUpperCase()}|${round.stimulusText}` : '',
  },
  {
    activityId: 'compare-groups',
    kind: 'compare',
    brief: [
      'Write compare rounds: two gem islands with 1–8 gems each. At least one round should be a trick where the',
      'smaller group looks bigger (spread or large gems against tight or small gems) and at least one should be',
      'equal islands with allowSame true. Hints: a nudge, the match-them-up strategy, then a worked example that',
      'states both counts. The success line states the counts and which is more (or that they are the same).',
      'Use number words (one, two, three…) rather than digits in spoken text.',
    ].join(' '),
    check(round) {
      if (round.kind !== 'compare') return ['Must be a compare round.'];
      const issues: string[] = [];
      const [a, b] = round.islands;
      if (a.count > 8 || b.count > 8) issues.push('Keep islands at eight gems or fewer for this objective.');
      const allowed = new Set([a.count, b.count, Math.abs(a.count - b.count)]);
      for (const [field, text] of [
        ['last hint', round.hints.at(-1) ?? ''],
        ['success', round.success],
      ] as const) {
        const spoken = [
          ...text.toLowerCase().matchAll(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/g),
        ]
          .map((match) => match[1] ?? '')
          .map((token) => (/^\d+$/.test(token) ? Number(token) : NUMBER_WORDS.indexOf(token)));
        const wrong = spoken.filter((value) => !allowed.has(value));
        // "one" is often an article ("just one more"); only flag it when it isn't a count either.
        if (wrong.some((value) => value !== 1))
          issues.push(`The ${field} names a number (${wrong.join(', ')}) that isn't on the islands.`);
        if (field === 'success' && round.answer !== 'same' && !spoken.includes(Math.max(a.count, b.count)))
          issues.push('The success line must state the larger count.');
      }
      return issues;
    },
    notes(round) {
      if (round.kind !== 'compare') return [];
      const [a, b] = round.islands;
      const misleading =
        (a.count < b.count &&
          (a.arrangement === 'spread' || a.size === 'large') &&
          b.arrangement === 'tight') ||
        (b.count < a.count &&
          (b.arrangement === 'spread' || b.size === 'large') &&
          a.arrangement === 'tight');
      return misleading ? ['Trick round: the smaller group is made to look bigger.'] : [];
    },
    signature: (round) =>
      round.kind === 'compare'
        ? round.islands.map((group) => `${group.count}${group.arrangement}${group.size}`).join('|')
        : '',
  },
  {
    activityId: 'spanish-colors',
    kind: 'choose',
    brief: [
      'Write rounds where the child hears a Spanish colour word, tries saying it, then taps the shape of that colour.',
      'Only these colours exist: rojo (red), azul (blue), verde (green), amarillo (yellow).',
      'practice is the Spanish word in es-ES, lower case. Each option is one token {shape, color} with the English',
      'colour name as its label and the colour as its id. Shapes are circle, square or triangle; vary them.',
      'Use 2–3 options. Never write the Spanish word in the prompt; the child hears it.',
      'Hints: a nudge, a strategy with the grown-up, then a worked example naming the English colour.',
    ].join(' '),
    check(round) {
      if (round.kind !== 'choose') return ['Must be a choose round.'];
      const issues: string[] = [];
      const color = SPANISH_COLORS[round.practice?.text.toLowerCase() ?? ''];
      if (!color || round.practice?.language !== 'es-ES')
        issues.push('practice must be rojo, azul, verde or amarillo in es-ES.');
      const answer = round.options.find((option) => option.id === round.answer);
      if (answer?.tokens.length !== 1 || answer.tokens[0]?.color !== color)
        issues.push(`The answer option must be one ${color ?? '?'} token.`);
      const colors = round.options.map((option) => option.tokens[0]?.color);
      if (new Set(colors).size !== colors.length) issues.push('Each option must be a different colour.');
      if (round.prompt.toLowerCase().includes(round.practice?.text.toLowerCase() ?? '\0'))
        issues.push('The prompt gives away the Spanish word.');
      return issues;
    },
    notes: () => [],
    signature: (round) =>
      round.kind === 'choose'
        ? `${round.practice?.text}|${round.options.map((option) => option.tokens.map((t) => t.shape + t.color)).join(',')}`
        : '',
  },
];

interface Usage {
  input_tokens: number;
  output_tokens: number;
}
const usage: Usage = { input_tokens: 0, output_tokens: 0 };

type Message = { role: 'user' | 'assistant'; content: string };
async function complete(system: string, messages: Message[]): Promise<string> {
  const response = await fetch(`${base}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, system, messages }),
  });
  if (!response.ok) throw new Error(`model ${response.status}: ${await response.text()}`);
  const body = (await response.json()) as { content: { type: string; text?: string }[]; usage: Usage };
  usage.input_tokens += body.usage.input_tokens;
  usage.output_tokens += body.usage.output_tokens;
  return body.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

function parseArray(text: string): unknown[] | string {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < start) return 'No JSON array found.';
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(value) ? value : 'The JSON is not an array.';
  } catch (error) {
    return `Invalid JSON: ${(error as Error).message}`;
  }
}

interface Verdict {
  id: string;
  round?: Round;
  raw: unknown;
  issues: string[];
  notes: string[];
}

function judge(objective: Objective, activity: Activity, raw: unknown[], seen: Set<string>): Verdict[] {
  const existing = new Set(activity.rounds.map(objective.signature));
  return raw.map((value, index) => {
    const id =
      value && typeof value === 'object' && 'id' in value && typeof value.id === 'string'
        ? value.id
        : `#${index}`;
    const parsed = roundSchema.safeParse(value);
    if (!parsed.success)
      return {
        id,
        raw: value,
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        notes: [],
      };
    const round = parsed.data;
    const issues: string[] = [];
    if (round.kind !== objective.kind) issues.push(`Must be a ${objective.kind} round.`);
    if (round.optional || round.onlyAfterHelpOn)
      issues.push('Bank items are plain rounds: no optional or onlyAfterHelpOn.');
    issues.push(...objective.check(round));
    const signature = objective.signature(round);
    if (existing.has(signature)) issues.push('Repeats a round already in the lesson; write a fresh example.');
    else if (seen.has(signature)) issues.push('Duplicates another round in this set.');
    seen.add(signature);
    const notes = objective.notes(round);
    if (round.prompt.length > 100)
      notes.push(`Long prompt (${round.prompt.length} characters) for a 4-year-old.`);
    return { id, round, raw: value, issues, notes };
  });
}

const SYSTEM = [
  'You write practice rounds for Pip, a friendly ball guide in a learning game for children aged 4–5 who play',
  'with a grown-up. Children do not read independently: everything is spoken aloud. Keep lines short, warm and',
  'concrete; never babyish, never sarcastic, no scores or speed. Rounds are JSON objects that must follow the exact',
  'shape of the exemplar rounds. Reply with a JSON array only, no commentary.',
].join(' ');

interface RunResult {
  objective: string;
  run: number;
  attempts: number;
  firstPass: { valid: number; total: number; issues: string[] };
  final: Verdict[];
  error?: string;
}

async function runObjective(objective: Objective, run: number): Promise<RunResult> {
  const activity = baselinePath.activities.find((candidate) => candidate.id === objective.activityId);
  if (!activity) throw new Error(`Unknown activity ${objective.activityId}`);
  const exemplar = activity.rounds.filter((round) => !round.optional && !round.onlyAfterHelpOn);
  const ids = Array.from({ length: PER_SET }, (_, i) => `g${i + 1}`);
  const messages: Message[] = [
    {
      role: 'user',
      content: [
        `Lesson: ${activity.title}. Objective: ${activity.objective}`,
        `Exemplar rounds (already in the lesson; do not repeat them):\n${JSON.stringify(exemplar, null, 1)}`,
        objective.brief,
        `Write ${PER_SET} fresh rounds with ids ${ids.join(', ')}. Each must test the same objective with a new`,
        'example, so a child who memorised the exemplar answers still has to think.',
      ].join('\n\n'),
    },
  ];
  const seenAt = () => new Set<string>();
  let text = await complete(SYSTEM, messages);
  let parsed = parseArray(text);
  if (typeof parsed === 'string')
    return {
      objective: objective.activityId,
      run,
      attempts: 1,
      firstPass: { valid: 0, total: PER_SET, issues: [parsed] },
      final: [],
      error: parsed,
    };
  let verdicts = judge(objective, activity, parsed, seenAt());
  const firstPass = {
    valid: verdicts.filter((v) => !v.issues.length).length,
    total: verdicts.length,
    issues: verdicts.flatMap((v) => v.issues.map((issue) => `${v.id}: ${issue}`)),
  };
  let attempts = 1;
  while (attempts <= MAX_REPAIRS && verdicts.some((v) => v.issues.length)) {
    const failing = verdicts.filter((v) => v.issues.length);
    messages.push({ role: 'assistant', content: text });
    messages.push({
      role: 'user',
      content: [
        'These rounds failed validation. Reply with a JSON array containing only corrected replacements, keeping',
        'their ids:',
        ...failing.map((v) => `- ${v.id}: ${v.issues.join(' ')}`),
      ].join('\n'),
    });
    text = await complete(SYSTEM, messages);
    attempts++;
    parsed = parseArray(text);
    if (typeof parsed === 'string') continue;
    const replacements = new Map(parsed.map((value) => [(value as { id?: string })?.id, value]));
    const merged = verdicts.map((v) => (replacements.has(v.id) ? replacements.get(v.id) : v.raw));
    verdicts = judge(objective, activity, merged, seenAt());
  }
  return { objective: objective.activityId, run, attempts, firstPass, final: verdicts };
}

async function startProxy(): Promise<ChildProcess | undefined> {
  if (
    await fetch(`${base}/`).then(
      () => true,
      () => false,
    )
  )
    return undefined;
  const proxy = spawn(
    'pnpm',
    ['exec', 'wrangler', 'dev', '-c', 'proxy/wrangler.jsonc', '--port', String(PORT)],
    {
      cwd: join(here, '..'),
      stdio: 'ignore',
    },
  );
  for (let i = 0; i < 60; i++) {
    if (
      await fetch(`${base}/`).then(
        () => true,
        () => false,
      )
    )
      return proxy;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  proxy.kill();
  throw new Error('The helper Worker did not start. Is `wrangler login` current?');
}

const proxy = await startProxy();
try {
  const results: RunResult[] = [];
  for (const objective of objectives)
    for (let run = 1; run <= RUNS; run++) {
      process.stdout.write(`${objective.activityId} run ${run}… `);
      const result = await runObjective(objective, run).catch(
        (error: Error): RunResult => ({
          objective: objective.activityId,
          run,
          attempts: 0,
          firstPass: { valid: 0, total: PER_SET, issues: [] },
          final: [],
          error: error.message,
        }),
      );
      const valid = result.final.filter((v) => !v.issues.length).length;
      console.log(
        `first pass ${result.firstPass.valid}/${result.firstPass.total}, final ${valid}/${PER_SET}, ${result.attempts} call(s)`,
      );
      results.push(result);
    }
  const date = new Date().toISOString().slice(0, 10);
  const out = join(root, 'docs/education/item-bank-spike', date);
  await mkdir(out, { recursive: true });
  await writeFile(
    join(out, 'results.json'),
    `${JSON.stringify({ model: MODEL, perSet: PER_SET, maxRepairs: MAX_REPAIRS, usage, results }, null, 2)}\n`,
  );
  console.log(
    `usage: ${usage.input_tokens} input, ${usage.output_tokens} output tokens → ${out}/results.json`,
  );
} finally {
  proxy?.kill();
}
