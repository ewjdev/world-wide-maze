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
| 13 | [phase-13-link-portals.md](phase-13-link-portals.md) | Links become portals to other sites' mazes (web journeys) | 03, 05, 08 | 5 |
| 14 | [phase-14-mazify-extension.md](phase-14-mazify-extension.md) | Browser extension + bookmarklet: maze the page you're on, built in-browser | 02, 03, 08 | 5 |
| 15 | [phase-15-ai-docent.md](phase-15-ai-docent.md) | Grounded, cited AI docent through Cloudflare AI Gateway | 10 | 5 |
| 16 | [phase-16-build-story.md](phase-16-build-story.md) | Build clock + AI-found-bugs gallery for the LinkedIn series | 10 | 5 |
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
| 01 | merged | main | G0 | fidelity spec + contract deltas; contracts → v0.2 |
| 02 | merged (+02b v0.2.1) | main | G0 ✅ | 106 tests green; CRs logged in contracts §9 |
| 03 | merged | main | G1 ✅ (own criteria) | 315/315 stages valid; recognizable islands; builder 0.3.0 |
| 04 | merged | main | G1 ✅ | 46 draw calls; 60 fps @1080p M5 Max (p99 17.7 ms); fireworks weak (polish backlog) |
| 05 | merged | main | G1 ✅ (own criteria) | deterministic Rapier; 1000/1000 tunneling; aid-dcc traversable |
| 06 | merged | main | G1 ✅ iPhone | iPhone 17 Pro: 60 Hz, p95 interval 21 ms, 0 lost; lock/reconnect unverified; Android pending |
| 07 | merged | main | G1 ✅ (local) | real builder wired; 7 live URLs → stage in 1.0–4.7 s; SSRF 57 tests; Browser Rendering enablement pending (needs Workers Paid + resources) |
| 08 | merged (+08b) | main | G2 pending human playtest | E2E 4/4; replay run scores exactly 1484; disconnect→pause→resume verified |
| 09 | merged (+03b/05b fixes) | main | G2 ✅ (solver) | 819/819 stages solved at all difficulties; 315/315 runs; solver runs in workerd with seed reroll; builder 0.4.0, physics 0.2.0 |
| 10 | merged | main | G3 partial | about/making/log/scores/share done; credits cross-checked; awaiting: curated approval, 08 mounting ranking+ghost, public URL for card validators |
| 11 | optional | | | |
| 12 | merged (local + 12b) | main | G4 blocked on user | perf 60 fps; entry bundle 1.46 MB→5.6 KiB; CSP+limits; load tests local; legal drafts + infra ready, not run |

### Gate log
- **G0 ✅ (2026-09-25):** contracts v0.2.x reconciled with the 2013 evidence. The converted 2013 stage validates, apart from the intentional width minimums.
- **G1 ✅ (2026-09-25):**
  - The builder produces 315/315 valid stages, and they're recognizable.
  - The engine renders at 60 fps at 1080p on an M5 Max, with 46 draw calls.
  - Physics is deterministic and the 2013 stage is traversable.
  - The phone controller works on a physical iPhone (60 Hz, 0 lost frames).
  - Capture + build on the 7 live URLs takes 1.0–4.7 s.
  - **Open:** Android, iPhone lock/reconnect, integrated-GPU fps (Phase 12), and enabling real Browser Rendering (the user must create resources).

### Polish backlog (assign later)
- ~~Goal fireworks are weak~~: fixed in 04b (streak trails, rockets, 5 burst shapes).
- ~~Idle particle pool~~: fixed in 04b (chase scene 27.7k → 19.5k triangles).
- ~~Private three.js field~~: isolated and guarded in 04b (`three-private.ts`, with a loud test). Only used by the manual clock.
- The controller socket double-connects in dev (1001), probably React StrictMode. Verify in production builds.
- Offline fixtures use the 1× analysis screenshot as their texture, so text is blocky up close (phase-08 `12-play-hud.jpg`). Live and curated stages built through the service get 2× textures (CCR-07-2). Decide with the user whether offline fixtures also need 2× textures (repo size versus fidelity).
- Phase 10 follow-ups:
  - The `/dev/engine` sandbox pulls the BBC fixture into production builds. Gate the dev routes out of prod.
  - Add an `engine.addGhost()` API (the ghost currently goes through `debug()`).
  - Let `loadRapier()` accept a precompiled WASM module, so the workerd shim can go.
  - Store par times so the scores API can use `par × 0.5`.
  - The worker bundle is 3.7 MB gzipped with Rapier, so the Workers Paid plan is required.
- **G2 status (2026-09-25 overnight):** all automated criteria pass (E2E 8/8, solver 100%, replays verified). **Remaining: the human playtest** (`docs/build-log/phase-08-playtest.md`, with keyboard and iPhone, including lock/reconnect).
- **12b (2026-09-25):**
  - Pairing secret: a guessing attack can no longer take over a room.
  - Queued builds wait or return RATE_LIMITED instead of timing out.
  - Iframe `WebSocketStream` bypass closed.
  - Rapier deferred: `/` is now 612 KiB gzipped, down from 1,681.
  - `/log` CLS 0.20 → 0.003.
  - Tests: 723 passed.

### Wave 5 (2026-09-25): "next-level tribute" for the LinkedIn showcase
Launch sooner rather than on the anniversary. Runtime AI goes through Cloudflare AI Gateway. Phases 13–16 run in parallel, and contracts v0.3.0 are in `@wwm/schema`.
| 13 | in progress | worktree | — | link portals |
| 14 | in progress | worktree | — | extension + bookmarklet |
| 15 | in progress | worktree | — | AI docent |
| 16 | in progress | worktree | — | build story |
