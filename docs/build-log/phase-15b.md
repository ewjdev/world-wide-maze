# Build log: Phase 15b (docent model bake-off: held-out eval, runner, dry run)

- **Agent:** Claude Opus 5.5 (1M context), run as a Claude Code sub-agent in an isolated git worktree
  (branch `worktree-agent-a86df87712f6270a4`), with the `claude-api` skill loaded before any model code.
- **Start / end:** 2026-09-25 ~18:05Z → ~18:50Z.
- **Environment:** macOS 26 (arm64), Node 26.0.0, pnpm 11.5, `@anthropic-ai/sdk` 0.128.

## Instructions received (summary)
Prepare the AI docent's model bake-off for a real run the owner has approved (about $1–2) once the Anthropic key and
the Cloudflare AI Gateway exist; **make no real model calls now** (no keys). Deliverables: a held-out question set
written from the corpus without looking at the Phase 15 tuning outcomes and kept out of retrieval; a
`pnpm docent:bakeoff` runner over a model matrix through the production code path, recording outcome class,
citation correctness, an LLM-judge unsupported-claim flag (`claude-opus-5`, structured JSON, plus a sample for human
review), TTFT, total latency, tokens and cost from one price file; concurrency-limited, resumable, writing
`results.jsonl`, `report.md` and `report.html` with a recommendation rule (cheapest config with zero unsupported
claims on held-out and p50 TTFT ≤ 1.5 s); a dry-run mode with a mock provider and fake latency; unit tests for the
scoring and cost maths; an up-front estimate and `--yes` before a real run; the owner's command documented. Owns
`tools/docent-index/**`, `providers.ts`/`config.ts` if per-model parameters need it, and this log. No push.

## What was built
**Held-out set** `tools/docent-index/eval-heldout.json` (20 items): 12 answerable (tricky specifics about the 2013
credits and dates, the builder's algorithm and rules, the rebuild's own measurements, and which model and tool did the
work), 5 the corpus does not cover (plausible questions about money, individual roles, audience size, shutdown and
the phone code), 2 injection attempts and 1 off-topic. A new optional `accept` field lets an injection count as
correct when it is either answered or rejected. `tools/` is outside the index roots; a test checks that no corpus
chunk contains a held-out question and that every expected source exists in the index. This log refers to items by
id only.

**Per-model request parameters** (`apps/worker/src/docent/providers.ts`, `config.ts`). Checked against the skill's
thinking/effort table:
- `claude-haiku-4-5`: takes no `effort` (a 400), and omitting `thinking` means no thinking.
- `claude-sonnet-5` and `claude-opus-5`: omitting `thinking` runs adaptive thinking; depth is set with
  `output_config.effort`.
- `claude-opus-5-5`: thinking can't be disabled (`{type: "disabled"}` is a 400), so effort is the only control, and
  its default is `medium`.
- None of the four accepts `temperature` on the new models, and the docent never sends it or `thinking`.

`modelParams(model, effort)` adds `output_config.effort` only where it is accepted. The Worker reads a new optional
`DOCENT_EFFORT` var. `usage` now also carries cache and thinking tokens, and an opt-in `skipCache` sends
`cf-aig-skip-cache: true` (the header name was checked in the AI Gateway docs). Thinking tokens count against
`max_tokens`, so the bake-off uses the production cap of 1024.

**Runner** `pnpm docent:bakeoff` (`tools/docent-index/src/bakeoff/`, `src/cli/bakeoff.ts`):
- Each question goes through `prepareDocent` → `answerDocent`, the Worker's own pipeline (sanitiser, BM25, topic
  check, prompt, streamed grounding gate).
- The provider is built from the same settings path as the Worker (`docentSettings` with
  `DOCENT_MODEL`/`DOCENT_EFFORT`, then `gatewayProvider`).
- Timing is measured in-process: TTFT is the first model text token, and "first visible" is when the grounding gate
  opens. Both exclude the Worker hop, KV and the limiter.
- Cost is `usage` × `bakeoff.config.json` prices. That one file holds the matrix, prices, judge, spend cap, rule
  and estimate assumptions.
- Outcome classes: an answer that says the sources don't cover it is a "don't know" even when it adds one cited
  sentence. The engine's own `answered` would hide that.

**Judge** (`judge.ts`): `claude-opus-5` through the same gateway, `output_config.format` JSON schema, effort medium.
- The answer is pre-split into numbered sentences. For each one the judge returns factual / supported /
  cited-excerpt-supports / note, and the counts are computed locally.
- "Supported" means the excerpts the docent was given state it or directly entail it. The judge's own knowledge
  doesn't count, and partial support counts as unsupported.
- The excerpts+question prefix is identical across configs, so it carries `cache_control`. The first judgment of a
  question writes the cache and the others wait for it, then read it at 0.1×.
- There is no refusal fallback: a judgment from another model would silently change the judge, so a refusal is
  recorded as a judge error and redone on `--resume`.
- `judge-sample.md` lists every flagged answer plus a seeded random sample for a human to check the judge.

**Recommendation rule:** the cheapest config (mean answer cost per model call) with zero held-out answers containing
unsupported claims, every held-out answer judged, all questions run without errors (a capped or interrupted config is
"incomplete"), and p50 TTFT ≤ 1.5 s.

**Safety:**
- `--real` alone prints the estimate and exits.
- `--yes` runs, but refuses when the estimate is above `--max-cost` (default $2).
- The runner stops starting new calls once recorded spend reaches the cap.
- `results.jsonl` is append-only and the last line per key wins. `--resume` skips finished answers and re-judges
  failed judgments without asking the model again.
- Output goes to `tools/docent-index/bakeoff/` (gitignored).

**Dry run** (default, no flags): the offline mock answer, delayed by a fake per-model latency profile, with synthetic
token counts and occasionally a clearly labelled synthetic uncited sentence (so the judge and the rule have
something to catch), judged by a mechanical stand-in. Every report says DRY RUN.

## Up-front estimate for the real run
From the exact prompts (retrieval and the topic check are local, so which questions reach the model and their
prompt sizes are known). Assumptions: 4 characters per token, ×1.3 for every model but Haiku, fixed output sizes per
config, and every question that reaches the model gets a judged answer. These are deliberately pessimistic.

| Run | Estimate |
|---|---|
| Full matrix, both sets (46 questions, 40 reach the model per config), judge on held-out | **$5.70** (answers $3.87, judge $1.83) |
| Full matrix, held-out only | $3.47 |
| Held-out only, `haiku-4-5,sonnet-5,opus-5-5@low` | **$1.94** |
| Held-out only, no judge (the rule can't be applied then) | $1.64 |

**The full matrix as briefed does not fit the approved $1–2.** The default cap refuses it; the documented options
are the $1.94 subset, or raising `--max-cost` knowingly. Output tokens dominate the judge's cost.

## Attempts that failed, and why
1. The first estimate put the judge at $4.54: one uncached ~4.7k-token prompt per answer, with the judge echoing
   every sentence back. The fix was to number the sentences locally (the judge returns verdicts only) and cache the
   shared excerpt prefix across configs, which brought it to $1.83.
2. The first dry run stopped at the $2 spend cap on synthetic costs and still recommended a config. Now there is no
   cap in dry runs unless asked for, and the rule marks configs with missing questions as incomplete.
3. With `--judge none`, zero judged answers counted as "zero unsupported". Answers outside the judge's scope now
   count as unjudged, which fails the rule.
4. Adding this log to the corpus made a Phase 15 engine test fail: a suggested question from the Japanese panel
   was no longer answered by the mock. The panel appends a Japanese answer-language hint to the English question.
   Its CJK bigrams are rare in the English corpus, so they pull the one Phase 15 build-log chunk that quotes the
   hint to the top, and the right chunk sat exactly on the 0.35 relative-score floor. At `HEAD` it scored 17.4
   against a floor of 17.395. Any new corpus chunk raises the IDFs enough to push it under, so the next build log
   would have broken it anyway. **Cross-ownership fix** (Phase 15's `apps/worker/src/docent/retrieve.ts`, flagged
   for the orchestrator): `searchText()` drops a trailing parenthesised Japanese note from the *search* query when
   the rest has Latin letters. The model still receives the full question. A test in `bakeoff.test.ts` covers it.
5. The first `.gitignore` entry (`bakeoff/`) also hid `src/bakeoff/`. It is now anchored (`/bakeoff/`).

## Manual human interventions
None.

## Test evidence
- `tools/docent-index/test/bakeoff.test.ts` (20):
  - the retrieval language-hint fix;
  - held-out shape, no overlap with `eval.json`, kept out of the corpus, sources exist;
  - config prices;
  - `modelParams` per model;
  - a fake-fetch gateway request (effort present for Opus 5.5, absent for Haiku; no `thinking`/`temperature`;
    skip-cache header; thinking tokens parsed);
  - cost maths incl. cache; estimate maths incl. the cached judge prefix;
  - outcome classes, percentile, JSONL last-wins;
  - aggregation and every branch of the rule;
  - the judge's marker mapping, prefix/answer split, JSON validation and sentence split;
  - an end-to-end dry run in a temp dir, resume (reuse, re-judge after a judge failure, no duplicate answers),
    report rendering, and the spend cap.
- Dry run of the full matrix (230 answers, about 2 minutes with fake latency) completed and wrote all four report
  files. The mock scores **lower on the held-out set** (16/20 correct outcomes) than on the tuned set (26/26),
  which confirms the Phase 15 note that the original set is optimistic. These are mock numbers, not model
  measurements.
- `pnpm check` green (see hand-off report).

## Remaining defects and follow-ups
- **Not run against real models** (no keys). The request shapes are tested with a fake fetch only. The first real
  step is the smoke test in `infra/README.md` (AI docent, step 5).
- The judge is a model, so read `judge-sample.md` and record disagreements before trusting a pick. Consider a
  second judge pass on flagged answers if they are borderline.
- The Worker's KV answer-cache key includes the model but not `DOCENT_EFFORT` (`routes/docent.ts`, not changed
  here). After changing only the effort, cached answers from the old effort are served until they expire.
- The price table is the skill's cached list (2026-06-24). Check current pricing before a real run.
- TTFT is measured from the owner's machine through the gateway, not from a Worker isolate. Absolute numbers will
  differ from production; the ranking between configs is what the rule uses.
