/** One retrievable section of the corpus (about 300–600 tokens). */
export interface CorpusChunk {
  /** Stable id: `<path>#<anchor>` plus `~n` when a long section is split. */
  id: string;
  /** "Document title › Section heading". */
  title: string;
  /** Repo-relative source path, e.g. `docs/build-log/phase-10.md`. */
  path: string;
  /** GitHub-style heading slug inside `path`, when the chunk starts at a heading. */
  anchor?: string;
  /** Site link, when the source is rendered on the site (e.g. `/log#phase-10`, `/about#credits`). */
  url?: string;
  /** Plain text (markdown kept as written; the model reads it). */
  text: string;
}

export interface CorpusIndex {
  /** Bumped when the chunk format or tokenizer changes (part of the answer-cache key). */
  format: number;
  /** sha-256 over the chunk ids and texts: identifies this corpus build (answer-cache key). */
  hash: string;
  /** Repo-relative files the index was built from. */
  files: string[];
  chunks: CorpusChunk[];
}

export interface SearchHit {
  chunk: CorpusChunk;
  score: number;
  /** Distinct query terms found in the chunk. */
  matched: string[];
}
