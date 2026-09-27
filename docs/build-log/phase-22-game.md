# Phase 22 L2: the game adapter (M3)

September 26, 2026. A Claude Code sub-agent (Claude Opus 5.5) in its own worktree, working from the approved plan
`plans/phase-22-learning-mechanics.md` (§1–§7 as they apply to the game, M3, Acceptance) and contracts §10.4
(CCR-GAME-01). It started from `feat/learning-mechanics-phase-22` at `0a0648b` at about 00:55 UTC on September 27
and finished at about 01:50 UTC. Midway it merged L1's physics and engine branch (`3f76870`) on the orchestrator's
instruction. Everything here is **N** (new, not a 2013 feature).

## What changed

### Levels (`apps/web/src/learning/levels.ts`)
- The game declares `SUPPORTS` = `locks.goal`, `locks.path.bridge`, `locks.path.elevator`, `mission.collect`,
  `mission.reach`. It offers only `playableLevels(activity, SUPPORTS)`, so it fails closed.
- `pickLevel` chooses the level in this order:
  1. the session's Grown-ups choice;
  2. `resolveLevel` (the family's `levels`, else the author's default), if playable;
  3. the first playable level;
  4. `explore`.
- **The loader strip** on site select shows the level's label and its `describeLevel` text.
- **A Grown-ups control** (`HoldButton.tsx`) acts only after a 2 s press and hold, or a 2 s hold of G on a
  keyboard. It opens a picker listing the lesson's levels, each with its description and the author's default
  marked. Choosing a level starts the session's progress over.

### Binding steps to the maze (`locks.ts`, pure)
- **Graph:** a multigraph whose nodes are the islands reachable from the start. Bridges (from/to) and lifts
  (islandFrom/islandTo) are its edges. `islandPath` is the BFS path from start to goal.
- **The cut chain:** from the start region, repeatedly take the source-closest minimum cut to the goal, then step
  across it.
  - The max-flow uses unit capacities.
  - Cuts are counted in **links**: all the connectors between two islands. Three parallel bridges are one lock
    decision, and each bridge gets its own `LockSpec`.
  - A link can be cut only if every connector in it is one of the level's `connectors`. Other links have infinite
    capacity.
- **Steps take cuts in plan order.**
  - A cut is only used when the segment in front of it has room for a gate (Phase 20's `gateSpots` rules).
  - When there are more usable cuts than `path` steps, the steps spread evenly over them.
  - Each gate or post stands in front of its cut. Other steps stand between their neighbours' cuts.
  - Rounds get Pip gates. Missions get posts with a `wwm-learning:<activity>/m<n>` href and a label such as
    "Mission: 4 gems".
  - There are at most 8 gates and posts per stage.
- **Fallback:** a `path` step with no usable cut becomes a goal lock (`no-cut`, or `no-room` when its spot was
  taken), even when the level's `goal` is false. This is recorded in the binding and in the debug state.
- **Checks:** `checkBinding` reports violations of these invariants:
  - (a) with the cuts of steps ≥ j closed, step j's gate is reachable;
  - (b) with only cut j closed, the goal is unreachable;
  - (c) with every lock open, every island is reachable;
  - (d) liveness: doing any reachable step, repeatedly, finishes every placed step. It also flags connectors shared
    between steps.
- **Output:** `LockSpec`s for bridges and lifts, with the host-side `islandId`, then one goal lock (`targetId 0`)
  if any step contributes to the finish.

### Play (`gates.ts`, wired in `game.ts`)
- **The session:**
  - One `LessonState` per session, seeded with `randomSeed()` (a `learningSeed` test hook pins it). `shuffle` comes
    from `path.play`.
  - Each gate asks its own step's round with `step(…, { type: 'play', roundId })`. In a `mode: none` level any gate
    asks the next round, as in Phase 20.
  - A solved round continues in the same card: with its follow-up (`followUpAfter`), or, after the last step, with
    the bonus offer and then the finale.
- **Solving a step:**
  - `setLock(id, true)` and `setLockState(id, 'opening')` for each of its locks.
  - Pip says `unlockedBridge` or `unlockedLift`.
  - The finish opens (`unlockedGoal`) once every step it waits for is done.
  - On the next attempt at the stage, done steps' locks load open and their gates show as used.
- **Missions:**
  - Rolling into a post starts the mission without stopping the ball. Pip says `pip.mission.post` and then the
    mission line: `collect(n)`, `reachMost`, `reachFewest`, or `reachLetter(L)`.
  - **Collect** counts pickups made after the post. Pip says `pip.number.N` for each one, and the HUD shows gem
    slots. The lock opens at N. If fewer gems are left on the reachable islands, N is lowered and a note is recorded.
  - **Reach** resolves `most-gems` / `fewest-gems` when the mission starts, against the gems left on the reachable
    islands other than the post's island. A tie becomes a letter target (A–J in BFS order), and the beacon marks the
    island. The mission completes on the `island` event.
- **At a closed lock** (the `locked` SimEvent), each behaviour follows the level's `signals`:
  - **Banner:** a keyed HUD banner, "🔒 Solve Pip gate 2 first" or "🔒 Bring Pip 4 gems first — you have 1". The
    same banner isn't restarted while it still shows, because the physics reports a pressed gate about once a
    second and restarting it made it flicker.
  - **Voice:** Pip's line (`lockedGate(n)`, `lockedCollect(n)`, `lockedReach`, `lockedLift`, `lockedGoal`), at most
    once every 8 s.
  - **Beacon:** `setBeacon` over the gate or post that opens the lock.
  - **Pulse:** `pulseLock`.
- **The region guard is the main enforcement.** L1's M0 spike showed that a ball can hop around about 90 % of cut
  positions on real sites, so the guard catches those hops:
  - It runs on every `island` event and on every `landed` event (the island under the ball).
  - An island beyond a closed lock sends the ball back to the last allowed restart point through the existing
    `reset(to)` path. No life is lost, and the recording is marked inexact.
  - Pip says `pip.oops` at most every 4 s. The banner names the lock the ball went around, and the beacon lights its
    gate.
  - Activations are counted in the debug state.
  - The guard runs only in `play`.
- **Grown-up override:** in the pause menu, a press-and-hold "Grown-ups: hold to open the next lock". It is shown only
  when the level's `override` is `grown-up` and a lock is still shut.
- **Unranked:**
  - A session that played a lesson sets `view.learningRun`.
  - Recordings are inexact, and there is no ghost fetch or race.
  - `submitName` refuses, and the ranking is marked skipped without asking the boards.
  - The result shows "Learning run", and the ranking says nothing was submitted.
  - With no lesson, the sim loads exactly as before (`sim.load(stage)`, no options).

### The gate card
- It uses `currentRound` (the shuffled round) and `sessionScript` for the lines.
- `choice` cues set `.is-callout` on the named `[data-choice-mark]` and its `[data-key-badge]`.
- **The input policy** is `inputPolicy(path, activity, round, device)`:
  - `tap` is always available;
  - `keyboard` means keyboard play or any key pressed;
  - `tilt` means a paired phone.
- **Badges:** when `policy.badges` is set, the scene gets `show-keys`, the card shows the invite ("Press the letter"),
  and Pip says `policy.promptLine` right after the callout.
- **Answering:**
  - Letter and number keys answer through `keyToChoice`.
  - An answer through an input the round didn't invite gets `nudgeLine(policy)` and a flash of the badges, twice,
    and is then accepted (`judgeInput`).
  - `family.tapOnly` accepts everything and hides the badges.
- A locking step offers "Later" instead of "Skip gate". The card closes, the lock stays shut, and the gate stays open
  for another try.

### L1 integration
- `LockPort` (`port.ts`) wraps every physics and engine call. The real port looks up the game's current
  `SimDriver` and `Engine` on each call. `FakeLockPort` records calls for tests.
- I first built against feature detection, then merged L1's branch and switched to the typed API.
- L1's `sim-driver.ts` replaced mine in the merge (the two were equivalent).

## Coverage (the batch-eval set)
The run was `WWM_LOCK_COVERAGE=1 pnpm vitest run --project @wwm/web test/learning-locks.test.ts -t batch-eval`. It
covered every capture × slice × easy/normal/hard × seeds 1–3, **666 stages**; the report is in
`/tmp/wwm-p22-coverage.json`.
- **Invariants:** (a)–(d) and "configuration honoured" hold for every level of every baseline lesson on **666 of 666**
  stages. There were 0 failures.
- **`compare-groups` / `gated`** (4 path steps, bridges and lifts):

  | | steps | share |
  |---|---|---|
  | physical lock (bridge or lift) | 1,860 of 2,664 | 69.8 % |
  | goal-lock fallback | 516 | 19.4 % |
  | no room for a gate (unplaced) | 288 | 10.8 % |

  - Stages where all 4 steps got a physical lock: 318 of 666 (47.7 %).
  - Stages with at least one fallback: 283.
- **Chokepoints per stage:** the median is 8–9. The chain is rarely the limit. The limit is room for a gate in front
  of a cut, and it is below the M0 target of 80 %.
- **Unplaced round steps** are asked on the stage-start card, as Phase 20 did for stages with no room. They lock
  nothing on that stage.
- **Practice stage `gated`:** 3 physical locks: the three 0 → 1 bridges as one link, bridge 1 → 2, and the lift.
  Step 4 keeps the finish shut.

## Tests
- **`test/learning-locks.test.ts`** (new, 31 tests):
  - the graph, the minimum cuts and the chain;
  - the practice-stage binding, and every baseline level sound and honoured;
  - each acceptance rule per field: `mode` none and goal, bridges-only, a step with `lock: none` or `lock: goal`,
    `goal: false`, start = goal;
  - a fast-check property test over 600 random island multigraphs with random plans and configurations;
  - the batch-eval sample (5 captures by default, the whole set with the env var);
  - missions: counts, lowering, letters, ties;
  - level resolution;
  - the session through a fake port: locks load closed, open on solving, the finish opens last; the lock signals
    and their 8 s limit; signals off; override `none`; the grown-up override; the region guard, including a
    hop-around test with the oops rate limit and the banner; done steps staying open; collect and reach missions;
    input policy, nudges, letter keys, tap-only, device fallback; shuffling; follow-ups; "Later";
  - the port forwarding.
- **`test/learning.test.ts`** (Phase 20, updated): 16 tests. Gates are bound to steps, the `open` signature changed,
  and `explore` keeps the Phase 20 behaviour.
- **`test/learning.e2e.test.ts`:** 4 tests. Two are the Phase 20 tests, updated: the seed is pinned, and the last
  step goes on to the finale. Two are new:
  - **`gated`, against L1's real gate:**
    - Roll at the locked bridge with POWER for 3 s. The banner "🔒 Solve Pip gate 1 first" appears and Pip says
      `pip.locked.gate.1`.
    - The ball stays on the start island. There are no guard activations and no lives lost.
    - A hop onto an island past the lock (an injected `island` event) triggers the guard, which sends the ball back,
      and Pip says oops.
    - Solve gate 1 and the lock opens.
    - Roll at the same bridge and the ball crosses to island 1.
    - Gate 2's letter-key round shows key badges, the callout pulse and the voiced invite, and `A` answers it.
  - **Loader and missions:**
    - The loader strip shows the level and its description. A tap does nothing; a 2 s hold opens the picker.
    - Switch to `mission` and solve gate 1.
    - Roll into the collect post. The mission starts and the HUD shows "Bring Pip 4 gems".
    - The pause menu shows the grown-up override.
- **`pnpm check`:** green. See the hand-off report for the exact line.

## Screenshots (`WWM_P22_SHOTS=1`, 1280 × 720, in `/tmp/wwm-p22-game/`)
| file | shows |
|---|---|
| `1-loader-level.png` | the loader strip: "Level: Gated" with its generated description, and the Grown-ups control |
| `1b-loader-levels.png` | after the hold: the picker with all four levels, "author's choice" on Gated, Missions picked |
| `2-lock-banner.png` | the ball against L1's gate at the bridge; padlock and "Pip gate 1" card; the banner "🔒 Solve Pip gate 1 first" below the ball |
| `2b-lock-opened.png` | after solving: the gate is gone, the HUD's first step is green, the banner cleared |
| `3-mission-post.png` | the "Mission: 4 gems" post (teal, Pip face) and the gem padlock on the bridge it opens |
| `4-mission-hud.png` | the mission chip at the bottom: "Pip's mission · Bring Pip 4 gems" and four empty gem slots |
| `5-gate-card-badges-callout.png` | gate 2 (r2): A/B key badges, the callout halo on island A, the "Press the letter" invite, "Later" |
| `6-pause-override.png` | the map with padlocks and the pause menu's "Grown-ups: hold to open the next lock" |

**Review fixes made from the screenshots:**
- **Banner timing:** the banner flashed for 1.6 s and was half faded in the shot. It now holds for about 4.5 s.
- **Banner flicker:** each `locked` restarted the animation. The same message isn't restarted while it still shows.
- **Banner position:** it sat on the 3D padlock, so it moved below the ball.
- **Stale banner:** a banner lingered after its lock opened. It now clears when its step is done or a gate opens.
- **Mission chip:** it collided with the posts' floating labels, so it moved to the bottom centre.
- **Picker alignment:** the panel now top-aligns while the picker is open.

## Attempts that failed
- The first minimum cut counted single edges. Three parallel bridges then cost 3, so the chain skipped the 0 → 1
  chokepoint. Counting links fixed it.
- The first `debugRollIntoLock` aimed at the bridge mouth, which is on the island edge, so no run-up fitted. It now
  starts on the connector's axis.
- A test expected a paired phone to fall back to tap in a letter-key round. `inputPolicy` invites tilt there, which
  is correct, so the test was wrong.

## Manual interventions
None by the user. On the orchestrator's instruction, the region guard was promoted to the main enforcement and L1's
branch was merged.

## Requests and known issues
- **`packages/learning`:**
  - A "Level" intro line, and a banner or voice line for the guard that names the gate ("Oops! Solve Pip gate two
    first."). `pip.oops` says only "Oops! Pip's gate first."
  - `inputPolicy` returns no prompt for tilt-only phone play. That looks intended, but it means a phone round never
    voices its invite.
- **Engine (L1):**
  - `setLocks` has no way to honour `signals.mapPadlocks: false`; padlocks always show in the map view.
  - Islands have no drawn letters, so `reach { letter }` targets (and ties) rely on the beacon.
- **Coverage:** 69.8 % physical is below the M0 target of 80 %. The limit is room for a gate in front of a cut (Phase
  20's spot rules), not chokepoints. A follow-up could let a gate stand closer to a mouth, or let a builder option
  place chokepoint islands deliberately (the plan's follow-up).
- **More than one unplaced round step** on a stage: the start card asks only the first.
- **Physics without locks:** the interim path (a goal event swallowed while the finish was locked, and a re-check on
  reaching the goal) remains for builds without runtime locks. With L1 merged it is unused.
