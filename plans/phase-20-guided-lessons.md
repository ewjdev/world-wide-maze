# Phase 20 — Guided lessons: Pip, Sky Islands, and a voice that explains
**Wave:** education track · **Contracts:** `@wwm/learning` → `wwm-learning/0.2` (CCR-EDU-02) · **Label:** N (new; not a 2013 feature)

> **Status: BUILT (September 26, 2026); PR open, stacked on Phase 19. Build log: `docs/build-log/phase-20.md`.** Decisions D1–D7 are answered below. The user added two requirements: walk through the finished HTML, and prove it loads into the game maze. The second pulls a minimal WWM adapter (formerly Phase 21) into this phase as M4b.

## Goal
Turn "Which has more?" (`compare-groups`) into the **reference lesson** for every future lesson: a short, escalating, themed challenge a 4–6-year-old can play without reading, guided by one voiced character, where the visuals and voice *explain* the math instead of decorating it. The same learning HTML document carries the theme — the guide ball and the maze pieces — as safe declarative data, so the standalone page draws it today and the WWM game can draw the same checkpoint later without extra assets.

Why this lesson first: the current version can be answered without counting. 2 vs 4 identical circles in a row means the longer row wins, both amounts can be seen at a glance, a guess is right half the time, and the lesson ends after one tap. Its own parent note ("vary spacing so a longer row is not mistaken for a larger amount") names the missing lesson. See the review in the September 26 conversation; walkthrough screenshots are in `/tmp/wwm-walk/` (local, not committed).

## Decisions already made (September 26, 2026)
- Option B: rebuild `compare-groups` as the model lesson, then apply the pattern.
- **Theme lives in the learning HTML.** The document encodes the visuals the ball and maze need; renderers read it, not app-specific assets.
- One guide character, voiced with ElevenLabs.
- The user has a child tester available (the user runs sessions; the plan never records personal data about the child).

## Decisions (answered September 26, 2026)
| # | Question | Decision |
|---|---|---|
| D1 | Guide name | **Pip**, the WWM ball given eyes and a voice |
| D2 | Voice | Audition 3 ElevenLabs voices × 4 lines (`pnpm learning:voice --audition`). The tool ships a default voice; the user and tester pick the final one, and swapping regenerates only the changed clips |
| D3 | How build-time audio reaches ElevenLabs | Through **Cloudflare AI Gateway `wwm`**, whose ElevenLabs key is already stored (BYOK). **M0 spike passed:** the gateway is authenticated, so the tool calls it through a Workers AI binding (`env.AI.gateway('wwm').run({ provider: 'elevenlabs', endpoint: 'v1/text-to-speech/<voice>/with-timestamps' })`) under `wrangler dev`, using the developer's wrangler login. No gateway token or ElevenLabs key sits on disk |
| D4 | Where generated MP3s live | **R2 bucket `wwm-learning-audio`**, public read-only at `https://learning-audio.ewj.dev/<hash>.mp3`, with CORS GET/HEAD and immutable, content-hashed names. The repo commits only the manifest (hashes and word timings). The bucket and domain were created September 26 |
| D5 | Voicing parents' AI-personalized introductions | **Deferred** to a GitHub issue. Personalized lines use browser speech this phase |
| D6 | Phase 19 was uncommitted on `main` | Committed as PR #9 (`feat/education-phase-19`); Phase 20 builds on it (`feat/guided-lessons-phase-20`) |
| D7 | Bonus round | Included, optional, and skippable. It never blocks the end card |

## Owns
- `packages/learning/**`: schema v0.2, layout, matching, script generation, theme validation, migration, checkpoint spec
- `apps/education/**`: themed scene renderer, round engine, audio player, UI fixes
- `tools/learning-voice/**` (new): build-time voice generator
- `docs/education/**`: html-contract v0.2, content notes, playtest notes
- `plans/phase-20-guided-lessons.md`, `docs/build-log/phase-20.md`
- Root wiring only: `package.json` script `learning:voice`, CI steps for education
- `apps/web/src/learning/**` (new) plus minimal wiring in `apps/web/src/game/game.ts`, `apps/web/src/ui/Play.tsx`, and routes, for the M4b "learning gates" adapter. The orchestrator authorized this on September 26 in response to the user's "load into the game maze" requirement
- **Not owned:** `apps/worker`, `packages/schema`, and physics. If `packages/engine` needs gate styling, keep the change additive and record it in the hand-off

## Design

### 1. The lesson: five rounds, about two minutes
Rounds replace the single question. Each round is data, and counters are **gems** (the game's collectible items), identical in size unless a round deliberately varies size.

| # | Kind | Island A | Island B | Answer | What it checks |
|---|---|---|---|---|---|
| 1 | Warm-up | 2 gems, dice pattern | 4 gems, dice pattern | B | Confidence; learn the controls |
| 2 | Close call | 4, scattered | 5, scattered | B | Must count or match, not glance |
| 3 | **Trick** | 3, **spread wide** | 5, **bunched tight** | B | Longer-looking ≠ more (the real lesson) |
| 3b | Trick again *(only after 3 needed the match tool)* | 4 big gems | 6 small gems | B | Bigger-looking ≠ more; confirms it stuck |
| 4 | Same | 4, spread | 4, tight | **Same** (third choice) | "Equal" is a real answer; vocabulary |
| 5 | Bonus *(D7)* | 3 | 6 | B, then "How many more?" → 3 | Difference, which the old explanation only mentioned |

- Choices are the two islands (tap the island) plus, from round 4, a "Same!" stone between them. Choice order is fixed per round and not always B. Varied answer positions go in the final data. The table shows B for readability; the authored data alternates.
- Wrong answers never end a round and never cost anything. The **hint ladder** advances: nudge → match tool → worked example.
- A correct answer **locks** the round. Pip rolls across a new bridge segment, then the next round begins. After the last round there is an end card: "You built the whole bridge!", with the offline activity for the grown-up and "Next activity".

### 2. The match tool (the simple visual that explains)
- **Trigger:** "Match them up" is hint level 2. It also appears automatically after a second wrong answer.
- **Motion:** it pairs one gem from each island with an animated line, one pair per spoken "match". Unpaired gems glow, and Pip counts them: "One… two left over! This island has more."
- **Same round:** everything pairs, and Pip says "No leftovers. They're the same!"
- **Bonus round:** the number of leftovers *is* the answer to "how many more?"
- **Implementation:** a pure `pairUp(layoutA, layoutB)` in `@wwm/learning` returns pairs and leftovers from the shared layout. The page draws them; the game can use the same function.
- **Reduced motion:** lines appear together without animation, and the voice still narrates.

### 3. Hint ladder
| Level | Trigger | Shows | Says (example) |
|---|---|---|---|
| 1 Nudge | First wrong answer or first hint tap | Both islands pulse once | "Hmm. Look at both islands again. Take your time." |
| 2 Tool | Second wrong answer or second hint tap | Match tool, run by the child | "Let's match them up. One from here, one from there." |
| 3 Worked | Third wrong answer or third hint tap | Match tool runs itself; the answer island glows | "See the leftovers? This island has more." |

This fixes today's issue where the wrong-answer message already contains the whole hint.

### 4. Theme encoded in the learning HTML
The document gains a `theme` block with a palette and **declarative vector sprites**, not raw SVG. Trusted renderer code draws them, so a document never injects markup into the page or the game. This is consistent with `docs/education/html-contract.md` ("Never insert untrusted page markup into the game").

```jsonc
"theme": {
  "id": "sky-islands",
  "name": "Sky Islands",
  "guide": { "name": "Pip", "sprite": "ball" },
  "palette": {                              // sourced from the game's engine/game.css values
    "sky": "#f8f8f8", "ink": "#20262d",
    "islandTop": "#ffffff", "islandSide": "#4f9fd6",
    "bridge": "#3f9a4c", "gem": "#31a4ae", "gemEdge": "#206a71",
    "ballShell": "#dddddd", "ballSeam": "#456e93", "gate": "#4f9fd6"
  },
  "sprites": {                              // viewBox 0 0 100 100; parts reference palette keys only
    "ball":   { "parts": [ { "circle": [50, 50, 46], "fill": "ballShell", "stroke": "ink" },
                           { "path": "M6 56 C30 44 70 44 94 56", "stroke": "ballSeam", "width": 5 } ] },
    "gem":    { "parts": [ /* hexagonal gem, gemEdge outline for ≥3:1 contrast */ ] },
    "island": { "parts": [ /* white top, blue side band */ ] },
    "bridge": { "parts": [ /* green planks, white edges */ ] },
    "gate":   { "parts": [ /* portal-style ring */ ] }
  }
}
```

**Validation:**
- Parts are limited to `circle`, `rect`, `polygon` and `path`.
- Path `d` may only contain `MLHVCQZ` commands and numbers.
- Fills and strokes must be palette keys.
- Each sprite is ≤ 2 KB and the whole theme is ≤ 12 KB.
- No text, URLs, `href`, or style strings.

**Contrast:** gem `#31a4ae` on white is below 3:1, so gems always carry the `gemEdge` outline (WCAG 1.4.11 applies to meaningful graphics).

**Clutter rule:** counted objects are the highest-contrast things on screen. Scenery (sky, clouds, the goal island) stays low-contrast and never moves while the child is deciding. Kindergartners in heavily decorated classrooms were measured to spend more time off-task (Fisher, Godwin & Seltman, 2014). The trick rounds also only work if the *only* differences are the ones we designed.

**The game reads the same data.** `checkpointSpec(activity, roundId)` returns engine-neutral data:
- Two gates, each with gem count, layout coordinates in ball radii, gem size, and which gate is correct.
- Theme palette keys for the ball, gems and gates.

The Phase 21 adapter maps this onto `Item` visuals and a portal-style gate choice. A wrong gate loops back with the match animation, never as a penalty. That follows the existing portal decline pattern (`apps/web/src/game/game.ts:1696`).

### 5. Voice: Pip explains, in sync with the picture
**Main channel for pre-readers.**
- A first "Tap Pip to start" unlocks audio (browser autoplay rules). After that, each round's prompt plays by itself.
- Pip is always tappable to replay. A mute toggle is saved in `localStorage` (`wwm-learning.muted`).
- Text stays visible for grown-ups and early readers, and the word being spoken is highlighted.

**Sync is what makes audio teach.** Count-along and match lines carry **cues**: each spoken number word lights the matching gem, and each "match" draws the matching line.
- Timing comes from ElevenLabs' `text-to-speech/{voice_id}/with-timestamps` endpoint (character alignment). It's reduced to word start times at build time.
- `env.AI.run('elevenlabs/…')` returns only an audio URL, so the build tool calls the provider path through AI Gateway (D3).

**Script generation.**
- `scriptFor(activity)` in `@wwm/learning` produces every line, each with an id like `compare-groups.r3.match`, its text, and its cues.
- Counting and matching lines are **templated from round data**, so changing a round's numbers can't leave the voice saying the wrong number.
- Prompt, nudge and success lines are authored per round.

**Draft script** (compare-groups; review the wording):
- Start: "Hi, I'm Pip! I roll across the sky. Can you help me build a bridge?"
- Frame: "Bridges need gems. We always pick the island with *more* gems."
- R1 prompt: "Which island has more gems? This one… or this one?" *(highlights A, then B)*
- R1 success: "Yes! Four is more than two. Bridge, go!"
- R2 prompt: "Ooh, these are close. Which island has more?"
- R3 prompt: "Tricky one! Some gems are spread out. Which island has more?"
- R3 success: "You checked! Five is more than three, even squished together."
- R3 nudge: "Spread-out gems can *look* like a lot. Let's match them up and see."
- R4 prompt: "Which island has more… or are they the same?"
- R4 success: "The same! Four and four. That's called *equal*."
- R5 bonus: "Bonus! This island has more. How many more? Match them and count the leftovers."
- End: "We did it! You built the whole bridge."

**Voice rules:** lines under about 10 words with one idea each, numbers written as words, pacing controlled with punctuation. Voice id, model and seed are locked, and the audio hash covers all of them.

**Build tool (`tools/learning-voice`, `pnpm learning:voice`).**
- For each script line it computes `sha256(text + voiceId + model + settings)`.
- It only calls ElevenLabs for hashes missing from the manifest or from R2 (checked with `HEAD`).
- It starts a local `wrangler dev` proxy Worker holding an AI binding (for the gateway) and a remote R2 binding (`wwm-learning-audio`). Each clip is generated through AI Gateway, written to R2 as `<hash>.mp3`, and recorded in `packages/learning/src/voice-manifest.json` as `{ line, text, hash, ms, words }`.
- A dry run is the default; `--write` spends credits. It logs characters used. The initial cost is small: all six lessons come to roughly 100 lines × 50 characters.

**Runtime.**
- The player looks up the clip whose line id *and* text match. The audio origin is consumer configuration (`https://learning-audio.ewj.dev/`), never a URL read from the document, which keeps the html-contract rule against fetching arbitrary URLs. It then plays the MP3 and cues.
- If the file is missing or fails, it falls back to `speechSynthesis` at the current 0.85 rate and runs the cues on estimated timing, so no line is ever silent.
- CI never calls ElevenLabs. A test fails if any baseline line's hash lacks a manifest entry, with the message "run `pnpm learning:voice --write`".

**Privacy.** ElevenLabs only ever receives our authored script, at build time. No child input, voice, or answers leave the device.

### 6. Contract: `wwm-learning/0.2` (CCR-EDU-02)
`@wwm/learning` is phase-owned (CCR-EDU-01), so `@wwm/schema` is untouched. Changes:
- **Path:** `format: 'wwm-learning/0.2'`, `version: '2.0.0'`, plus `theme`, `voice` (`{ provider, voiceId, model, settingsHash }`), `provenance` unchanged.
- **Activity:** `rounds[]` (min 1), `hints[]` (1–3, ladder), `story` (`{ scene, frame }`), `tools` (`['match']`), and `interaction`, which gains `'compare'` and `'how-many-more'` alongside `'single-choice'`.
- **Groups** are `{ count, arrangement: 'dice' | 'row' | 'spread' | 'tight' | 'scatter', size: 'small' | 'medium' | 'large', seed }`. Positions come from the shared pure `layoutGroup()`, so every consumer draws the same thing. Shape/colour token arrays remain for geometry, pattern and sorting.
- **Size limit:** `MAX_DOCUMENT_BYTES` rises from 100 KB to 200 KB (theme plus word timings for six lessons). A test measures the actual size.

**Migration.**
- `upgradeFromV01()` turns any 0.1 document into a one-round 0.2 document with the default theme.
- Saved family forks are drafts against baseline `1.0.0` that only change introductions. They keep working because `parseDraft` accepts 1.0.0 drafts and maps introductions by activity id.
- Readers still fail closed on unknown formats.

**Personalization prompt:** still changes only the title, description and introductions. It now tells the AI that Pip and Sky Islands are fixed, and that the rounds, numbers, hints and answers are not editable.

**Portable download:** still has no scripts or external resources. It includes the theme drawn as inline SVG, every round in readable form, and the script text. No audio, because MP3s would break the "no `src=`" guarantee and the size budget.

### 7. Fixes carried over from the review (all lessons)
- Correct answers lock; hint after success doesn't overwrite the explanation.
- "Next" appears directly under the success feedback, within the first viewport at 390×844.
- Accessible names include the visible label: "Island A, 4 gems, spread out". Voice-control users can say what they see, and screen-reader users get the counts they need, which is the stimulus rather than the answer.
- Group layouts use fixed patterns, so there's no uneven wrapping on mobile.
- The listen and hint buttons use the same size.

### 8. The other five lessons (minimum to keep the path coherent)
Each gets the Sky Islands frame, Pip's voiced lines (intro, prompt, a two-level hint, success), the lock/Next fixes, and one round. Their deeper redesigns (arrangement variety, trick items) are **out of scope**, listed as follow-ups in `docs/education/content-notes.md`.

## Milestones
| M | Work | Size | Exit check |
|---|---|---|---|
| **M0** Prep & spike | D6: commit Phase 19 on a branch. Spike: one request through AI Gateway to ElevenLabs `with-timestamps` (proves D3). Voice audition page: 3 voices × 4 lines, played for the user and tester (D2) | S | Timing JSON returned via gateway, or fallback agreed; voice chosen |
| **M1** Contract 0.2 | Schema, `layoutGroup`, `pairUp`, theme validator, `scriptFor`, `checkpointSpec`, `upgradeFromV01`, draft compatibility, updated prompt, html-contract v0.2 doc | M | Unit tests green; 0.1 fixtures and saved forks load |
| **M2** Compare-groups experience | Scene renderer (SVG from theme data), round engine, hint ladder, match tool with reduced-motion variant, lock and Next, end card, a11y names | L | Playwright plays all rounds, including wrong-answer paths, on desktop and 390×844 |
| **M3** Voice | `tools/learning-voice`, manifest, committed audio (D4), player with cues, word highlight, fallback, mute/replay, stale-audio test | M | Audio and cues in sync by eye; fallback path passes with audio blocked |
| **M4** Path coherence | Five lessons migrated minimally; home page uses the theme; portable download | M | `pages.test.ts` guarantees still hold; six lessons voiced |
| **M4b** Game adapter | `apps/web/src/learning/**`: load document, place Pip gates via the portal mechanism, checkpoint overlay using the shared scene renderer, tilt/keys/tap choices, voice | M | Browser walkthrough: roll into a gate, answer a round, resume play |
| **M5** *(deferred, D5)* | Worker voicing for personalized intros, tracked in a GitHub issue | — | Not in this phase |
| **M6** Playtest & hand-off | 2–3 short sessions with the tester (protocol below), fix what's found, content notes, build log, `pnpm check`, hand-off report | S–M | Findings recorded; check green |

Sizes are relative effort, not time promises.

## Playtest protocol (M6)
Observe and record behavior only: no names, ages beyond "4–6", recordings, or photos in the repo. Notes go in `docs/education/playtest-notes.md`.
1. Can the child start and finish without a grown-up operating the UI?
2. **Trick round:** do they choose by length first? After the match tool, do they get 3b right?
3. Do they use or ask for the match tool on their own?
4. Voice: do they listen, replay, or talk back to Pip? Any lines they didn't understand?
5. Is it too easy or too hard: bored by round 2, or stuck?
6. Afterward, off screen: build two block towers (4 and 4, one spread out). "Which has more?" This checks transfer, which the screen can't show.

## Acceptance
- `pnpm check` is green, and `pnpm build:education` emits index plus six lessons.
- Compare-groups has 5 rounds (plus 3b), the hint ladder, the match tool, the same-and-bonus mechanics, locked success, Next within the first viewport on 390×844, and an end card.
- Each lesson document contains a valid `theme` from which the ball, gem, island, bridge and gate render. A test rejects themes containing URLs, `href`, text, unknown palette keys, or disallowed path commands.
- `checkpointSpec` gives deterministic output for every compare-groups round, with snapshot tests. `layoutGroup` and `pairUp` are deterministic and pair correctly for equal, unequal and bonus cases.
- Every baseline script line has manifest audio with a matching hash. With audio blocked, the lesson still completes with browser speech. With speech also unavailable, text and cues still work.
- A 0.1 document and a saved 1.0.0 family fork still load.
- **Game adapter:** the WWM game loads a learning document (`/play/practice?learn=<activityId>` from the bundled baseline, or a downloaded learning HTML file), places "Pip gates" as learning portals on the stage, and pauses at each gate for the next round. Choices work by tilt or arrow keys plus JUMP/Enter, or by tap. The round is drawn from the document's theme, and gates stay optional (a child can roll past; declining keeps the gate inactive). A browser walkthrough captures screenshots of both the lesson page and the in-maze checkpoint.
- The portable download has one inert JSON script, no `src=`, and includes the inline themed SVG.
- No console errors, no horizontal scroll at 390 px, and reduced motion is respected.
- Playtest notes are recorded; the educator-review gate remains open (unchanged from Phase 19).

## Risks
| Risk | Mitigation |
|---|---|
| `with-timestamps` doesn't pass through AI Gateway | M0 spike first; D3 fallback (local build-tool direct call) or estimated cue timing |
| Theme becomes clutter that hurts attention | Clutter rule; tester observation in M6; scenery static during decisions |
| Voice sounds off to a child, or number pacing is too fast | D2 audition with the tester; per-line regeneration is cheap because files are hashed |
| Scope creep into the other five lessons | Fixed minimum in §8; deeper redesigns listed as follow-ups |
| Document size | 200 KB cap with a measured test; word-level timings only, never character-level |
| Generated-audio licensing in a public repo | D4; R2 fallback |
| Mixed voices (ElevenLabs Pip plus browser voice for personalized intros) | Accepted this phase; D5 follow-up |
| Treating completion as mastery | Unchanged principle: no scores or progress locks; notes say "practice, not assessment" |

## Follow-ups (not this phase)
- Deeper WWM integration: 3D gem islands built from `checkpointSpec`, instead of the 2D overlay card.
- Worker voicing of personalized lines (D5).
- Deeper redesigns of the other five lessons.
- Educator review, as a gate before any public launch.
