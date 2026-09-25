# World Wide Maze Revival

A tribute rebuild of Google Japan / PARTY's 2013 Chrome Experiment "World Wide Maze": any website becomes a 3D island maze that you steer with your phone.

## Start here
- `plans/00-overview.md` covers scope, the phase index, ownership, the orchestration protocol and gates.
- `plans/contracts.md` holds the shared types and protocols. Never change them unilaterally. File a Contract Change Request instead.
- `plans/phase-XX-*.md` is one self-contained plan per sub-agent.
- `research/` and `RESEARCH.md` hold the historical evidence. Distinguish **evidenced / reconstructed / new**.

## Rules for agents
- Edit only the paths your phase owns (overview §3). Read anything.
- Import contract types from `@wwm/schema`. Never redeclare them.
- Never commit original 2013 assets or the unlicensed WWMMM data. They go in `reference/` (gitignored), fetched with `pnpm ref:fetch`.
- Before handing off, run `pnpm check`, then write `docs/build-log/phase-XX.md` and return the hand-off report (overview §6).
- No "AI built this N× faster" claims.

## Commands
(Filled in by Phase 02: `pnpm check`, `pnpm dev`, `pnpm fixture:capture <url> <slug>`, `pnpm ref:fetch`.)
