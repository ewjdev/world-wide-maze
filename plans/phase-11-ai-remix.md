# Phase 11 — (Optional) AI Remix Mode

**Wave:** 3 · **Depends on:** 09 (validator and solver, and the eval set) · **Status:** optional. Start only after G2, and only if the user opts in.

## Goal
An optional **"AI Remix"** stage mode where a model *interprets* the page (regions, meaning, theme) and **proposes** stage changes, which the deterministic builder, validator and solver then check. The faithful mode stays the default baseline. The result has to be measurably compared against the baseline and must not replace it.

## Read first
- `research/recreation-plan.md` "Where AI belongs" (the recommendation: evaluate against the baseline on a frozen set, and report failures, latency and cost)
- `RESEARCH.md` Part 5 (idea list)
- The **`claude-api` skill** (load it before writing any model code: model IDs, tool use and structured output, prompt caching, vision)
- `plans/contracts.md`

## Owns
`packages/ai/**`, `apps/worker/src/routes/remix.ts`, `fixtures/eval/remix/**`

## Design
- **Input:** the `CaptureBundle` (trimmed: element kinds, rects, short text) plus a downscaled screenshot (vision).
- **Output (strict JSON through tool use and a schema)**, called `RemixProposal`:
  ```ts
  { regions: { elementIds: number[]; role: 'nav'|'hero'|'article'|'sidebar'|'ad'|'comments'|'footer'|'media'|'other' }[];
    emphasis: { elementIds: number[]; weight: number }[];        // raise/keep important content as islands
    levelHints: { elementIds: number[]; level: number }[];       // verticality suggestions
    hazards: { elementIds: number[]; kind: 'crumble'|'bumpy'|'bounce' }[];  // requires contract CR (new Island field)
    title: string; stageNames: string[]; palette?: { ocean: string; sky: string } }
  ```
- **Integration:** the builder gets an optional `hints` input, which needs a Contract Change Request to add `BuildInput.hints?: RemixProposal`. The builder applies the hints as soft weights. The **validator and solver remain the gatekeepers**: a proposal that yields an unplayable stage falls back to the faithful build.
- **Models:** a fast, cheap model for region classification. A stronger vision model (current Claude Sonnet) for theming and naming. Confirm the IDs through the `claude-api` skill. Use prompt caching for the system prompt and schema. The API key is a Worker secret. **Once per stage version, never per play.**
- **Hazards** (crumbling ad islands, etc.) need physics and engine support. Propose them as follow-up tasks for Phases 04 and 05. Don't edit those packages.
- **Safety:** also expose `moderate(screenshot)` for the Phase 07 hook, using a vision model. Flag and block unsafe content.

## Tasks
1. The prompt and schema, with 10 or more hand-labeled examples from the eval set as a test set (`fixtures/eval/remix/labels.json`).
2. `proposeRemix(capture, image) → RemixProposal` with retries, schema validation, timeouts and a cost log (tokens in and out).
3. Contract Change Requests for `BuildInput.hints` and any new stage fields.
4. The `/api/stages?mode=remix` path, cached separately.
5. **Evaluation (required deliverable):**
   - Run the frozen eval set in both baseline and remix modes.
   - Metrics: validity rate, solver success, par time, island count variance, build latency, $ per stage, and model failure rate.
   - Blind human A/B ratings (recognizable? fun?) using the Phase 09 dashboard.
   - Write `docs/build-log/phase-11-eval.md` with honest results, **including where remix is worse**.
6. A UI toggle "Faithful / AI Remix" on the select screen, handed to Phase 08's owner as a small follow-up spec.

## Acceptance criteria
- 100% of remix outputs are either valid and solved or have fallen back cleanly (no user-visible failures).
- The cost per unique stage is measured and reported, with a target under $0.01.
- The evaluation report is complete, with baseline comparison numbers.
- The model and prompt version are recorded in each remix stage's `provenance.notes`.

## Out of scope
Replacing the faithful builder, live per-frame AI, and AI commentary (a possible later idea).
