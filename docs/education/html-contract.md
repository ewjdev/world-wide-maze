# Learning HTML, experimental v0.2

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
