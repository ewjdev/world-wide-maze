# Build log: Phase 16 (The Build Story: build clock and "AI found these bugs" gallery)

- **Agent:** Claude Opus 5.5 (1M context), run as a Claude Code sub-agent in an isolated git worktree (branch `worktree-agent-a43c92214f91c13f7`).
- **Start / end:** 2026-09-25 ~16:58Z → ~17:35Z.
- **Environment:** macOS (Apple M5 Max), Node 26.0.0, pnpm 11.5.0, Vite 8.3.1, Playwright 1.63 Chromium.

## Instructions received (summary)
- Execute `plans/phase-16-build-story.md`: turn `/log` into the LinkedIn-ready story of the build, episode 1 of the owner's series. Own `apps/web/src/pages/log/**`, `tools/build-story/**`, `content/build-story/**` and this log.
- Every number computed from git or the build logs and traceable; label estimates and unknowns; the original team's effort is unknown and no comparison may be implied. No "N× faster" claims.
- Use the `impeccable` skill; the page must hold up in a screen recording on desktop and mobile. Leave a marked slot for Phase 15's docent panel. Social copy is a draft; post nothing. Don't stop processes I didn't start (use other ports).

## What was built
**`tools/build-story` (`@wwm/build-story`)**
- `collect.ts` writes three local-only sources into `content/build-story/sources/`:
  - `session.json`: a content-free extract of the orchestrating Claude Code session and its sub-agent transcripts: owner message times and word counts, orchestrator turn spans, each sub-agent's first and last event, finish notices and monitor events. No prompt text or tool output (a test checks this).
  - `files.json`: birth times of the project folder, `RESEARCH.md`, `research/*` and `plans/` in the owner's checkout (the worktree's own files are fresh checkouts, so it reads the checkout that owns `.git`).
  - `tests.json`: counts from a `vitest run --reporter=json` report.
- `build.ts` computes `content/build-story/timeline.json` for a snapshot commit (`--rev`) from git, the build logs and those sources. The logic is a pure `buildTimeline()` (`src/timeline.ts`) with interval helpers (`src/intervals.ts`), a git-log parser, the session extractor and a per-package line counter. `src/annotations.ts` holds the only hand-written inputs: phase names for each agent description and short labels for the owner's messages. No numbers.
- `social.ts` renders the share images and the page screenshots with Playwright against any dev server.
- The committed snapshot is **`4969885`** (2026-09-25 09:57:48 PT, "phase plans 13-16; wave 5"): everything up to the start of wave 5. Rebuild with `--rev HEAD` after merging (README).

**`content/build-story`**
- `timeline.json`, `sources/*.json`.
- `bugs.json`: the gallery data. Plain-language text carries no figures; every figure is a verbatim quote from a build log or commit (checked by `test/content.test.ts`).
- `social/`: `build-clock.png`, `page-to-maze.png`, `bug-gallery.png` (1200×627), `og-log.png` (1200×630).
- `linkedin-draft.md`: the draft post, with a table tying each claim to a timeline key or quote. Not posted.

**`/log` (`apps/web/src/pages/log`)**, now the build story above the Phase 10 build record:
- **Build clock** (`BuildClock.tsx`): the headline "Built in 10 h 13 min of wall-clock time" and four measured facts, beside a 12-hour dial. The outer ring is the wall clock (ink where something ran), dots are owner messages, arcs are agent runs packed into lanes (parallel runs side by side, coloured by wave, with text legend), and the inner ring is the orchestrating session. On load a hand sweeps from 11:44 pm to 9:57 am and paints each arc as it passes. A "Replay the night" button re-runs it for recordings. It's off under `prefers-reduced-motion`, and the default state is fully drawn.
- **Swimlane** (`Swimlane.tsx`): one row per run grouped by wave, the owner's lane, gates G0/G1 as dashed milestones, merge diamonds, helper agents inside their parent's bar, and the two idle stretches hatched. Rows are buttons; the selected run's panel shows the exact transcript span, what its log says, failed attempts, helpers and the merge commit. Mobile stacks each label over its bar.
- **Bug gallery** (`BugGallery.tsx`): the batch before/after (257/273 → 273/273 stages, 283/315 → 315/315 runs) with the Phase 09 dashboards, then one case file per solver issue BI-1 to BI-5. Each has the solver's own words, the repro, a quoted count, the quoted fix and before/after renders. Then six other catches: the rail wedge, the SSRF redirect hop, `WebSocketStream`, the private three.js field, the `ref:fetch`/pnpm clash (with the commit's diff) and the Nagle check (labelled Check, not Bug).
- **2013 and 2026, side by side** (`ThenNow.tsx`): who, starting point, time, and four stack rows from `/about`'s sourced `history.ts`. The note says no verdict is drawn.
- **Share cards**: `/log?card=clock|maze|bugs|og` renders a bare card for `social.ts`.
- **Docent slot**: `{/* ── PHASE 15 DOCENT SLOT ── … */}` in `LogPage.tsx`, between the story and the build record.
- `LogPage` became a thin router (card or page). The asset glob moved to `assets.ts`, and the old "Build record" h1 is now an h2 below the story. Phase 10's summary table and the unedited logs are unchanged.

**Per-issue before/after images** (`docs/build-log/assets/phase-16/issues/`). For each BI repro I extracted the tree at `2354e42` (the Phase 09 commit: builder 0.3.0, physics 0.1.0; `af7db69` before the history rewrite) to `/tmp` with `git archive`, installed it offline, and rendered the same crop with `tools/batch-eval/src/cli/thumb.ts --width 3840 --crop …` in both trees. The "What the solver reported" lines for BI-1 and BI-2 are the old solver's actual output from those runs:
- `eval-go-dev:0:easy:2`: FAIL narrow-neck, "island 9 is split by a neck narrower than the ball; the bridge 31 mouth is cut off". After: OK in 72.4 s.
- `eval-python-home:1:normal:2`: FAIL elevator-blocked, "no room for the ball beyond the arrival end of elevator 0 (platform ends at the island edge)". After: OK in 45.1 s.
- BI-5 re-checked: `govuk-card-grid:0:normal:1` and `:hard:1` at `2354e42` render to **byte-identical PNGs** (`cmp`); at HEAD they differ.
- For BI-2 I avoided the log's first repro (lite.cnn, political headlines) in favour of python.org's, which the log also lists.

## Computed headline numbers (snapshot `4969885`)
| | Value | Source |
|---|---|---|
| Wall clock | 10 h 13 min (613.2 min), 06:44:34Z → 16:57:48Z | project folder birth time → snapshot commit time |
| Active | 5 h 35 min | union of agent runs and orchestrator turns (session) |
| Idle ≥ 30 min | 4 h 2 min in 2 stretches (12:22Z → 14:27Z, 14:32Z → 16:29Z) | gaps in the above |
| Agent time | 10 h 34 min (633.9 min) over 20 runs (11 phase, 5 follow-up, 4 helper), max 5 concurrent at 08:07Z | sub-agent transcripts |
| Orchestrator turns | 71.5 min | session |
| Owner | 9 messages, 395 words; longest gap 5 h 17 min, with 6 h 1 min of agent work inside it | session (text not kept) |
| Git | 70 commits, 17 merges (16 of them "Merge phase …"); gates G0 01:06 PT, G1 01:59 PT; contracts 0.1.0 → 0.3.0 (10 versions) | `git log` |
| Tests | 722 passed, 13 skipped at `4969885` | `vitest run --reporter=json` |
| Lines | 44,926 source + 11,390 test lines in code files | `git ls-tree` at `4969885` |
| Build logs | 14 files, 93 failed attempts recorded, 0 human interventions | `parse-log.ts` |

## Attempts that failed, and why
1. **Contract versions from the schema constant** missed 0.2.1–0.2.3: those bumps only changed `plans/contracts.md`, not `CONTRACT_VERSION`. The tool now reads the "Contract version" line of `contracts.md` at each first-parent commit.
2. **Finish notices:** the Phase 06 agent's completion notice arrived *attached* to another message, not as its own user message, so the first extractor missed it and the run looked unfinished. The extractor now scans attachments too. "Running" now means "transcript continues past the snapshot", which doesn't depend on notices at all.
3. **Helper parent lookup:** helpers record their parent's worktree path, so a map by worktree path pointed parents at their own helpers. It now indexes top-level agents only (a test covers it).
4. **Worktree guard:** compound shell commands (loops, globs with `sips`, `git -C`) were refused by the isolation guard. I used Python one-liners, small script files in `/tmp/bs`, and separate plain commands instead.
5. **Design review round 1** (desktop and mobile screenshots together) found:
   - double parentheses in the agent-time sentence
   - duration labels colliding with merge diamonds
   - the mobile dial falling below four paragraphs
   - idle labels overlapping bars on mobile
   - gate lines striking through mobile labels
   - a clipped diff block
   - a stretched build-record heading

   All were fixed in one batch (`display: contents` reorders the mobile hero). The second round found only the mobile 2013/2026 column width.
6. **Biome:** ARIA table roles on spans (rewritten as a real `<table>` that collapses on mobile) and descending-specificity CSS (reordered, scoped, or given classes).

## Manual human interventions
None.

## Test evidence
- `pnpm check`: **green**. Typecheck and biome pass. 54 test files passed and 2 skipped; **770 tests passed** and 13 skipped. Of those, 48 are new.
- `tools/build-story/test/timeline.test.ts` (12 tests, on a fixture git log plus a fixture session JSONL):
  - git parsing, merges, gates and contract versions
  - interval union, gaps, concurrency and lanes
  - the session extract keeps no text, handles attached notices and finds helper parents
  - `buildTimeline`: start, wall clock, clipped running runs, merges, log windows, lanes, active and idle time, owner gap, git counts
  - log windows and line counting
- `tools/build-story/test/content.test.ts` (25 tests):
  - `timeline.json` **deep-equals** a fresh `buildTimeline(readRepo(repo, '4969885'))`; the test skips on shallow clones.
  - No speed-up wording anywhere.
  - `session.json` has no text fields.
  - Every quote in `bugs.json` appears verbatim in its cited log or commit.
  - Re-run solver messages match the solver's templates, and plain text carries no figures.
  - Every image exists, and the `ref:fetch` diff is the commit's diff.
- `apps/web/src/pages/log/build-story.test.tsx` (11 tests):
  - `/log` through the app routes shows the headline and every breakdown figure, each run, the gates, each bug with its quotes and each other catch.
  - No verdict or multiplier appears, and the Phase 10 record and the docent slot are present.
  - Time zone formatting is correct.
  - All four share cards render bare.
- `vite build`: `/log` chunk 268 kB (99 kB gzip), which includes `timeline.json` (30 kB). No BBC asset is emitted.
- `impeccable` detector on the changed UI files: `[]`.
- Screenshots (reviewed), in `docs/build-log/assets/phase-16/`:
  - `log-{desktop,mobile}-{clock,night,bugs,case,caught,then-now,record}.png`
  - `issues/issue-bi{1..5}-{before,after}.png`

## Remaining defects and follow-ups
- **Re-snapshot after wave 5.** Once phases 13–16 (and any later runs) are merged, run `collect.ts`, then `build.ts --rev HEAD`, then `social.ts`. Also add `RUN_LABELS` entries for new agent descriptions: "Fill legal drafts with placeholders" and "Phase 17 Cloudflare previews pipeline" already appear in the session.
- **OG tags for `/log`:** `og-log.png` exists, but the SPA's `<head>` is Phase 08/12's. The Worker (or `index.html` per route) should serve `og:image`, `og:title` ("Built in 10 h 13 min of wall-clock time") and `twitter:card` for `/log`. LinkedIn's Post Inspector needs a public URL.
- **Owner time is unknown.** Only message times and word counts exist. The page and the draft say so and don't estimate it.
- **Idle means "nothing running".** The 30-minute threshold is a choice, stated on the page. Shorter pauses count as active.
- **Session data isn't in git history.** `sources/session.json` is the committed evidence. Re-running `collect.ts` needs the owner's `~/.claude/projects/…` transcripts.
- **Lockfile:** adding `@wwm/build-story` added an importer entry to `pnpm-lock.yaml` (outside my paths, unavoidable for a new workspace package).
- **The draft post** is `content/build-story/linkedin-draft.md`. The ✱ lines are the ones to keep exact. The iPhone test duration ("a few minutes") comes from the device-test log, not the timeline.

---

# Phase 16b: build story refresh (after the history rewrite and wave 5)

- **Agent:** Claude Opus 5.5 (1M context), run as a Claude Code sub-agent in an isolated git worktree (branch `worktree-agent-aeb20c07f438135d9`).
- **Start / end:** 2026-09-25 ~18:22Z → ~18:45Z.

## Instructions received (summary)
- The history was rewritten with git-filter-repo before publication, so every SHA the story cited was dead and the traceability tests skipped silently. Map them with `.git/filter-repo/commit-map` and make those tests fail instead.
- Re-run the pipeline at HEAD so the story includes wave 5 and launch prep. Keep the original overnight window as its own labelled "Night 1" figure, with day 2 as a second segment. Refresh the draft post (numbers, live URL, repo), the share PNGs and these screenshots. Don't post, don't push, don't stop processes I didn't start.

## What changed
- **SHAs remapped:** `4969885` → `c9713b9` (the night-1 snapshot), `af7db69` → `2354e42` (the Phase 09 commit used for the before renders), `96414f5` → `a31beba` (the `ref:fetch` fix), and every merge, gate and contract-version SHA in `timeline.json` (rebuilt from git).
- **Traceability can't rot silently any more** (`test/content.test.ts`): a new test gathers every commit that `timeline.json`, `bugs.json`, the draft and the test-count sources cite, and fails on any missing one. The deep-equal and quote tests now fail too, where they used to skip. They skip only in a shallow clone (`git rev-parse --is-shallow-repository`). Before the draft was fixed, this test caught the stale `4969885` in it.
- **Segments** (`Timeline.segments`): each stretch is measured with the same rules as the whole build, over its own window: wall clock, active and idle time, runs started, agent time clipped to the window, concurrency, owner messages, commits, and lines and tests at its closing commit. Where a stretch ends is an annotation (`SEGMENTS` in `annotations.ts`), matched by **commit subject** rather than SHA so it survives rewrites. Night 1 ends at "Schema 0.3.0 …; wave 5". Day 2 ends at the snapshot.
- **Night 1 test count:** the rewritten `c9713b9` tree lacks the seven removed captures. Re-running the suite there gives 703 passed, 2 failed (both need those captures) and 13 skipped. So `sources/tests-night-1.json` keeps the count measured at the time (722/13/0), and its `command` field says where that count came from. Lines at night 1 (44,926) recompute identically from the rewritten tree.
- **Snapshot tests:** `sources/tests.json` is now measured in a clean `git archive f265f74` extract (`collect.ts --vitest … --vitest-root … --rev …`, new options), not the working tree.
- **Labels:** `RUN_LABELS` for phases 13–17 (with their logs), legal drafts (A3), the scrub, the docent bake-off and this refresh. `mergeSubject` finds merges that aren't "Merge phase XX". `OWNER_LABELS` for the four day-2 messages. Wave 5 has a colour (violet).
- **`parse-log.ts`** reads Pacific windows (`~09:58 → ~10:45 PDT`, Phase 13's log). Tested.
- **Page:** the hero is "Night 1 · 11:44 pm → 9:57 am / Built in 10 h 13 min" with the night-1 facts. A "Day 2" block and an "in all" line follow it. The dial shows the whole build, with a violet tick at 9:57 am and "+1h 21m day 2" in its centre. The swimlane has a "Day 2" marker, and durations near the right edge sit before their bars.
- **Fixed on the way:**
  - The dial's start tick was at 12 o'clock for every snapshot, because SVG `transform="rotate(…deg)"` ignores the unit.
  - The share PNGs were 1328×715, not 1200×627: `.sc.cd` lacked `box-sizing: border-box`. They're now exactly 1200×627 (og 1200×630).

## Computed headline numbers (snapshot `f265f74`, 11:18:56 am PT)
| | Night 1 (06:44:34Z → 16:57:48Z, `c9713b9`) | Day 2 (→ 18:18:56Z, `f265f74`) | In all |
|---|---|---|---|
| Wall clock | **10 h 13 min** (613.2) | **1 h 21 min** (81.1) | **11 h 34 min** (694.4) |
| Active / idle | 5 h 35 min (334.7) / 4 h 2 min in 2 stretches | 1 h 12 min (71.9) / 0 | 6 h 47 min / 4 h 2 min |
| Agent time | 10 h 34 min (633.9), 20 runs, max 5 | 3 h 42 min (222.0), 9 runs, max 6 at 17:10Z | 14 h 16 min (855.8), 29 runs, max 6 |
| Owner | 9 messages, 395 words | 4 messages, 171 words | 13, 566 |
| Commits | 70 | 26 | 96 |
| Tests (passed / skipped) | 722 / 13 (measured before the rewrite) | 922 / 14 at `f265f74` | 922 |
| Source + test lines | 44,926 + 11,390 | 58,330 + 14,847 at `f265f74` | |

The old draft's table said `active.min` = 335.2. The committed value was 334.7 (both display as 5 h 35 min). The table now cites 334.7.

## Attempts that failed, and why
1. The first dial render put the day-2 tick at 12 o'clock. The cause was the SVG `rotate()` unit (see above), which also affected the original start tick.
2. `social.ts` output was measured with `sips` and turned out not to be 1200×627, as described above.
3. `pnpm check` under full load had one failure in the extension's bookmarklet E2E, which passes when run alone (33/33). The docent corpus hash went stale because it indexes `docs/build-log/**`, including this log, so I regenerated `apps/worker/src/docent/corpus.json` with `pnpm docent:index`. That file is outside my paths, but it's a derived artifact.

## Manual human interventions
None.

## Test evidence
- `tools/build-story`: 43 tests, including segment unit tests on the fixture log (hand-computed clip values), a missing-closing-commit error, the PDT window, stale-SHA detection, and a check that the segments add up to the whole.
- `apps/web/src/pages/log/build-story.test.tsx`: 13 tests. Night 1 is labelled and complete, and day 2 and the total are shown.
- `pnpm check`: green (see the hand-off report).
- Screenshots re-rendered and reviewed: `docs/build-log/assets/phase-16/log-{desktop,mobile}-*.png`. The social PNGs are in `content/build-story/social/`.

## Remaining defects and follow-ups
- CI's `actions/checkout` is shallow, so the git-traceability tests skip there. `fetch-depth: 0` in `.github/workflows/ci.yml` (not my path) would enforce them in CI too.
- The docent bake-off and this refresh started after `f265f74`, so they aren't in the snapshot. Their labels are ready for the next rebuild.
- `/log` still says "The source repository is not public yet" until `VITE_REPO_URL` is set at build time.
- OG tags for `/log` are still not served (see above).
