# World Wide Maze + Learning

A pnpm monorepo for the WWM game and an independent education experience. The learning pilot starts with parent-guided early math for ages 4–6: readable pages, explicit educational intent, and reviewable AI-assisted family introductions.

| Workspace | Purpose |
| --- | --- |
| `apps/web` | Existing WWM game, phone controller, and showcase |
| `apps/worker` | Existing game backend |
| `apps/extension` | Existing browser extension |
| `apps/education` | Standalone learning path, activity pages, parent customization |
| `packages/learning` | Educational HTML contract, validation, original starter content, forks |
| Other `packages/*`, `tools/*` | Existing game engine, capture, physics, shared game contracts, and tooling |

```sh
pnpm install
pnpm dev:education       # education: http://127.0.0.1:5174
pnpm dev                 # existing game + worker
pnpm build:education     # standalone static output
pnpm check               # workspace types, lint, tests
```

- [Education app and parent workflow](apps/education/README.md)
- [Educational HTML contract](docs/education/html-contract.md)
- [Starter content and review needs](docs/education/content-notes.md)
- [Broader opportunity and next decision gates](docs/education/opportunity.md)

The education app is a local pilot. It includes a bring-your-own-AI prompt/import flow and local saved forks, not connected AI generation, accounts, shared learner records, or in-maze lessons. It is built separately from the game's deployment.

## Historical research

Research date: September 24, 2026 (America/Los_Angeles).

World Wide Maze offers a useful starting point for a playable tribute to inventive web development and an honest demonstration of present-day AI-assisted engineering.

- [Historical research and reading guide](research/world-wide-maze.md)
- [Proposed recreation and AI showcase](research/recreation-plan.md)
- [Machine-readable recovery evidence](research/recovery-evidence.json)

The original client bundle and English localization were retrieved and inspected as text; the original game was not run. A later installation's stage data was inspected separately. The research predates the current implementation; see the master plan and build logs for implementation evidence.

The original revival research is retained alongside the newer education direction.

## Build plan

- [Master plan and orchestration overview](plans/00-overview.md): phases, waves, ownership, gates
- [Shared contracts](plans/contracts.md): the types and protocols every phase codes against
- Phase plans `plans/phase-01` … `phase-12`: one self-contained brief per sub-agent
- [Earlier technical dossier](RESEARCH.md): case-study breakdown and the modern stack mapping
