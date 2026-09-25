# Phase 15 — AI Docent (grounded, cited, through Cloudflare AI Gateway)
**Wave:** 5 · **Contracts:** §10.3 · **Label:** N

## Goal
An "Ask about the 2013 original, and how this rebuild was made" panel on `/about` and `/log`. It answers **only** from the project's own research and build record, with citations, and says so when it doesn't know. It's the runtime AI showcase: grounded, honest and cheap.

## Owns
- `apps/worker/src/routes/docent.ts` (+ registration) and `apps/worker/src/docent/**`
- `tools/docent-index/**` (build-time corpus chunking and index)
- `apps/web/src/docent/**` (the panel), plus mounting lines in the about and log pages
- `docs/build-log/phase-15.md`

## Tasks
1. **Corpus index (build time):**
   - Chunk `research/**`, `RESEARCH.md`, `docs/reference/**`, `docs/build-log/**` and the `/about` history data into sections of about 300–600 tokens, with the title, path and anchor.
   - Retrieval is lexical (BM25) over a JSON index bundled into the Worker. Embeddings aren't needed. If Workers AI embeddings are clearly better, propose them as a follow-up.
   - Exclude anything under `reference/` (third-party material).
2. **Model call through Cloudflare AI Gateway:**
   - Load the **`claude-api` skill** first and use its current model IDs and guidance. Choose a fast, cheap model for answers.
   - Call through the AI Gateway endpoint for the Anthropic provider (verify the current URL shape and headers in the Cloudflare AI Gateway docs, and load the `cloudflare` skill).
   - Config: `AI_GATEWAY_ACCOUNT_ID`, `AI_GATEWAY_ID`, and the `ANTHROPIC_API_KEY` secret. If none are set, use a **mock provider** in dev and tests that returns a deterministic answer built from the retrieved chunks.
   - Stream over SSE per §10.3.
3. **Grounding and guardrails:**
   - A system prompt that allows answering only from the provided excerpts, requires citing them by id, and requires saying "the sources don't cover that" otherwise.
   - Strip prompt-injection attempts in the question from the retrieval query.
   - Refuse questions unrelated to the project (`QUESTION_REJECTED`).
   - Post-check that the answer cites at least one retrieved chunk, or else is the "don't know" phrasing.
4. **Cost and abuse:**
   - A KV cache keyed by the normalized question.
   - Per-IP rate limits, and a global daily cap (`DOCENT_DAILY_LIMIT`) returning `DOCENT_UNAVAILABLE` with a friendly message.
   - `max_tokens` bounded.
   - Log token counts.
5. **UI:**
   - A compact chat panel in the showcase design language, with suggested questions: "Who made the original?", "How did the 2013 maze builder work?", "What did AI do in this rebuild?", "What's reconstructed vs evidenced?".
   - Citations link to `/log` sections or GitHub paths.
   - Accessible, with keyboard and screen-reader support. English, plus Japanese UI strings.
6. **Evals:** `tools/docent-index/eval.json` with 20 or more questions, each with expected sources, including 5 that should get "don't know" and 3 injection attempts. A script runs them against the mock, and against the real model when keys exist, and reports citation accuracy.

## Acceptance
- Mock-mode E2E works: ask, get a streamed answer and citations.
- The eval script runs against the mock.
- The docs explain exactly how to set up the AI Gateway and secret (`infra/README.md` section).
- `pnpm check` is green. Screenshots are in `docs/build-log/assets/phase-15/`.
