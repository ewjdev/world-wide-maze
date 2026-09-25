# Phase 16 — The Build Story: build clock + "AI found these bugs" gallery
**Wave:** 5 · **Label:** N

## Goal
Turn `/log` into the LinkedIn-ready story of this build: a **build clock** showing honest elapsed time with a breakdown, and a gallery of bugs the AI caught in its own work. It's the first episode of the user's "rebuild in hours what took months" series.

## Owns
- `apps/web/src/pages/log/**`
- `tools/build-story/**` (new: data extraction)
- `content/build-story/**`
- `docs/build-log/phase-16.md`

## Tasks
1. **Build clock data (`tools/build-story`):**
   - Derive a timeline from `git log`: commit times, merge commits per phase, contract version bumps.
   - Add timestamps from the `docs/build-log/*.md` files, and file mtimes for pre-git research. The research folder was created around 2026-09-24 23:44 PT, and the first commit was 2026-09-25 00:18 PT.
   - Output `content/build-story/timeline.json`:
     - phases with start and end
     - total wall-clock time
     - parallel agent-hours (the sum of each agent's duration where known)
     - human touchpoints (approvals, playtests, the device test)
     - counts: commits, tests, lines of code by package via `git ls-files` + `wc`
   - **Every number must be computed, not asserted.** Label estimates. No "N× faster" claims (CLAUDE.md).
2. **UI on `/log`:**
   - A hero "Built in ~X hours of wall-clock time" with the honest breakdown: elapsed time, human active touchpoints, and agent parallelism.
   - An interactive timeline or swimlane of phases, with waves running in parallel and gates as milestones.
   - A "then vs now" strip comparing the 2013 team and stack (from `/about` data) with this build's facts. Compare facts, don't draw conclusions.
3. **"AI found these bugs" gallery:**
   - From `docs/build-log/phase-09-builder-issues.md` and the before and after dashboards (`docs/build-log/assets/phase-09/*`).
   - A card per issue: what the solver saw, the repro, the fix, and before and after images.
   - Also include other self-caught issues from the build logs: the Nagle check, the rail wedge, the private three.js field, the SSRF redirect hop, the iframe WebSocketStream bypass, the ref:fetch pnpm-builtin clash.
4. **Share assets:**
   - OG card images for `/log`.
   - Three 1200×627 LinkedIn-ready PNGs in `content/build-story/social/`: the build clock, the page-to-maze transformation, and the bug gallery.
   - Draft post copy in `content/build-story/linkedin-draft.md`: factual, with claims tied to the timeline JSON. It's a **draft for the user**. Don't post it.
5. **Tests:** timeline extraction unit tests using a fixture git log. Page render tests.

## Acceptance
- Every number on the page traces to `timeline.json`, and every number in `timeline.json` traces to git or a build log.
- Screenshots are in `docs/build-log/assets/phase-16/`.
- `pnpm check` is green.
