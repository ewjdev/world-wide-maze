# Phase 23 proposal — Four lessons that stretch the maze

September 26, 2026. **Design proposal, not implemented.** Builds on the current Phase 22 checkout and `wwm-learning/0.3`. No public deployment or audio-provider work is part of this document change.

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

**Chapter A: understand and plan.** Deliver a parcel to the tower before the dock, then return to base. Start with 8 energy. Authored bidirectional edges cost: base→key 1, key→tower 2 (requires the key), tower→dock 2, dock→base 2; base→tower 2 also requires the key; key→dock 3. Choose/preview a route before travelling. The intended route base→key→tower→dock→base costs 7 and obeys delivery order. Other routes are judged by the same constraints, not a stored answer string. A map preview shows the running budget.

**Chapter B: explain and carry out.** Record 20–30 seconds using “Primero … Después … Al final …”, supported by destination cards. For example: “Primero, tomo la llave. Después, voy a la torre. Después, voy al muelle. Al final, vuelvo a la base.” Offer one short sentence at a time with model replay; the increase in difficulty comes from planning and sequencing, not advanced Spanish grammar. Execute the route; the game evaluates visits/resources, while a listener reviews whether the explanation matches the plan. Preview and undo prevent resource mistakes from becoming dead ends.

**Chapter C: revise.** Before departure, close tower→dock. Provide a visible tower→shelter edge costing 1 and shelter→dock costing 1, preserving the total of 7. Revise the plan and optionally record one sentence about the change. A new map at the end tests whether the learner applies the constraints again. Do not close a route after spending resources without supplying a reachable recovery route or restoring the chapter checkpoint.

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
| `mission.deliver` | Spanish market | Item/count/destination predicates and visible partial progress |
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

Every event identifies lesson revision, session, node, event ID and sequence. Duplicate pickup/delivery events cannot double-spend or double-complete. Completion and world effects commit once; retries replay safely. A future speech evaluator can emit a separate assessment result with provider/rubric/version and uncertainty, without changing inventory or asserting mastery.

Declare `interfaceLocale` and `targetLocale` separately; prompts/model clips carry locale. Include locale, exact text, voice and settings in clip identity. Broaden ages/domains explicitly rather than mislabelling language content as counting. Retain strict parsing and bounded documents.

**Capability mismatch:** report the unsupported action before starting. Offer an explicitly authored alternative with its own evidence label. Never silently convert a spoken task into a correct multiple-choice answer or downgrade an exact task's quantity. Current level fallback behavior needs review for these stronger guarantees.

## Long mazes: separate lesson progress from geometry

- Chapter boundaries create natural stopping points. Keep the active world segment small; a lesson can contain more steps than the number of currently visible posts.
- Start with 3 chapters and a synthetic 24-node lesson to exercise limits beyond 8 placed spots and 12 legacy steps. These are explicit POC bounds, not unlimited content promises.
- Bind the next chapter before entering it; failures retain the current checkpoint and explain incompatibility. Do not skip a required mission because no post fits.
- Save lesson/version/seed, node results, support used, inventory, world pickups, locks, route changes and safe spawn atomically. Do not restore progress against a different content/stage hash without an explicit migration or restart choice.
- Falling changes safe position, not completed educational evidence. Replaying a chapter distinguishes practice retries from new observations.
- Record learner audio in memory for the POC. Chapter progress can persist locally, but audio itself does not survive reload; tell the user before leaving and offer explicit download. Missing audio after reload is `unavailable`, never evidence of a successful speaking assessment.
- Authoring validation must test dependencies and inventory under every authored branch. Physical playthrough must verify collision geometry as well as graph reachability. Ensure rejected placements cannot lock away their own requirements.

## Audio recording experience

At a safe post, pause motion and guide playback. Present model replay, a visible **Record** action, elapsed/remaining time, **Stop**, then **Listen**, **Try again**, **Keep**, and **Delete**. Start capture only on the learner's action and browser microphone grant; stop tracks on stop, cancel, navigation, interruption or disposal. Never resume recording automatically after interruption.

Use `getUserMedia({ audio: true })` and `MediaRecorder`, negotiate supported audio MIME types and handle runtime errors. A supported MIME type is not a guarantee that capture succeeds. HTTPS/localhost, microphone permission, denied/ignored permission, missing devices and physical iPhone behavior need real verification. [MDN microphone access](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [MDN recorder format negotiation](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static).

Keep clips device-local and ephemeral initially; no automatic upload, analytics attachment, cloud transcription, or public clip URL. Retakes discard the prior pending blob and object URL. Limit individual clips to 30 seconds and retained clips to 10 per session; prompt to delete/export before exceeding the cap. Explicit download is user-controlled. A future persistent portfolio/upload feature needs its own retention and access design.

Use distinct results: `recorded`, `reviewed-by-learner`, `reviewed-by-adult`, `skipped`, `unavailable`; assessment is separately `not-assessed` or a rubric result. Silence detection may suggest retry but cannot classify pronunciation. Keep supported text/selection paths playable and label their evidence accurately.

The ACTFL framework distinguishes interpretive, interpersonal and presentational communication, and notes that skills can differ within a learner. Here listening trials and recorded presentations are different observations. A scripted shop interaction is practice; it does not establish interpersonal proficiency. [ACTFL Can-Do Statements](https://www.actfl.org/educator-resources/ncssfl-actfl-can-do-statements).

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

1. **Author and review the four scripts.** Freeze objectives, language variants, correct/alternate solutions, misconception-specific hints, support rules, and transfer trials. Deliver four readable lesson pages/storyboards with a shared map reference. Review overview, gameplay, recording card and parent summary page by page before substantial UI work.
2. **Contract/runtime:** `packages/learning/**`. Add only required primitives, compatibility/migration checks, locale and bounded flow. Test inventory conservation, multiple valid routes, idempotent events, invalid references, branches and evidence separation.
3. **First vertical slice:** Bridge Builders in the standalone page and authored maze using one document. `apps/education/**` and `apps/web/src/learning/**`; additive engine/physics work only where deposits or scene objects demand it. Must complete without any quantity substitution.
4. **Recording slice:** shared browser media adapter, Message Trail, then Spanish market. Verify start/stop/playback/retake/delete and every unavailable/denied/interrupted path on desktop and a physical iPhone. No provider dependency to record/replay. Reviewed model clips are required for listening acceptance.
5. **Long-form slice:** Expedition chapters, resume, constraints and route changes. Exercise the 24-node fixture and one incompatible website maze. Report all binding failures explicitly. Compare the authored maze with a suitable website-derived maze using unchanged educational rules.
6. **Playtest and choose the next investment.** Complete an end-to-end walkthrough of all four lessons, portable HTML readback, old baseline regression checks, and the focused automated suite; run repo-required checks for implementation changes. Keep local/browser/device/deployed results separate.

Acceptance scenarios include: alternate valid arithmetic/route solution; extra/missing items; duplicate event; fall after delivery; retry after spending; resume at each chapter; changed lesson version; disconnected target; microphone denied/ignored; recorder error; missing target-language voice; no audio sent by the application; spoken task skipped without a pronunciation pass; old family export still loads. A real saved clip must be audibly reviewed on each target device—mock capture alone cannot pass audio acceptance.

## Cheapest test of the main hypothesis

For each objective, make one short maze version and one matched standalone version. Use fresh but comparable items; vary which format comes first. Keep motor difficulty low and target language fixed in the comparison. Begin with a few parent-facilitated sessions for usability; this small sample cannot establish educational effectiveness.

Observe: independent vs prompted decisions, hint/support use, route understanding, requests for adult UI help, wasted traversal, recording willingness, and a new transfer item. Keep navigation time/falls separate from learning responses. Do not treat engagement, completion, recordings, or repeated correct answers as mastery.

Provisional decision rules: a repeatable deadlock or unlabelled evidence downgrade blocks the next build slice; if learners repeatedly solve the standalone task but need help navigating the equivalent maze, simplify the controls/route before adding content; if a lesson's world actions have no meaningful relation to its learning objective, retain its standalone version. If local record/replay is useful, then investigate human rubric review or narrowly evaluated speech feedback.

Recommend the four-lesson sampler over four longer multiple-choice lessons. Its tradeoff is more adapter work, but each addition tests a reusable capability. The outcome is a decision about which two lesson families merit deeper investment, not an early commitment to a general curriculum or universal learning API.
