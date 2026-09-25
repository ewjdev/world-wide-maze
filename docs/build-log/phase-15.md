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
