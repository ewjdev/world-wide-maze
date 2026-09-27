# Phase 22 — Learning mechanics: the maze follows the lesson
**Wave:** education track · **Builds on:** Phase 20 (`wwm-learning/0.2`, Pip gates), PR #11 · **Contracts:** `@wwm/learning` → `wwm-learning/0.3` (CCR-EDU-03); `@wwm/schema` `SimEvent` + physics load options (CCR-GAME-01) · **Label:** N (new; not a 2013 feature)

> **Status: DRAFT FOR SIGN-OFF (September 26, 2026).** The user's decisions from the same day are recorded below. Nothing in this plan has been built.

## Goal
Make the maze the lesson. A learning page declares **how progress works**: which rounds and missions must be done, in what order, and how the child may answer. The game makes any website's maze obey those rules:
- A **visibly locked bridge or elevator** stays shut until the Pip gate (or mission) in front of it is done.
- Rolling up to a lock says what's needed ("Solve Pip gate 2 first!") and points to it.
- Higher difficulty adds **missions** that use the maze's own gems and islands as math: "Bring Pip four gems", "Roll to the island with the most gems".
- The voice now also **animates the choices** as it names them, and the lesson **varies how the child answers** (tap, letter key, number key, arrows or tilt) and **shuffles where the right answer sits**.

## Decisions (user, September 26, 2026)
| # | Question | Decision |
|---|---|---|
| E1 | "Mix up the mouse or keys" | **Both**: vary the input type per round **and** shuffle answer positions |
| E2 | Who picks difficulty | **The grown-up in the parent area**; the **lesson author's default** applies until they do |
| E3 | Locks | **Visible locked bridges (and elevators) are a must-have**, with an indication at the bridge that another task must come first |
| E4 | Architecture | Mechanics live in the **learning API**. The learning HTML declares the semantics; the maze logic follows them |

## Principles
1. **Declare intent, not geometry.** A lesson never names a bridge; it can't know which website becomes its maze. It declares ordered **steps** (rounds, missions) and a **gating** rule. The game binds those to the stage's island graph at load time.
2. **Explicit capability.** A game declares the mechanics it supports (`supports: ['gates.block', 'mission.collect', …]`). A level that requires something unsupported is not offered, the same fail-closed rule as round kinds today.
3. **A lock is never a punishment.** Wrong answers cost nothing: no lives, no score, and the timer stays paused at gates. The hint ladder always ends in a worked example. Steering skill is not a learning signal.
4. **Grown-ups choose.** The level is a grown-up setting (parent area, or the game's loader strip behind a grown-ups control). The child never has a "skip" in gated levels; a **grown-up override** can open a lock.
5. **Learning runs are unranked.** Locks change physics, so these runs can't be verified by the server replay (`apps/worker/src/routes/scores.ts:77`). They never submit scores or ghosts, and the result screen says "Learning run".

## Design

### 1. Voice-synced choices (E1, page and game)
- `scriptFor` adds a generated **callout** line per round, spoken right after the prompt:
  - compare: "Island A… or Island B?", or "Island A, Island B… or the same?"
  - choose: "Group A, Group B, or Group C?" (names for shape rounds: "Square, circle, or triangle?")
  - difference: "Two, three, or four?"
- A new cue type `{ type: 'choice', id }` pulses the named choice (`[data-choice-mark].is-callout`) and flashes its key badge as the word is spoken.
- The callout names **positions**, not answers, so shuffling (below) never makes it lie.

### 2. Answer positions and input variety (E1)
**Shuffling.**
- `presentRound(round, seed)` in `@wwm/learning` returns the round as shown: compare islands may swap (the answer letter follows), and choose options are permuted.
- The seed is per play-through (`LessonState.seed`), so a replay of the same session is identical.
- Validation still runs on the authored round.
- `play.shuffle: 'positions' | 'none'`, default `'positions'`.
- **Clip lookup moves from line id to text.** Clips are deduplicated by text hash already, so "One, two." keeps its clip when it becomes island B's count line.

**Input modes.** `input` is declared per round (overriding the activity default, which overrides the path default). Each value is a list of the ways the child is *invited* to answer:

| Mode | How | Where |
|---|---|---|
| `tap` | click or touch the choice | page, game |
| `letter-key` | press the letter on the choice's key badge (`A`, `B`, `S` for Same, `C`…) | page, game (keyboard play) |
| `number-key` | type the digit (difference rounds) | page, game (keyboard play) |
| `arrows` | ←/→ then Enter | page, game |
| `tilt` | tilt the phone, confirm with JUMP | game (phone play) |

- **Device capability decides fallbacks.** An invited mode the device can't do (a letter key on a phone with no keyboard, tilt on a laptop) falls back to `tap`/`arrows`.
- **When the device can,** other inputs get a gentle nudge rather than an answer. Tapping an island in a `letter-key` round makes Pip say "Try pressing the letter! A or B?" and flashes the badges. That keeps the variety real without ever blocking a child who can't find the key: after two nudges, taps are accepted.
- **Input prompts are voiced** and generated from the mode: "Press the letter!", "Type the number!", "Tilt to choose, then jump!".
- **Baseline mix for compare-groups:**
  - r1 `tap`, r2 `letter-key`, r3 `tap`, r3b `arrows`
  - r4 `letter-key` (A / S / B)
  - bonus r5 `tap`, r5b `number-key`
- **Grown-up accessibility setting:** "Answer by tapping only" disables the variety for children who need it.

### 3. Levels, steps, and gating (E2, E3, E4): `play` in `wwm-learning/0.3`
```jsonc
"play": {
  "defaultLevel": "gated",                       // the lesson author's default (E2)
  "shuffle": "positions",
  "input": { "default": ["tap", "arrows", "tilt"] },
  "levels": [
    { "id": "explore", "gating": "none",      "steps": "rounds" },
    { "id": "gated",   "gating": "lock-path", "steps": "rounds" },
    { "id": "mission", "gating": "lock-path",
      "steps": [ { "round": "r1" }, { "round": "r2" },
                 { "mission": "collect", "count": 4 },
                 { "round": "r3" }, { "round": "r3b" },
                 { "mission": "reach", "island": "most-gems" },
                 { "round": "r4" } ] }
  ]
}
```
- **Level ids are standard** (`explore`, `gated`, `mission`), so the parent picker is one control for the whole path.
- **Missing levels are generated.** An activity without `play` gets `explore`, plus `gated` (all required rounds).
- **`steps: "rounds"`** means the required rounds in order. The conditional follow-up (r3b) and bonus rounds stay optional and never lock anything.
- **Gating:**
  - `none`: today's behaviour. Gates are optional, and the goal is always open.
  - `lock-path`: each step locks the way forward until it is done, and the goal stays locked until every step is done.
- **Missions (v1):**
  - `collect { count: 1–10 }`: gems picked up after the mission starts count. Pip counts each pickup aloud ("One!", "Two!", …) and the HUD shows the progress in gem icons. This is counting by doing.
  - `reach { island: 'most-gems' | 'fewest-gems' | { letter: 'C' } }`: roll to that island. The maze labels its islands with letters. "Most gems" is comparison in 3D. The target is fixed when the mission starts; ties fall back to a letter target.
  - **If the stage can't satisfy a mission as written** (fewer reachable gems than `count`), the game lowers the count to what's available. The count lines are templated number words, so the voice still matches. The substitution is recorded in the debug state.
- **Validation:**
  - steps reference existing required rounds, in authored order;
  - mission counts are 1–10;
  - `defaultLevel` must be one of the levels.
- **The family version records the grown-up's choice** as `play.selectedLevel` (plus the tap-only setting). It travels in the exported learning HTML, so the game plays the level the parent chose.

### 4. Binding steps to a maze (game)
The stage already records the island graph: bridges `from`/`to`, elevators `islandFrom`/`islandTo` (`packages/schema/src/types.ts:116-140`). A pure module `apps/web/src/learning/locks.ts`:
1. **Graph and path.** Build the undirected island graph (bridges and elevators are edges) and the BFS start→goal island path `P`.
2. **Assign steps to host islands** spread along `P`, reusing Phase 20 gate placement for the gate's spot. Mission steps get a **mission post** (a Pip sign) instead of a gate.
3. **Pick a lock cut for each step**, in order: a minimum edge cut between the islands on the start side of the host (host included) and the goal, with earlier cuts treated as open. Unit-capacity max-flow is enough on graphs of about 40 islands.
   - **Invariants,** property-tested:
     - (a) with cuts ≥ j closed, step j's host is reachable;
     - (b) with cut j closed, the goal is unreachable;
     - (c) with all cuts open, every island is reachable.
   - **If no valid cut exists** (start and goal on one island, or a step's host past the last cut), that step falls back to a **goal lock** only. The goal lock is always present in `lock-path`.
4. **Region guard (backstop).** A ball that ends up beyond a closed lock by other means (a jump, a drop) is returned to the last allowed restart point, and Pip says "Oops! Pip's gate first." This uses the existing `island` SimEvent, and is logged in the debug state so bypasses can be found and fixed.
5. **Coverage check** over the batch-eval stage set (`tools/batch-eval`, 800+ stages): report how many stages get physical locks for every step, and how many fall back to goal locks.

### 5. Locks in physics and on screen (E3)
**Physics** (`packages/physics`, CCR-GAME-01):
- **Loading locks:** `load(stage, { locks?: LockSpec[] })`, where `LockSpec = { id, kind: 'bridge' | 'elevator' | 'goal', targetId, islandId }`. All locks start closed.
- **Opening:** `setLock(id, open)`. The worker protocol gains a `lock` message.
- **Bridge lock:** a static barrier collider across the deck at the apron on the host island's side (the `bridgeSpecs` apron geometry, `geometry.ts:234-284`). It is tall enough that POWER + JUMP can't clear it, and is disabled via `Collider.setEnabled` when opened (the pattern items and elevators already use).
- **Elevator lock:** the ride trigger (`simulation.ts:593-599`) is ignored while locked, and a barrier sits on the lower-platform entry.
- **Goal lock:** while closed, the goal sensor doesn't latch `goalReached` (`simulation.ts:553-556`); it emits `locked` instead. Opening re-arms it.
- **New SimEvent:** `{ type: 'locked', lockId }`, emitted when the ball touches a closed lock, at most once per second per lock.
- **Scoring:** lockstep recording is marked inexact for learning runs, and they never submit (Principle 5).

**Engine** (`packages/engine`):
- **Barrier mesh:** a new instanced mesh, one draw call, built like `portals.ts`. Each lock is a gate of bars across the bridge in the theme's gate colour, with a padlock badge showing Pip and a label card ("Pip gate 2", or a gem icon with "4 gems").
- **States:** closed, then opening (bars drop, sparkle), then open (gone). Touching a closed lock pulses it.
- **Bridge deck:** a locked bridge's deck is dimmed. This needs a per-vertex `bridgeIndex` plus a uniform array, the same pattern as `elevatorY` (`stage-world.ts:222-228`). Elevator platforms get the padlock badge, and the goal ring greys out with a padlock until it opens.
- **Beacon:** `setBeacon(pos | null)` draws a light beam over the gate or post that opens the lock the child just touched, the same beam the map view draws over portals.
- **Map view:** locks show as padlocks on their bridges, with a line to the gate that opens them.

**Messages at the lock** (the E3 "indication"):
- **Banner:** a `locked` event shows a keyed HUD banner (the `wwm-hud__inst wwm-flash` pattern): "🔒 Solve Pip gate 2 first", or "🔒 Bring Pip 4 gems first. You have 1."
- **Voice:** Pip says the matching generated line, at most once every 8 s.
- **Pointer:** the beacon lights the gate or post that opens this lock.
- **On unlock:** Pip says "The bridge is open!", the bars drop, and the map updates.

### 6. Parent area and game loader (E2)
- **Parent area** (`apps/education` home, "For parents"):
  - A **Game level** control with three options: *Explore* (gates are optional stops), *Gated* (bridges stay locked until Pip's question is answered), *Missions* (gated, plus gem and island missions). The lesson author's default is marked.
  - An **Answer by tapping only** switch.
  - Saved with the family version (local, like the introductions) and included in "Download learning HTML". Lesson pages show "In the game: Gated" in the grown-ups notes.
- **Game loader strip:** shows the level from the document. A **Grown-ups** control (press and hold for 2 s) changes it for this session. The grown-up **override** to open a lock lives in the pause menu, behind the same hold.

### 7. Voice
- **New generated lines:** callouts, input prompts, lock messages (per gate number and per mission), mission lines (templated counts 1–10: "Bring Pip four gems!", "Three!", "That's four! The bridge is open!"), unlock lines, and level intros. Roughly +90 lines and about 3,500 characters. All go through `pnpm learning:voice --write` (AI Gateway `wwm` → ElevenLabs), with the clips in R2.
- **Pickup counting** reuses one short clip per number word, "One!" to "Ten!".

## Ownership
**Orchestrator:**
- `packages/learning` (0.3 contract, script, `presentRound`, and a `locks` helper, if it proves engine-neutral)
- CCR-GAME-01 in `plans/contracts.md` and `packages/schema` (the `SimEvent` `locked` variant)
- `tools/learning-voice` runs
- docs

**Sub-agents:**

| Area | Paths (edit) | Sub-agent |
|---|---|---|
| Physics locks | `packages/physics/**` (additive API, worker protocol) | L1 |
| Engine locks | `packages/engine/**` (barriers, bridge dimming, beacon, map padlocks) | L1 (same agent: physics and engine are one feature) |
| Game adapter | `apps/web/src/learning/**`, wiring in `game.ts`, `Play.tsx`, `LearningPanel.tsx`, i18n, `apps/web/test/**` | L2 |
| Lesson page and parent area | `apps/education/**`, `docs/education/**` | L3 |

Not touched: the worker (except that learning runs never reach the scores endpoint), `stage-builder`, and the solver (read-only reuse for coverage checks).

## Milestones
| M | Work | Size | Exit check |
|---|---|---|---|
| **M0** Spike | (1) A barrier collider across one fixture bridge mouth stops the ball at top speed with POWER + JUMP. (2) Measure jump and drop bypasses on 50 batch-eval stages. (3) Prototype the cut-based lock placement and report coverage | S | Barrier holds; bypass rate known; coverage ≥ 80% physical locks for `gated` |
| **M1** Contracts | `wwm-learning/0.3`: `play` levels, steps and missions, `input`, `shuffle`, `presentRound`, callout and cue types, clip lookup by text, `selectedLevel`. CCR-GAME-01: `SimEvent.locked`, `LockSpec`. Migration 0.2 → 0.3 | M | Unit tests; 0.2 documents and family forks still load |
| **M2** Physics and engine locks (L1) | `load({locks})`, `setLock`, the `locked` event, goal re-arm, elevator lock; barrier mesh, bridge dimming, beacon, map padlocks, unlock animation | L | Physics unit tests (a closed lock blocks, an open lock passes, determinism with locks); engine screenshot at 1280×720 |
| **M3** Game adapter (L2) | `locks.ts` (graph, path, cuts, region guard), steps → gates and posts, missions (collect, reach) with HUD and voice, lock banner and beacon, level from the document plus the grown-ups control, unranked learning runs, input modes and shuffling in the gate card | L | Property tests of the invariants on the fixture and batch-eval stages; e2e: blocked at a lock → message → solve the gate → the lock opens → cross |
| **M4** Page and parent area (L3) | Callout animations, shuffled positions, input modes with key badges and nudges, tap-only setting, Game level control, export | M | e2e on 390×844 and 1440×900; exported HTML carries `selectedLevel` |
| **M5** Voice | Generate the new lines; `--verify` | S | Manifest test green; all clips in R2 |
| **M6** Walkthrough and hand-off | Orchestrator walkthrough: page (callouts, a letter-key round, shuffle) and game at each level on the practice stage and one real site. A physical-iPhone tilt check with the user. Build log, `pnpm check`, PR | M | Screenshots reviewed; the user tries it |

M2 and M4 run in parallel after M1. M3 starts after M1, against the M2 API as specified in §5, and integrates when M2 lands.

## Acceptance
- **Checks:** `pnpm check` green; `pnpm build:education` passes; the existing portal, game and replay e2e tests unchanged and green.
- **Page:**
  - Pip's callout pulses each choice as it's named.
  - Answer positions differ between play-throughs, but a replay of the same session is identical.
  - Letter-key and number-key rounds work with a keyboard, nudge a tapper twice, then accept the tap. On a touch-only device they fall back to tap.
  - "Tap only" turns the variety off.
- **Parent area:** the level control defaults to the author's level; the choice persists and is exported.
- **Game, `explore` level:** behaves exactly like Phase 20.
- **Game, `gated` level:**
  - Every step has a visible lock on the practice stage.
  - Rolling into a closed lock shows the banner, Pip's line and the beacon, and does not let the ball cross, even with POWER + JUMP.
  - Solving the gate opens it with the animation.
  - The goal refuses to finish until all steps are done, and says so.
- **Game, `mission` level:** "collect N" counts pickups aloud and opens its lock at N; "reach most-gems" opens on arrival.
- **Placement:**
  - The invariants hold on 100% of the batch-eval stages that the placement accepts.
  - Coverage (physical locks vs goal-lock fallback) is reported in the build log.
  - Region-guard activations during the walkthrough: 0 on the practice stage.
- **Rules:**
  - Learning runs never submit scores or ghosts.
  - The timer is paused at gates.
  - No lives are lost because of a lock.
  - The grown-up override opens a lock.

## Risks
| Risk | Mitigation |
|---|---|
| A child can't steer well enough to reach gates | `explore` stays available; the grown-up picks the level; keyboard play; the override. Record in the playtest |
| Jumps or drops bypass a lock | M0 measurement, barriers tall enough to stop a POWER jump, and the region guard as a backstop |
| Stages with no clean cut | Goal-lock fallback, and coverage reported. A later builder change could place gates at chokepoints |
| Physics changes break determinism or verification | Locks exist only when passed at load; ranked runs pass none. The existing replay e2e must stay green, and learning runs are unranked |
| Engine draw-call and perf budget | One instanced barrier mesh (like portals); bridge dimming via the existing uniform-array pattern; measure on the perf scene |
| Input variety frustrates the youngest | Nudge twice then accept; tap-only setting; device fallback |
| Missions feel like chores | Missions are voiced as Pip's requests with counting feedback on every pickup. Playtest with the tester and trim what drags |
| Scope | Missions v1 is only `collect` and `reach`; more kinds only after the playtest |

## Follow-ups (not this phase)
- A builder option to place chokepoint islands deliberately for lessons.
- More mission kinds, for example "collect exactly", "bring the triangle gem", and patterns in item order.
- Syncing progress across devices, which needs accounts.
- Voicing personalized lines (#10).
