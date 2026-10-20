# @wwm/lesson-draft

Phase 31 lesson-authoring tools. Model-written example rounds go through Cloudflare AI Gateway `wwm` and are checked against `@wwm/learning`.

## Bank import (M4)

```sh
pnpm learning:bank check  <file.json>   # validate only
pnpm learning:bank import <file.json>   # validate, then write
```

Brings a bank approved in the admin workbench's **Lesson drafts** view (`GET /api/admin/lessons/:id/export`) into `@wwm/learning`. The file must be a `wwm-learning-bank/1` export for an objective in `AUTHORING_OBJECTIVES` without a generator bank. Every item must pass `roundSchema`, `roundIssues` and the objective's checks, and be fresh against the lesson and unique in the bank. The CLI writes `packages/learning/src/banks/<objective>.json`, regenerates `banks/index.ts` (which `reviewed-banks.ts` reads and the baseline merges), and formats both with Biome. Importing the same file again changes nothing. Code: `src/bank-import.ts` (tested in `test/`). Operator guide: [docs/education/lesson-drafts.md](../../docs/education/lesson-drafts.md).

## Draft smoke test (M4)

```sh
pnpm --filter @wwm/lesson-draft draft-smoke [--count 6] [--model claude-sonnet-5-5]
```

Runs one turn of the Worker's `LESSON_DRAFT` pipeline (`apps/worker/src/lesson-drafts/pipeline.ts`) with Claude through the helper Worker below. At most three paid model calls. Prints each item's verdict and the token usage.

## Item-bank spike (M0)

```sh
pnpm --filter @wwm/lesson-draft spike [--runs 3] [--model claude-sonnet-5-5]
```

For each objective (`little-word-builders`, `compare-groups`, `spanish-colors`), the model sees the authored rounds and writes six fresh ones. Every round must pass `roundSchema` and the objective checks in `src/spike.ts`. A failing round gets up to two repair turns. Output goes to `docs/education/item-bank-spike/<date>/results.json`. See that folder's README for the October 19 findings. Since M4 the spelling checks come from `@wwm/learning` (`spellingIssues`, `spellingFlags`): a word must be on the reviewed word list, which replaced the `/usr/share/dict/words` check the October 19 run used.

## Helper Worker

The scripts start `proxy/` with `wrangler dev` on port 8798 unless something already listens there. The helper Worker is local-only and never deployed. Its AI binding uses your wrangler login, and the Anthropic key stays in the gateway (BYOK). A full spike run makes 9–27 paid model calls.
