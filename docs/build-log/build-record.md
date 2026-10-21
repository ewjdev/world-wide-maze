# Build log: Keeping the build record current (Since launch, drift report, skill)

- **Agent:** Claude Opus 5.5 (1M context), run as a Claude Code session with one research sub-agent
- **Start / end:** 2026-10-21 ~18:40Z → ~19:10Z

## Instructions received (summary)

Update the build record with the latest information and features; detect, without blocking, when the record falls
out of step with the work, and show it on the pull request; add a skill that helps maintain the record.

## What was built

- **`/log` "Since launch"** (`apps/web/src/pages/log/SinceLaunch.tsx`, data in
  `content/build-story/since-launch.json`): fifteen entries for the work after the build clock's snapshot
  `f265f74`, each with a status (live, paused by the operator, built but switched off, operator only), the
  evidence for that status, and links to its build logs. The clock itself is unchanged: it stays a measurement of
  the launch build.
- **`/log` fixes:** the log index labelled non-phase logs (analytics, the performance logs, portal windows) as
  "Phase null"; they now show their titles. The "At a glance" table lists phase logs only, since the later
  non-phase logs state no windows and are covered by "Since launch".
- **`docs/facts/whats-built.md`** rewritten: every build log cited by name; the launch build, the work since, what
  is built but switched off, and what the last operator receipt left paused; Phase 21's manual moderation replaces
  the stale `allowAllContent` line; Codex (GPT-6 family) agents named where their logs name them; operator-only
  model calls (the lesson-draft agent, Jev) listed apart from the docent. Docent corpus regenerated.
- **Drift report** (`tools/build-story/src/record.ts`, CLI `pnpm record:drift`): later logs missing from "Since
  launch", logs the facts page doesn't cite, planned phases it doesn't name, its build-clock numbers against
  `timeline.json`, a stale docent corpus, and (with `--base`) product code changed without a build-log update.
  It exits 0 unless `--strict` is passed.
- **CI** (`build-record` job in `.github/workflows/ci.yml`): on every pull request, runs the report, adds warning
  annotations and a job summary, and keeps one sticky comment (created only when something is out of sync, then
  updated). `continue-on-error`, and nothing `needs:` it, so it never blocks a merge.
- **Skill** (`.claude/skills/build-record/SKILL.md`): the steps to bring the record back in sync, finding by
  finding, and the writing rules (evidence only, no speed-up claims, the clock stays fixed unless the owner asks).

## Attempts that failed, and why

- The first phase check wanted a literal "Phase NN" and missed "Phases 19, 20 and 22"; it now reads lists and
  ranges (`phasesNamed`).
- A first draft of "Since launch" allowed only build logs as records; the operator tools and the home-page work
  have none, so an entry may cite other repository documents (`docs`).

## Manual human interventions

None during the run.

## Test evidence

- `pnpm record:drift --base origin/main`: "build record: in sync" (before this log was added, and after).
- `pnpm vitest run --project @wwm/build-story --project @wwm/web --project @wwm/docent-index`: 58 files passed,
  4 skipped; 580 tests passed, 22 skipped. New: `tools/build-story/test/record.test.ts` (the checks, rendering,
  annotations), "Since launch" render and label tests in `build-story.test.tsx`, a shape test for
  `since-launch.json` in `content.test.ts`.
- `pnpm check`: typecheck and lint green; 1,907 tests passed, 53 skipped, 1 failed. The failure
  (`apps/web/test/mobile-layout.e2e.test.ts`, `.wwm-map` 360 px wide in a 321 px viewport) fails the same way on an
  untouched `origin/main` checkout, so it predates this work.
- `/log` checked in a browser: all fourteen "Since launch" entries then present (this work's own entry came
  after), no "Phase null" labels.

## Remaining defects and follow-ups

- The paused/resumed state of the docent, scores, share cards and telemetry lives in the cost-controls Durable
  Object, not the repository; the record states the last receipt (2026-09-29) and says so.
- Some logs are stale against `main`: `phase-29-race-elevation-flow` and `mobile-browser-game` still say their work
  is local or undeployed, though it merged and every merge deploys.
- The status board in `plans/00-overview.md` §8 lags (Phases 15, 19–31 and the non-phase work); it is the
  orchestrator's document, not part of the public record, and the report doesn't check it.
- The CI comment has not yet run on GitHub; the first pull request carrying this job is its test.
