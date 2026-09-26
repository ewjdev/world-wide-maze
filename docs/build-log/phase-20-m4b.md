# Phase 20 M4b: Pip gates (the game adapter)

September 26, 2026. Claude Code sub-agent in its own worktree, working on the approved Phase 20 plan (`plans/phase-20-guided-lessons.md`, M4b and §4 "The game reads the same data"). This file covers only M4b. Phase 20's own build log is `phase-20.md`.

## What changed (N: new, not a 2013 feature)

A learning document now loads into the maze. Its rounds are asked at "Pip gates" on the stage.

- **Loading** (`apps/web/src/learning/load.ts`) follows the consumer rules in `docs/education/html-contract.md`. Only the inert JSON block is parsed (`readLearningHtml` → `parseLearningJson`). No document markup is inserted or run, and no URL is fetched. There are two ways in:
  - `?learn=<activityId>` selects an activity of the bundled baseline.
  - "Load a learning page…" on site select reads a downloaded learning HTML file with `File.text()`.
  - Without an id, the first activity whose rounds are all `choose`, `compare` or `difference` is used. Errors are shown as kind, translated messages.
- **Gates ride the link-portal pipeline.** When a lesson is loaded, a stage's link portals are replaced by Pip gates before the engine and the simulation load it. They reuse the same physics sensor, the same pause (driver paused, timer stopped) and the same "used" state after a gate is done.
  - Each gate has a `wwm-learning:<activity>/<n>#<gate colour>` href, which the engine draws in the theme's gate colour with Pip as the monogram.
  - The game never treats a gate as a link: no travel, no journey stop, no health probe, no `portal_selected` telemetry.
- **Placement** (`placement.ts`) re-applies the builder's portal rules at runtime:
  - on islands reachable from the start, with the whole ring on the island;
  - ≥ 4 D from the start and the goal, ≥ 2 D from bridge and lift mouths and from large items;
  - no small item or restart point inside the ring, and ≥ 6 D apart.

  The grid is fixed, so placement is deterministic. Gates are spread evenly from the start towards the goal.

  **Count:** the main rounds plus the trick follow-ups (5 for compare-groups, capped at 5). With only `requiredRounds` gates, a child who needed help on round 3 would never reach round 4. An extra gate offers the bonus.

  If a stage has no room for a gate, the round is asked when the intro ends, before the countdown.
- **The card** (`LearningGateCard.tsx`) draws the round with the shared `sceneSvg`. It is a trusted renderer, so the output goes into `dangerouslySetInnerHTML`.
  - **Choosing:** transparent buttons over the choice boxes take taps. Phone or gamepad tilt (with hysteresis and repeat) and ←/→ move the `is-focus` cursor. 1–3 answer directly. JUMP (after a release) or Enter/Space confirms.
  - **Help:** Help climbs the hint ladder, "Match them up" runs the match tool, and "Skip gate" is never a penalty.
  - **Effects** follow scene.ts. The step's `show` sets the classes, and voice cues light gems, draw pairs and mark leftovers. If the voice is cut short or silent, the full match still appears.
  - **One `LessonState` per session.** It lasts across gates, stages and retries, and resets on a new game or a new document.
  - **Voice:** Pip speaks through `createVoicePlayer` with `DEFAULT_AUDIO_BASE`. It follows the game's mute and is unlocked on the game's first gesture.
- **UI chrome:**
  - a loader strip under the address bar on site select;
  - a HUD chip showing the lesson and its bridge progress;
  - a notice for a lesson that didn't load.

  Strings are in en and ja. Lesson content stays in the document's language.
- **Scoring:** a solved gate awards no points, and falls and scores never reach the lesson. Replays stay verifiable, because a paused gate records no ticks and the gates don't touch physics.

**Outside `apps/web`:** there is one additive change in `packages/engine/src/world/portals.ts` (and its export in `index.ts`). `LEARNING_HREF` and `isLearningHref` were added. `portalColor` returns a learning href's own colour, and the label atlas draws Pip and no host line for such hrefs. Link portals render exactly as before.

## Verification

- **Typecheck:** passes for every package except `apps/education`. That app is being rebuilt against `wwm-learning/0.2` in parallel, and its failures are confined to it.
- **`biome check .`:** clean. The two remaining diagnostics are pre-existing and outside this change: a warning in `apps/web/src/pages/log/story.css` and an info note in `scripts/dev-phone.mjs`.
- **`vitest run`:** 1099 passed, 18 skipped, and 4 failed. All four failures are the expected ones: three in `@wwm/education` (the parallel rebuild) and the `@wwm/learning` voice-manifest test.
- **`@wwm/web` alone:** 220 passed. This includes the unchanged portal e2e and the new tests:
  - `test/learning.test.ts`: 17 tests covering placement, the gate → state-machine glue, cursor and tilt, loading, and the href parity with the engine.
  - `test/learning.e2e.test.ts`: 2 tests.
- **Screenshots:** the walkthrough screenshots at 1280×720 and 1920×1080 were inspected at `/tmp/wwm-game-learning/`. They are local QA artefacts and are not committed.
