# Phase 31 M4: the operator-only lesson authoring agent

**Date:** October 19, 2026 (America/Los_Angeles), about 22:45 to 23:55.
**Agent:** Claude Code (Claude Opus 5.5) as a phase sub-agent in its own git worktree (`claude/p31-m4-lesson-drafts`), working in parallel with M2 and M3.
**Plan:** [plans/phase-31-lesson-depth-and-tracking.md](../../plans/phase-31-lesson-depth-and-tracking.md) §8; contracts §10.5 CCR-31-4.

## Key instructions
- Port the fx0/libfx "durable design agent" pattern to Cloudflare: an Agents SDK Durable Object per draft, a `LESSON_DRAFT` Workflow (generate, validate, repair at most twice, ready for review) through AI Gateway, operator endpoints under `/api/admin/lessons/*` behind Access, and a "Lesson drafts" view in the admin workbench.
- Scope from the M0 spike: open-vocabulary bank items only, starting with English missing-letter spelling. Pass the bank so far as an exclusion list, use a reviewed word list, flag distractors that spell real words.
- Nothing reaches a child until an operator approves, the export is imported with a CLI, committed and deployed. Model output is untrusted.
- Mark which steps are safe to re-run and which are billed; a retried Workflow must not pay twice.
- One optional real smoke test through AI Gateway (at most three calls), only with existing credentials.

## What changed (N: new, not a 2013 feature)
- **Reviewed vocabulary (N):** `packages/learning/src/vocabulary.ts`, 68 consonant-vowel-consonant words for ages 4–5 with a one-line meaning each, `reviewStatus: 'needs-owner-review'`. The spike's spelling checks are now reusable (`spellingIssues`, `spellingFlags`, `spellingBankRound`); the word must be on the list, and a distractor that completes a common word is flagged for review. The spike uses them too.
- **Reviewed banks (N):** `reviewed-banks.ts` holds the export format (`wwm-learning-bank/1`), `AUTHORING_OBJECTIVES`, `reviewedBankReport()` and the workbench wire types. `src/banks/index.ts` lists imported bank files; `baseline.ts` merges them in one line. No bank is imported yet.
- **Import CLI (N):** `pnpm learning:bank import|check <file>` (`tools/lesson-draft/src/bank.ts`). Validates against the baseline, writes `banks/<objective>.json`, regenerates the registry and formats both with Biome. Idempotent.
- **Agent and Workflow (N):** `apps/worker/src/lesson-drafts/`.
  - `LessonDraftAgent` (Agents SDK `Agent`, not `AIChatAgent`: the transcript is plain text and the Anthropic SDK call goes through the docent's gateway pattern, so the AI SDK isn't needed). SQLite holds the draft, transcript and revisions by content hash; the `draft-index` instance lists drafts.
  - `LessonDraftWorkflow` runs `pipeline.ts`: `context` → `generate` (billed, run once) → `validate-0` → `repair-1/2` (billed, run once) with `validate-1/2` → `assemble` → `save-revision` → `ready-for-review`. Validation is a pure function of the stored replies, so a resumed instance reaches the same verdicts.
  - Routes under the admin router: list, create, read, message (with drops), revision, preview, review, export. `LESSON_DRAFTS` gates them; a daily cap applies to gateway turns.
  - Previews render through `portablePage()` (`@wwm/education` now exports `./render`) with a no-script, sandboxed CSP.
- **Admin UI (N):** `apps/web/src/admin/LessonDrafts.tsx` and `lesson-drafts.css`, one tab in `AdminPage.tsx`. Drafts list, new-draft form, chat with drop checkboxes, revision picker, issues, reviewer flags, per-item verdicts and spoken lines, a sandboxed preview frame, approve/reject with a note and flag acknowledgement, export link with the import command.
- **Wiring:** `wrangler.jsonc` adds `LESSON_DRAFT_AGENT` (migration `v5`), the `LESSON_DRAFT` Workflow (`wwm-lesson-draft`; Previews `wwm-lesson-draft-preview`) and five `LESSON_DRAFT*` vars in every environment (`LESSON_DRAFTS` on locally with the mock, off in production and Previews). `worker-configuration.d.ts` regenerated. The deploy guard (`infra/scripts/lib/cloudflare-infra.mjs`) expects the new binding and Workflow and requires `LESSON_DRAFTS=off` in Previews. The solver probe entry exports the new classes because it runs with the production config.
- **Docs:** [docs/education/lesson-drafts.md](../education/lesson-drafts.md), the Worker README section, the tool README.

## Attempts that failed, and why
- `node` couldn't run `bank-import.ts` at first: a TypeScript parameter property isn't supported in strip-only mode. Replaced with a field.
- A registry block inside `reviewed-banks.ts` fought Biome's import organiser (it moves imports out of a marked region). The CLI now regenerates a separate `banks/index.ts`.
- The Workflow first destructured its payload field by field and silently dropped the new `avoid` list, so a dropped word came back in the next turn. The workerd test caught it.
- A test asserted that a second message is refused while the agent works; with the mock, the Workflow finished before the second request. Removed (the records test covers the rule).
- `solver.workerd.test.ts` timed out: it runs the production config with a test entry that didn't export the new classes.
- The in-app preview tool wasn't available to this sub-agent, so the UI was checked with Playwright screenshots against the test-only Worker and Vite (1440×1000 and 390×844, not committed).

## Manual human interventions
None.

## Test evidence
- `pnpm check`: green. Typecheck, Biome (warnings only, none in new code) and Vitest: 163 test files passed and 6 skipped; 1,755 tests passed and 44 skipped (the skips are the browser-driven suites without local Playwright Chromium, as before this change).
- Worker: `lesson-drafts-pipeline` (13: valid output, exclusion list, repair, giving up after two repairs, nothing valid, no re-billing when a run is interrupted before each of six steps, the 24-item cap, the mock), `lesson-drafts-routes` (12: unauthenticated 401 on all eight endpoints, 503 without Access config, 403 cross-site, 404 for three `LESSON_DRAFTS` values, input validation, daily cap, preview and export headers), `lesson-drafts-records` (10: turns, idempotent revisions and summaries, failure, drops, approval rules, index, preview escaping of script and event-handler markup, export → import round trip, tampered export refused), `lesson-drafts.workerd` (1: the real agent and Workflow in workerd from brief to imported export).
- `@wwm/learning` `reviewed-banks.test.ts` (16), `@wwm/lesson-draft` `bank-import.test.ts` (12), web `LessonDrafts.test.tsx` (4).
- The full Worker config boots in workerd; `/agents/*` is 404 and `/api/admin/lessons` is 503 without Access config.
- **Real smoke test** (`pnpm --filter @wwm/lesson-draft draft-smoke`, existing wrangler login, AI Gateway `wwm`): one `claude-sonnet-5-5` call, 2,980 input and 2,704 output tokens. Six items, all valid on the first pass with no reviewer flags: PIG, HEN, FOX, CUP, POT, RUG.

## Remaining defects and follow-ups
- The vocabulary needs the owner's review before any bank built from it is approved.
- The first turn still favours the commonest words (PIG, HEN, FOX again); later turns exclude them.
- Previews bind their own Workflow name; whether per-PR Previews can each define it hasn't been tried (nothing was deployed).
- New lesson drafts (whole activities) and post-approval voice generation are not built.
