# World Wide Maze Revival — Master Plan (Overview)

**The pitch:** paste any website, watch it turn into a floating 3D island maze, and tilt your phone to roll a glowing ball to the goal. It's a faithful tribute to Google Japan / PARTY's 2013 Chrome Experiment, rebuilt in 2026 with AI-assisted engineering, and the build is documented well enough that people can see both the original craft and the new work.

This file is the **single source of truth for scope and coordination**. Each phase has its own plan file (linked below), written so one sub-agent can execute it without reading the others.

**Required reading for every agent:**
1. This file.
2. [contracts.md](contracts.md), the shared types and protocols. **Never change these unilaterally.**
3. Your phase file.
4. The background sections your phase file points to in [../RESEARCH.md](../RESEARCH.md) and [../research/](../research/).

---

## 1. Product decisions (defaults, and the user can override)

| Decision | Default chosen | Rationale |
|---|---|---|
| Fidelity | **Faithful mechanics, modern visuals.** Original scoring constants, 3 balls, hold POWER to tilt, JUMP, MENU/M for the map, a 6-digit pairing code, portrait lock, keyboard fallback | Recovered bundle and localization give real rules. Visuals are a respectful modern tribute, not a pixel clone (we have no rights to the original art) |
| Website scope | **Curated set first, then any public URL** behind a hardened capture service | The user's goal is "any website". Curated levels guarantee a great first impression and survive outages |
| AI role | **Primary: AI-assisted development, with a public build record. Secondary: optional "AI Remix" runtime mode** (Phase 11) that goes through the same validator | Makes AI claims checkable and keeps the baseline honest |
| Transport | **WebSocket relay on Cloudflare Durable Objects.** Add WebRTC later only if measurements require it | Simple, measurable, and edge-located (the original's US-only relay caused about 200 ms lag from Japan) |
| Platform | Cloudflare (Workers, Durable Objects, Browser Rendering, R2, D1, KV) | One deploy target, edge relays, managed headless Chromium |
| Stack | TypeScript (strict), pnpm workspaces, Vite, three.js, Rapier 3D (WASM), Clipper2, Vitest, Playwright, Biome | See each phase |

## 2. Architecture at a glance

```
            ┌───────────── Cloudflare ─────────────┐
 URL ─────► │ Worker API ─► Browser Rendering       │   CaptureBundle
            │     │           (capture-script)      │ ──────────────┐
            │     ▼                                 │               ▼
            │  stage-builder (same TS lib) ─► validator/solver ─► R2 StageData + texture
            │  Durable Object Room (6-digit relay)  │   D1 scores, KV cache
            └───────▲───────────────────▲──────────┘
                    │ WS                │ HTTP
        Phone controller          Desktop game (three.js renderer + Rapier worker)
        (/c/:code)                (/play/:stageId)
```

## 3. Repository layout and ownership

**Ownership is exclusive.** An agent edits only the paths its phase owns. It reads anything.

```
apps/web/                 Phase 08 (shell, routes, HUD), 10 (history/museum pages)
apps/web/src/controller/  Phase 06
apps/worker/              Phase 07 (capture/stages/scores API), Phase 06 (src/room.ts DO only)
packages/schema/          Phase 02 ONLY (orchestrator applies contract changes)
packages/capture-script/  Phase 02
packages/stage-builder/   Phase 03
packages/engine/          Phase 04
packages/physics/         Phase 05
packages/net/             Phase 06
packages/solver/          Phase 09
packages/ai/              Phase 11
tools/fixture-capture/    Phase 02
tools/stage-debugger/     Phase 03
tools/batch-eval/         Phase 09
fixtures/                 Phase 02 creates; others ADD files in their own subfolder only
docs/reference/           Phase 01
docs/build-log/           every agent appends ONE entry file; orchestrator curates
reference/                gitignored, downloaded third-party material (never committed)
```

## 4. Phases

| # | Plan | Summary | Depends on | Wave |
|---|---|---|---|---|
| 01 | [phase-01-reference-spec.md](phase-01-reference-spec.md) | Mine the recovered bundle, localization, and WWMMM stage JSON into a fidelity spec | — | 0 |
| 02 | [phase-02-foundation.md](phase-02-foundation.md) | Monorepo, `schema` package, capture-script, fixtures, CI | — | 0 |
| 03 | [phase-03-stage-builder.md](phase-03-stage-builder.md) | Screenshot and DOM to islands, bridges, maze, items, rails, plus a visual debugger | 02 | 1 |
| 04 | [phase-04-renderer.md](phase-04-renderer.md) | three.js world: islands with texture, ocean, ball, glow, camera, perf ladder | 02 | 1 |
| 05 | [phase-05-physics.md](phase-05-physics.md) | Rapier sim in a worker and headless, controls feel, events, determinism | 02 | 1 |
| 06 | [phase-06-controller.md](phase-06-controller.md) | Room DO, pairing, phone controller page, tilt pipeline, keyboard and gamepad | 02 | 1 |
| 07 | [phase-07-capture-service.md](phase-07-capture-service.md) | Hosted capture, build jobs, SSRF safety, caching, storage | 02 (03 for integration) | 1 |
| 08 | [phase-08-game-integration.md](phase-08-game-integration.md) | App shell and game state machine wiring 03–07, HUD, map, audio, onboarding | 03, 04, 05, 06 | 2 |
| 09 | [phase-09-validation-solver.md](phase-09-validation-solver.md) | Solver bot, stage validation and seed reroll, batch eval dashboard | 03, 05 | 2 |
| 10 | [phase-10-showcase.md](phase-10-showcase.md) | Credits and history, build record, debug "how it's made" view, leaderboards, sharing | 08 | 3 |
| 11 | [phase-11-ai-remix.md](phase-11-ai-remix.md) | *Optional:* AI semantic theming and route proposals, behind the validator | 09 | 3 |
| 12 | [phase-12-launch.md](phase-12-launch.md) | Perf and device matrix, load and abuse testing, deploy, observability | 08, 09, 10 | 4 |

### Execution waves
```
Wave 0:  [01 reference] ‖ [02 foundation]
             └── orchestrator gate G0: reconcile contracts with the reference findings
Wave 1:  [03 builder] ‖ [04 renderer] ‖ [05 physics] ‖ [06 controller] ‖ [07 capture]
             └── gate G1: each package passes its own acceptance against fixtures
Wave 2:  [08 integration] ‖ [09 solver]
             └── gate G2 = MILESTONE "First playable": keyboard + phone playthrough of 5 fixture sites
Wave 3:  [10 showcase] ‖ [11 AI remix, optional]
Wave 4:  [12 launch]  →  MILESTONE "Public demo"
```

## 5. Milestones and gate criteria (checked by the orchestrator, not the agent)

| Gate | Must be true |
|---|---|
| **G0 Contracts frozen v0.1** | `pnpm i && pnpm check` is green. `packages/schema` matches contracts.md. 5+ capture fixtures and `handmade-simple` exist. The fidelity spec is reviewed, and any contract deltas are applied |
| **G1 Components** | Builder turns all fixtures into stages that pass `validateStage`. The renderer displays `handmade-simple` at 60 fps on the reference desktop. Physics replays the fixture replay deterministically. The phone pairs and streams tilt, with RTT logged. Capture works for fixture URLs locally with `wrangler dev` |
| **G2 First playable** | A human completes a start-to-goal run on 5 generated fixture stages with keyboard **and** with a physical phone (iOS Safari + Android Chrome). The solver completes 90% or more of the batch eval set. There are no console errors |
| **G3 Showcase** | History and credits reviewed for accuracy against the research. The build record is complete. Leaderboards work. The curated set has 12 or more stages |
| **G4 Public demo** | The launch checklist in Phase 12 is all green |

## 6. Orchestration protocol (how the work stays coherent)

**Orchestrator (main session) responsibilities**
- Brief each agent with: "Read `plans/00-overview.md`, `plans/contracts.md`, and `plans/phase-XX-*.md`, then execute Phase XX." Add any gate-specific notes.
- Run each wave's agents in parallel, each in an **isolated git worktree** on branch `phase-XX-<slug>`. Merge into `main` after reviewing, in dependency order.
- Own `packages/schema`. Apply contract change requests, bump the contract version, and tell the affected agents.
- Run gate checks personally: tests, the batch eval, and visual screenshots through the preview tools.
- Keep this overview's status table (section 8) current.

**Agent rules**
1. Stay inside your owned paths. Read anything.
2. Code against `@wwm/schema` types only. Don't redeclare contract types.
3. If a contract blocks you, write a Contract Change Request in your report and keep going with a local adapter. Don't fork the type.
4. Every package has unit tests and a `README.md` (purpose, API, how to run).
5. Before reporting, run `pnpm check` (typecheck + lint + test) at the repo root.
6. Write `docs/build-log/phase-XX.md` using the template below.
7. Don't commit third-party original assets (bundle, art, WWMMM JSON). Use `reference/` (gitignored).
8. Label anything reconstructed or invented versus evidenced when it touches historical fidelity.

**Hand-off report (what an agent returns to the orchestrator)**
```
## Phase XX hand-off
Status: complete | partial (why)
Acceptance criteria: [each item → pass/fail + evidence (command output, screenshot path)]
Files/packages added:
Public API exposed:
Contract Change Requests: (none | list)
Known issues / follow-ups:
Notes for dependent phases:
```

**Build-log entry (`docs/build-log/phase-XX.md`), the AI showcase record**
- Agent model and tool, and start and end timestamps.
- Key prompts or instructions received (summary).
- Attempts that failed and why.
- Manual human interventions.
- Test evidence.
- Remaining defects.
- **No productivity-multiplier claims.** See research/recreation-plan.md.

## 7. Global conventions

- TypeScript `strict`, ESM only, Node 22+, pnpm 9+. Biome for lint and format. Vitest for unit tests, Playwright for e2e.
- Packages are named `@wwm/<name>` and export from `src/index.ts`.
- No global singletons. Deterministic code takes a seeded PRNG from `@wwm/schema/rng` (mulberry32).
- Performance-sensitive code (builder, physics) avoids allocation in hot loops and reports timings.
- User-facing strings go through `apps/web/src/i18n` (en first, ja second, as a nod to the original).
- Accessibility: keyboard-complete play, `prefers-reduced-motion`, and color-independent item cues.

## 8. Status board (orchestrator maintains)

| Phase | Status | Branch | Last gate | Notes |
|---|---|---|---|---|
| 01 | not started | | | |
| 02 | not started | | | |
| 03 | not started | | | |
| 04 | not started | | | |
| 05 | not started | | | |
| 06 | not started | | | |
| 07 | not started | | | |
| 08 | not started | | | |
| 09 | not started | | | |
| 10 | not started | | | |
| 11 | optional | | | |
| 12 | not started | | | |
