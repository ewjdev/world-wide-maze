# Learning HTML, experimental v0.2

## Guided science 0.5 review reader

`guided-v05.ts` provides `parseGuidedPath`, `readGuidedLearningHtml`, `readGuidedLearningDocument`, `guidedLearningScript` and `guidedCapabilities`. It dispatches 0.1–0.3 documents to the existing legacy reader, and validates guided science as strict `wwm-learning/0.5` / revision `1.0.0`. Legacy readers continue rejecting guided data, including motion rounds placed in a 0.3 envelope. The separate 0.4 encounter/inventory reader remains independent; normalized guided paths have kind `guided-v05`.

The curated `pip-discoveries` path contains `rocket-lab`: four required predictions and optional space. It requires `round.predict-motion`, `scene.rocket-lab` and `demo.rocket-push`. Guided activities require a demonstration, motion rounds, fixed spatial order and a finish lock covering their required rounds. The consumers reject disabled or unsupported lessons before state construction.

`motion.ts` bounds apparatus, setting, escaping-gas direction and initial rest. It derives expected motion and validates semantic marker identity/order, unique choices and a single matching answer. The trusted renderer draws the balloon/string/knot or rocket/exhaust; imported HTML cannot provide scene markup, URLs or an animation script. `guidedLearningScript` uses the existing single inert JSON block and byte bound, with escaped `<`, `>` and `&`.

An accepted answer enters a tokenized pending explanation. A matching `effect-complete` alone commits required progress and maze locks; replay or old callbacks cannot add another completion. Intro must finish before answering. Reduced motion uses before/after frames. Hidden, disposed, restarted or closed work cancels; reopening replays the pending explanation. Narration may extend the readable after-frame within a finite silent fallback, so failed providers cannot block progress indefinitely.

The standalone route is `/education/lessons/rocket-lab/`; the game route is `/play/practice?learn=rocket-lab`. `VITE_ROCKET_LAB_ENABLED` defaults false and production explicitly sets false. The web build copies education's compiled output under `/education/`. Answer hit areas hydrate numeric geometry through CSSOM under `style-src self`. Portable HTML supplies readable before/after examples and imports through the guided reader. Rocket does not read or overwrite the six-activity family draft; the existing mute preference remains shared.

See [execution and release gates](../../plans/pip-rocket-lab-execution.md) and [review evidence](../build-log/pip-rocket-lab.md). New authored clips, physical devices and educator/child acceptance remain pending; this guided format is an original review convention, not an external standard.

## Phase 23 experimental 0.4 reader (in progress)

`packages/learning/src/lesson-v04.ts` defines a separate strict `wwm-learning/0.4` document. The 0.1–0.3 reader and the six `little-discoveries` activities remain unchanged. `normalizeLearningDocument` identifies old paths as `legacy-linear` and preserves their original normalized 0.3 data; it identifies the experimental path as `v04`. `readLearningHtmlAny` reads one inert script, applies the same 200 KB JSON bound and rejects unsupported formats. A 0.4 export is not promised to old consumers.

The first executable 0.4 contract is `bridge-builders`. It declares exact inventory, unique pickup IDs, four encounters, deposit totals and connector IDs. Its authored fixture lives at `fixtures/learning/bridge-builders/`. The separate binding manifest names targets and stage connector IDs, with a full stage-content hash. Neither the document nor imported HTML contains a world path, media origin, or executable code. The current `apps/web/src/learning/world.ts` binder rejects missing references, a changed stage and unsafe or overlapping placements. Graph reachability under every authored state and physical collision traversal remain acceptance work.

The pure reducer in `packages/learning/src/bridge-runtime.ts` accepts a lesson revision, session, attempt, node, event ID and strict sequence. Pickups and exact Confirm are deduplicated, tentative transfers can be returned, and Confirm alone opens a connector. `apps/web/src/learning/storage.ts` provides an IndexedDB compare-and-commit boundary for Bridge Builders. The game must commit before projecting the world or acknowledging an action. The sampler is currently draft and is not linked or offered by the game or education app.

This is an original experimental convention, not an established HTML standard. The implementation authority is `packages/learning/src/schema.ts` (`wwm-learning/0.2`, CCR-EDU-02). Existing game contracts remain in `@wwm/schema`.

## One document, several readers

The education app generates readable HTML and structured learning data from the same validated object. The readers are the lesson pages, the portable download, and the WWM game adapter. Every page includes exactly one:

```html
<script id="wwm-learning" type="application/json">{ "format": "wwm-learning/0.2", "…": "…" }</script>
```

The JSON is inert. It escapes `<`, `>` and `&`, and contains the full path. The JSON contract is authoritative. Visible markers only connect it to what a person reads, so a consumer must not infer educational intent from arbitrary appearance.

### Markers

| Marker | Where it appears | Meaning |
| --- | --- | --- |
| `data-learning-activity="<id>"` | Lesson `<article>` and portable `<article>` | The activity shown |
| `data-learning-kinds="compare difference"` | Lesson `<article>` | The round kinds this activity uses |
| `data-learning-round="<id>"`, `data-learning-kind="<kind>"` | The lesson stage (current round), each grown-up round item, each portable round section | One round |
| `data-learning-field` | Visible text | One of `introduction`, `prompt`, `objective`, `hint` (one per ladder step), `explanation` (the round's success line), or `offline` |

## Fields

| Field | Meaning |
| --- | --- |
| `format` | Exact wire-format version. Unsupported versions fail closed; a valid `wwm-learning/0.1` document is upgraded to a one-round 0.2 document (`upgradeFromV01`) |
| `id`, `version` | Baseline path identity and revision (`2.0.0`) |
| `language`, `suggestedAges` | Initial language and audience. Not an assessment |
| `reviewStatus` | Pilot awaiting educator review |
| `provenance` | Original baseline, or parent-personalized introductions |
| `theme` | Guide (Pip), palette, and declarative sprites (`pip`, `gem`, `island`, `plank`, `gate`, `cloud`). See below |
| `voice` | Optional. Provider, voice, model, a settings hash, and clips (`line`, `text`, `hash`, `ms`, word start times) |
| `activities[].id` | Stable baseline activity identity |
| `objective`, `parentNote`, `offlineActivity` | Intent, interpretation limits, and an off-screen extension |
| `introduction`, `finale` | Pip's first and last lines for the activity |
| `rounds[]` | 1–8 rounds. Kinds are `choose` (options with shape tokens), `compare` (two gem islands, optionally a "Same" choice), and `difference` ("how many more", numeric choices) |
| `rounds[].hints` | A ladder of 1–3 steps: a nudge, a strategy (the match tool on island rounds), then a worked example |
| `rounds[].success` | What Pip says when the round is solved: the answer, explained |
| `rounds[].optional`, `onlyAfterHelpOn` | Bonus rounds (offered, never required) and follow-ups played only when an earlier round needed the strategy step |
| `tools` | `["match"]` when the one-to-one matching tool is offered |
| `prerequisites` | Earlier suggested activities, never a lock on access |

Gem groups are `{ count, arrangement, size, seed? }`. Every consumer computes gem positions with the shared pure `layoutGroup()`, and pairings with `pairUp()`, so they all draw the same picture. Answers are derived facts: the validator rejects a compare answer that doesn't match the counts, or a difference answer that isn't the actual difference.

## Theme safety

The theme is data, not markup. A sprite part is a `circle`, `ellipse`, `rect`, `polygon` or `path`:
- Path data may contain only move, line, curve and close commands, plus numbers.
- Fills and strokes must be palette keys, and the palette holds only hex colours.
- There is no text, no URL, no `href`, and no style string.
- The theme is at most 12 KB.

Only the trusted renderer (`sceneSvg`, `spriteSvg`, `spriteMarkup` in `@wwm/learning`) turns it into SVG, and it writes only numbers, validated colours and text it escapes itself. The scene SVG is decorative (`aria-hidden`). The lesson page places real `<button>`s over `sceneLayout().choices`, and each accessible name begins with the visible label (for example "Island A: 3 gems, spread out").

## Voice

`activityScript`/`pathScript` generate every line Pip says, with stable ids such as `compare-groups.r3.match`. Counting and matching lines are templated from the round's numbers. Cues tie spoken words to what lights up: `light` lights a gem, `pair` draws a match line, and `leftovers` marks the unpaired gems.

A consumer plays a clip only when both the line id and its text still match. **The audio origin is consumer configuration, never read from the document.** The education app uses `VITE_LEARNING_AUDIO_BASE`, falling back to `DEFAULT_AUDIO_BASE`. A missing or blocked clip falls back to browser speech; without speech, the cues run on estimated timing. Family-personalized introductions have no clip and always use browser speech.

## Fork boundary

Drafts identify the baseline ID and version (`2.0.0`; saved Phase 19 drafts against `1.0.0` still apply, because introductions are keyed by activity id). A draft proposes a title, a description, and six introductions. Applying it creates a copy: rounds, numbers, questions, hints, answers, objectives, Pip and the theme are preserved, and provenance is marked personalized. Parent acceptance is a UI action before local persistence. The saved record also includes `acceptedAt`. Downloaded HTML displays that timestamp, and the backup JSON contains the editable draft. No child's identity is required.

The baseline ID and version do not uniquely identify fork text. Consumers must retain the exact document if they track future learning evidence; a content hash and a separate fork revision ID are prerequisites for cross-device progress or hosted publishing. Local browser versions are not published back to the server. A raw URL fetch returns the baseline, and the parent downloads the accepted fork to transfer it.

## Portable download

`portablePage` produces one self-contained HTML file:
- Every round in readable form: its prompt, the hint ladder, the answer and success line, what it checks, objectives, parent notes, and the offline activity.
- The theme drawn as inline SVG (each round's wide scene, and Pip).
- The learning JSON as the **only** `<script>`: inert, no `src=`, no external resources.
- No audio: MP3s would break the no-`src=` guarantee and the size budget.

`readLearningHtml(portablePage(path))` returns the same path. A unit test checks this for the baseline and for a family fork.

## Consumer boundary

Use `readLearningDocument` (a DOM you already have permission to read) or `readLearningHtml` (HTML text, such as a downloaded file). Both only parse the inert JSON and never run page code. This package deliberately has no arbitrary-URL fetcher. A future remote loader needs its own origin policy, size limits, sanitized rendering, and publishing and review provenance. Never insert untrusted page markup into the game, and never treat prose as agent instructions.

The standalone lesson pages are the first consumer. The WWM game is the second. `/play/practice?learn=<activityId>` uses the bundled baseline, and the site-select "Load a learning page…" control reads a downloaded learning HTML file through `readLearningHtml`. The game then places "Pip gates" (learning portals, href `wwm-learning:<activity>/<n>`) on the stage and plays one round per gate. It uses the shared `step()` state machine and draws each round with `sceneSvg`, the trusted renderer. `checkpointSpec(theme, activity, roundId)` gives a game engine-neutral round data: choices in on-screen order, the answer, and gem positions in ball radii. Falls and maze scores must not become educational proficiency signals. One play-through is practice, not an assessment of mastery. Authentication, cross-origin publishing and learner records are separate additions.

## `wwm-learning/0.3` (Phase 22): how play works

0.3 is a superset of 0.2. A 0.2 document is read as 0.3. Additions:

- **`input`**, on the path's `play`, on an activity, or on a round (most specific wins): the ways a child is *invited* to answer. Values: `tap`, `letter-key`, `number-key`, `arrows`, `tilt`.
  - `inputPolicy(path, activity, round, device)` applies device fallbacks.
  - `judgeInput` nudges up to twice, then accepts.
  - `keyToChoice` maps keys to choices: A/B, S for "same", digits.
- **`play.shuffle`:** `positions` (default) or `none`. `presentRound(round, seed)` shows a round with its positions shuffled for one play-through. The answer follows the shuffle, and the callout names positions, not answers.
- **Callout lines:** each round has one, e.g. "Island A… or island B?". Its `choice` cues pulse each choice as it's named.
- **Levels:** `activity.play = { defaultLevel, levels: [{ id, label, steps, locks }] }`. Each level is the author's recipe:
  - **Steps:** rounds and missions, in order. `steps: "rounds"` means the required rounds.
  - **Lock configuration:**
    - `mode`: `none`, `goal` or `path`
    - `connectors`: `bridge`, `elevator`
    - `goal`
    - `signals`: `banner`, `voice`, `beacon`, `mapPadlocks`
    - `override`: `grown-up` or `none`
  - **Per-step override:** a step can set `lock` to `path`, `goal` or `none`.
  - **Missions:** `collect { count }` and `reach { island: most-gems | fewest-gems | { letter } }`.
  - **Missing play block:** an activity without `play` gets `explore` and `gated`.
  - **Validation:** `playIssues` reports contradictions in readable words.
  - **Game capabilities:** `levelRequires` and `playableLevels` let a game offer only the levels it can fully honour.
- **`family = { levels: { [activityId]: levelId }, tapOnly }`:** the grown-up's choices, carried in the exported HTML. `resolveLevel` returns the grown-up's choice, else the author's default.

The document declares **intent, never geometry**. It can't name a bridge, because it doesn't know which website becomes the maze. A game binds the steps to its own world. WWM's binding and runtime locks are described in `plans/phase-22-learning-mechanics.md` §4–5 and in contracts §10.4.

### The lesson page and parent area as a 0.3 consumer (Phase 22 M4)

How `apps/education` applies 0.3. This describes one consumer; it doesn't change the document format.

- **Positions.** Each play-through starts `initialState(activity, { seed: randomSeed(), shuffle: path.play.shuffle })`, and "Play again" draws a new seed. The page renders `currentRound()` (the shuffled round) and speaks from `sessionScript()`, so count lines and callouts match what's shown. The seed is exposed as `data-seed` on the lesson `<article>`. `?seed=<n>` replays a play-through exactly; `?seed=0` shows the rounds as written.
- **Callouts.** A `choice` cue adds `is-callout` to `[data-choice-mark]` and `[data-key-badge]` for that choice for about 600 ms. The class is held by a timer, not an animation, so it still shows with reduced motion.
- **Inputs.** The device is `{ tap: true, keyboard: (any-pointer: fine) or a key pressed this tab session, tilt: false }`, and `inputPolicy()` runs per round.
  - With `badges`, the scene gets `show-keys`, each answer button's name ends with its key ("Island A: 3 gems, spread out. Key A"), and a hint line under the question reads "Press A or B" or "Type the number: 2, 3 or 4". An arrows-only round shows "Use ← →, then Enter".
  - The input line (`promptLine`) is spoken after the callout and isn't repeated in the written feedback.
  - Letter and digit keys answer through `keyToChoice` only while badges show. Arrow keys move an `is-focus` cursor in on-screen order, and Enter answers it.
  - Every pointer answer goes through `judgeInput()`. A nudge says `nudgeLine()` followed by the callout, flashes the badges (`is-nudge`), and doesn't answer. Nudges reset each round.
  - An answer button activated from the keyboard or by assistive technology (a click with `detail === 0`) always answers. Screen-reader and switch users answer with the buttons and are never nudged.
- **Game settings.** They're stored under `wwm-learning:settings:v1` as `FamilySettings` (`{ levels, tapOnly }`), apart from the family version (`wwm-learning:family-fork:v1`), so restoring the original path keeps them.
  - A record that fails `applyFamilySettings` against the current path (unknown lesson or level, wrong types, extra keys) is ignored as a whole, with a visible warning.
  - Every page reads the path through `applyFamilySettings`, so the page's own `#wwm-learning` JSON and the "Download learning HTML" file carry `family`.
  - Choosing a lesson's recommended level removes that lesson's entry. With nothing left to remember, the record is removed.
- **Portable download.** It adds a visible "Game settings" section: each activity's level with its generated description, and the answering setting. It still has exactly one inert JSON script and no `src=`.
