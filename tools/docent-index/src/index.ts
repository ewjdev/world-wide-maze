/**
 * Runtime-safe exports (no Node APIs): the Worker imports these to search the bundled index. The index build
 * (`src/build.ts`) and the CLIs use `node:fs` and are not exported here.
 */
export { createSearcher, type Searcher } from './bm25.ts';
export { approxTokens, chunkMarkdown, slugify, splitText } from './chunk.ts';
export {
  type EvalItem,
  type EvalSet,
  type EvalSummary,
  type Expect,
  formatReport,
  type ItemScore,
  type KindOf,
  kindResolver,
  matchesSource,
  type Observed,
  planAsFact,
  scoreItem,
  summarize,
} from './eval-core.ts';
export {
  intentWeights,
  KIND_NOTES,
  type KindWeights,
  sourceKind,
  weightHits,
} from './kinds.ts';
export { stem, terms, tokenize } from './tokenize.ts';
export {
  type CorpusChunk,
  type CorpusIndex,
  type SearchHit,
  SOURCE_KINDS,
  type SourceKind,
} from './types.ts';
