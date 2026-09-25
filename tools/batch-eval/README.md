# @wwm/batch-eval

Batch evaluation: build + solve every fixture/curated stage and report pass rates.

**Status:** scaffold (Phase 02). Owned and implemented by **Phase 09** — see `plans/phase-09-*.md`.

- Contract types come from `@wwm/schema` (never redeclare them).
- Tests: `pnpm vitest run --project @wwm/batch-eval` (or `pnpm test` at the root).
- Typecheck: `pnpm --filter @wwm/batch-eval typecheck`.
