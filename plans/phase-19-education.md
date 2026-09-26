# Phase 19 — Independent learning pages

User-authorized scope: extend the existing monorepo with education pages to hone for ages 4–6, then evaluate the broader education opportunity. Prior conversation established default paths, parent AI customization, transparent HTML intent, and separation from games.

## Implemented slice

- `apps/education`: static, independently runnable/built pages with progressive enhancement.
- `packages/learning`: experimental runtime-validated learning contract and six original early-math activities.
- AI prompt/import, visible before/after review, local acceptance, backup/export, and restore.
- Parent teaching notes, optional browser speech, hints/retry, and free navigation.
- Source-grounded content notes, HTML contract, and an opportunity/validation sequence.

## Contract decision CCR-EDU-01

The root orchestrator accepts a new independent domain package rather than adding education fields to `StageData`, physics, or capture contracts. Game types continue to come from `@wwm/schema`; education types come from `@wwm/learning`. Existing phase consumers require no changes. No promise of compatibility with LRMI, H5P, or xAPI is made.

## Acceptance

The education build emits one index and six lesson HTML files; content/data are present without JavaScript. All activities have valid answers, objectives, hints, and parent notes. Invalid/stale drafts fail; acceptance is required before persistence. Reload/restore/export work. Baseline and personalized visible copy match their machine payloads. Desktop/mobile views fit the viewport. Root checks and the standalone build run before handoff.

## Explicit next work

Educator and family review; richer variations appropriate for older children in the 4–6 range; a real WWM lesson adapter; then a second game to test portability. Accounts, automatic AI requests, hosted forks, learner records, remote loading, curriculum expansion, and deployment require separate implementation work. See `docs/education/opportunity.md` for decision gates.
