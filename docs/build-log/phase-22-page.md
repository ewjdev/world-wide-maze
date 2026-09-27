# Phase 22 M4: lesson page and parent area (sub-agent L3)

**Scope:** `apps/education/**` and `docs/education/**`, from `plans/phase-22-learning-mechanics.md` §1, §2 and §6 (page and parent area), M4 and Acceptance. Built on `wwm-learning/0.3` (commit `0a0648b`). `packages/learning` was not edited.

## What changed

**Lesson page** (`src/lesson.ts`, `src/render.ts`, `src/style.css`)
- **Voice-synced choices.** A `choice` cue holds `is-callout` on `[data-choice-mark]` and `[data-key-badge]` for 600 ms. A timer holds the class rather than an animation, so it also shows with reduced motion. Every round opening speaks its prompt, then its callout.
- **Shuffled positions.**
  - Each play-through gets `randomSeed()` and the path's `play.shuffle`, and "Play again" draws a new seed.
  - The page renders `currentRound()` and speaks from `sessionScript()`, so count lines and callouts name what's on screen.
  - `data-seed` sits on the lesson `<article>`. `?seed=<n>` replays a play-through exactly (`0` = as written), which the e2e tests use.
- **Input modes.**
  - **Device detection:** tap is always available; a keyboard counts when `(any-pointer: fine)` matches or a key has been pressed this tab session (`sessionStorage`); tilt is never available. The policy is computed per round, and again when the first key press arrives mid-round.
  - **With badges:** the scene gets `show-keys`, the answer buttons' names end with ". Key A", and a hint line appears under the question ("Press A or B", "Type the number: 2, 3 or 4").
  - **Arrows-only rounds** (r3b) show "Use ← →, then Enter". The input line is spoken after the callout. Letter and digit keys answer through `keyToChoice`, arrows move an `is-focus` cursor, and Enter answers it.
  - **Nudges:** every pointer answer goes through `judgeInput`. A nudge says the nudge line and the callout, flashes the badges and the hint line (`is-nudge`), and doesn't answer. The third tap is accepted, and nudges reset each round.
  - **Keyboard and assistive-technology presses** of an answer button (`detail === 0`) always answer, so screen-reader and switch users are never nudged.
  - **Tap only** removes the badges, the hint, the input line and the nudges.
- **Grown-up notes.** A new "In the game" paragraph (`#game-level`) reads, for example, "In the game: Gated (recommended by the lesson). Bridges and lifts stay locked…". It adds "Answering: tapping only." when that's set, links to the settings, and shows a warning when the stored settings were rejected.

**Parent area** (`src/home.ts`, `src/storage.ts`, `render.ts gameSettingsHtml`)
- A new **Game settings** section follows the personalization controls.
  - One disclosure per lesson. Its summary shows the current level ("Gated (recommended by the lesson)" or "Missions (your choice)").
  - Opening it shows radio cards for `levelsFor(activity)`, each with its `describeLevel()` text and the author's default marked "(recommended by the lesson)".
  - An "Answer by tapping only" switch with a one-sentence explanation.
  - "Use the lesson’s recommendation for every lesson" (keeps tap-only), and "Reset game settings".
- **Storage:** `wwm-learning:settings:v1` holds `{ levels, tapOnly }`, separate from the family version. "Restore original path" keeps it; the e2e test checks this.
  - Picking a lesson's recommended level removes its entry, and an empty record is deleted.
  - `readFamily()` applies the settings with `applyFamilySettings` for the home page, lesson pages and the download.
  - Invalid stored settings are rejected as a whole (`parseSettings`, fail closed), with a warning on both pages.
- **Portable download:** a new visible "Game settings" section lists each activity's level and description, plus the answering setting. It still has one inert JSON script and no `src=`, and `readLearningHtml` round-trips `family`.

**Docs:** a consumer section in `docs/education/html-contract.md` (extension only), plus the answering and Game settings components in `apps/education/DESIGN.md`.

## Tests
- `pnpm check`: green. 82 test files passed, 3 skipped; 1129 tests passed, 31 skipped (the browser tests skip without `WWM_EDUCATION_E2E_BASE`).
- `pnpm build:education`: passes.
- The e2e ran against `vite preview` on 127.0.0.1:4184 (`WWM_EDUCATION_E2E_BASE`, `WWM_EDUCATION_SHOTS=/tmp/wwm-p22-page`): **31 passed** (2 files).
- **New e2e:**
  - Callout pulses in order: `a, b` on r1, and `a, b, same` on r4 (with badges).
  - Shuffling: two seeds show different islands and still judge correctly, the worked example counts the shown island A, the same seed replays identically, count-three options are permuted, and "Play again" gets a new seed.
  - Letter-key round: badges, the hint and the aria keys; "Press the letter!" is spoken; two nudges, then the tap is accepted; the key answers; a keyboard-activated button answers without a nudge.
  - Number-key round (r5b: "2" is wrong, "3" is right).
  - Arrows round (r3b).
  - Tap-only.
  - Touch-only phone fallback (`hasTouch`/`isMobile`: no badges or nudges).
  - Game settings persist, the export carries `family` and a "Game settings" section, and the lesson notes show the level.
  - Bad stored settings bring a warning and a reset.
  - 390×844 and 1440×900 with no horizontal scroll, and reduced motion covers the nudge.
- **Unit tests** (`pages.test.ts`): scene keys and aria labels, input hint text per round and device, the settings markup, `gameLevelText`, the export with `family`, and `parseSettings` validation.
- **Fixed pre-existing e2e failures** left by M1: the prompt/callout speech order, the `baselineVersion` 3.0.0 AI prompt, and clips played from the network. The tests now block `*.mp3` so every line goes through the speech stub.

## Screenshots (`/tmp/wwm-p22-page/`, reviewed)
- `p22-callout-pulse.png`: r2 while Pip says "island B?". Island B has the solid callout halo, and "B?" is highlighted in the feedback.
- `p22-key-badges.png`: r2 with the A/B badges and the "Press A or B" line.
- `p22-nudge.png`: after a tap in r2. The hint is highlighted, the badges have Glow rings, and the feedback reads "Try pressing the letter! Island A… or island B?".
- `p22-game-settings-desktop.png` and `p22-game-settings-mobile.png`: the Game settings block with "Which has more?" open.
- `lesson-*-mobile-round.png`: the first round of each lesson at 390×844, with the hint line where the round invites keys.

**Fixed after looking at them:**
- The flat 6×(2–4) radio grid was about 1,700 px tall on desktop and 3,000 px on mobile. It is now one disclosure per lesson.
- The nudge was hard to see in a still frame, so the badges got a Glow ring.
- There was a double divider above the actions.
- The fixed skip link showed up in element screenshots; it is hidden in the screenshots only.

## Requests for `packages/learning` (orchestrator)
1. **`voice.ts`, speech fallback runs twice.** When a clip fails, both `play().catch` and `element.onerror` can start `playSpeech` for the same line. `onerror` doesn't check `settled`.
   - In the tests this shows as the line spoken twice; `spoken()` collapses immediate repeats and cites this.
   - In a real browser, the second `speech.cancel()` can end the first utterance and advance the sequence, cutting the line short.
   - Suggested fix: `if (settled) return;` at the top of `onerror`, keeping `failed.add`.
2. **`scene.ts`: key badges scale from the SVG origin.** `.key-badge.is-callout{transform:scale(1.25)}` has no `transform-box`, so a callout would jump the badge towards (0,0). The page works around it in `style.css` (`transform-box: fill-box; transform-origin: center`). The game renders the same SVG and would need the same fix, so it belongs in `STYLE`.

## Known issues
- `?seed=` is a page convenience for replay and tests, not a contract field.
- A keyboard is assumed on any device with a fine pointer, so a touchscreen laptop gets badges. Taps are still accepted after two nudges, and tap-only turns the badges off.
- The "In the game" wording adds "(recommended by the lesson)" after the label when the level is the author's default, a small extension of the spec's "In the game: <label>. <description>".
