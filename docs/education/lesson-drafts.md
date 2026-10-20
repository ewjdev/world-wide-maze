# Lesson drafts: the operator-only authoring agent

Phase 31 milestone M4 ([plan §8](../../plans/phase-31-lesson-depth-and-tracking.md), contracts §10.5 CCR-31-4). An operator chats with an agent that writes fresh **bank items** for an open-vocabulary objective, checks every item, approves a revision, and exports it as JSON. The JSON is then imported into the repo, reviewed in git and deployed. Only after that does a child see any of it.

Today one objective is open: English missing-letter spelling (`little-word-builders`). Parametric objectives (counting, comparing, Spanish colours) don't need a model; they have generators ([M0 spike](item-bank-spike/2026-10-19/README.md)).

## The safety boundary

| Layer | What it guarantees |
|---|---|
| **Operator only** | `/api/admin/lessons/*` sits behind the existing Cloudflare Access application and the `ADMIN_EMAILS` allowlist. Without Access configuration it returns 503; without a valid operator token, 401; a cross-site write, 403. The switch `LESSON_DRAFTS` must also be `on`, or every endpoint is 404. |
| **Inert data** | The model's reply is only ever parsed as JSON. Each item must pass `roundSchema`, `roundIssues` and the objective's checks in `@wwm/learning`: a word from the reviewed list, a completed word that matches the spoken word, a worked example that names the letter, freshness against the lesson, the bank so far and earlier drops. Items that fail after two repair turns are left out. |
| **Trusted renderer** | A preview is the revision's items placed into a copy of the baseline and rendered by `portablePage()` (`@wwm/education`), the same renderer as the downloadable lesson. Every string is escaped. The page is served with `default-src 'none'` and `sandbox`, inside a sandboxed frame, so it can't run anything. |
| **Human approval** | Only the latest revision can be approved, only with no blocking issues, only with a note, and only after the operator ticks that they have read every reviewer flag (for example, "distractor also spells a real word"). Approval locks the draft. |
| **Git review** | The export carries the items, the revision hash and the review note, but no operator identity. `pnpm learning:bank import` validates it again against the current baseline and writes `packages/learning/src/banks/<objective>.json`. It reaches children only after a reviewed pull request is merged and deployed. |

The reviewed word list (`packages/learning/src/vocabulary.ts`, 68 three-letter consonant-vowel-consonant words with a one-line meaning each) is marked `needs-owner-review`. The workbench shows that status. Review the list before approving any bank built from it.

## Workflow, end to end

1. **Turn it on.** For local development, `LESSON_DRAFTS` is already `on` and the provider is the offline mock (items built from the word list, labelled "Offline mock"). In production it is `off`; set it to `on` (and keep `LESSON_DRAFT_PROVIDER=auto`) only when you want to author. The model is `LESSON_DRAFT_MODEL` (default `claude-sonnet-5-5`) through AI Gateway `wwm`, using the docent's gateway secrets.
2. **Start a draft.** Admin → **Lesson drafts** → *Start a new draft*. Pick the objective, write a short brief ("animals and things in the kitchen; vary the blank position") and the number of new items (1–12).
3. **Read the agent's turn.** Each message starts one `LESSON_DRAFT` Workflow instance: generate → validate → repair (at most twice) → save the revision → ready for review. The agent's chat reply is a plain summary written by the pipeline, not by the model: how many items passed, which failed, the bank size and the number of reviewer flags.
4. **Check the revision.** Each item shows *Added*, *Valid, not added* (the bank is at 24 items) or *Failed*, with its issues, its flags and "What Pip says" (the spoken lines from `activityScript`). Open *Preview as a lesson page* to see it as a child's page would draw it.
5. **Iterate.** Send another message ("six more, blank at the start"). Tick items under *Drop from the next revision* to remove them; dropped words are excluded from later turns too. Every revision keeps its content hash, so you can go back and read any of them.
6. **Approve or reject.** Write a note. If there are reviewer flags, confirm you've read them. Approve locks the draft; reject closes it.
7. **Export.** *Export the approved bank (JSON)* downloads `<objective>.json`.
8. **Import.** In the repo:
   ```sh
   pnpm learning:bank check ~/Downloads/little-word-builders.json   # optional dry run
   pnpm learning:bank import ~/Downloads/little-word-builders.json
   pnpm check
   ```
   The import refuses an unknown objective, an objective with a generator bank, invalid or duplicate items, lesson repeats and words off the reviewed list. A newer approved bank for the same objective replaces the file; importing the same file twice changes nothing.
9. **Review in git and deploy.** Commit the bank file and `banks/index.ts`, open a pull request, and read the diff: every word, meaning sentence, hint and success line. Merging deploys it. An activity plays bank items only when it asks for them with `activity.fresh` (the lesson page does that from M2).

## What it costs

A turn makes one model call, plus one per repair turn (at most three). The October 19 smoke test (one turn, six items, `claude-sonnet-5-5`) used one call: 2,980 input and 2,704 output tokens, all six items valid with no flags. Gateway turns are capped at `LESSON_DRAFT_DAILY_LIMIT` (20 per rolling 24 hours across operators). Model steps never retry, and a Workflow that resumes after an interruption replays the stored reply instead of calling the model again.

## Known limits

- The first turn of a new draft still tends to pick the most common words (the smoke test chose PIG, HEN and FOX, as the spike did). Later turns exclude everything already used. A brief that names a theme helps.
- The real-word distractor flag uses a hand-picked list of common three-letter words. It is a prompt for a human check, not a dictionary.
- The agent writes bank items only. New lesson drafts (activities) and voice generation after approval are later work.

## Reference

- Code: `apps/worker/src/lesson-drafts/` ([README section](../../apps/worker/README.md#lesson-drafts-phase-31-m4-contracts-105-ccr-31-4)), the admin view `apps/web/src/admin/LessonDrafts.tsx`, the import CLI `tools/lesson-draft/src/bank.ts`.
- Checks and formats: `packages/learning/src/vocabulary.ts` and `reviewed-banks.ts`.
- The fx0 pattern this ports: plan §8, the mapping table.
