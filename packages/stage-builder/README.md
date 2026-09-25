# @wwm/stage-builder

Screenshot + DOM → StageData (islands, bridges, maze, items, rails). Pure, deterministic, no I/O.

**Status:** scaffold (Phase 02). Owned and implemented by **Phase 03** — see `plans/phase-03-*.md`.

- Contract types come from `@wwm/schema` (never redeclare them).
- Tests: `pnpm vitest run --project @wwm/stage-builder` (or `pnpm test` at the root).
- Typecheck: `pnpm --filter @wwm/stage-builder typecheck`.
