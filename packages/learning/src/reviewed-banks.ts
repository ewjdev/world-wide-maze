/**
 * Reviewed banks (Phase 31 M4): open-vocabulary bank items that an operator approved in the lesson-draft
 * workbench, exported as JSON and imported into the repo with `pnpm learning:bank import <file>`. The baseline
 * merges them with its generated banks. Nothing here reaches a child until it is committed, reviewed and deployed.
 *
 * Each bank is `src/banks/<objective>.json`; the import CLI regenerates `src/banks/index.ts`, which lists them.
 */
import { z } from 'zod';
import { bankFiles } from './banks/index.ts';
import { roundKey } from './banks.ts';
import { roundIssues } from './checks.ts';
import { type Bank, type LearningPath, parseLearningPath, type Round, roundSchema } from './schema.ts';
import { spelledWord, spellingFlags, spellingIssues } from './vocabulary.ts';

export const BANK_FILE_FORMAT = 'wwm-learning-bank/1' as const;

/** An approved bank as exported by the workbench (`GET /api/admin/lessons/:id/export`). */
export const bankFileSchema = z
  .object({
    format: z.literal(BANK_FILE_FORMAT),
    objective: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    items: z.array(roundSchema).min(1).max(24),
    provenance: z
      .object({
        draft: z.string().max(80),
        revision: z.string().regex(/^[0-9a-f]{32}$/),
        approvedAt: z.string().max(40),
        note: z.string().max(1000),
        model: z.string().max(80).optional(),
        vocabulary: z.string().max(80).optional(),
      })
      .strict(),
  })
  .strict();
export type BankFile = z.infer<typeof bankFileSchema>;

/** Objectives the authoring agent may write items for, with the checks a model-written item must pass. */
export interface AuthoringObjective {
  /** The activity whose authored rounds are the exemplars and the freshness baseline. */
  activity: string;
  kind: Round['kind'];
  /** Objective-specific problems (fail the item). */
  issues(round: Round): string[];
  /** Notes for the reviewer (don't fail the item). */
  flags(round: Round): string[];
  /** Content identity for freshness: two items with the same signature teach the same example. */
  signature(round: Round): string;
  /** What the item is about in a word, for exclusion lists and summaries (the spelled word). */
  label(round: Round): string;
}

export const AUTHORING_OBJECTIVES: Readonly<Record<string, AuthoringObjective>> = {
  'little-word-builders': {
    activity: 'little-word-builders',
    kind: 'choose',
    issues: (round) => spellingIssues(round),
    flags: spellingFlags,
    signature: (round) =>
      round.kind === 'choose' ? `${spelledWord(round) ?? ''}|${round.stimulusText ?? ''}` : '',
    label: (round) => spelledWord(round) ?? '',
  },
};

export interface BankReport {
  /** Problems that block the import (or approval). */
  issues: string[];
  /** Notes a reviewer should read. */
  flags: string[];
}

/**
 * Check an approved bank against a learning path (normally `baselinePath`): the objective exists, has no generator
 * bank and is one the agent may write; every item is a plain round that passes `roundSchema`, `roundIssues` and
 * the objective's checks; items are fresh against the authored lesson and unique in the bank; and the path still
 * parses with the bank in place.
 */
export function reviewedBankReport(
  path: LearningPath,
  bank: { objective: string; items: Round[] },
): BankReport {
  const issues: string[] = [];
  const flags: string[] = [];
  const { objective } = bank;
  if (!path.objectives?.some((candidate) => candidate.id === objective))
    return { issues: [`Unknown objective "${objective}".`], flags };
  const existing = path.banks?.find((candidate) => candidate.objective === objective);
  if (existing && 'generator' in existing)
    return {
      issues: [`"${objective}" already has a generator bank; it doesn't take reviewed items.`],
      flags,
    };
  const authoring = AUTHORING_OBJECTIVES[objective];
  if (!authoring) return { issues: [`"${objective}" is not open for authored banks.`], flags };
  const activity = path.activities.find((candidate) => candidate.id === authoring.activity);
  const authored = activity?.rounds ?? [];
  const authoredKeys = new Set(authored.map(roundKey));
  const authoredSignatures = new Set(authored.map(authoring.signature));
  const authoredLabels = new Set(authored.map(authoring.label));
  const ids = new Set<string>();
  const signatures = new Set<string>();
  for (const value of bank.items) {
    const parsed = roundSchema.safeParse(value);
    if (!parsed.success) {
      issues.push(`Item ${describe(value)}: ${parsed.error.issues.map((issue) => issue.message).join(' ')}`);
      continue;
    }
    const round = parsed.data;
    const at = `Item "${round.id}"`;
    if (ids.has(round.id)) issues.push(`${at}: duplicate id.`);
    ids.add(round.id);
    if (round.kind !== authoring.kind) issues.push(`${at}: must be a ${authoring.kind} round.`);
    if (round.optional || round.onlyAfterHelpOn || (round.objective && round.objective !== objective))
      issues.push(`${at}: bank items are plain rounds for this objective.`);
    for (const issue of [...roundIssues(round), ...authoring.issues(round)]) issues.push(`${at}: ${issue}`);
    const signature = authoring.signature(round);
    if (authoredKeys.has(roundKey(round)) || authoredSignatures.has(signature))
      issues.push(`${at}: repeats a round in the lesson.`);
    else if (signatures.has(signature)) issues.push(`${at}: duplicates another item in the bank.`);
    signatures.add(signature);
    for (const flag of authoring.flags(round)) flags.push(`${at}: ${flag}`);
    if (authoredLabels.has(authoring.label(round)))
      flags.push(`${at}: "${authoring.label(round)}" is also in the lesson (a different blank).`);
  }
  if (!issues.length) {
    const banks: Bank[] = [
      ...(path.banks ?? []).filter((candidate) => candidate.objective !== objective),
      { objective, items: bank.items },
    ];
    try {
      parseLearningPath({ ...path, banks });
    } catch (error) {
      issues.push(`The learning path doesn't accept this bank: ${(error as Error).message.slice(0, 500)}`);
    }
  }
  return { issues, flags };
}

function describe(value: unknown): string {
  return value && typeof value === 'object' && 'id' in value && typeof value.id === 'string'
    ? `"${value.id}"`
    : '(no id)';
}

/** Imported banks, parsed. A malformed file fails the build (and every test) loudly. */
export const reviewedBanks: Bank[] = bankFiles.map((file) => {
  const { objective, items } = bankFileSchema.parse(file);
  return { objective, items };
});

// ── lesson-draft workbench wire types (`/api/admin/lessons/*`, shared by the Worker and the admin UI) ─────────

export type DraftStatus = 'generating' | 'ready' | 'failed' | 'approved' | 'rejected';

/** One model-written item in a turn, after validation and repair. */
export interface DraftItemVerdict {
  /** The id the model was asked to use (`g1`…). */
  draftId: string;
  /** The bank id it was given when added (`i-<hash>`). */
  id?: string;
  /** What it is about (the spelled word). */
  label: string;
  ok: boolean;
  /** In the revision's bank (valid, fresh, and under the 24-item limit). */
  added: boolean;
  issues: string[];
  flags: string[];
  /** The parsed round, when it passed `roundSchema`. */
  round?: Round;
  /** The model's JSON for this item when it didn't parse as a round (shown escaped, never rendered). */
  raw?: unknown;
  /** Lines Pip would say for this item (`activityScript`). */
  spoken?: string[];
}

export interface DraftModelCall {
  kind: 'generate' | 'repair';
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** A draft revision: the whole candidate bank after one turn, identified by a hash of its content. */
export interface DraftRevision {
  /** First 32 hex characters of SHA-256 over the bank's canonical JSON. */
  hash: string;
  turn: number;
  createdAt: string;
  objective: string;
  bank: { objective: string; items: Round[] };
  /** Item ids new in this revision, and ids the operator dropped from the previous one. */
  added: string[];
  dropped: string[];
  items: DraftItemVerdict[];
  /** Problems that block approval (from `reviewedBankReport`). */
  issues: string[];
  /** Reviewer notes, such as a distractor that also spells a real word. */
  flags: string[];
  calls: DraftModelCall[];
  /** A plain summary written by the pipeline (not by the model). */
  summary: string;
  promptVersion: string;
  vocabulary: string;
}

export interface DraftRevisionSummary {
  hash: string;
  turn: number;
  createdAt: string;
  items: number;
  added: number;
  issues: number;
  flags: number;
}

export interface DraftMessage {
  seq: number;
  role: 'operator' | 'agent';
  author?: string;
  text: string;
  at: string;
  revision?: string;
}

export interface DraftSummary {
  id: string;
  objective: string;
  brief: string;
  status: DraftStatus;
  createdAt: string;
  updatedAt: string;
  revisionCount: number;
  latest?: string;
}

export interface DraftReview {
  decision: 'approved' | 'rejected';
  note: string;
  by: string;
  at: string;
  revision?: string;
}

export interface DraftSnapshot extends DraftSummary {
  createdBy: string;
  turn: number;
  error?: string;
  review?: DraftReview;
  messages: DraftMessage[];
  revisions: DraftRevisionSummary[];
}

export interface DraftListResponse {
  drafts: DraftSummary[];
  objectives: { id: string; title: string; statement: string }[];
  provider: { mode: 'gateway' | 'mock' | 'off'; model: string };
  vocabulary: { id: string; reviewStatus: string; words: number };
}
