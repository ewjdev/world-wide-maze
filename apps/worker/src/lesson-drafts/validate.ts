/**
 * Validation of model-written bank items. `@wwm/learning` stays the only validator: every item must pass
 * `roundSchema`, `roundIssues` and the objective's own checks (`AUTHORING_OBJECTIVES`, which for spelling include
 * the reviewed word list), be a plain round, and be fresh against the lesson, the bank so far and the rest of the
 * turn. Flags are notes for the reviewer that don't fail an item.
 */
import { type AuthoringObjective, type Round, roundIssues, roundKey, roundSchema } from '@wwm/learning';

export interface Verdict {
  draftId: string;
  label: string;
  round?: Round;
  raw?: unknown;
  issues: string[];
  flags: string[];
}

export interface JudgeContext {
  objective: string;
  authoring: AuthoringObjective;
  /** The lesson's rounds for this objective (exemplars, and the freshness baseline). */
  authored: Round[];
  /** The bank so far. */
  base: Round[];
  /** Labels this draft dropped earlier. */
  avoid: string[];
}

/** A short, plain label from untrusted input (it ends up in summaries). */
function clip(value: string): string {
  return value.replace(/[^\p{L}\p{N} '-]/gu, '').slice(0, 24);
}

/** Judge the items for `ids` (in order) from the model's values, keyed by the id the model gave each one. */
export function judge(context: JudgeContext, ids: string[], byId: ReadonlyMap<string, unknown>): Verdict[] {
  const { authoring, objective } = context;
  const authoredKeys = new Set(context.authored.map(roundKey));
  const authoredSignatures = new Set(context.authored.map(authoring.signature));
  const authoredLabels = new Set(context.authored.map(authoring.label));
  const baseSignatures = new Set(context.base.map(authoring.signature));
  const usedLabels = new Set([...context.base.map(authoring.label), ...context.avoid]);
  return ids.map((draftId) => {
    if (!byId.has(draftId))
      return { draftId, label: '', issues: ['Missing: the reply had no item with this id.'], flags: [] };
    const raw = byId.get(draftId);
    const parsed = roundSchema.safeParse(raw);
    if (!parsed.success)
      return {
        draftId,
        label: '',
        raw,
        issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'round'}: ${issue.message}`),
        flags: [],
      };
    const round = parsed.data;
    const label = clip(authoring.label(round));
    const issues: string[] = [];
    if (round.kind !== authoring.kind) issues.push(`Must be a ${authoring.kind} round.`);
    if (round.optional || round.onlyAfterHelpOn)
      issues.push('Bank items are plain rounds: no optional or onlyAfterHelpOn.');
    if (round.objective && round.objective !== objective)
      issues.push(`objective must be "${objective}" or absent.`);
    issues.push(...roundIssues(round), ...authoring.issues(round));
    const signature = authoring.signature(round);
    if (authoredKeys.has(roundKey(round)) || authoredSignatures.has(signature))
      issues.push('Repeats a round already in the lesson; write a fresh example.');
    else if (baseSignatures.has(signature) || usedLabels.has(authoring.label(round)))
      issues.push(
        `"${label}" is already used in this draft (the bank, an earlier drop or this turn); use another word.`,
      );
    usedLabels.add(authoring.label(round));
    const flags = [...authoring.flags(round)];
    if (authoredLabels.has(authoring.label(round)))
      flags.push(`"${label}" is also in the lesson (a different blank).`);
    return { draftId, label, round, issues, flags };
  });
}

/** The model's items keyed by their `id` (the first one wins), from a parsed array. */
export function itemsById(values: unknown[]): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const value of values) {
    const id =
      value && typeof value === 'object' && 'id' in value && typeof value.id === 'string'
        ? value.id
        : undefined;
    if (id && !out.has(id)) out.set(id, value);
  }
  return out;
}
