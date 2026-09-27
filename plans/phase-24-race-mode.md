# Phase 24 — Race mode: flowing island courses and personal ghosts

Status: execution plan; implementation has not started. The user confirmed Race as a distinct third gameplay style alongside Original and Education. This document proposes implementation defaults and gates; it does not report completed features or authorize deployment.

Label: **N (new)**. This is an extension of the revival, not a claim about the 2013 game.

## 1. Outcome and scope

Build a ball time-trial mode in which players learn a readable course through webpage-derived islands and race translucent recordings of their own attempts. Preserve familiar POWER, tilt, steering, and JUMP behavior. Give Race its own course construction, session rules, timing, history, and results.

The experience should reward anticipation, cornering, and preserving momentum. Flow is a human-experience hypothesis to test, not something a geometry score or solver can certify.

| Mode | Objective | Rules and content |
| --- | --- | --- |
| Original | Navigate, collect, reach the goal | Existing maze, score, lives, timer, portals, and leaderboard behavior |
| Education | Complete learning activities | Existing education entry points, lesson content, gates, missions, and progress |
| Race | Improve a finish time against previous attempts | Readable course, ordered sectors, personal ghosts, quick retry, local history |

### Confirmed direction versus proposed defaults

- **Confirmed:** Race is a third mode, not an Original difficulty or a leaderboard toggle. Reuse ball handling; design for continuous travel through islands; support shadows of prior personal runs; investigate connectors that turn while changing height.
- **Default for implementation:** a point-to-point, gently descending sprint, approximately 45–90 seconds after learning it, with about 8–12 islands. These are design targets, not measured outcomes. Closed circuits and laps follow later.
- **Default:** authored HTML courses first, one obvious route, no required jumps, no elevators, no item-score competition or outbound portal transitions during a race.
- **Default:** local personal records without accounts. A fastest eligible finish and a previous-attempt ghost; at most two visible ghosts initially.
- **Default:** normal timing uses simulation ticks. Pause or controller loss pauses the attempt and marks it practice-only; a new uninterrupted attempt can set a record. Falls likewise make an attempt practice-only, with recovery or immediate retry available.
- **Deferred:** multiplayer, public race rankings, cloud history, arbitrary-URL course guarantees, branching shortcuts, procedural difficulty adaptation, loops/overpasses, banking, and new driving assists.

The sprint/circuit decision remains open, but sprint is the working default so planning can proceed. Geometry and record formats must leave room for laps without implementing them now.

## 2. Current implementation evidence

The following was inspected in the working checkout while preparing this plan. README performance figures are historical and are not fresh measurements.

| Area | Current seam | Consequence |
| --- | --- | --- |
| Island construction | `packages/stage-builder/src/build.ts`, `islands.ts`, `semantic.ts`, `walkable.ts` | Reuse screenshot/DOM processing, contours, and ball clearance; HTML is an input to these operations, not a direct mesh specification |
| Maze selection | `packages/stage-builder/src/maze.ts` | Randomized DFS considers connectivity and deck conflicts, not a flowing sequence of entrances and exits |
| Connections/heights | `packages/stage-builder/src/bridges.ts`, `levels.ts`, `params.ts` | Cardinal candidates, straight sloped decks, noisy target heights, and eligible elevators; existing parameter overrides can help a first fixture |
| Course identity | `packages/stage-builder/src/build.ts` | Ordinary stage ID hashes capture, slice, seed, builder version, and difficulty; arbitrary parameter overrides and Race rules are not part of that identity |
| Physics | `packages/physics/src/geometry.ts`, `simulation.ts`, `replay.ts` | Straight bridge boxes; deterministic tick replay; existing fall/reset behavior; no curved connector contract |
| Ghosts | `apps/web/src/ranking/ghost.ts`, `game/game.ts` | Inputs can become a pose track and translucent ball; game integration loads a server leaderboard ghost, not persistent personal history |
| Recording | `apps/web/src/game/game.ts`, `sim-driver.ts` | Lockstep records consumed inputs; exact completed recordings are kept in session memory; some resets cannot be represented by the existing replay format |
| Tick observation | `apps/web/src/game/sim-driver.ts` | One `advance()` can execute multiple steps but returns only the last ball state; Race needs a post-step observer rather than frame-level checkpoint detection |
| Finish and retry | `packages/physics/src/simulation.ts` | The ordinary goal event latches on first contact. `reset()` teleports without clearing that latch or simulation ticks; `load()` restores the initial world |
| Phone state | `packages/schema/src/types.ts`, `zod.ts`, `packages/net/src/connection.ts`, `apps/web/src/controller/ControllerPage.tsx` | Validated messages use Original phases, score, balls, and time remaining; the HUD displays those fields directly. Race needs a compatible protocol extension before phone acceptance |
| Game integration | `apps/web/src/routes.tsx`, `ui/GameApp.tsx`, `game/game.ts` | Original shell owns the main lifecycle; Education also has its own app and learning adapters. A unified three-mode lifecycle is not already implemented |
| Validation | `packages/solver/src`, solver README | Existing bot proves traversal, can slow to a crawl, and uses 2D navigation; its success does not establish race speed or support stacked crossings |

## 3. Product behavior to implement

### Entry and attempt loop

1. Present Original, Education, and Race as distinct choices at the shared game entry. Preserve existing direct links and Education deployment/entry behavior; resolve its actual target from current configuration rather than inventing a route.
2. Race opens a small course selection screen, showing personal best and a course preview. Proposed routes: `/race` and `/race/:courseId`.
3. Course screen offers **Race**, ghost choice, and controls. First visit can explain controls without advancing the race clock.
4. Load the fixed course into a fresh simulation state, prepare ghosts, then show a short countdown. No movement or input buffering grants an advantage before GO.
5. Play with elapsed time, next-sector guidance, and brief split feedback. Keep the physical ball visually dominant. No lesson interruptions or Original score submissions.
6. Finish shows time, personal-best difference, sector comparisons, and **Race again** as the main action. Also offer ghost selection, course selection, and exit.
7. Retry reloads the cached course into its initial simulation state and resets the Race session. It does not recapture HTML, change the seed, reconnect the controller, or replay a long intro. A ball teleport alone is not a retry.

### Timing, sectors, and record eligibility

- Tick zero is the initial state at GO, before any enabled simulation step; the first completed step is tick one. Freeze simulation during countdown. Store start, sector, and finish ticks explicitly; format milliseconds only for display.
- Use ordered, directional sector gates with finite width and height. Detect swept crossings between successive physics-step positions so fast motion cannot skip a gate. Race's own finish gate requires all sectors; the ordinary physics goal event is never authoritative for Race completion.
- Retain JUMP. Gate order and course boundaries prevent cutting across islands to skip the course; legitimate lines between gates remain the player's choice.
- Compare sector splits at the same gate. Do not infer a time lead from Euclidean distance between balls, which is misleading around turns.
- A fall, manual recovery, pause, focus-loss pause, or controller-disconnect pause makes the attempt ineligible for a personal best. Explain this as practice status while allowing the player to continue or retry. Paused time is excluded consistently from playback and displayed active time.
- A personal best requires a completed, uninterrupted, fully recorded attempt under identical compatibility settings. Tied tick counts retain the earlier record. No 300-second Original countdown, spare-life economy, or collectible bonus in Race.
- Incomplete and practice attempts can appear in recent history and as optional ghosts when their available input range is replayable. Label any capped prefix and stop its ghost at the recorded end. They never displace an eligible personal best.

## 4. Architecture and contracts

### Shared systems, explicit mode boundaries

Add an explicit game-mode resolution boundary with `original`, `education`, and `race` values. Existing links resolve as they do today; conflicting Race and learning options produce a clear error, not mixed rules.

Create `packages/race` for pure race-domain contracts, eligibility rules, sector progress, record comparison, and compatibility. Create `apps/web/src/race` for session orchestration, screens, local storage, and ghost management. Both import shared types from `@wwm/schema` rather than copying them.

Reuse engine, physics, controller, audio primitives, and input sampling. Give Race its own state machine (`loading → ready → countdown → racing → finished`, with pause/retry/exit transitions). Introduce narrow shared lifecycle adapters only where needed; do not fork the entire `Game` class or broadly rewrite Education and Original to enable Race.

### Authoritative tick processing, finish, and retry

The first Race release requires the lockstep driver at the stored physics step rate (currently 120 Hz). Ignore or reject the free-running worker override for Race; its estimated ticks and frame-latched inputs cannot establish exact records. Replay preparation may run headlessly in a separate worker, but must execute the same fixed-step logic.

Add an optional post-step observer to `SimDriver.advance()` in `apps/web/src/game/sim-driver.ts`, invoked after every completed lockstep step, including catch-up steps. It supplies the completed tick, previous/current physical ball state, and that step's events, and can stop further stepping for the frame. Preserve existing callers' event behavior when no observer is supplied. Race processes the complete step through this observer rather than handling finish effects through the Original event callback.

Implement a pure Race progress reducer in `packages/race`; live play and a dedicated Race replay runner call it with the same ordered steps. The runner must not reuse `recordGhostTrack()` unchanged: that helper stops at the ordinary physics goal and does not apply Race sector or recovery semantics.

1. Apply recorded manual recovery at the defined boundary before step N; record its destination and ineligibility reason. Rebase the previous-position sample to the recovered position, so the teleport never crosses gates. Automatic recovery uses the same timeline semantics and must not also trigger the legacy replay helper's automatic reset.
2. Record the exact input consumed for step N, step physics, and observe the completed state. Apply fall/ineligibility events before determining record eligibility for a finish in that step.
3. Find forward crossings along the physical segment, sorted by intersection fraction. Advance only the next expected sector. Permit multiple correctly ordered crossings in one step and record integer tick N for their splits; do not award sub-tick finish precision. Reject coincident gate planes at course validation so ordering has no ambiguous tie.
4. Accept a Race finish crossing only after all required sectors, stop stepping immediately after that physics step, and stop the recorder at the same tick. An early finish crossing does not disarm the Race gate; a later valid forward crossing can finish. Ignore ordinary `goal` events for Race transitions, haptics, and replay stopping.

Use a single serialized retry operation: pause stepping, cancel obsolete replay preparation and UI callbacks, retain the immutable course/texture and paired room, reload the cached stage plus any Race world payload with `load()`, reset the Race reducer/recorder/ticks/accumulator, and rewind ghosts. Allow a finalized previous attempt's atomic save to commit under its own ID; retry must not discard that record. Restore the renderer's ball pose and camera to the initial course view. Clear pending jump/menu edges and input filters; sample current continuous steering at GO rather than replaying countdown input. Tag asynchronous work with the attempt generation so an old completion cannot finish or overwrite a new attempt. Distinguish this full reload from an in-attempt practice recovery using `reset()`.

**M0 contract / M1 proof:** the same recorded inputs under 30/60/144 Hz render schedules and bounded catch-up frames must yield identical sector and finish ticks. Cover crossing and recrossing a gate within one rendered frame, early finish followed by legal finish, last-sector-plus-finish in one step, recovery across a gate, and repeated finish/retry cycles. Compare the initial simulated state and first input sequence after each retry, not only the visible ball position.

### Phone compatibility contract — required for M1

Record a controller Contract Change Request during M0, separately from the later curved-geometry request. Extend shared types and Zod validation in `packages/schema`, consumption in `packages/net`, and host/controller adapters and HUD in `apps/web/src/controller`. Keep the existing 12-byte controller input format and ordinary `StateMessage` behavior intact.

- Add an optional versioned Race payload to host state containing Race phase, elapsed ticks and step rate, current/total sectors, practice status, and an optional split delta. Maintain valid legacy phase values in the outer envelope through an explicit mapping: Race loading→building, ready→select, countdown→countdown, racing→play, paused→paused, finished→result. Keep legacy score/balls/time-left fields neutral; never encode elapsed time into `timeLeft`. A Race-aware phone hides those legacy fields.
- Add a versioned capability request/response to the validated control-message union. Before enabling phone-controlled Race, the host confirms support for Race state v1; recheck on reconnect/replacement. An older controller that does not respond gets a host-side refresh notice and keyboard fallback before GO. Do not start a phone race with misleading legacy HUD data. A new controller connected to an old host continues normal Original behavior when no Race payload/request is present.
- The current relay in `apps/worker/src/room.ts` forwards control text verbatim within existing size/rate limits. Verify the new payload through that relay, but do not add a server migration or endpoint unless this check identifies a concrete need. Keep state updates within the existing 4 Hz host cadence and message limits.
- Host owns all timing and eligibility. Disconnect pauses and marks practice; reconnect restores current authoritative Race state before input resumes. Controller claims never set elapsed ticks, finish, or best status.
- Acceptance matrix: new host/new phone, new host/old phone fallback, old host/new phone Original behavior, reconnect during countdown/play, and switching back to Original without stale Race HUD. Cover parsers and room relay in automated tests, then a physical-phone run.

### Proposed race data

Freeze exact schemas during M0. Names below describe responsibilities, not existing exports:

| Contract | Required content |
| --- | --- |
| `RaceCourse` | Schema version, content-derived course ID, immutable generated base stage, texture identity, source capture provenance, resolved generator settings/version/seed, ordered sector geometry, start/finish, optional curved connector geometry, validation report |
| `RaceRules` | Rules version, countdown/start policy, eligibility conditions, pause/recovery behavior, recording and ghost resource limits |
| `RaceAttempt` | Attempt ID, course ID, physics version and resolved parameter hash, rules version, input format version, input source metadata, consumed inputs, start/finish/sector ticks, reset timeline where applicable, recorded-through tick, recording completeness, outcome and ineligibility reasons |
| `GhostTrack` | Attempt reference, tick-indexed position/orientation, discontinuity markers, duration, eligibility label; disposable derived data rather than the sole durable record |

Keep plain first-release geometry compatible with `StageData`. Store Race metadata in the separate course envelope; do not disguise a modified course as an ordinary stage or feed it into Original rankings/caches. Course identity hashes canonical resolved geometry, source/texture identity, sector definitions, generator settings, and versions. Ignore incidental file paths/timestamps in the canonical geometry hash. Compatibility additionally includes rules and physics configuration.

Curved connectors require a documented Contract Change Request for common geometry, runtime load interfaces, and worker messages. Use a validated additive Race world payload with shared connector types in `@wwm/schema`; legacy `load(stage)` retains existing behavior. Exact payload details must be agreed before renderer/physics implementation, not invented independently in each package. Do not modify `plans/contracts.md` or shared types merely to record this proposal.

For practice replays, encode all recoveries as tick-stamped events applied before the specified step, including destination and reason. Do not assume an input array alone reproduces manual recovery. Run live playback, replay generation, and eligibility through the same reducer and event ordering defined above.

## 5. Course construction and authored HTML

### First course: establish whether the idea feels good

Add an owned HTML fixture under `fixtures/race/flow-sprint/`, its captured input, and a reproducible build recipe. Use a fixed viewport, local assets/fonts, settled layout, and a single stage slice. Freeze and retain generated course artifacts; rerunning a race must not recapture a changing page.

Arrange a readable sequence of approximately 8–12 islands: launch straight → generous turn → straight descent → opposite turn → recovery area → precise final section → finish. Put readable surface markings inside islands; check the capture mask so markings do not accidentally become extra islands. Avoid large regions that the extractor splits unexpectedly.

At first, use existing bridge geometry, a bounded seed search, and Race-specific resolved parameter overrides (no elevators, reduced height noise, generous legal widths). Inspect the generated route and choose one explicit result. If the source cannot produce the intended chain, change the HTML layout or advance the Race route planner; do not claim arbitrary HTML guarantees that topology.

### Race builder

After the first course is playable, expose a narrow reusable terrain-extraction result from the stage builder. The Original builder must reproduce its existing golden outputs under unchanged version/settings. Add a separate `buildRaceCourse` path that consumes extracted terrain rather than trying to turn a finished DFS maze into a flowing course.

1. Extract islands and usable interior paths with existing ball-clearance rules.
2. Generate safe connection candidates and candidate entry/exit headings. Begin with straight cardinal connectors.
3. Search a bounded set of route sequences, accounting for the incoming heading as well as the current island. Score actual feasible travel within islands, not only centroid distances.
4. Prefer one continuous route with readable exits, usable corner radius, low forced stopping, adequate recovery width, and a target duration. Penalize abrupt reversals, poor entry alignment, narrow mouths, and excessive backtracking. All weights are explicit versioned settings.
5. Assign heights along route progress, not page Y alone. Allow flat recovery sections; constrain every slope and transition. A path can move upward on the webpage while descending in world height.
6. Regenerate rails, mouth clearance, start/finish, sector gates, and recovery locations after final geometry selection. Remove unused navigable distractions for the first curated course while retaining source provenance.
7. Validate geometry and real-physics traversal, then inspect race-speed traces. Bound retries and return an actionable failure when no course qualifies. Do not silently substitute an unrelated ordinary maze.

HTML author hints are a later part of this builder milestone: a versioned, validated sidecar manifest can map stable DOM identifiers to intended sections/order. Retain that mapping in the capture artifact; current numeric element IDs alone are not a stable authoring interface. Hints constrain route intent, but never bypass geometry validation. General arbitrary-page racing remains outside the first release.

### Curved, sloping connectors

Deliver one simple on/off-ramp-style connector after the plain course proves useful. It follows a horizontal curve while its height changes smoothly. Banking is separate and deferred.

- Represent a centerline, width profile, endpoint tangents/heights, and vertical transition profile in explicit units. Match island height and approach direction; ease pitch to flat at each mouth.
- Generate a deterministic sampled ribbon with bounded chord and height error. Renderer, collision mesh, rails, navigation, and debug overlays consume the same canonical sampled surface.
- When a curve replaces a base-stage bridge, explicitly identify the replaced connector and regenerate its mouth/rail openings. Remove the old deck and rail colliders from the composed world; validate the final composed geometry, not just the base stage and curve separately.
- Check turn radius, longitudinal slope, seam continuity, rail clearance, self-intersection, nearby-island clearance, and ball support along the entire swept width. Endpoint checks alone are insufficient.
- Test entry, mid-turn, crest, exit, reverse traversal, braking, edge contact, and jumping at the current physics envelope. No visible/collidable mismatch, exposed snagging seams, or unexpected launch at a transition.
- Extend navigation to these sampled surfaces. Keep the first curves free of planar overlap; the current 2D planner cannot validate stacked overpasses. A future stacked track needs surface-aware navigation and separate scope.
- Invalidate incompatible ghosts via course and physics compatibility keys. Changing core physics must not be a shortcut for fixing bad course geometry.

## 6. Personal history and ghosts

Persist attempts in IndexedDB on the game host device, not the paired controller. Keep exact consumed input streams for eligible attempts. Generate/cache pose tracks outside the active race loop, then interpolate them using the race clock. Never advance ghosts on wall-clock time while the player simulation is paused or lagging.

Default selection is personal best; add the most recent attempt as an optional second ghost. Before a best exists, offer the latest attempt. Distinguish the ghosts by shape/label as well as color, fade them near the player if they obscure the route, and allow both to be hidden. Ghosts have no colliders and cannot activate sectors, pickups, portals, or goals. Stop/fade an incomplete ghost at its end and do not interpolate across recovery teleports.

Proposed storage bounds: 10 recent attempts plus a protected best per course; 50 MiB total input/history budget. Measure actual size in M0 and adjust before freezing the schema. Evict oldest unprotected attempts first. If protected records alone exhaust the budget, keep existing records and offer management rather than silently deleting bests. Save attempt and best-index updates atomically; reject malformed/version-incompatible data and handle quota failures without losing a live result. Show session-only status when persistence is unavailable. Provide clear-history controls and verify reload persistence.

### Bound active recordings and replay preparation

These are proposed implementation budgets, to measure and freeze in M0 rather than claims about current memory use:

- Cap a recording at 10 minutes of simulated play (72,000 samples at 120 Hz) or 8 MiB of input/event buffer data, whichever comes first. Use bounded binary chunks/typed arrays, not an indefinitely growing array of input objects. Validate each format's sample size and event-count limits before allocation; the duration target for a course remains 45–90 seconds.
- If play continues beyond the last fully recordable tick, stop recording at that tick and mark the attempt practice-only with `recording-limit`. Continue gameplay and elapsed-time display, show a quiet “Recording limit reached; retry to save a full run” message, and keep retry available. Never drop earlier samples while representing the remaining data as a complete run.
- Store bounded summary metadata and, optionally, the recorded prefix with its end tick and explicit truncation status. A prefix ghost stops at that tick; it has no verified finish and can never become a personal best. If the finish lands on the final fully recorded tick within both limits, it can remain eligible; subsequent ticks cannot.
- Validate stored input/event byte length and tick count before decoding or allocating pose tracks. Generate only the selected ghosts, one preparation job at a time, with no more than two retained pose tracks and an 8 MiB total pose-buffer budget. Evict derived tracks freely; preserve durable attempts. Enforce bounds on output allocation as well as stored input length.
- Implement cancellable preparation in a dedicated worker using the Race replay runner. Course change, retry, ghost selection change, or unmount cancels obsolete work; ignore stale results using the attempt/course generation. Transfer bounded output buffers and dispose the worker/simulation on cancellation. If preparation fails or exceeds the budget, allow play with the ghost unavailable rather than blocking the course.

Test the last eligible recorded tick, one tick beyond the cap, an event-heavy byte-limit case, oversized stored records, switching courses during preparation, and repeated retry/cancel cycles. Report actual buffer/heap behavior on the reference device before accepting the defaults; the 50 MiB persistent-history budget is separate from these runtime bounds.

No raw input tracks or pose tracks are uploaded for analytics. Existing telemetry must identify Race separately if enabled; useful aggregate events are start, finish, retry, practice status, and ghost selection. Cloud sync and public verification require their own future design.

## 7. Execution sequence, ownership, and gates

Ownership below is by responsibility. A single engineer can execute sequentially. Separate implementers may work only after the shared contract is frozen and with exclusive file ownership; shared edits are integrated by the lead. Recheck current working changes before starting, including the unrelated `plans/mazify-extension-release.md` present during this review.

| Milestone | Owner / paths | Work and deliverable | Exit gate |
| --- | --- | --- | --- |
| **M0 — Baseline and contract** | Lead: this plan, `plans/contracts.md`, `packages/race`, schema coordination; controller owner reviews protocol | Record baseline tests/sessions; freeze per-step observer and reducer ordering, finish/retry lifecycle, mode/identity rules, controller CCR/capabilities, recording format and runtime/storage budgets. Produce page-by-page UI sketches and contract examples | No unresolved timing/identity/replay/phone ambiguity; bounded recording design; precise first-course spec; baseline failures separated from new failures |
| **M1 — Playable sprint** | Course: `fixtures/race`, capture recipe. Integration: `apps/web/src/race`, `game/sim-driver.ts`. Controller owner: `apps/web/src/controller`, `packages/net`; lead owns shared schema edits | One HTML-derived straight-ramp course; post-step Race evaluator, independent finish, cached-world retry, timer/countdown/results; compatible phone state and capability handling; developer entry first | Frame-schedule invariance and early-goal/retry proofs pass; keyboard and physical-phone loop works; old/new controller matrix passes; no Original score writes |
| **M2 — Race your history** | Race domain/storage/web integration; Race replay worker; renderer ghost lifecycle | Persistent best/recent attempts, exact recording/recovery timeline, runtime caps and cancellable preparation, up to two ghosts and history controls | Save → reload → replay yields identical finish/sector ticks; limit boundaries and cancellation pass; ghosts do not affect physics; storage failure is recoverable |
| **M3 — Repeatable Race builder** | `packages/stage-builder`, `packages/race`, `tools/stage-debugger`, `tools/batch-eval`, owned fixtures | Extract terrain seam; implement route scoring, route-relative heights, metadata/hints, diagnostics; add two more HTML courses with different rhythms | Three curated courses across fixed seeds/settings are deterministic and valid; original goldens unchanged; debug report explains selection/rejections; each course passes human course review |
| **M4 — Curved-ramp extension (optional for first release)** | Lead owns shared CCR/schema; geometry/engine/physics/solver owners own their packages | After M3, add canonical curved connector, renderer/collider/rails/nav support, and one showcase course variant | Real-physics transition tests and deterministic replay pass; performance measured; human comparison supports the curve; no stacked crossings |
| **M5 — Mode integration and playtest** | Web UX, i18n, controller integration, validation | After M3, integrate three-mode entry, finished screens, accessibility, physical devices, ghost readability, and course tuning; include M4 only when qualified | All common and selected-release acceptance gates pass; omitted curve checks explicitly not applicable to the straight release; human evidence separate |
| **M6 — Release and rollback** | Lead/release owner | After M5, run flagged preview, production-equivalent checks, release report and rollback rehearsal for the named course set; deployment only under release authorization | Race can be disabled without affecting Original/Education or history; preview readback passes; release scope and limitations explicit |

Base release dependency order: **M0 → M1 → M2 → M3 → M5 → M6**. M1–M2 are the first playable proof, not completion of the whole plan. **M3 → M4** is an extension branch. Including curves in a release requires M4 plus the affected M5/M6 gates for that course set. A later curve release reruns those affected gates; it does not reopen completed baseline work without a regression reason.

| Release scope | Required validation | Explicitly deferred |
| --- | --- | --- |
| Straight-course Race | M0–M3, M5, M6; every common timing, retry, phone, replay, storage, accessibility, performance, isolation, and preview gate; straight-surface geometry checks | Curved mesh/rail/navigation checks and straight-versus-curve comparison; M4 remains pending/deferred, not complete |
| Race with curved connectors | All base-release checks plus M4 geometry/replay/performance gates and M5 human comparison on the curved variant; M6 verifies the curved course set | Banking, stacked crossings, circuits, and arbitrary-page guarantees remain outside scope |

Do not begin with a universal track generator or refactor all modes. The first vertical slice must let the user race one authored course, retry, and see a persisted ghost before broadening generation.

## 8. Acceptance and evidence

| Area | Required evidence |
| --- | --- |
| Isolation | Original fixture geometry and deterministic replay results unchanged; Original score submission still works; representative Education gate/mission/progress tests pass; Race never submits to their score or progress systems |
| Identity | Different resolved geometry, seed, rules, sector order, or physics settings cannot silently share comparable records; same frozen course reloads identically; incompatible history is labeled rather than replayed |
| Timing and retry | Identical inputs across 30/60/144 Hz frame schedules and catch-up frames yield identical ticks; early finish remains finishable later; multiple crossings per step ordered; recovery teleports ignored; repeated full reload retries restore initial state; countdown/pause/fall/disconnect outcomes explicit |
| Replay | Shared Race evaluator reproduces finish/sector ticks; ordinary goal events never terminate Race replay; recovery timeline reproduces once; truncated attempts cannot become bests; ghosts share live time origin and stop at recorded end |
| Geometry | Every included surface is validated for ball clearance and high-speed traversal; for the curve extension, render/collision/navigation agree; solver crawl success alone never passes the flow gate |
| Persistence | Best/recent runs survive reload; bounds/eviction, two-tab writes, IndexedDB unavailability, interrupted saves, quota errors, and schema migration have defined outcomes |
| Recording resources | Tick/byte caps apply during recording, loading, and preparation; continue play at cap with explicit practice status; prefix ghosts stop correctly; cancellation and obsolete-result rejection hold under repeated retry/selection changes |
| Phone compatibility | New/new Race state and input work; old/new Original remains unchanged; new/old Race requires refresh or keyboard fallback before GO; actual relay preserves payload; reconnect resynchronizes host-authoritative state |
| Interaction | Keyboard-complete entry/play/retry/exit; physical iPhone tilt play and lock/reconnect; Android Chrome if claiming support there; no ghost-only color cues; reduced-motion support and stable camera visibility |
| Performance | Compare zero/one/two ghosts on the same reference desktop and supported mobile rendering target; target 60 fps on the reference desktop, report p95/p99 frame times, and keep p95 regression within 10% of the no-ghost run; build/replay preparation cannot stall active play |
| Release | Local and preview evidence separate; feature-off restores existing entries; legacy deep links still work; no account or backend dependency for local Race history |

### Human flow experiment

Use the same course, controls, and physics for an initial familiarization run and five repeat attempts. Start with the user, then include at least two additional players with differing experience before making broader product claims. Compare ghost hidden/visible with order varied between players. For the curve extension, separately compare the straight and curved course variants; that comparison is not a straight-release dependency.

Capture completion, falls, sector times, unintended near-stops, severe rail impacts, route hesitation, and voluntary retries. In M0 define a diagnostic near-stop threshold (initial proposal: speed below 0.5 ball diameters/second for over one second away from start/finish); do not confuse deliberate braking or accessibility needs with failure.

Ask: Could you anticipate the next turn? Did the course force an unwanted stop? Did the ghost help you improve or distract you? Did you want another attempt? Review the exact locations causing interruptions. A useful initial gate is that the user can complete three consecutive clean runs after familiarization and reports no recurring forced stop on the intended line. This is an iteration criterion, not proof that every player reaches a flow state.

If repetition remains frustrating, fix course geometry/readability first. If ghosts create visual pressure, default to one or hide them. If curves do not improve the experience, ship the qualified simpler course and retain the curve experiment as incomplete/deferred.

### Verification commands and reporting

During implementation, run focused package suites for race, builder, physics, solver, and affected web behavior; register new suites in the existing workspace/Vitest setup. At integration gates run `pnpm check`, relevant Playwright browser tests with actual browser execution confirmed, and the production web build. Inspect newly generated fixture/debug images and perform the physical-device checks; skipped browser tests are not passes.

Each milestone records changed files, contract/version changes, commands/results, fixture IDs, screenshots or replay evidence, human feedback, and remaining defects in `docs/build-log/phase-24-race-mode.md`. Avoid unrelated golden regeneration or broad formatting changes. Documentation-only planning does not establish any implementation acceptance gate.

## 9. Release boundaries and rollback

Initially expose Race only through the developer route/flag. Add the public mode choice after the first playable proof and regression gates, then validate in a preview. Curated course assets can be bundled or served as immutable static assets; no new database migration or capture endpoint is required for the local-history MVP.

Use a dedicated Race enablement flag. Disable its entry and show a clear unavailable state on Race deep links during rollback. Keep personal history intact and versioned for a later compatible release. Never reinterpret Race attempts as Original scores. Course changes create new identities; preserve old bests as historical rather than silently remapping them.

Release planning must name the straight-only or curve-inclusive scope before M5/M6 acceptance. The controller protocol extension is required in either scope; the curved-geometry extension is required only for curves. Remaining validation decisions are measured recording/pose budgets at M0 and supported-device performance at M5; sprint and pause/fall eligibility remain the stated product defaults. Future circuits and arbitrary-page generation are separate scope. This is an updated execution proposal; product code, production resources, and deployments remain untouched by the planning task.
