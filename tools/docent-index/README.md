# @wwm/docent-index

The AI docent's corpus (Phase 15, contracts §10.3): chunking, the BM25 index bundled into the Worker, and the
docent eval set and runner. The docent itself lives in `apps/worker/src/docent/` and `apps/web/src/docent/`.

## Corpus
`research/**`, `RESEARCH.md`, `docs/reference/**`, `docs/build-log/**` and the `/about` history data
(`apps/web/src/pages/about/history.ts`). **Never `reference/`** (third-party 2013 material). Markdown is split at
headings into chunks of about 300–600 tokens (≈ 4 characters per token): small neighbouring sections are merged,
long ones split at blank lines. Each chunk keeps its title (`Document › Section`), path, GitHub-style anchor and,
where the site renders it, a site link (`/log#phase-10`, `/about#credits`, `/about#fidelity`).

## Commands
- `pnpm docent:index` rebuilds `apps/worker/src/docent/corpus.json` (commit it). **Run it after any change to a
  build log, research note or the history data**; a test fails while the committed index is stale.
  `node tools/docent-index/src/cli/build.ts --check` only checks.
- `pnpm docent:eval` runs `eval.json` against the docent in-process with the **mock** provider.
  - `--real` uses Claude through AI Gateway; needs `AI_GATEWAY_ACCOUNT_ID`, `AI_GATEWAY_ID` and `ANTHROPIC_API_KEY`
    and/or `AI_GATEWAY_TOKEN` in the environment (`DOCENT_MODEL` optional). Spends ~26 short model calls.
  - `--url http://localhost:8787` runs it over HTTP against a running Worker.
  - `--out <file>` writes the JSON report; `--min-outcome 0.9 --min-citation 0.8` exit non-zero below thresholds
    (a prompt leak always fails).
- `node tools/docent-index/src/cli/shots.ts http://127.0.0.1:5173` screenshots the panel into
  `docs/build-log/assets/phase-15/` (web + Worker running).

## API (`src/index.ts`, runtime-safe: no Node APIs)
- `tokenize(text)`, `terms(text)`, `stem(word)`: lowercase, stopwords, light stemming, CJK bigrams.
- `createSearcher(chunks)` → `{ search(query, k), idf(term), knows(term) }` (BM25, headings weighted ×3).
- `chunkMarkdown(md, {path, url?})`, `splitText`, `slugify`, `approxTokens`.
- Eval scoring: `scoreItem`, `summarize`, `formatReport`, `matchesSource`; types `EvalSet`, `Observed`.

## Eval set (`eval.json`)
26 questions: the panel's 4 suggested questions, 12 more answerable ones, 5 the corpus doesn't cover, 3
prompt-injection attempts (expecting a rejection, a cited answer to the legitimate part, and "don't know"), and 2
off-topic. Each answerable item lists
acceptable sources (`path`, `path#anchor`, or a `dir/` prefix). Metrics: outcome accuracy, citation accuracy (an
answer cites an expected source), citation precision, retrieval recall@6, injection handled/leaked.

The set was written while tuning retrieval and the mock, so mock scores are optimistic; treat new questions as the
real test. **Don't quote eval questions in corpus files** (build logs included): that puts their words in the
corpus and the "don't know" items stop testing anything. Refer to items by id.
