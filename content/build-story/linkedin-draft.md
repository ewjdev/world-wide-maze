# LinkedIn draft: episode 1 (World Wide Maze)

> **DRAFT for the owner. Not posted.** Every figure below is tied to a key in `content/build-story/timeline.json`
> or a quote in `content/build-story/bugs.json` (the table at the end). The timeline is a snapshot as of commit
> `f265f74`; if you rebuild it after more work lands, re-read the numbers from the new file before posting. The
> phrasing is yours to change; the ✱ lines are the ones that would become inaccurate if reworded loosely. The
> repository link only works once the repo is public.

---

In 2013, Google Japan and a team of Tokyo studios (PARTY, AID-DCC, Katamari, FUTUREK) shipped World Wide Maze: paste
any website, and it becomes a 3D maze of floating islands that you steer by tilting your phone. It won awards and
then it went offline.

Last night I rebuilt it with AI agents, as a tribute. Here's the honest clock.

**Night 1**

✱ **10 h 13 min of wall-clock time**, from an empty project folder at 11:44 pm to the commit where the fifth wave
of work began at 9:57 am. That includes every pause: I slept through part of it.

✱ **5 h 35 min** with something actually running. The other 4 h 2 min were two stretches where the agents had
finished and were waiting on me.

✱ **10 h 34 min of agent time**, across 20 runs of Claude Opus 5.5, **up to 5 at once**, each in its own copy of
the repository, merged at checkpoints.

✱ **My part: 9 messages, 395 words**, plus a few minutes tilting an iPhone to test the controller. My
longest gap between messages was 5 h 17 min; the agents put in 6 h 1 min of work inside it.

✱ By 9:57 am: **722 passing tests** and **44,926 lines of source** in **70 commits**.

**The morning after (day 2)**

✱ **1 h 21 min more**, to 11:18 am: link portals between sites, a "maze this page" browser extension, an AI
docent that answers questions about the original with citations, this build story, then launch prep (Cloudflare
deploys and previews, legal drafts, a pre-publication scrub, the licence). **3 h 42 min of agent time** over 9 runs,
**up to 6 at once**, and 4 more messages from me.

✱ **In all: 11 h 34 min** from the empty folder, **922 passing tests**, **58,330 lines of source**, **96 commits**.

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

Play it at https://wwm.ewj.dev (the build story is at https://wwm.ewj.dev/log); the code is at
https://github.com/ewjdev/world-wide-maze.

#AI #SoftwareEngineering #ChromeExperiments #WorldWideMaze

---

## Images to attach
1. `content/build-story/social/build-clock.png` (1200×627): the clock, the Night 1 headline and the day-2 line.
2. `content/build-story/social/page-to-maze.png` (1200×627): GOV.UK → islands → the 3D maze.
3. `content/build-story/social/bug-gallery.png` (1200×627): the solver's bug reports, before/after.
`og-log.png` (1200×630) is the link preview for `/log` once it's wired into the page head.

## Where each claim comes from
Night 1 is `segments[0]` (`id` `night-1`); day 2 is `segments[1]` (`id` `day-2`); "in all" is the top level.

| Claim in the post | Source |
|---|---|
| 10 h 13 min | `segments[0].wallClock.min` = 613.2 |
| 11:44 pm / 9:57 am | `segments[0].wallClock.start` 06:44:34Z (project folder birth time, `sources/files.json`) / `segments[0].end.at` (commit `c9713b9`), shown in Pacific time |
| “the fifth wave of work began” | `segments[0].end.subject`: “Schema 0.3.0 …; phase plans 13-16; wave 5” (the boundary is `SEGMENTS` in `tools/build-story/src/annotations.ts`, matched by subject) |
| 5 h 35 min / 4 h 2 min, two stretches | `segments[0].activeMin` = 334.7; `segments[0].idle.min` = 241.8, `idle.spans` (2, threshold 30 min) |
| “waiting on me” | the idle spans end at owner messages (`owner.touchpoints`, 14:27Z and 16:29Z) |
| 10 h 34 min, 20 runs, up to 5 at once | `segments[0].agents.agentMin` = 633.9; `.runs` = 20; `.maxConcurrent` = 5 |
| Claude Opus 5.5 | `agents.model` (named in every build log) |
| 9 messages, 395 words | `segments[0].owner.messages`, `.words` |
| a few minutes tilting an iPhone | not in timeline.json: the device-test log says the relay stats cover “about 2.5 min of use” (`docs/build-log/phase-06-device-test.md`); the touchpoint is `owner.touchpoints` kind `device test` |
| 5 h 17 min gap; 6 h 1 min of agent work inside it | `segments[0].owner.longestAway.min` = 316.9; `.agentMinWhileAway` = 361.4 |
| 722 tests, 44,926 lines, 70 commits | `segments[0].tests.passed` (`sources/tests-night-1.json`, measured at this commit before the history rewrite; see its `command`); `segments[0].lines.source`; `segments[0].git.commits` |
| 1 h 21 min more, to 11:18 am | `segments[1].wallClock.min` = 81.1; `segments[1].end.at` (commit `f265f74`) |
| what day 2 was | `segments[1].what`, and the day-2 runs in `runs[]` (phases 13–17, A3, scrub) |
| 3 h 42 min, 9 runs, up to 6 at once | `segments[1].agents.agentMin` = 222; `.runs` = 9; `.maxConcurrent` = 6 (17:10Z) |
| 4 more messages | `segments[1].owner.messages` = 4 (171 words) |
| 11 h 34 min in all | `wallClock.min` = 694.4 |
| 922 tests, 58,330 lines, 96 commits | `tests.passed` (`sources/tests.json`, a clean extract of `f265f74`); `lines.total.source`; `git.commits` |
| 257 of 273 → 273 of 273 | `bugs.json` `batch` (quote from `docs/build-log/phase-03.md`) |
| the three example bugs | `bugs.json` `solver` BI-1, BI-2, BI-3 |
| 2013 credits | `/about` (`apps/web/src/pages/about/history.ts`, sourced from award entries) |
| schedule never published | `timeline.json` `unknowns[0]`; `/about` “Remaining gaps” |
| wwm.ewj.dev, github.com/ewjdev/world-wide-maze | not measured: the domain and repository chosen at launch setup (`plans/00-overview.md`, “Launch setup”) |
