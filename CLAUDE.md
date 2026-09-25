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
The repo uses pnpm 11 workspaces (`apps/*`, `packages/*`, `tools/*`), Node ≥ 22.12, TypeScript 7 (strict), Biome 2, and Vitest 5.
- `pnpm i`: install. Once per machine, also run `pnpm --filter @wwm/fixture-capture browsers` to install Playwright Chromium. The browser-driven tests skip locally without it and are required in CI.
- `pnpm check`: typecheck (`tsc` per package) + lint (`biome check .`) + test (`vitest run`, every package is a project). It must be green before hand-off.
- `pnpm format`: Biome auto-fix (format + organize imports).
- `pnpm vitest run --project @wwm/<pkg>`: run one package's tests.
- `pnpm dev`: web (Vite, http://localhost:5173, `/api` proxied) + worker (`wrangler dev`, http://localhost:8787). Run just one with `pnpm --filter web dev` or `pnpm --filter worker dev`.
- `pnpm fixture:capture <url> <slug> [--dark]`: capture a page into `fixtures/captures/<slug>/`.
- `pnpm --filter @wwm/fixture-capture handmade`: regenerate `fixtures/stages/handmade-simple.{json,png}`. `pnpm fixture:texture` regenerates only the PNG.
- `pnpm ref:fetch`: download the 2013 reference material into `reference/` (Phase 01's `@wwm/ref-fetch`).
- `pnpm --filter worker types`: regenerate `apps/worker/worker-configuration.d.ts` after editing `wrangler.jsonc`.

Packages export TypeScript source directly (`"exports": {".": "./src/index.ts"}`), so there is no build step. Relative imports use `.ts` extensions.
