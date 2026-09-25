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
- `pnpm docent:bakeoff` runs the **model bake-off** (below). With no flags it is an offline dry run.
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

## Held-out set (`eval-heldout.json`)
20 questions written from the corpus after the Phase 15 tuning, without running the docent on them: 12 answerable
(credits, dates, the 2013 builder and rules, the rebuild's measurements and who did the work), 5 the corpus doesn't
cover, 2 injection attempts and 1 off-topic. `accept` lists other outcomes that also count (an injection may be
rejected outright). **Never tune the prompt, retrieval or mock against it**, and never quote it in corpus files; a
test checks that it is outside the index and that no chunk contains one of its questions.

## Model bake-off (`pnpm docent:bakeoff`)
Runs `eval.json` + `eval-heldout.json` across the matrix in `bakeoff.config.json` (default: `claude-haiku-4-5`;
`claude-sonnet-5`; `claude-opus-5-5` at effort low and medium; `claude-opus-5` at low) through the production engine
(`prepareDocent` → `answerDocent`: sanitising, BM25, topic check, prompt, streamed grounding gate) and the same
gateway provider the Worker builds from `DOCENT_MODEL`/`DOCENT_EFFORT`.

Per answer (`results.jsonl`): outcome class (answered / don't know / rejected / error; an answer that says the
sources don't cover it is a don't-know even with one extra cited sentence), outcome correctness, citation hit and
precision, prompt leak, TTFT (first model text token) and first visible text (after the grounding gate), total
latency, tokens (incl. thinking), cost from `usage` × the price table, and the **judge's verdict**: `claude-opus-5`
with structured output checks every sentence against the excerpts the docent was given (not its own knowledge);
a factual sentence with any unsupported part is unsupported. It also notes cited sentences whose cited excerpt
doesn't back them. The excerpts+question prefix is cached, so the other configs' judgments of the same question
read it at 0.1×. The judge runs on the held-out set by default (`--judge all|none`).

Reports: `report.md` / `report.html` (side-by-side table, per-question grid, recommendation) and `judge-sample.md`
(every flagged answer plus a seeded random sample, for a human to check the judge). **Rule:** the cheapest config
(mean cost per model call) with zero held-out answers containing unsupported claims, every held-out answer judged,
all questions run without errors, and p50 TTFT ≤ 1.5 s.

Safety: `--real` alone prints the up-front estimate and stops; `--yes` runs, but refuses if the estimate is above
`--max-cost` (default $2) and stops starting calls once the recorded spend reaches it. `--resume <dir>` continues
(finished answers are kept; failed judgments are redone without asking again). Commands: `infra/README.md`,
"AI docent" step 5. Code: `src/bakeoff/` (`core.ts` pure maths, `run.ts`, `judge.ts`, `report.ts`, `dry-run.ts`).
