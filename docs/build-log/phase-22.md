# Phase 22: Learning mechanics (the maze follows the lesson)

**Date:** September 26, 2026 (America/Los_Angeles).
**Agents:** Claude Code (Claude Opus 5.5) as orchestrator, with three sub-agents in their own worktrees:
- **L1, physics and engine locks:** [phase-22-locks.md](phase-22-locks.md)
- **L2, game adapter:** [phase-22-game.md](phase-22-game.md)
- **L3, lesson page and parent area:** [phase-22-page.md](phase-22-page.md)

**Plan:** [plans/phase-22-learning-mechanics.md](../../plans/phase-22-learning-mechanics.md). The user approved it after adding decision E5: locking is configured per level, as part of the lesson.

## What changed (N: new, not a 2013 feature)
- **`wwm-learning/0.3`** (orchestrator, `packages/learning`):
  - **Levels:** each level is a recipe of ordered steps (rounds and missions) with its own lock configuration: `mode`, `connectors`, `goal`, `signals` and `override`. Steps can override the level's lock.
  - **Levels as data:**
    - `playIssues` rejects contradictions in plain words.
    - `describeLevel` writes the grown-up's description.
    - `levelRequires` and `playableLevels` let a game offer only the levels it can fully honour.
    - `family` carries the grown-up's choice.
  - **Answering:**
    - Input modes (tap, letter key, number key, arrows, tilt) with device fallbacks; `judgeInput` nudges twice, then accepts.
    - Answer positions are shuffled per session.
    - A voiced callout follows every prompt, and its `choice` cues pulse each choice as it's named.
  - **Content:** compare-groups ships four levels (Explore, Answer before the finish, Gated as the default, Missions), and the counting lessons get "collect N" missions.
  - **Voice:** 202 Pip lines (105 new) generated through AI Gateway → ElevenLabs into R2. Clips are now looked up by text.
- **Contracts §10.4 (CCR-GAME-01):** runtime locks. `LockSpec`, `Simulation.load(stage, options?)`, `setLock`, and the `locked` SimEvent. `StageData` is unchanged, and so is ranked play.
- **Physics and engine locks (L1):**
  - A bridge gate 4.5 m tall, with invisible side fences.
  - Lift and goal locks.
  - `locked` fires at most once per second per lock.
  - Replays can carry a lock timeline.
  - Visuals: bars across the bridge, a padlock showing Pip or a gem, a label card, a dimmed deck, a greyed goal, an opening animation, the beacon, and padlocks on the map. All locks together add one draw call.
- **Game adapter (L2):**
  - Levels are read from the document, with a grown-up hold-to-change control in the loader strip.
  - `locks.ts` binds steps to any maze: it builds the island graph and cuts it along the start→goal path, limited to the level's connectors, and falls back to a goal lock where no cut exists.
  - Pip gates and mission posts: collect N, with Pip counting each pickup aloud; reach the island with the most or fewest gems.
  - At a closed lock: the banner, Pip's line and the beacon.
  - The region guard, the grown-up override in the pause menu, and unranked learning runs.
  - The gate card shows key badges, callouts, nudges, and handles tap-only.
- **Lesson page and parent area (L3):**
  - Callouts pulse the choices, positions are shuffled (`?seed=` replays a session), and letter-key, number-key and arrows rounds have badges and nudges.
  - A per-lesson Game settings block with generated descriptions, a tap-only switch and resets.
  - The download carries `family`, and the grown-ups notes show the game level.

## The spike changed the design
L1 measured two things:
- **Gates hold:** 0 crossings in 33 hard attempts; the highest jump reached 3.4 m against a 4.5 m gate.
- **Mazes leak:** on 50 real-site stages, a ball can hop to a neighbouring island around 90–99% of lock positions (the median gap is 0.89 m).

So the **region guard became the main enforcement**. Any `island` or `landed` event beyond a closed lock sends the ball back. Pip says "Oops! Solve Pip gate two first.", and the banner and beacon point at the gate. The visible gates carry the "closed" story. Raising guardrails along lock boundaries is a possible follow-up.

## Coverage
Across 666 batch-eval stages, for compare-groups `gated` (L2):
- 69.8% of steps got a physical lock.
- 19.4% fell back to a goal lock.
- 10.8% had no room for a gate; those rounds are asked on the stage-start card.

This is **below the plan's 80% M0 target**. The limit is room for a gate in front of a cut, not the number of chokepoints. The invariants held on all 666 stages.

## Orchestrator integration and fixes
- Merged L3, L1 and L2, with no conflicts.
- Added `setLock` and the `load` options to the schema `Simulation` interface, and forwarded them in `record()`.
- Voice fixes (from L3): a line is never spoken twice when a clip fails, and key badges scale in place.
- Guard lines now name the gate, and a level that hides map padlocks requires a game capability that WWM doesn't declare yet (fail closed).
- The voice tool now waits out AI Gateway rate limits (429s) and keeps progress if interrupted.
- The generated manifest is excluded from Biome.

## Test evidence
- `pnpm check`: 1,188 tests passed, 29 skipped.
- **Orchestrator walkthrough, lesson page (1440×900, real clips from R2, no errors):**
  - The parent chose Missions, and the lesson notes described it.
  - In round 2, a tap got "Try pressing the letter!" and the letter key answered.
  - The downloaded HTML carries `family: { compare-groups: mission }`.
- **Orchestrator walkthrough, game (1440×900):** that downloaded file, loaded with `?learn=compare-groups`, played the Missions level.
  - Rolling at gate 1's lock showed the banner "🔒 Solve Pip gate 1 first".
  - Solving the gate opened three bridges.
  - The mission post said "Bring Pip four gems!", and a pickup said "One!", with the mission chip on the HUD.
  - The practice stage had room for two physical locks; the remaining steps lock the finish.

## Remaining defects and follow-ups
- Physical-lock coverage is 70%, not 80%. Options: relax gate-spot rules near cuts, or have the builder place chokepoints for lessons.
- Most mazes can be hopped around; the region guard handles it. Raising guardrails at lock boundaries is optional.
- The engine can't hide map padlocks yet (`signals.mapPadlocks: false` levels aren't offered).
- Real-site mazes don't show island letters, so letter `reach` missions rely on the beacon. No baseline level uses them.
- A touchscreen laptop counts as having a keyboard; taps are accepted after two nudges.
- Tilt selection and the gated flow haven't been tried on the physical iPhone.
- Educator review is still required before any public launch.
