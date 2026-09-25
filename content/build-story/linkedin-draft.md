# LinkedIn draft: episode 1 (World Wide Maze)

> **DRAFT for the owner. Not posted.** Every figure below is tied to a key in `content/build-story/timeline.json`
> or a quote in `content/build-story/bugs.json` (the table at the end). If you rebuild the timeline after more work
> lands, re-read the numbers from the new file before posting. The phrasing is yours to change; the ✱ lines are
> the ones that would become inaccurate if reworded loosely.

---

In 2013, Google Japan and a team of Tokyo studios (PARTY, AID-DCC, Katamari, FUTUREK) shipped World Wide Maze: paste
any website, and it becomes a 3D maze of floating islands that you steer by tilting your phone. It won awards and
then it went offline.

Last night I rebuilt it with AI agents, as a tribute. Here's the honest clock.

✱ **10 h 13 min of wall-clock time**, from an empty project folder at 11:44 pm to the commit where the fifth wave
of work began at 9:57 am. That includes every pause: I slept through part of it.

✱ **5 h 35 min** with something actually running. The other 4 h 2 min were two stretches where the agents had
finished and were waiting on me.

✱ **10 h 34 min of agent time**, across 20 runs of Claude Opus 5.5, **up to 5 at once**, each in its own copy of
the repository, merged at checkpoints.

✱ **My part: 9 messages, 395 words**, plus a few minutes tilting an iPhone to test the controller. My
longest gap between messages was 5 h 17 min; the agents put in 6 h 1 min of work inside it.

✱ At the snapshot: **722 passing tests** and **44,926 lines of source** in **70 commits**.

The part I didn't expect: the AI caught its own bugs. One agent wrote the maze builder. Another built a solver
bot, had it play every stage the builder could generate, and filed bug reports with repros: islands split by necks
thinner than the ball, elevators with nowhere to get off, a low lift that could pin the ball until the clock ran
out. ✱ A third agent fixed them: **257 of 273 stages solvable at normal difficulty became 273 of 273.**

What I can't tell you is how this compares with 2013. The original team's schedule and size were never published,
and rebuilding a design that already exists is a different job from inventing it. So no multiplier here, just the
receipts: every agent kept a log, and the page below shows the timeline, the bugs, and where every number comes
from.

This is episode 1 of a series: rebuilding, in hours and with AI, things that once took teams months to make, and
publishing the evidence.

[link to /log]

#AI #SoftwareEngineering #ChromeExperiments #WorldWideMaze

---

## Images to attach
1. `content/build-story/social/build-clock.png` (1200×627): the clock and the headline numbers.
2. `content/build-story/social/page-to-maze.png` (1200×627): GOV.UK → islands → the 3D maze.
3. `content/build-story/social/bug-gallery.png` (1200×627): the solver's bug reports, before/after.
`og-log.png` (1200×630) is the link preview for `/log` once it's wired into the page head.

## Where each claim comes from
| Claim in the post | Source |
|---|---|
| 10 h 13 min | `timeline.json` `wallClock.min` = 613.2 |
| 11:44 pm / 9:57 am | `wallClock.start` 06:44:34Z (project folder birth time, `sources/files.json`) / `asOf.at` (commit `4969885`), shown in Pacific time |
| “the fifth wave of work began” | `asOf.subject`: “Schema 0.3.0 …; phase plans 13-16; wave 5” |
| 5 h 35 min / 4 h 2 min, two stretches | `active.min` = 335.2; `idle.min` = 241.8, `idle.spans` (2, threshold 30 min) |
| “waiting on me” | the idle spans end at owner messages (`owner.touchpoints`, 14:27Z and 16:29Z) |
| 10 h 34 min, 20 runs, up to 5 at once | `agents.agentMin` = 633.9; `agents.runs` = 20; `agents.maxConcurrent` = 5 |
| Claude Opus 5.5 | `agents.model` (named in every build log) |
| 9 messages, 395 words | `owner.messages`, `owner.words` |
| a few minutes tilting an iPhone | not in timeline.json: the device-test log says the relay stats cover “about 2.5 min of use” (`docs/build-log/phase-06-device-test.md`); the touchpoint is `owner.touchpoints` kind `device test` |
| 5 h 17 min gap; 6 h 1 min of agent work inside it | `owner.longestAway.min` = 316.9; `owner.agentMinWhileAway` = 361.4 |
| 722 tests, 44,926 lines, 70 commits | `tests.passed`; `lines.total.source`; `git.commits` |
| 257 of 273 → 273 of 273 | `bugs.json` `batch` (quote from `docs/build-log/phase-03.md`) |
| the three example bugs | `bugs.json` `solver` BI-1, BI-2, BI-3 |
| 2013 credits | `/about` (`apps/web/src/pages/about/history.ts`, sourced from award entries) |
| schedule never published | `timeline.json` `unknowns[0]`; `/about` “Remaining gaps” |
