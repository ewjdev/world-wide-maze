/**
 * Lexical retrieval (BM25) over the corpus index bundled into the Worker (`corpus.json`, built by
 * `pnpm docent:index` from tools/docent-index). The searcher is built once per isolate: the index is immutable,
 * so a module-level memo is safe.
 */
import {
  type CorpusChunk,
  type CorpusIndex,
  createSearcher,
  intentWeights,
  type Searcher,
  type SearchHit,
  weightHits,
} from '@wwm/docent-index';
import corpus from './corpus.json' with { type: 'json' };

export const INDEX = corpus as CorpusIndex;

let memo: Searcher | null = null;
export function searcher(): Searcher {
  memo ??= createSearcher(INDEX.chunks);
  return memo;
}

/** An excerpt as the model sees it: `S1`…`Sn` in retrieval order. */
export interface Excerpt {
  ref: string;
  chunk: CorpusChunk;
  score: number;
}

export const TOP_K = 6;
/** Keep hits scoring at least this share of the best hit (drops weak tail matches). */
const RELATIVE_FLOOR = 0.35;

export function selectExcerpts(hits: SearchHit[], k = TOP_K): Excerpt[] {
  const top = hits[0]?.score ?? 0;
  return hits
    .filter((h) => h.score >= top * RELATIVE_FLOOR)
    .slice(0, k)
    .map((h, i) => ({ ref: `S${i + 1}`, chunk: h.chunk, score: h.score }));
}

/**
 * A few words the visitor uses that the corpus says differently ("who made it" → the credits; "AI" → the
 * agents and Claude named in the build logs). Appended to the retrieval query only.
 */
const EXPANSIONS: [RegExp, string][] = [
  [/\bwho\b.*\b(made|make|created?|built|behind|designed|developed)\b/i, 'credit production agency'],
  [/\b(team|creators?|makers?|people)\b/i, 'credit'],
  [/\b(ai|llm|claude|agents?)\b/i, 'agent claude'],
  [/\b(evidenced?|reconstructed|labels?)\b/i, 'fidelity'],
  [/\bphone\b/i, 'controller tilt'],
];

export function expandQuery(q: string): string {
  const extra = EXPANSIONS.filter(([re]) => re.test(q)).map(([, words]) => words);
  return extra.length ? `${q} ${extra.join(' ')}` : q;
}

/** A trailing parenthesised Japanese note, like the panel's "(日本語で答えてください)" answer-language hint. */
const LANGUAGE_HINT =
  /\s*[(（][^()（）]*[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}][^()（）]*[)）]\s*$/u;

/**
 * The text to search for: an English question without the answer-language hint. The hint says nothing about the
 * topic, and its CJK bigrams are rare enough in the English corpus to outrank the real matches. The model still
 * gets the full question.
 */
export function searchText(question: string): string {
  const stripped = question.replace(LANGUAGE_HINT, '');
  return /\p{Script=Latin}/u.test(stripped) ? stripped : question;
}

/**
 * Search for `question`; when that finds little and there is an earlier user question (a follow-up such as
 * "tell me more"), search again with both.
 */
export function retrieve(s: Searcher, rawQuestion: string, previousQuestion?: string): SearchHit[] {
  const question = searchText(rawQuestion);
  const hits = weightedSearch(s, question);
  if (previousQuestion && (hits[0]?.score ?? 0) < 6) {
    const more = weightedSearch(s, `${question} ${previousQuestion}`);
    if ((more[0]?.score ?? 0) > (hits[0]?.score ?? 0)) return more;
  }
  return hits;
}

/** BM25 candidates considered before the provenance weighting picks the top `TOP_K * 2`. */
const CANDIDATES = 60;

/**
 * BM25, then re-weighted by provenance for what the question is about (`intentWeights`): a question about the
 * 2013 original favours history over the rebuild's build logs, a question about this rebuild favours the status
 * summary and build logs over plans that may never have been built.
 */
export function weightedSearch(s: Searcher, question: string): SearchHit[] {
  const hits = s.search(expandQuery(question), CANDIDATES);
  return weightHits(hits, intentWeights(question)).slice(0, TOP_K * 2);
}
