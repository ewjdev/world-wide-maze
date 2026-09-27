# Phase 20: Guided lessons (Pip, Sky Islands, a voice that explains)

**Date:** September 26, 2026 (America/Los_Angeles).
**Agents:** Claude Code (Claude Opus 5.5) as orchestrator, plus two sub-agents in their own git worktrees: the lesson pages (M2–M4) and the game adapter (M4b, see [phase-20-m4b.md](phase-20-m4b.md)).
**Plan:** [plans/phase-20-guided-lessons.md](../../plans/phase-20-guided-lessons.md). The plan came out of a thought-partner review of the Phase 19 "Which has more?" lesson; the user approved decisions D1–D7 before anything was built.
**Time:** git timestamps from 15:32 (first Phase 20 commit) to about 16:20. Before that came the review, the plan, and the M0 spike, and the two sub-agents ran in parallel. These are elapsed times, not effort multipliers.

## What changed (N: new, not a 2013 feature)

### The learning contract, `wwm-learning/0.2` (`packages/learning`)
- **Rounds:** activities are now sequences of rounds of three kinds: `choose`, `compare` (two gem islands, optionally with "same") and `difference` ("how many more?").
  - Validation checks answers against the gem counts, so the data can't state a wrong answer.
  - Bonus rounds are optional and come last. `onlyAfterHelpOn` plays a follow-up only when the child needed the strategy on an earlier round.
- **Sky Islands theme:** a palette plus declarative vector sprites for Pip (the WWM ball with eyes), gem, island, plank, gate and cloud.
  - Sprites are limited to circle, ellipse, rect, polygon and path, and paths may only use line and curve commands.
  - Colours must be palette keys, and the theme is capped at 12 KB. Tests reject URLs, markup, arcs, unknown keys and oversized themes.
  - `sceneSvg` is the trusted renderer. The lesson page, the portable download and the game all draw from it.
- **Pip's script (`pathScript`):** counting lines ("One, two, three. Three gems.") and match lines ("Match, match, match. Two left over!") are generated from round data. Cues tie spoken words to gems lighting and match lines drawing.
- **Shared state machine (`step`):**
  - the hint ladder: nudge → match tool → worked example, which counts both islands;
  - a solved round is locked;
  - a trick follow-up plays after help;
  - the bonus is offered and can be skipped;
  - planks count only required rounds.
- **Voice player:** clips from a consumer-configured origin, then browser speech, then silent timing. Cues fire in every mode.
- **Compatibility:** `checkpointSpec` returns engine-neutral round data for games. 0.1 documents upgrade automatically, and Phase 19 family drafts (baseline 1.0.0) still apply.
- **Content:** compare-groups now has five rounds plus a conditional follow-up and a two-part bonus:
  - warm-up: 2 vs 4
  - close: 5 vs 4
  - trick: 3 spread out vs 5 bunched up
  - follow-up: 6 small vs 4 big
  - same: 4 vs 4
  - bonus: 3 vs 6, then "how many more?" → 3

  The other five lessons became themed single rounds with a three-step hint ladder.

### Voice (`tools/learning-voice`, `pnpm learning:voice`)
- **Generation:** 97 lines (about 3,900 characters) went through **AI Gateway `wwm` → ElevenLabs `eleven_v3` `with-timestamps`**, using the voice "Jessica" (default, pending the user's pick).
- **Storage:** MP3s are in the R2 bucket **`wwm-learning-audio`**, public at `https://learning-audio.ewj.dev/` with content-hashed, immutable names. Git holds only the manifest (hashes and word start times, 30 KB).
- **Credentials:** the gateway is authenticated and holds the ElevenLabs key (BYOK). The tool reaches it through a Workers AI binding in a local `wrangler dev` helper Worker, so no key or token is on disk.
- **Audition:** 3 voices × 4 lines in `audition/`. `pnpm learning:voice --audition` writes the listening page.

### Lesson pages (`apps/education`)
- **Flow:** "Tap Pip to start" (which also unlocks audio). The prompt highlights each word as it's spoken. The scene has real answer buttons over the islands, plus "Help me" and "Match them up".
- **After a correct answer:** Next appears under the feedback inside the first mobile viewport. Then comes the bonus offer, and an end card with the off-screen activity.
- **Settings and fallbacks:** the mute setting persists, reduced motion is respected, and the tall layout is used on phones.
- **Portable download:** still one inert JSON script and no external resources. It now includes the themed SVG for every round, and the game can load it.

### The game (`apps/web`, M4b)
- **Loading:** `/play/practice?learn=compare-groups`, or "Load a learning page…" on site select.
- **Gates:** up to 5 Pip gates ride the link-portal pipeline. Each one pauses play and shows the next round in a card drawn by the shared renderer. Answers come from tilt, arrow keys, number keys or a tap, and "Roll on!" resumes play.

### Infrastructure (created with the user's approval)
- The R2 bucket `wwm-learning-audio`, with CORS for GET/HEAD and the custom domain `learning-audio.ewj.dev`.
- GitHub issue #10 records deferred decision D5: voicing parent-personalized introductions through a Worker route.

## Attempts that failed, and why
- **M0 spike:**
  - Calling the gateway's REST endpoint with the wrangler OAuth token as `cf-aig-authorization` returned 401, because an authenticated gateway wants an AI Gateway token.
  - `getPlatformProxy` hung.
  - A two-file helper Worker under `wrangler dev`, using `env.AI.gateway('wwm').run(...)`, worked. That became the tool's proxy.
- **R2 setup:** creating the bucket through the Cloudflare API connector failed (its token has no R2 write), so the bucket was created with wrangler instead.
- **Layout:** the first hexagonal "tight" layout overlapped gems (0.21 < 0.22), and so did the six-dot die face after the gems were enlarged. The deterministic "no overlap" test caught both.
- **Contrast:** white "Island A/B" labels on the game's `#4f9fd6` measured 2.9:1. The island side became `#2f7fbd` (4.3:1).
- **Match lines:** in the tall layout they struck through the island labels. Labels are now drawn above the lines.

## Manual human interventions
- The user answered the plan decisions (Pip, audition, AI Gateway key already present, R2 for MP3s, a GitHub issue for D5, committing Phase 19 first, optional bonus).
- No code was written by hand.

## Test evidence
- `pnpm check` is green after the final fixes and the docent index refresh.
- `@wwm/learning` has 32 tests: contract, theme safety, layout, script, play-through and consumers. `@wwm/learning-voice` has 3.
- Education e2e (Chromium): 11 tests covering every lesson, the full compare-groups play-through, blocked audio, the family fork and reduced motion.
- Web: 17 unit tests and 2 e2e tests (a gate round trip, and a file loaded then played at a gate).
- **Orchestrator walkthrough (screenshots, not committed):**
  - Lesson page at 1440×900 and 390×844, with real clips streamed from R2 (HTTP 206) and no console errors.
  - Game at 1440×900: the education app's `portablePage` output, loaded through the file input, played gate 1 (wrong answer → match tool → correct answer → Roll on, timer resumed) and then gate 2 (round 2).

## Remaining defects and follow-ups
- **Voice:** the user and their tester still need to pick a voice from the audition, then run `--write`.
- **Physical phone:** tilt selection at gates is unit-tested but hasn't been tried on the physical iPhone.
- **Lesson depth:** the other five lessons are single rounds (§8 of the plan), and their deeper redesigns are open.
- **Personalized introductions** fall back to browser speech (issue #10).
- **Review and deployment:** educator review is still a gate before any public launch, and the education app isn't deployed.
- **Game UI:** the HUD lesson chip can briefly overlap a gate's floating label.
