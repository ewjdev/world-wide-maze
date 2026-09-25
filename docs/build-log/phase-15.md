# Build log: Phase 15 (AI docent: grounded, cited, through Cloudflare AI Gateway)

- **Agent:** Claude Opus 5.5 (1M context), run as a Claude Code sub-agent in an isolated git worktree
  (branch `worktree-agent-a5a09857394ad4ba5`).
- **Start / end:** 2026-09-25 ~16:50Z → ~18:05Z.
- **Environment:** macOS 26 (arm64), Node 26.0.0, pnpm 11.5, wrangler 4.140 (workerd), Vite 8.3, Playwright
  Chromium, `@anthropic-ai/sdk` 0.128.

## Instructions received (summary)
Execute `plans/phase-15-ai-docent.md` against contracts §10.3 (types already in `@wwm/schema` 0.3.0; no schema
changes). Load the `claude-api` skill before model code and the `cloudflare` skill to verify the AI Gateway endpoint
in the docs. **No real keys exist:** build with a mock provider and document how the owner configures the gateway
and secret. No deploy, no Cloudflare resources, no remote wrangler commands, no push. Phases 13, 14 and 16 run in
parallel; Phase 16 owns `apps/web/src/pages/log/**`, so only a minimal mount there. Don't stop other processes (use
other ports). Honesty: the docent must never invent facts about the 2013 team. Use the `impeccable` skill for the
panel.

## What was built
**Corpus index** (`tools/docent-index`, new package `@wwm/docent-index`)
- Chunks `research/**`, `RESEARCH.md`, `docs/reference/**`, `docs/build-log/**` and the `/about` history data
  (`history.ts`, written out with its source labels) into 231 chunks of ≈ 160–600 tokens (median ≈ 400), split at
  headings, small sections merged, long ones split at blank lines. Title, path, GitHub-style anchor, and a site link
  where the site renders the source (`/log#phase-XX`, `/about#credits`…, fidelity spec → `/about#fidelity`).
  `reference/` is excluded by construction and by a test.
- BM25 (k1 1.2, b 0.75, headings ×3) with a small tokenizer (stopwords, light stemming, CJK bigrams). The Worker
  bundles `apps/worker/src/docent/corpus.json` (420 KB) and builds the searcher once per isolate.
- `pnpm docent:index` rebuilds it; a test fails while it is stale. `pnpm docent:eval` runs the eval.

**Worker** (`apps/worker/src/docent/**`, `src/routes/docent.ts`, one registration line in `router.ts`)
- `POST /api/docent` → SSE `delta`… `citations` `done` | `error` (same framing as the build-job stream).
- **Guardrails:** injection clauses ("ignore previous instructions", "reveal your system prompt", role-play, tag
  smuggling, Japanese variants), code fences, markup and bidi/control characters are removed from the question
  before it is searched or sent. Off-topic questions (no project word and no strong retrieval match) get
  `QUESTION_REJECTED` before any budget is spent.
- **Prompt:** fixed system prompt; excerpts `S1`…`S6` and the question go in the last user turn inside
  `<excerpts>`/`<question>` and are declared data. Rules: only the excerpts, cite `[Sn]` per sentence, exactly
  "The sources don’t cover that." otherwise, never guess about the 2013 team, keep evidenced/reconstructed/new and
  secondary testimony distinct, no claims that AI made the work faster or cheaper.
- **Grounding gate:** markers are renumbered `[1]`, `[2]`… while streaming (split markers across deltas handled,
  unknown ids dropped), and **no text leaves the Worker until the answer cites a real excerpt or says it doesn't
  know**. An answer that ends uncited, or a `refusal`, is replaced by the "don't know" sentence; since nothing was
  shown yet, no unsupported text ever reaches the visitor.
- **Provider:** Claude through Cloudflare AI Gateway's Anthropic endpoint
  `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic` (verified in the AI Gateway docs), with
  the official Anthropic SDK (`messages.stream`), `x-api-key` from the `ANTHROPIC_API_KEY` secret and
  `cf-aig-authorization` from `AI_GATEWAY_TOKEN`; with only the gateway token (keys stored in the gateway), the
  SDK is told to omit `x-api-key`, as the docs require. Default model `claude-haiku-4-5` (the brief asks for a fast,
  inexpensive answer model; `DOCENT_MODEL` overrides it and the request uses no model-specific parameters),
  `max_tokens` 600 (capped 1024).
- **Mock provider:** no network. Quotes the best-matching sentences of the top excerpts with citations, prefixed
  "Offline mode (no AI model is connected)…", or "don't know" when a content word appears nowhere in the corpus or
  coverage is under half. Used in dev and tests; deployed environments without gateway config answer
  `DOCENT_UNAVAILABLE` instead (fail closed).
- **Cost and abuse:** KV answer cache by normalised question (no-history requests; key includes the index hash and
  model); per-IP 20 model calls/hour and a global 500 per rolling 24 h through the existing `Limiter` DO (cache hits
  and rejections don't count), friendly `RATE_LIMITED` / `DOCENT_UNAVAILABLE` messages; kill switch KV
  `kill:docent`; one `docent answer` log line per answer with provider, model, outcome, stop reason, input/output
  tokens, excerpt/citation counts, latency (no question text, no IP).
- Config vars added to `wrangler.jsonc` (top level, staging, production); the generated `Env` was **not**
  regenerated (a local `DocentVars` interface types them) to avoid a merge conflict with Phase 14.

**Web** (`apps/web/src/docent/**`; one import + one element in `AboutPage.tsx` and `LogPage.tsx`)
- `<DocentPanel/>`: section variant on `/about` (before Sources, anchor `#ask`), compact variant under the `/log`
  header. Catalogue voice: suggested questions as index entries, serif answers at reading measure, citations as
  small teal chips linking to numbered footnote sources (site sections via the router, GitHub when `VITE_REPO_URL`
  is set, else the path). One authored motion: the ball rolling along a rule while the docent reads (static under
  reduced motion). States: idle, streaming, answered, don't know, rejected (suggestions shown again), rate limited,
  unavailable, network error with retry, stopped.
- Accessibility: labelled form, Enter asks / Shift+Enter newline / Escape stops, `aria-busy` on the streaming
  answer and one polite status announcement per finished answer (not per word), visible focus, the error marker is
  a shape plus text.
- English and Japanese strings. The corpus is English, so the Japanese suggestions send the English question plus
  "(日本語で答えてください)"; the real model then answers in Japanese, the mock answers in English.

**Docs:** `infra/README.md` "AI docent" (gateway, token, secrets, BYOK alternative, budget knobs, how to verify,
real-model eval), `apps/worker/README.md`, `apps/worker/.dev.vars.example`, `tools/docent-index/README.md`.

## Attempts that failed, and why
1. `node` could not run the eval CLI: Node's type stripping rejects TypeScript parameter properties
   (`constructor(private readonly …)`) in `grounding.ts`. Rewritten as plain fields.
2. A regex with literal `​`/` ` escapes came out of the file-writing tool as the raw characters, and
   U+2028 ended the regex literal. The character class is now built from code points at runtime.
3. Mock answers for "Who made the original?" were "don't know": every word in it was in the mock's list of generic
   words. Falls back to all words when none are specific.
4. `sentences()` stripped underscores, so `stage_builder` became `stagebuilder` and matched nothing.
5. Duplicate chunk ids for logs with a second `# ` heading (`phase-12.md` has "12b"): later H1s now get anchors and
   ids are de-duplicated.
6. The "don't know" rule for unknown words was too strict for morphology ("promoted" vs the corpus's
   "promotional"); `knows()` now also accepts a shared five-letter prefix. It was also triggered by the Japanese
   instruction on the Japanese suggestions, so CJK tokens no longer count when a question has Latin words.
7. Screenshots: the first "streaming" shot showed a finished answer, because the local KV cache replayed it
   instantly (with an answer from before a mock fix). My own worktree's local KV/DO state was cleared and the
   Worker run with a slower mock stream for the shots. The citation chips also opened up the line spacing
   (`vertical-align` offset); now offset with relative positioning.
8. `impeccable` detector flagged a `padding-left` transition on the suggestions; replaced by a transform on the
   ball-dot.
9. The Phase 12 room flood test (`room.test.ts`, "a flood beyond the token bucket is dropped") failed in 3 of 5
   full `pnpm test` runs with this phase's workerd integration test in the suite, and 0 of 3 without it. It sends
   500 frames and expects fewer than 400 relayed, but the bucket refills at 150/s, so any CPU contention (here a
   second Worker being bundled in parallel) lets more through. Not this phase's file; reported to the orchestrator
   with a suggested fix. The final `pnpm check` run was green.
10. Adding this log to the corpus flipped one eval item (`inj-tags`, which should get "don't know"): the mock
    quoted two unrelated passages, because it measured coverage across the top two excerpts combined and the
    re-ranked excerpts together matched two of its three content words. Coverage must now be met within a single
    excerpt. A first draft of this entry quoted the item's question, which put its words into the corpus and made
    the mock "answer" it from this very log; the entry now names eval items by id only. Build logs that describe
    the eval must not quote its questions.

## Manual human interventions
None.

## Test evidence
- `pnpm check`: typecheck + lint green; tests **773 passed**, 13 skipped (57 files) on the final run (see item 9
  above for the flaky Phase 12 test).
- `apps/worker/test/docent.test.ts` (26): injection stripping, cache-key normalisation, topic rejection;
  citation gate (split markers, lists, unknown ids, nothing emitted before a citation, don't-know opens the gate,
  partial marker dropped, `[Saqoosha]` isn't a marker); engine event order, don't-know, rejection without a model
  call, ungrounded answer replaced, refusal, `max_tokens` ellipsis, sanitised question inside `<question>`,
  history shaping, follow-up retrieval; **AI Gateway request shape with a fake fetch** (URL
  `…/v1/acct123/wwm-docent/anthropic/v1/messages`, `x-api-key`, `cf-aig-authorization`, `anthropic-version`,
  body, token usage) and the BYOK variant without `x-api-key`; config modes; SSE framing; the eval set against the
  mock as a regression guard.
- `apps/worker/test/docent.integration.test.ts` (6, real Worker in workerd, mock provider): **mock-mode E2E**
  (streamed deltas → citations → done, SSE + security headers), KV cache hit on a re-worded question, rejection and
  400, per-IP limit → 429 `RATE_LIMITED` with `Retry-After`, daily cap → 503 `DOCENT_UNAVAILABLE`, kill switch.
- `tools/docent-index/test/index.test.ts` (14): tokenizer, chunk sizes and anchors, corpus coverage without
  `reference/`, index freshness, BM25 sanity, eval set shape and scoring.
- `apps/web/test/docent.test.tsx` (5): SSE parsing across arbitrary byte chunks, error bodies with 429 status,
  non-SSE failure, citation links, `/about` and `/log` render the panel, en/ja strings.
- Manual: `wrangler dev` on :8811 + Vite on :5191 (5173/8787 left alone), `curl` of `/api/docent` and the panel in
  Chromium.
- **Eval (mock provider)**, `pnpm docent:eval` (`docs/build-log/assets/phase-15/eval-mock.json`), 26 questions:
  outcome accuracy 100% (answer 17/17, don't know 6/6, rejected 3/3), citation accuracy 88% (15/17 answers cite
  an expected source; the misses are "awards", where the mock quotes the source list, and "physics engine", where
  BM25 ranks a build-log chunk first), citation precision 79%, retrieval recall@6 100%, injection 3/3 handled and 0
  leaked. The set was written while tuning, so these numbers are optimistic. **Not run against the real model**
  (no keys).
- Screenshots (reviewed): `docs/build-log/assets/phase-15/docent-{idle,streaming,answer,dont-know,rejected,
  rate-limited,network-error,log-compact,mobile,ja-idle,ja-answer}.png`.
- Worker bundle (local `wrangler deploy --dry-run`): 13,187 KiB, 4,023 KiB gzipped (Phase 10 recorded 12.1 MB /
  3.7 MB): the corpus and the SDK add about 0.3 MB gzipped, still within the Workers Paid limit.

## Remaining defects and follow-ups
- Not verified against Claude through a real gateway (no keys). The request shape is tested with a fake fetch;
  the owner's first real run is `pnpm docent:eval --real` (infra/README.md).
- Retrieval is English and lexical: free-typed Japanese questions mostly get "don't know". Follow-up: translate or
  expand the query (one cheap model call), or Workers AI embeddings if the eval shows misses BM25 can't fix.
- The mock is a stand-in: it quotes, it doesn't summarise, and it answers in English.
- The index must be regenerated whenever a build log or research note changes (`pnpm docent:index`); the deploy
  workflow could run it (or the `--check`) before deploying.
- History sent back by the client is trusted as conversation context (it is capped, user turns are sanitised, and
  every answer must still cite current excerpts); follow-up answers are not cached.
- `check-deploy-config.mjs` could refuse `DOCENT_PROVIDER=mock` in production (Phase 12 file, not changed).

# Phase 15c (grounding)

- **Agent:** Claude Opus 5.5 (1M context), a Claude Code sub-agent in an isolated git worktree, branch
  `fix/docent-grounding` (PR against `main`, not merged: merging deploys production, which is the owner's call).
- **Date:** 2026-09-25, about 21:55Z to 23:00Z.

## Instructions received (summary)
The live docent (production, `claude-haiku-4-5` through AI Gateway) got two of three spot checks wrong, recorded here
by eval id. For `g-live-2013-builder` it said the sources don't cover the 2013 stage builder, although `RESEARCH.md`
Part 1.3 and `research/world-wide-maze.md` do: retrieval ranked the rebuild's Phase 03 build log above them. For
`g-live-ai-agents` it described never-built items from the `RESEARCH.md` Part 5 plan as things the rebuild does, and
understated the agents' role. The model repeated what it was given; the corpus mixed plans with records of what was
built, without labels. `g-live-who-made` was answered well. Fix this at the corpus, retrieval and prompt level
without special-casing questions: label every chunk's provenance, add a maintained "what exists today" source,
favour history chunks for 2013 questions, extend the eval with these and similar traps plus a "plan presented as
fact" check, verify on the PR Preview (at most 15 model calls), and don't merge.

## What was built
- **Provenance on every chunk** (`tools/docent-index/src/kinds.ts`, `CorpusChunk.kind`; index format 2):
  - `history`: 2013 evidence (research notes, `RESEARCH.md` Part 1 and Sources, the 2013 evidence notes in
    `docs/reference/`, the `/about` data).
  - `plan`: `RESEARCH.md` goal and Parts 2–8, `research/recreation-plan.md`, `contract-deltas.md`, `plans/**`.
  - `build-log`: `docs/build-log/**`.
  - `status`: the new `docs/facts/whats-built.md`.
  - `reference`: the fidelity spec.
  Small sections of different kinds are never merged into one chunk (before, `RESEARCH.md`'s goal statement and
  Part 1 shared a chunk). Result: 319 chunks (with this log), of which 53 are history, 31 plan, 220 build-log, 4 status and 11
  reference.
- **Headings in chunk titles:** a title is now `Document › Part › Section`, plus the headings of merged sections and,
  for split pieces, bold pseudo-headings. Before, the 2013 builder steps were titled "1.3 How it was built
  (continued)", and "The original engineering, condensed" was merged into "What playing involved" without its
  heading. Title words count three times in BM25.
- **"What exists today"** (`docs/facts/whats-built.md`, a new corpus root) covers:
  - the features in the live site, phase by phase;
  - what is planned but not built: the AI Remix phase, AI theming, naming, music, difficulty and moderation, the
    vision fallbacks and commentary;
  - how AI was used: agents wrote the code, tests and logs under an orchestrating session, with the owner directing,
    approving and doing the physical phone test;
  - that the docent is the only runtime model call;
  - the build-story numbers, cited from `content/build-story/timeline.json`. A test checks every number against
    that file and that the page quotes no eval question.
- **Retrieval** (`apps/worker/src/docent/retrieve.ts`): 60 BM25 candidates, re-weighted by `intentWeights(question)`,
  then the top 12. For 2013 intent (2013, original, Saqoosha, PARTY, case study…): history ×1.6, build logs ×0.7,
  plans ×0.6. For rebuild intent (rebuild, tribute, AI, agents, "is there"…): status ×1.6, build logs ×1.2, plans
  ×0.6. When both apply, the weights are in between. Plans are neutral only when the question asks about plans.
- **Prompt** (`prompt.ts`, `PROMPT_VERSION` 2, now part of the answer-cache key): every excerpt header carries
  `kind` and a one-line `note`, e.g. `kind="plan" note="a plan or proposal; it may never have been built"`. A new
  rule says:
  - plans state intentions, never facts, and only build-log, status and reference excerpts establish what exists;
  - if only plans mention something, say it was planned;
  - answer 2013 questions from history;
  - describe the roles of AI and people as the sources state them, without softening or inflating either.
- **Eval:** 10 `grounding` items in `eval.json`: the three live questions, four plan-versus-built traps, the runtime
  model, and two 2013 builder specifics. Each has expected source `kinds` and an expected `answer`. `s3-ai-role` now
  expects the status page or build logs instead of the plans. Scoring changes:
  - it resolves every citation's kind;
  - it reports **source kind** accuracy;
  - it flags **plan as fact**: a sentence whose citations are all `plan` chunks and which doesn't say planned,
    proposed or not built.
  `pnpm docent:eval` gained `--set` and `--only`, and the Worker's regression test now also requires kind accuracy
  ≥ 90% and zero plan-as-fact answers.

## Attempts that failed, and why
1. The sandbox refused shell heredocs and some one-liners that write files, so edits went through the file tools.
2. The first retrieval test demanded no plan chunk anywhere in the top 6 for a rebuild question. Without the
   Worker's query expansion one Part 5 chunk still lands at rank 4–6, which is harmless now that it is labelled.
   The test now checks that the top 3 contain no plans and that a status chunk ranks first.

## Manual human interventions
None.

## Test evidence
- Mock eval (`pnpm docent:eval`), 36 items: outcome 100% (answer 27/27, don't know 6/6, rejected 3/3), citation
  accuracy 96%, precision 85%, retrieval recall@6 100%, injection 3/3 with 0 leaked, source kind 100%, plan as fact
  0. Before (26 items): outcome 100%, citation 88%, precision 79%.
- Retrieval before and after, for the grounding items (top 6):
  - `g-live-2013-builder`: before, Phase 03 build logs ranked first and second, with a plan chunk fourth and no
    Part 1.3 chunk. After, all six are history, including the chunk with the builder steps.
  - `g-live-ai-agents` / `s3-ai-role`: before, the Part 5 plan was second. After, the two status chunks come first,
    then build logs, with no plans.
  - `g-ai-theming`: before, Parts 3 and 5 were in the top 6. After, the status summary is first and there are no
    plans.
  - `g-ai-remix`: before, the recreation plan was second. After, the status summary is first.
- Held-out set with the mock (never tuned against), before → after:
  - outcomes 16/20 → 15/20; citation accuracy 77% → 69%; recall@6 92% → 92%.
  - `ho-nagle` loses its answer. Before, the mock answered it from the rebuild's own iPhone test log (a 2026
    measurement, cited for a 2013 question); now history outranks that log, and the history chunk that covers it
    uses different words than the question.
  - `ho-attempts` cites the `RESEARCH.md` Part 1 overview instead of the bundle notes; the bundle notes are still
    retrieved third.
  - `ho-time-limit` now cites the right sources.
  These are the mock's quoting heuristics; the real model reads all six excerpts.
- Live answers before, and the Preview answers after: `docs/build-log/assets/phase-15c/live-check.md`.
- Tests: `tools/docent-index/test/provenance.test.ts` (11): kinds by path and part, no merging across kinds,
  headings and pseudo-headings in titles, intent weights and ranking, the plan-as-fact rule (markers before and
  after the full stop, hedged and mixed sentences), kind scoring, and the status page's numbers against the
  timeline. `apps/worker/test/docent.test.ts`: the excerpt header shows the kind, and the prompt has the plan rule.
  `pnpm check` green.

## Remaining defects and follow-ups
- `docs/facts/whats-built.md` is hand-maintained. The test pins its numbers to the build story, but its feature
  list must be updated when a phase merges or is dropped. It could be generated from the status board once the
  board records merges in a machine-readable form.
- The plan-as-fact check is lexical: it catches plan-only citations without hedging words, not a plan paraphrased
  under a build-log citation. The bake-off's LLM judge could add a "cites a plan as fact" verdict.
- Intent detection is a word list (English, plus a few Japanese words). A free-typed Japanese question falls back to
  neutral weights, where plans are still down-weighted to 0.8.
- Build logs' own "follow-ups" sections are proposals too, but they are labelled `build-log`. The prompt's rule
  covers them only through their wording.
