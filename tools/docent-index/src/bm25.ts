/**
 * BM25 (Okapi, k1 = 1.2, b = 0.75) over the corpus chunks. The Worker builds the searcher once per isolate from
 * the bundled index (tokenizing ~330 KB takes a few milliseconds), so the JSON stays just the chunks.
 * Heading words count three times: "Who deserves credit" should win for a question about credit.
 */
import { tokenize } from './tokenize.ts';
import type { CorpusChunk, SearchHit } from './types.ts';

const K1 = 1.2;
const B = 0.75;
const TITLE_WEIGHT = 3;

export interface Searcher {
  search(query: string, k?: number): SearchHit[];
  /** Inverse document frequency of a (tokenized) term; 0 when it isn't in the corpus. */
  idf(term: string): number;
  /** The corpus uses this (tokenized) term, or a word sharing its first five letters ("promot…"). */
  knows(term: string): boolean;
  readonly size: number;
}

export function createSearcher(chunks: readonly CorpusChunk[]): Searcher {
  const tfs: Map<string, number>[] = [];
  const lens: number[] = [];
  const df = new Map<string, number>();
  for (const c of chunks) {
    const tf = new Map<string, number>();
    const body = tokenize(c.text);
    for (const t of body) tf.set(t, (tf.get(t) ?? 0) + 1);
    const head = tokenize(c.title);
    for (const t of head) tf.set(t, (tf.get(t) ?? 0) + TITLE_WEIGHT);
    tfs.push(tf);
    lens.push(body.length + head.length * TITLE_WEIGHT);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = chunks.length;
  const avg = lens.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const idf = (t: string) => {
    const d = df.get(t);
    return d ? Math.log(1 + (n - d + 0.5) / (d + 0.5)) : 0;
  };

  let prefixes: Set<string> | null = null;
  const knows = (t: string) => {
    if (df.has(t)) return true;
    if (t.length < 5) return false;
    prefixes ??= new Set([...df.keys()].filter((k) => k.length >= 5).map((k) => k.slice(0, 5)));
    return prefixes.has(t.slice(0, 5));
  };

  return {
    size: n,
    idf,
    knows,
    search(query, k = 6) {
      const q = [...new Set(tokenize(query))];
      if (!q.length) return [];
      const hits: SearchHit[] = [];
      for (let i = 0; i < n; i++) {
        const tf = tfs[i] as Map<string, number>;
        const len = lens[i] as number;
        let score = 0;
        const matched: string[] = [];
        for (const t of q) {
          const f = tf.get(t);
          if (!f) continue;
          matched.push(t);
          score += (idf(t) * (f * (K1 + 1))) / (f + K1 * (1 - B + (B * len) / avg));
        }
        if (score > 0) hits.push({ chunk: chunks[i] as CorpusChunk, score, matched });
      }
      hits.sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id));
      return hits.slice(0, k);
    },
  };
}
