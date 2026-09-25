/**
 * Provenance labels for corpus chunks (Phase 15c) and the retrieval weights that use them. Runtime-safe (no Node
 * APIs): the index build labels chunks, the Worker re-weights hits by the question's intent, and the eval uses the
 * labels to flag answers that present a plan as fact.
 */
import type { SearchHit, SourceKind } from './types.ts';

/** How the model is told to read each kind (shown in every excerpt header). */
export const KIND_NOTES: Record<SourceKind, string> = {
  history: 'evidence about the 2013 original',
  plan: 'a plan or proposal; it may never have been built',
  'build-log': 'a record of what was actually done in this rebuild',
  status: 'the current summary of what exists in this rebuild today',
  reference: 'a current reference document for this rebuild',
};

/** `docs/reference/` files that document the 2013 evidence itself (bundle, archive, stage data, UI copy). */
const REFERENCE_HISTORY = new Set([
  'docs/reference/archive-index.md',
  'docs/reference/bundle-notes.md',
  'docs/reference/stage-format.md',
  'docs/reference/ux-flow.md',
  'docs/reference/visual-notes.md',
]);

/**
 * The kind of a section, from its repo path and its heading trail (outermost first, the document title
 * excluded). `RESEARCH.md` is split by part: Part 1 ("What the original was") and the source list are history;
 * the goal statement and Parts 2–8 are the rebuild plan written before any code existed.
 */
export function sourceKind(path: string, trail: readonly string[] = []): SourceKind {
  if (path.startsWith('docs/build-log/')) return 'build-log';
  if (path.startsWith('docs/facts/')) return 'status';
  if (path.startsWith('plans/')) return 'plan';
  if (path === 'research/recreation-plan.md') return 'plan';
  if (path.startsWith('research/')) return 'history';
  if (path === 'apps/web/src/pages/about/history.ts') return 'history';
  if (path === 'RESEARCH.md') {
    const part = trail[0] ?? '';
    if (/^Part 1\b/i.test(part) || /^Sources\b/i.test(part)) return 'history';
    return 'plan';
  }
  if (REFERENCE_HISTORY.has(path)) return 'history';
  if (path === 'docs/reference/contract-deltas.md') return 'plan';
  return 'reference';
}

/** The question is about the 2013 original. */
const HISTORY_INTENT =
  /\b(2013|original|originally|saqoosha|party|google japan|chrome experiments?|back then|at the time|katamari|futurek|aid-dcc|dotfes|cannes|webby|phantomjs|physijs|opencv|case study)\b|原作|オリジナル|2013/i;
/** The question is about this rebuild, or about what exists now. */
const REBUILD_INTENT =
  /\b(rebuild|rebuilt|revival|tribute|remake|this (game|site|project|version|docent)|today|now|currently|2026|agents?|claude|ai|llm|models?|does (it|the game|the site)|is there|are there|can (i|you)|live site)\b/i;
/** The question asks about plans or proposals themselves. */
const PLAN_INTENT =
  /\b(plan|plans|planned|planning|proposal|proposals|proposed|propose|roadmap|intended|intentions?|ideas?|future|next steps?|follow-?ups?|was supposed to)\b/i;

export type KindWeights = Record<SourceKind, number>;

/**
 * Multipliers for BM25 scores by source kind, from what the question is about. A 2013 question favours history
 * over the rebuild's build logs (which mention "2013" and "builder" constantly); a question about this rebuild
 * favours the status summary and build logs over plans; plans are only neutral when the question asks about plans.
 */
export function intentWeights(question: string): KindWeights {
  const history = HISTORY_INTENT.test(question);
  const rebuild = REBUILD_INTENT.test(question);
  const plan = PLAN_INTENT.test(question);
  let w: KindWeights;
  if (history && !rebuild) w = { history: 1.6, reference: 1.15, status: 0.8, 'build-log': 0.7, plan: 0.6 };
  else if (rebuild && !history)
    w = { status: 1.6, 'build-log': 1.2, reference: 1.1, history: 0.9, plan: 0.6 };
  else if (history && rebuild) w = { history: 1.3, status: 1.3, 'build-log': 1.1, reference: 1.1, plan: 0.7 };
  else w = { history: 1, status: 1.1, 'build-log': 1, reference: 1, plan: 0.8 };
  if (plan) w.plan = Math.max(w.plan, 1.1);
  return w;
}

/** Re-rank hits by kind weight (stable for equal scores, as the searcher's order). */
export function weightHits(hits: SearchHit[], w: KindWeights): SearchHit[] {
  return hits
    .map((h) => ({ ...h, score: h.score * (w[h.chunk.kind] ?? 1) }))
    .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id));
}
