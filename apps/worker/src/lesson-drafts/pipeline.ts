/**
 * The `LESSON_DRAFT` Workflow's steps (contracts §10.5 CCR-31-4): generate → validate → repair (at most twice) →
 * assemble a revision → save it → ready for review. Kept free of Workflow and Agent imports so the same code runs
 * in the Workflow (workflow.ts) and in tests with a recorded step runner.
 *
 * Steps are of two kinds, after the fx0 pattern:
 * - **Billed, run once** (`generate`, `repair-N`): a model call. No step retries, and the Workflow caches each
 *   completed step's result, so a Workflow that resumes after a crash or an eviction replays the stored reply
 *   instead of paying for the call again. A failed call fails the turn; the operator decides whether to ask again.
 * - **Safe to re-run** (`context`, `validate-N`, `assemble`, `save-revision`, `ready-for-review`): deterministic
 *   reads, checks and idempotent writes (a revision is stored by content hash), retried with backoff.
 */
import {
  type Activity,
  AUTHORING_OBJECTIVES,
  activityScript,
  baselinePath,
  type DraftItemVerdict,
  type DraftModelCall,
  type DraftRevision,
  type LearningPath,
  type Round,
  reviewedBankReport,
  roundHash,
  spellingVocabulary,
} from '@wwm/learning';
import { firstMessage, PROMPT_VERSION, parseArray, repairMessage, SYSTEM_PROMPT } from './prompt.ts';
import type { ChatTurn, DraftModel, DraftReply } from './providers.ts';
import { itemsById, type JudgeContext, judge, type Verdict } from './validate.ts';

export const MAX_REPAIRS = 2;
export const MAX_BANK_ITEMS = 24;
export const MAX_TURN_ITEMS = 12;

/** Step settings, matching `WorkflowStepConfig`. */
export interface StepConfig {
  retries?: { limit: number; delay: string | number; backoff?: 'constant' | 'linear' | 'exponential' };
  timeout?: string | number;
}
export const SAFE_STEP: StepConfig = {
  retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' },
  timeout: '1 minute',
};
export const BILLED_STEP: StepConfig = { retries: { limit: 0, delay: 0 }, timeout: '4 minutes' };

/** The part of `WorkflowStep` the pipeline uses. Results must be structured-cloneable. */
export interface StepRunner {
  do<T>(name: string, config: StepConfig, callback: () => Promise<T>): Promise<T>;
}

/** One turn's input: everything the Workflow needs, so a replay sees exactly what the first run saw. */
export interface DraftParams {
  draftId: string;
  turn: number;
  objective: string;
  brief: string;
  /** The operator's message for this turn (the brief on the first turn). */
  message: string;
  /** How many new items to ask for. */
  count: number;
  /** The bank so far (the previous revision, minus anything the operator dropped). */
  base: Round[];
  dropped: string[];
  /** Labels (words) this draft dropped earlier: excluded like the bank so far. */
  avoid?: string[];
}

export interface PipelineDeps {
  model: DraftModel;
  maxTokens: number;
  /** The learning path the bank must fit (default: the deployed baseline). */
  path?: LearningPath;
  now?: () => Date;
  save(revision: DraftRevision): Promise<unknown>;
  ready(turn: number, hash: string, summary: string): Promise<unknown>;
}

export interface DraftOutcome {
  hash: string;
  summary: string;
}

interface Context {
  ids: string[];
  exclude: string[];
  first: ChatTurn;
}

export function authoringActivity(path: LearningPath, objective: string): Activity {
  const authoring = AUTHORING_OBJECTIVES[objective];
  const activity = authoring && path.activities.find((candidate) => candidate.id === authoring.activity);
  if (!authoring || !activity) throw new Error(`"${objective}" is not open for lesson drafts.`);
  return activity;
}

export async function runDraftPipeline(
  steps: StepRunner,
  params: DraftParams,
  deps: PipelineDeps,
): Promise<DraftOutcome> {
  const path = deps.path ?? baselinePath;
  const authoring = AUTHORING_OBJECTIVES[params.objective];
  const activity = authoringActivity(path, params.objective);
  if (!authoring) throw new Error(`"${params.objective}" is not open for lesson drafts.`);
  const judgeContext: JudgeContext = {
    objective: params.objective,
    authoring,
    authored: activity.rounds,
    base: params.base,
    avoid: params.avoid ?? [],
  };

  // Read: what to ask for, and what to exclude. Safe to re-run.
  const context = await steps.do('context', SAFE_STEP, async (): Promise<Context> => {
    const room = Math.max(0, MAX_BANK_ITEMS - params.base.length);
    const count = Math.max(1, Math.min(params.count, MAX_TURN_ITEMS, room || 1));
    const ids = Array.from({ length: count }, (_, i) => `g${i + 1}`);
    const exclude = [
      ...new Set([...[...activity.rounds, ...params.base].map(authoring.label), ...(params.avoid ?? [])]),
    ].filter(Boolean);
    const first = firstMessage({
      activity,
      objective: params.objective,
      brief: params.brief,
      message: params.message,
      ids,
      exclude,
    });
    return { ids, exclude, first };
  });

  const ask = (messages: ChatTurn[], ids: string[], exclude: string[]) =>
    deps.model.complete({
      system: SYSTEM_PROMPT,
      messages,
      maxTokens: deps.maxTokens,
      task: { objective: params.objective, ids, exclude },
    });

  // Generate: billed, run once.
  const replies: { kind: DraftModelCall['kind']; reply: DraftReply; asked: ChatTurn }[] = [];
  const generated = await steps.do('generate', BILLED_STEP, () =>
    ask([context.first], context.ids, context.exclude),
  );
  replies.push({ kind: 'generate', reply: generated, asked: context.first });

  // Validate: safe to re-run. Each check is a pure function of the stored replies, so a resumed Workflow that
  // replays cached model steps reaches exactly the same verdicts.
  const validate = (attempt: number) =>
    steps.do(`validate-${attempt}`, SAFE_STEP, async () => {
      const raw = new Map<string, unknown>();
      let problem: string | undefined;
      for (const [index, { reply }] of replies.entries()) {
        const parsed = parseArray(reply.text);
        // The latest reply's parse failure explains why its items are still failing.
        if (typeof parsed === 'string') problem = index === attempt ? parsed : problem;
        // A repair's replacements overwrite only the ids they name.
        else for (const [id, value] of itemsById(parsed)) raw.set(id, value);
      }
      const verdicts = judge(judgeContext, context.ids, raw);
      return verdicts.map((verdict) =>
        problem && verdict.issues.length ? { ...verdict, issues: [problem, ...verdict.issues] } : verdict,
      );
    });
  let verdicts: Verdict[] = await validate(0);

  // Repair: at most twice, each billed and run once.
  for (let attempt = 1; attempt <= MAX_REPAIRS; attempt++) {
    const failing = verdicts.filter((verdict) => verdict.issues.length);
    if (!failing.length) break;
    const request = repairMessage(
      failing.map((verdict) => ({ id: verdict.draftId, issues: verdict.issues })),
    );
    const history = replies.flatMap(({ asked, reply }): ChatTurn[] => [
      asked,
      { role: 'assistant', content: reply.text },
    ]);
    const used = verdicts.filter((verdict) => !verdict.issues.length).map((verdict) => verdict.label);
    const reply = await steps.do(`repair-${attempt}`, BILLED_STEP, () =>
      ask(
        [...history, request],
        failing.map((verdict) => verdict.draftId),
        [...context.exclude, ...used],
      ),
    );
    replies.push({ kind: 'repair', reply, asked: request });
    verdicts = await validate(attempt);
  }

  // Assemble the revision: safe to re-run (deterministic apart from the timestamp, which the step stores).
  const revision = await steps.do('assemble', SAFE_STEP, () =>
    assemble(path, params, activity, verdicts, replies, deps.now?.() ?? new Date()),
  );
  await steps.do('save-revision', SAFE_STEP, async () => {
    await deps.save(revision);
    return revision.hash;
  });
  await steps.do('ready-for-review', SAFE_STEP, async () => {
    await deps.ready(params.turn, revision.hash, revision.summary);
    return revision.hash;
  });
  return { hash: revision.hash, summary: revision.summary };
}

async function assemble(
  path: LearningPath,
  params: DraftParams,
  activity: Activity,
  verdicts: Verdict[],
  replies: { kind: DraftModelCall['kind']; reply: DraftReply }[],
  now: Date,
): Promise<DraftRevision> {
  const items: DraftItemVerdict[] = [];
  const bankItems = [...params.base];
  for (const verdict of verdicts) {
    const ok = !verdict.issues.length && Boolean(verdict.round);
    const item: DraftItemVerdict = {
      draftId: verdict.draftId,
      label: verdict.label,
      ok,
      added: false,
      issues: verdict.issues,
      flags: [...verdict.flags],
    };
    if (verdict.round) {
      item.spoken = spokenLines(activity, verdict.round);
      if (!ok) item.round = verdict.round;
    } else if (verdict.raw !== undefined) item.raw = verdict.raw;
    if (ok && verdict.round) {
      if (bankItems.length >= MAX_BANK_ITEMS)
        item.flags.push(`Not added: the bank is at its ${MAX_BANK_ITEMS}-item limit.`);
      else {
        // Ids and the objective don't change an item's hash; the bank id comes from its content.
        const { objective: _objective, ...round } = verdict.round;
        const id = `i-${(await roundHash(verdict.round)).slice(0, 12)}`;
        const added = { ...round, id } as Round;
        bankItems.push(added);
        item.id = id;
        item.added = true;
        item.round = added;
      }
    }
    items.push(item);
  }
  const bank = { objective: params.objective, items: bankItems };
  const report = bankItems.length
    ? reviewedBankReport(path, bank)
    : { issues: ['No items passed validation, so there is nothing to approve.'], flags: [] };
  const hash = await contentHash(bank);
  const passed = items.filter((item) => item.ok);
  const failed = items.filter((item) => !item.ok);
  const repairs = replies.filter((entry) => entry.kind === 'repair').length;
  const summary = [
    `Turn ${params.turn}: asked for ${items.length} new item${items.length === 1 ? '' : 's'}.`,
    `${passed.length} passed${repairs ? ` after ${repairs} repair turn${repairs === 1 ? '' : 's'}` : ''}${passed.length ? ` (${passed.map((item) => item.label).join(', ')})` : ''}.`,
    failed.length
      ? `${failed.length} failed and ${failed.length === 1 ? 'was' : 'were'} left out (${failed.map((item) => item.label || item.draftId).join(', ')}).`
      : '',
    params.dropped.length ? `Dropped at your request: ${params.dropped.length}.` : '',
    `The bank has ${bankItems.length} item${bankItems.length === 1 ? '' : 's'}.`,
    report.flags.length ? `${report.flags.length} reviewer flag${report.flags.length === 1 ? '' : 's'}.` : '',
    report.issues.length ? 'Not ready to approve: see the issues.' : 'Ready for review.',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    hash,
    turn: params.turn,
    createdAt: now.toISOString(),
    objective: params.objective,
    bank,
    added: items.flatMap((item) => (item.added && item.id ? [item.id] : [])),
    dropped: params.dropped,
    items,
    issues: report.issues,
    flags: report.flags,
    calls: replies.map(({ kind, reply }) => ({
      kind,
      model: reply.model,
      inputTokens: reply.usage.inputTokens,
      outputTokens: reply.usage.outputTokens,
    })),
    summary,
    promptVersion: PROMPT_VERSION,
    vocabulary: spellingVocabulary.id,
  };
}

/** What Pip says for one item (the activity's script for that round alone, without intro and finale). */
function spokenLines(activity: Activity, round: Round): string[] {
  const lines = activityScript({ ...activity, rounds: [round] });
  return lines.slice(1, -1).map((line) => line.text);
}

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

/** First 32 hex characters of SHA-256 over the canonical JSON of a bank. */
export async function contentHash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(canonical(value))),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}
