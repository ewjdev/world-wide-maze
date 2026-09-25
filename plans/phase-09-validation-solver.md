# Phase 09 — Solver Bot, Playability Validation & Batch Evaluation

**Wave:** 2 (parallel with 08) · **Depends on:** 03 (builder), 05 (headless sim) · **Blocks:** G2, 11, 12

## Goal
Guarantee that every published stage is **actually playable with the real physics**, not just graph-connected. Produce solver-based par times, and give the team a batch dashboard that measures generator quality across many sites. The bot also powers attract mode and ghost runs.

## Read first
- `plans/contracts.md` §3, §4, §5
- `research/recreation-plan.md` "Geometry and gameplay decisions" and "Implementation sequence". Note: *the solver does not replace human judgement of fun.*
- The READMEs of `@wwm/stage-builder` and `@wwm/physics`

## Owns
`packages/solver/**`, `tools/batch-eval/**`, `fixtures/eval/**`

## Tasks
1. **Planner:**
   - Build a navigation graph from `StageData`: island safe-spot nodes, bridge centerline edges (ramps included), and elevator edges with wait semantics.
   - Run A* from the start to the goal.
   - Optional item-collection tour: a greedy detour to reachable items within a time budget.
   - Output a waypoint polyline in world space.
2. **Controller (the bot plays through the same input channel as a human):**
   - Output `InputSample` (tilt, power, jump) with a PD or pure-pursuit controller that follows the waypoints: speed caps on bridges, braking before turns, elevator waiting, and jump use only where needed.
   - Uses only information a player could see: the stage and the ball state.
3. **`solveStage(stage, opts) → { success, timeSec, falls, inputs: InputSample[], failure?: {kind, at: Vec2, islandId} }`**, running the headless `Simulation` faster than real time. Up to K attempts with varied controller gains.
4. **Validation hook:**
   - `validatePlayable(stage) → { ok, parTimeSec, report }`.
   - Integrate it into `buildStage`'s caller path. Add a wrapper `buildPlayableStage(input)` in `@wwm/solver` that tries seeds `seed..seed+N` until it finds one that is valid **and** solved.
   - Set `timeLimitSec = round(parTime × factor[difficulty])` with factors easy 3.0, normal 2.2, hard 1.6 (tunable, labeled "chosen").
   - Phase 07 calls this wrapper through the injected interface.
5. **Failure diagnostics:** classify failures as stuck on a rail corner, can't climb a ramp, bridge too narrow at speed, elevator timing, unreachable item, or goal in a pocket. Report the island and bridge IDs so Phase 03 can fix the root cause. **Filing builder issues is part of the job:** write them to `docs/build-log/phase-09-builder-issues.md`.
6. **Ghost runs:** export a solved `InputSample[]` as a replay (the same format as Phase 05). Phase 08 uses it for attract mode and Phase 10 for "race the bot".
7. **Batch eval (`tools/batch-eval`):**
   - Input: a list of capture fixtures, plus an optional URL list (through the Phase 07 API, when available).
   - Runs builder × difficulties × seeds 1–3 → validate → solve.
   - Output: `fixtures/eval/report.json` and a static HTML dashboard with the debugger thumbnail per stage, pass/fail, par time, island/bridge/item counts, build ms, solve ms, and failure classes, plus aggregate rates.
   - Grow the eval set to **30 or more captures** (use `pnpm fixture:capture`, covering varied layouts, languages including Japanese, and dark and light themes). Put new captures under `fixtures/captures/eval-*` (you may add fixtures, not modify existing ones).
8. **Human-judgement hooks:** the dashboard has a per-stage "recognizable? fun? (1–5)" rating that saves to local JSON, so the orchestrator or user can record playtest judgments next to the metrics.

## Acceptance criteria
- `solveStage` completes `handmade-simple` and at least 90% of eval stages at normal difficulty. Every unsolved stage has a classified failure.
- `buildPlayableStage` returns only stages that pass both `validateStage` and the solver (tested).
- Solving an average stage takes under 3 s of CPU at more than 10× real time headless (log it).
- The dashboard is generated and a screenshot is saved to `docs/build-log/assets/phase-09/`.
- At least 1 round of builder-issue reports is filed, with repro seeds.

## Out of scope
Changing the builder's code: report issues, and the orchestrator routes the fixes to a Phase 03 follow-up. Also out: rendering the ghost (08/10) and AI (11).


---

## G0 updates (2026-09-25). Where these conflict with the text above, these win.
Sources: `docs/reference/fidelity-spec.md` (E = evidenced from the 2013 build) and contracts v0.2.0.

- **Time limit is a fixed 300 s (E):** drop the par × factor formula. The solver's par time is used to:
  - (a) **reject** stages where par > 150 s (keeping at least 2× headroom), and
  - (b) derive the **difficulty stars** (1–5) shown on the select screen (E: 2013 showed stars).
- **Solver inputs** must set `frameYaw`. Use the heading toward the next waypoint, which mimics a chase camera, and hold `power` while steering.
- **The solver models trigger elevators** (roll onto the end sensor, wait `travelSec`, roll off, respect the cooldown).
- **Eval runs per slice.** Report per-run aggregates too.
