# Phase 23 proposal — Four lessons that stretch the maze

September 26, 2026. **Reviewed implementation plan, not implemented.** Builds on the current Phase 22 checkout and `wwm-learning/0.3`. No public deployment or audio-provider work is part of this document change.

## Confirmed scope and design assumptions

Use four new lessons to discover which learning actions become more meaningful inside a maze, and which demand a richer content/runtime contract. Each lesson adds a different kind of reasoning: combine, compose, interpret, then plan and explain. Keep the existing gem-counting/comparison activities as the baseline.

User-confirmed scope: lesson and API POC plan first; playable implementation is a later phase. Audience: roughly Grades 1–4, one grade per lesson. These are design targets, not curriculum alignment or validated age recommendations. Reading skill, target-language proficiency, maze dexterity, and task complexity are separate settings. An older beginner in Spanish still needs beginner Spanish. The four lessons are a sampler, not a complete prerequisite sequence across subjects.

User-confirmed language mix: English literacy plus beginner Spanish. The expedition uses scaffolded beginner Spanish, with an English version for comparing route complexity. Select the language experience at the start; do not switch languages mid-lesson to make it harder. All examples below are authored drafts needing educator/fluent-speaker review.

The central uncertainty: does acting in the maze help a learner reason or communicate, or merely delay the next question? Longer geometry alone is not increased educational sophistication.

## What is actually available

Inspected in the local checkout; existing tests and historical performance figures were not rerun for this planning pass.

| Current source | Useful foundation | Limit this POC exposes |
| --- | --- | --- |
| `packages/learning/src/schema.ts` | Strict portable learning data; choose, compare, difference; configurable levels and locks | English only; ages fixed at 4–6; five early-math domains; 8 rounds/activity; 12 explicit steps/level; collect counts 1–10 |
| `packages/learning/src/levels.ts` | Ordered round/collect/reach steps and capability matching | No inventory delivery, ordered response, branch dependencies, or spoken-response contract |
| `apps/web/src/learning/locks.ts` | Binds lesson steps to the maze; bridge/lift/goal locks | `MAX_STEP_SPOTS = 8`; later steps have no placed spot. Unplaced rounds have a start-card fallback in `gates.ts`; this is not a long-lesson progression model |
| `apps/web/src/learning/missions.ts` and `gates.ts` | Uses actual remaining maze gems | `collectCount` lowers a requested count to availability; useful for casual collection but changes an exact arithmetic exercise |
| `packages/learning/src/voice.ts` | Guide clips with speech fallback and timing cues | Speech fallback uses `en-US`; learner recording is absent |
| `docs/build-log/phase-22.md` | Prior implementation evidence and known limitations | Reports about 70% physical-lock coverage and reliance on a region guard. This is historical repository evidence, not a fresh measurement |

Consequently, begin with authored, guaranteed-solvable lesson mazes. Add one website-derived maze as a portability test after all four authored lessons work. Do not promise that an arbitrary captured page can support every puzzle.

## Decisions adopted after system-design review

The user authorized these plan changes on September 26, 2026. No clarification is required to finish the plan. Implementation, public deployment, and paid audio generation remain later actions.

- Publish the sampler as a separate experimental path, `maze-discoveries`, with four stable activity IDs: `bridge-builders`, `message-trail`, `mercado-perdido`, `expedition-dispatch`. Preserve `little-discoveries` and its six activities.
- Use a validated runtime world overlay for lesson objects and route rules. Keep persisted `StageData`, ordinary score gems and ranked play unchanged; extend runtime simulation/renderer interfaces through a documented contract change.
- Persist bounded local progress in IndexedDB; restore the visual/physics world from that committed state before accepting input. Learner recordings remain memory-only.
- Keep completion, evidence availability and assessment independent. All speaking nodes in this POC offer an explicit non-recording alternative or skip path.
- Use `en-US` for English prompts and `es-MX` as the initial Spanish model-audio locale. This is a reversible production default, not a requirement for the learner's accent. Fluent-speaker review can correct scripts/voice selection before audio acceptance.

Non-goals: accounts, cloud learner records, speech recognition/scoring, public release, arbitrary-page support for every lesson, changes to ranked scoring, general-purpose scripting, and a full curriculum. No production migration or new backend endpoint is required for the local POC.

## The four lessons

| Lesson | Approximate target | Learning objective | Maze action | New contract pressure |
| --- | --- | --- | --- | --- |
| 1. Bridge Builders | Grade 1 | Compose/decompose a total and reason about what remains | Collect, place, and retrieve exact quantities to repair bridges | Inventory, deposit, exact totals, reversible actions |
| 2. The Message Trail | Grade 2 | Read a sentence, preserve its meaning, and use sequence words | Gather word/clue tiles, assemble a message, deliver it, record a retelling | Ordered responses, semantic destinations, audio response |
| 3. El mercado perdido | Grade 3 task complexity; beginner Spanish | Understand a short spoken request and communicate a matching request | Listen, select goods, plan two stops, record a request, deliver | Typed inventory, listening evidence, locale-aware prompts |
| 4. Expedition Dispatch | Grade 4 task complexity; beginner Spanish with an English variant | Plan a route under constraints and explain the sequence | Compare routes, obtain a key, make ordered deliveries, revise after a closure | Branches, dependencies, resource costs, chapter resume, oral explanation |

### 1. Bridge Builders — arithmetic changes the world

**Target session:** 5–7 minutes, 4 encounters; keep movement easy.

1. Pip starts with 2 gems. A bridge needs 5. Collect the missing 3 and deposit exactly 5. A visible five-slot tray shows the relationship; crossing follows the learner's action.
2. A bridge needs 6. Choose piles of 2 and 4, or 3 and 3. Both solutions work. Do not encode one route as the only correct answer.
3. Start with 9, spend 4 on the next bridge, predict the remainder before revealing the inventory: 5. Then verify by manipulating the tray.
4. Fresh transfer: a bridge needs 7 and already holds 3. Choose the additional amount without the five-slot hint. Rearrange piles so position/appearance cannot answer it.

**Feedback:** an incomplete tray shows open slots; overfilling puts extra gems in a return area. Deposits are reversible until confirmed. Hint ladder: notice empty slots → pair gems to slots → worked example. Falling never destroys lesson inventory.

**What counts as evidence:** correct decomposition before help, a different valid decomposition, and the fresh total. Collection alone is not arithmetic evidence. Any self-recorded explanation is optional enrichment, not necessary for this lesson.

**Failure to test:** opportunistic pickup changes the numbers or leaves a required pile behind a locked bridge. Reserve lesson objects independently from score gems and validate solvability before starting; never quietly change 5 into 3.

### 2. The Message Trail — language as a useful object

**Target session:** 6–8 minutes, 5 encounters; English literacy.

1. Read/listen to “Take the red key to the tower.” Match the pictured object and destination. The objective distinguishes listening with read-aloud support from independent reading.
2. Gather and arrange the tiles “Take / the red key / to the tower.” Change the order and hear the result; confirming the intended message opens the dispatch route. Include tap-to-place controls as well as drag.
3. Choose between two messages that differ in meaning: “Take the key to the tower” and “Take the key from the tower.” Carry out the selected instruction; success depends on the intended relation, not merely tile order.
4. Visit the dock and then the tower. At a safe post, record 10–20 seconds: “First I … Then I …” Play it back, retry or keep it. A parent/self checklist asks whether both places were named in order.
5. Transfer: a new key and a new destination, with support reduced. Do not make remembering the original route the answer.

**Assessment separation:** destination/action can be checked deterministically. A saved recording shows participation. A listener's rubric can record sequence/meaning feedback; the game does not infer fluent reading from recording length or a button press.

**Failure to test:** the beacon gives away the comprehension answer. Show navigable paths but reveal the target only after the learner chooses a destination or requests an explicitly logged hint.

### 3. El mercado perdido — listen, request, deliver

**Target session:** 7–10 minutes, 6 encounters; novice Spanish with English instructions available.

1. Learn/replay three pictured words: `manzana`, `pan`, `agua`. This is practice, not assessment.
2. Hear “Dos manzanas, por favor.” Choose the requested goods from pictured stalls. The initial listening attempt hides the transcript; “Show words” remains available and is recorded as support.
3. Carry two apples to the customer. A wrong item remains recoverable; the customer repeats the request and points to the comparison tool after help is requested.
4. At the next stall, build a supported request: “Quiero pan, por favor.” Record up to 15 seconds, replay, retry, or keep. The game uses the selected item to determine the transaction; it makes no claim that the spoken phrase was correct.
5. Hear and execute two deliveries: bread to the tower, water to the dock. Keep the request replayable so this tests comprehension more than working memory.
6. Fresh request changes the item/count. Record a short response without the full sentence model if the learner chooses.

**Language feedback:** model clip → learner clip → concrete checklist (“Did I name the item? Did I include the request?”). Do not require native-like accent. A no-microphone path permits speaking to a nearby adult or assembling the phrase, marked as a different evidence mode.

**Failure to test:** a generic English voice reads Spanish, or a speech recognizer rejects a correct child utterance. Require a reviewed target-language model clip for listening trials; typed/text alternatives change the trial mode. Automatic recognition is outside this first POC.

### 4. Expedition Dispatch — plan, explain, revise

**Target session:** 10–15 minutes in three independently resumable chapters, each 3–5 minutes. Beginner Spanish examples use visual vocabulary and sentence frames; an English version provides a control for route complexity.

**Chapter A: understand and plan.** Collect the reusable key, deliver one tower parcel and one dock parcel in that order, then return to base. Both parcels start in inventory. Visits do not automatically deliver: the learner confirms a delivery at its destination. Start with 8 energy. Authored bidirectional edges cost: base→key 1, key→tower 2, tower→dock 2, dock→base 2; base→tower 2; key→dock 3. Every entry to the tower requires the key, including entry from the dock or shelter; the key is not consumed. Visiting the dock before the tower is permitted, but delivering there early is rejected without spending the parcel. Choose/preview a route before travelling. The intended route base→key→tower→dock→base costs 7 and obeys delivery order. Other routes are judged by the same constraints, not a stored answer string. A map preview shows the running budget.

**Chapter B: explain and carry out.** Record 20–30 seconds using “Primero … Después … Al final …”, supported by destination cards. For example: “Primero, tomo la llave. Después, voy a la torre. Después, voy al muelle. Al final, vuelvo a la base.” Offer one short sentence at a time with model replay; the increase in difficulty comes from planning and sequencing, not advanced Spanish grammar. Execute the route; the game evaluates visits/resources, while a listener reviews whether the explanation matches the plan. Preview and undo prevent resource mistakes from becoming dead ends.

**Chapter C: revise.** Start a new attempt at base with 8 energy, both parcels, no key and no prior deliveries; preserve Chapter B’s evidence separately. Before departure, close tower→dock in both directions. Provide a visible tower→shelter edge costing 1 and shelter→dock costing 1, preserving the total of 7. Revise the plan and optionally record one sentence about the change. A new map at the end tests whether the learner applies the constraints again. Do not close a route after spending resources without supplying a reachable recovery route or restoring the chapter checkpoint.

**Why this is harder:** several conditions must hold together, more than one representation must agree, and a plan must be revised. Extra walking distance and harder tilt controls are not the source of difficulty.

**Failure to test:** a beacon supplies the solution; the route solver knows a path but the ball cannot physically traverse it; the session is too long; unfamiliar Spanish obscures otherwise sound reasoning. Keep a map/plan accessible, check actual traversal, support chapter stopping, and compare against the English version. Grade level does not establish Spanish proficiency; reuse the market lesson’s beginner vocabulary and introduce only the destination words needed here.

## Small API expansion, driven by these lessons

Propose `wwm-learning/0.4` only after the four lesson scripts are reviewed. This is a proposed contract, not an accepted schema. Keep existing 0.1–0.3 readers/migrations and family choices working; convert ordered steps into equivalent linear nodes internally. Do not rewrite existing lesson answers or level choices during migration.

Separate four responsibilities:

1. **Lesson document:** objectives, prompts, target language, hints, response rules, valid transitions and authored world requirements. No executable code or learner recordings in the portable HTML.
2. **Lesson runtime:** bounded deterministic state transitions, inventory, attempts, chapter progress, evidence status and completion. Independent of physics and provider APIs.
3. **Game adapter:** binds semantic targets such as `tower`, `apple-stall`, or `bridge-repair` to validated world objects; translates visits/pickups/deposits into runtime events and applies allowed lock/world effects.
4. **Media adapter:** model playback plus explicit learner recording/replay/delete. Returns response references, never a fabricated pronunciation grade.

Minimum additions:

| Capability | Introduced by | Contract requirements |
| --- | --- | --- |
| `inventory.deposit` | Bridge Builders | Typed reserved items, exact amount, return/undo, atomic spend, unique pickup IDs |
| `response.order` | Message Trail | Stable token IDs, declared accepted sequences, meaningful alternative orders where authored |
| `response.audio.local` | Message Trail | Duration bounds, locale, review controls, explicit non-recording alternative, evidence state |
| `mission.deliver` | Message Trail; reused by Spanish market | Item/count/destination predicates and visible partial progress |
| `flow.branch` and `route.constraints` | Expedition | Named nodes, prerequisites, bounded retry, inventory conditions, graph targets, resource rules |
| `session.resume` | Long expedition | Versioned snapshot, deterministic seed, chapter and world state, content/stage hashes |

Use a small declarative condition vocabulary (`all`, `any`, visited target, inventory amount, response result), plus allowlisted effects (open connector, consume/deposit inventory, reveal authored clue). No arbitrary expressions, uploaded scripts, or generated runtime code. Validate every reference and bound every collection, graph, retry loop and recording duration.

Suggested internal seams, not new network endpoints:

```ts
validateLesson(document, capabilities): ValidationResult
bindLesson(document, world): BindingResult // complete binding or useful incompatibility reasons
transition(state, event): { state, effects, evidence }
snapshot(state, binding): SessionSnapshot
restore(snapshot, document, world): RestoreResult
```

Every event identifies lesson revision, session, attempt, node, event ID and sequence. Duplicate pickup/delivery events cannot double-spend or double-complete. The runtime commits canonical state once; renderer/physics effects are idempotent projections of that state, not a claimed cross-system transaction. Retried projection after interruption must converge without spending inventory twice. A future speech evaluator can emit a separate assessment result with provider/rubric/version and uncertainty, without changing inventory or asserting mastery.

Declare `interfaceLocale` and `targetLocale` separately; prompts/model clips carry locale. Include locale, exact text, voice and settings in clip identity. Broaden ages/domains explicitly rather than mislabelling language content as counting. Retain strict parsing and bounded documents.

**Capability mismatch:** report the unsupported action before starting. Offer an explicitly authored alternative with its own evidence label. Never silently convert a spoken task into a correct multiple-choice answer or downgrade an exact task's quantity. Apply the explicit 0.4 rejection policy below instead of the legacy level fallback.

## Content packaging and compatibility

Add a path registry in `packages/learning` with the existing baseline and the new sampler. Keep legacy `?learn=<activityId>` behavior; use `?path=maze-discoveries&learn=<activityId>` for the sampler. `apps/education/scripts/generate.ts` must generate both paths with stable, non-colliding routes, keeping existing baseline URLs. The sampler overview states grade targets and prerequisites per lesson; it is not the next preschool level.

Update `apps/web/src/learning/load.ts` to choose from the registry or an imported document, then validate the selected activity, full node capabilities and world binding before play. Export the selected path, family level choices and locale configuration as inert HTML data; exclude snapshots, responses and audio blobs. The sampler's readable export includes objectives, graph/chapter order, alternatives and review notes, rather than assuming every task is one of the existing three round kinds. `apps/education/src/render.ts` and `lesson.ts` require explicit handlers for the new nodes.

Keep existing baseline personalization unchanged: `packages/learning/src/forks.ts` intentionally accepts six introductions and the baseline identity. Do not enable introduction personalization for the experimental path in this POC; hide that control with an explanation while retaining level/locale choices. Store those choices by path ID and content revision. Old drafts apply only to the old baseline and must never be applied to the sampler.

In the contract milestone, add explicit 0.1/0.2/0.3 → normalized 0.4 adapters and independent versioned schema fixtures; retain old format definitions rather than changing a single previous-version constant. Preserve omitted/optional rounds, follow-up triggers, hint history semantics, level IDs and family defaults when normalizing old content. Old exports remain readable by the new consumer; new 0.4 exports are not promised to work in older consumers. Reader changes land before exposing new exports. Unsupported required capabilities fail before the session; do not reuse `pickLevel()`'s silent fallback for 0.4 tasks.

## Runtime world overlay and binding

Concrete new modules below are implementation targets, not existing files: `packages/learning/src/world.ts` (engine-neutral requirements), `apps/web/src/learning/world.ts` (binding/projection), and `fixtures/learning/` (authored stages and binding manifests). Extend existing `port.ts` or add a sibling port for object visibility, sensors and route effects. Record the exact additions to `SimLoadOptions`, `SimEvent`, renderer methods and worker messages in `plans/contracts.md` before changing `packages/schema`, `packages/physics` or `packages/engine`.

The lesson document declares semantic targets, typed inventory and conditions. A separate local binding manifest maps semantic IDs to stage island/connector IDs and safe positions. Imported HTML cannot select a file path or fetch an asset/maze URL. The user selects an available maze; the binder returns a complete compatible mapping or explicit rejection. For the later website-maze test, author a validated binding manifest against a frozen captured-stage fixture; automatic semantic inference is deferred.

The overlay contains:

- `targets`: stable ID, role (`pickup`, `deposit`, `destination`, `key`, `safe-post`), item type/quantity where applicable; all IDs unique within path/activity/chapter.
- `bindings`: target ID → island ID, position and interaction radius; connector ID → existing bridge/elevator ID. Stage hash and manifest revision prevent rebinding to different geometry accidentally.
- `initialInventory`, deposit slots and delivery requirements, plus chapter-specific connector costs/prerequisites. Lesson item IDs use a separate namespace and never enter the normal score-gem event path.
- Proposed POC limits per activity: 24 nodes total, 3 chapters, 8 interactive posts per chapter, 64 active lesson objects, 32 active route edges, 16 item types, 0–99 units per type, and retry counters capped at 100 with an explicit restart option. Enforce the existing 200 KB document bound; reject oversized documents rather than raising it implicitly.

Binding verifies every reference, walkable target clearance, sensor separation, required pickup availability, connector placement, and reachability under each authored state. Labels must name the target in the world and map; a beacon cannot reveal an unanswered destination. Dynamic lesson pickups use dedicated runtime sensors/events and renderer objects. Interacting with a deposit opens a paused tray; tentative transfers remain reversible, and Confirm atomically changes inventory/deposit/node state. Wrong or excessive quantities cannot consume items. Normal gem pickups never satisfy these predicates.

**First contract fixture:** author a complete executable `bridge-builders` document and bound stage under `fixtures/learning/bridge-builders/`. Encounter 1 has initial inventory `{gem: 2}`, three separately identified gem pickups, a five-slot `repair-1` deposit and locked connector `crossing-1`. Confirm with exactly five gems commits inventory `{gem: 0}`, deposit `{gem: 5}`, node complete and connector open. Replaying the same Confirm or pickup event has no effect. Encounter transitions explicitly replace the exercise inventory and mark a new encounter; this is not an unexplained resource award. Encounters 2–4 must declare their pile alternatives, initial stock and prefilled slots in the same fixture. The standalone tray and game consume the same rules and IDs. Acceptance requires serialized document → parser → binding → pickup/deposit → export/readback → restored world, not just a mocked reducer.

### Traversal, energy and route recovery

Use an explicit committed traversal event for route lessons; island contact alone cannot spend energy. Extend the runtime simulation interface to identify departure sensor, connector, direction and arrival sensor with a monotonic traversal ID. Bridge mouth/arrival sensors and lift start/end identify a candidate traversal; leaving its allowed corridor, falling, resetting, or arriving through a different connector cancels it. The trusted game adapter validates the event against the currently permitted edge and sends one runtime event. These additions apply only in learning mode.

Check prerequisites and available energy before departure. Reserve the edge cost while crossing; commit it once at valid arrival, update safe spawn and only then allow destination interaction. Cancelled crossings release the reservation and return to the departure safe spawn; they do not collect a destination item or advance evidence. Crossing back is a new paid traversal. Jumping to a non-connected island or bypassing a sensor returns to the last committed safe spawn without granting progress. Include a physical playthrough and automated adversarial tests for each of these cases.

Route previews are freely editable. During execution, Undo returns to the previous committed safe stop and restores its canonical energy/inventory/delivery state; it retains an attempt-history marker so the first attempt is not rewritten as unaided success. Undo never rolls back the event sequence or accepted-event ledger; it creates a new revision so stale events cannot be replayed for credit. Maintain a bounded undo stack of 32 safe stops; older entries roll off. Chapter restart resets that chapter's world and attempt state while preserving prior observations. Completion requires key acquisition, both confirmed deliveries in order, return to base and nonnegative energy. The 8-cost keyless dock detour is rejected at tower entry. Enumerate the bounded fixture graph to test valid alternate routes, exhausted budgets and the Chapter C closure.

## Long mazes: separate lesson progress from geometry

- Chapter boundaries create natural stopping points. Keep the active world segment small; a lesson can contain more steps than the number of currently visible posts.
- Start with 3 chapters and a synthetic 24-node lesson to exercise limits beyond 8 placed spots and 12 legacy steps. These are explicit POC bounds, not unlimited content promises.
- Bind the next chapter before entering it; failures retain the current checkpoint and explain incompatibility. Do not skip a required mission because no post fits.
- Save lesson/version/seed, node results, support used, inventory, world pickups, locks, route changes and safe spawn atomically. Do not restore progress against a different content/stage hash without an explicit migration or restart choice.
- Falling changes safe position, not completed educational evidence. Replaying a chapter distinguishes practice retries from new observations.
- Record learner audio in memory for the POC. Chapter progress can persist locally, but audio itself does not survive reload; tell the user before leaving and offer explicit download. Missing audio after reload is `unavailable`, never evidence of a successful speaking assessment.
- Authoring validation must test dependencies and inventory under every authored branch. Physical playthrough must verify collision geometry as well as graph reachability. Ensure rejected placements cannot lock away their own requirements.

### Snapshot commit and restoration protocol

Implement a shared browser-only adapter at `packages/learning/src/browser-storage.ts`, consumed by `apps/education/src/lesson.ts` and game wiring in `apps/web/src/learning/storage.ts`, over IndexedDB database `wwm-learning-poc`, schema version 1, store `sessions`, key `[pathId, activityId]`. Keep one resumable session per activity; a deliberate new session replaces it. Storage is scoped to the current origin: education and game on different origins have independent progress, with no cross-origin resume promise. Provide Delete progress per activity and for the sampler; no automatic cloud sync. Imported files must be reselected after reload unless the matching document is in the local registry; this POC does not silently persist imported HTML or external world assets.

A snapshot includes its own schema version, lesson content revision/hash, normalized binding/stage hashes, selected level/locales, seed, session/attempt IDs, state revision, node completion, support/evidence metadata, inventory, consumed pickup IDs, deposits, deliveries, energy, chapter mutations, safe spawn and bounded undo state. Do not serialize open microphone state, object URLs, blobs or pending permission requests. Include the next event sequence and deduplication data for the active attempt; retain at most 4096 accepted event IDs. At the bound, require a checkpointed new attempt rather than silently evicting IDs and weakening duplicate protection.

Pause input at every accepted inventory/deposit/delivery/traversal completion, node completion and chapter transition. Compute and validate the next canonical state, then commit it in one IndexedDB transaction using a revision comparison against the prior record. Only after commit project that state into physics/rendering and acknowledge success. A second tab with a stale revision must stop and offer reload; it cannot overwrite the active snapshot. Projection failure leaves the committed record available for retry while gameplay stays paused.

If storage is unavailable or a write fails, retain the last good snapshot and show Retry or Continue without saving. The latter is explicit session-only mode; stop updating that old snapshot and clearly state that reload returns to its last saved point. Never display Saved after a failed write. Closing during an uncommitted action restores the prior state. A reserved in-flight edge is not a completed traversal: reload returns to its departure safe spawn at the prior committed energy.

Restore in this order: validate snapshot/version and content/binding hashes → bind chapter with the exact fixture → initialize canonical lesson state → load base physics/renderer → project consumed pickups, deposits, closures and lock states → set safe spawn and zero velocity → expose UI and enable input. Replace the unconditional clearing of collections/unfinished missions in `gates.ts:stageReady()` for restored 0.4 sessions; keep legacy behavior for old sessions. No frames with freshly respawned lesson pickups may accept input. Effects are reconstructed from state, not reissued as inventory mutations.

Do not migrate mismatched snapshots in the first POC. Preserve them and offer reselecting the matching content or explicit restart; do not silently replace progress. Corrupt records produce a recoverable error/reset option. Chapter A records a plan at base; B executes it in that same world; C creates the fresh revised attempt described above. Each chapter binds a fresh overlay on its specified fixture, with persistent observations held outside resettable attempt state. The 24-node fixture uses three chapters of eight nodes to verify this lifecycle.

## Audio recording experience

At a safe post, pause motion and guide playback. Present model replay, a visible **Record** action, elapsed/remaining time, **Stop**, then **Listen**, **Try again**, **Keep**, and **Delete**. Start capture only on the learner's action and browser microphone grant; stop tracks on stop, cancel, navigation, interruption or disposal. Never resume recording automatically after interruption.

Use `getUserMedia({ audio: true })` and `MediaRecorder`, negotiate supported audio MIME types and handle runtime errors. A supported MIME type is not a guarantee that capture succeeds. HTTPS/localhost, microphone permission, denied/ignored permission, missing devices and physical iPhone behavior need real verification. [MDN microphone access](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [MDN recorder format negotiation](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static).

Keep clips device-local and ephemeral initially; no automatic upload, analytics attachment, cloud transcription, or public clip URL. Retakes discard the prior pending blob and object URL. Limit individual clips to 30 seconds and retained clips to 10 per session; prompt to delete/export before exceeding the cap. Explicit download is user-controlled. A future persistent portfolio/upload feature needs its own retention and access design.

Represent three independent fields: `completion` (`pending`, `complete`, `skipped`), `evidence` (mode, availability, review status), and `assessment` (`not-assessed` or a human rubric result). Availability is `pending`, `available`, `deleted` or `unavailable`; review status is `unreviewed`, `learner` or `adult`. A completed recording is participation, never correctness. Human review is an optional local observation; there is no authenticated reviewer identity in this POC. Silence detection may suggest retry but cannot classify pronunciation.

| Action / condition | Progression | Evidence and assessment |
| --- | --- | --- |
| Record / Stop | Remains pending until Keep | Temporary response, not assessed; Stop alone opens no lock |
| Listen / Try again | No progression change | Listen may mark learner review; retry discards the pending take |
| Keep a nonempty successful capture | Completes the speaking node and releases its progression lock | Audio available, review status preserved, assessment remains not-assessed |
| Microphone denied, ignored or capture failure | Remains pending; cancel permission wait without hanging the lesson | Offer Retry, authored phrase-selection / speak-to-adult alternative, or Skip |
| Confirm authored alternative | Completes the node | Record `phrase-selection` or `spoken-to-adult` mode, not an audio or pronunciation pass |
| Skip speaking | Mark skipped and satisfy this POC node's progression dependency | Explicit skipped mode, no assessment; later nodes must not require a speech pass |
| Delete a kept clip | Completion and locks unchanged | Revoke blob/URL, mark deleted; keep the historical participation marker |
| Reload after completion | Completion and locks unchanged | Audio availability becomes unavailable; historical human review remains attributed but is not re-evaluated |

A parent summary distinguishes completed-with-audio, alternative, skipped and evidence no longer available. Assessment never controls locks in these four lessons. An optional retake after completion replaces only response evidence, preserving attempts. Late microphone permission resolution after cancellation immediately stops the received tracks and cannot begin recording. At the retained-clip cap, Delete/Export or Skip remains available; recording capacity cannot deadlock progression.

The ACTFL framework distinguishes interpretive, interpersonal and presentational communication, and notes that skills can differ within a learner. Here listening trials and recorded presentations are different observations. A scripted shop interaction is practice; it does not establish interpersonal proficiency. [ACTFL Can-Do Statements](https://www.actfl.org/educator-resources/ncssfl-actfl-can-do-statements).

### Model audio prerequisite

Learner recording needs no provider, but listening trials need reviewed model audio. Extend `tools/learning-voice/src/cli.ts`, its timing/hash helpers, `packages/learning/src/script.ts`, `voice.ts`, and the voice schema to select a path and locale explicitly. Keep the existing baseline manifest intact. Create a separate manifest per sampler locale containing line ID, exact text, locale, voice/model/settings, hash and timings; lookup validates all identity fields rather than text alone. A separate reviewed variant owns corrected text and clips; do not overwrite clips behind immutable hashes.

First freeze scripts and choose an intelligible `es-MX` model voice through fluent-speaker review. Either import reviewed human recordings into the same manifest contract or generate authored script through the existing voice tooling in a separately authorized audio-production step. Never send learner recordings to that tool. Add a dry-run inventory of missing/stale lines before any paid run; paid generation or R2 writes are not authorized by approval of this plan. Local fixtures/assets may serve the POC from a consumer-configured audio base; portable HTML cannot choose an arbitrary origin. Verify timings and pronunciation by listening, not manifest presence alone.

For a listening trial, preflight the required clip and handle playback failure as unavailable. Never fall back to English speech or mark silent playback as a listening attempt. Offer an explicitly labelled reading/phrase-selection variant or retry. General guidance may use a matching-locale browser voice with visible text; if none is available, use text. Browser speech availability is not sufficient acceptance evidence for a Spanish listening trial.

## What else fits the format

| Candidate | Why the maze helps | When to try it |
| --- | --- | --- |
| Fractions / equal sharing | Divide a physical supply among destinations and compare leftovers | After reversible deposits work |
| Measurement / elapsed time | Compare path lengths, scale and schedules | After route quantities are trustworthy |
| Algorithms | Plan a sequence, use repeat blocks, debug a route | After route planning; distinct from dexterity |
| Science investigation | Visit stations, choose an experiment, compare observations | Requires a causal simulation, not decorative fact gates |
| Reading inference | Gather clues, revisit evidence, choose an explanation | After semantic inventory; avoid a single hidden author-intent answer |
| Language information gap | One character/player has instructions another needs; ask for clarification | After audio practice; genuine interaction is a larger feature |

Weak fits for this POC: long passive readings, isolated spelling quizzes with unrelated navigation, speed-based pronunciation gates, and open conversation judged by an opaque score. Standalone activities remain the leading simpler alternative if travel adds no learning value.

## Build order and acceptance

Work areas below express responsibility boundaries, not instructions to start parallel agents.

| Milestone | Depends on | Deliverable / affected surfaces | Exit evidence |
| --- | --- | --- | --- |
| M0 Content and fixture specification | — | Freeze four scripts, variants, correct/alternate solutions, hints and transfer trials; storyboard overview, gameplay, recorder and parent summary. Specify complete Bridge Builders fixture plus Expedition graph | Walk through every branch and approved non-recording alternative; enumerate intended/invalid routes; review page by page before substantial UI work |
| M1 Contracts and registry | M0 | `packages/learning/**`, `docs/education/html-contract.md`, `plans/contracts.md`; versioned schemas, overlay/events, path registry, locale-aware audio identity, full Bridge Builders document and binding | Strict parse/export/readback; invalid-reference and bound tests; 0.1–0.3 exports, six-introduction drafts and family levels still load; sampler personalization disabled |
| M2 Runtime and persistence | M1 | Pure transition/evidence model; shared browser storage plus education/game wiring; adapters and world projection contracts | Inventory conservation, duplicate/out-of-order events, revision conflict, interrupted writes, quota/unavailable storage, restore around deposits, lost-audio progression and stale-content tests |
| M3 First playable slice | M2 | Bridge Builders standalone/game; `apps/education/**`, `apps/web/src/learning/**`, game wiring; runtime sensor/object additions in schema/physics/engine and worker protocol | All four encounters, alternate totals, exact deposits, fall/reload before and after Confirm, no score-gem substitution; actual geometry traversable; legacy/ranked behavior unchanged |
| M4 Media and Message Trail | M3 | Shared recorder, ordered responses and delivery primitive, semantic destinations; both consumers | Start/stop/replay/retake/delete, ignored/denied/late permission, interruption, keyboard/tap access, explicit alternatives; real audible capture on desktop and physical iPhone |
| M5 Reviewed model assets and Spanish market | M1, M4 | Per-path/locale manifests and audio tool extension; reviewed Spanish clips and the market lesson | Audio-production authorization only if paid generation/upload is selected; dry-run inventory then reviewed recordings; missing/stale/wrong-locale clips cannot pass listening; deliveries work with matching evidence modes |
| M6 Expedition and long-form integration | M3, M5 | Committed traversal/cost protocol, chapter projection, undo and closures, resumable plans | Keyless bypass rejected; alternate valid routes accepted; jump/fall/cancel/backtrack cases; 24-node/3-chapter fixture, reload at every chapter, website-stage binding success plus explicit incompatibility |
| M7 Comparative playtest and handoff | M6 | Four portable lesson exports, matched standalone comparisons, observed results and remaining limitations | End-to-end walkthrough, fresh transfer items, physical-device audio acceptance, baseline regression checks; identify which two lesson families justify deeper work |

These milestones are responsibility boundaries, not instructions to spawn agents. Delivery primitives land in M4 because Message Trail already needs them; Spanish reuses them. Persistence is established before the first playable slice, then exercised across chapters in M6. Audio asset production is a visible prerequisite, not assumed to appear during browser testing.

Implementation verification commands available in this repository: `pnpm --filter @wwm/learning typecheck`, `pnpm vitest run --project @wwm/learning --project @wwm/education`, `pnpm build:education`, and the final required `pnpm check`. Run targeted tests for changed game/physics/engine modules and existing browser suites using their documented server setup. Extend those suites with the acceptance cases above. Do not run application tests solely for this Markdown change.

Acceptance also includes 390×844 and desktop layouts; keyboard/tap equivalents to dragging; visible focus/recording status; no motion during recording; no audio blobs or response text in application network/analytics calls; English/Spanish export readback; and no silent downgrade of a required 0.4 capability. Real clips must be audibly reviewed on each target device; mocks alone cannot pass audio acceptance. Report measured chapter binding/load costs and frame-time changes against the same device/stage baseline; unexplained regression requires investigation before the next slice.

## Exposure, rollback and remaining gates

The sampler stays opt-in through its experimental catalog entry or explicit local URL. Legacy entry points continue to select the existing baseline. Deploy nothing during this planning task. No new secrets or production database migrations are required for local runtime, recording or IndexedDB progress. Existing audio-provider configuration is used only in an explicitly selected production step.

Implement the reader/registry before enabling sampler links. Roll back by hiding the sampler entry and disabling its explicit route while leaving the legacy path available; do not delete snapshots automatically. If runtime/schema code is rolled back to a version that cannot read 0.4, show unsupported-content/version guidance rather than trying to reinterpret new data. Provide explicit Delete progress and discard transient clips when leaving a session. Do not regenerate or overwrite baseline assets to deploy/undo the sampler.

No product clarification blocks implementation planning. Educator/fluent-speaker review remains an M0/M5 content gate; paid generation/upload remains a separate action if selected; physical-device testing and the playtest determine readiness. An implementation inability to satisfy a runtime overlay must return with evidence before proposing persisted stage-schema changes. These are explicit gates, not permission to expand into cloud learner storage, speech assessment or public deployment.

## Cheapest test of the main hypothesis

For each objective, make one short maze version and one matched standalone version. Use fresh but comparable items; vary which format comes first. Keep motor difficulty low and target language fixed in the comparison. Begin with a few parent-facilitated sessions for usability; this small sample cannot establish educational effectiveness.

Observe: independent vs prompted decisions, hint/support use, route understanding, requests for adult UI help, wasted traversal, recording willingness, and a new transfer item. Keep navigation time/falls separate from learning responses. Do not treat engagement, completion, recordings, or repeated correct answers as mastery.

Provisional decision rules: a repeatable deadlock or unlabelled evidence downgrade blocks the next build slice; if learners repeatedly solve the standalone task but need help navigating the equivalent maze, simplify the controls/route before adding content; if a lesson's world actions have no meaningful relation to its learning objective, retain its standalone version. If local record/replay is useful, then investigate human rubric review or narrowly evaluated speech feedback.

Recommend the four-lesson sampler over four longer multiple-choice lessons. Its tradeoff is more adapter work, but each addition tests a reusable capability. The outcome is a decision about which two lesson families merit deeper investment, not an early commitment to a general curriculum or universal learning API.
