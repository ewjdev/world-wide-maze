# @wwm/build-story

The build clock behind `/log`: derives `content/build-story/timeline.json` from git, `docs/build-log/*.md` and a
content-free extract of the orchestrating Claude Code session. Every number in the timeline is computed; the only
hand-written inputs are the labels in `src/annotations.ts` (which phase a run was, what an owner message was about).

## Run it
```sh
# 1. local-only sources → content/build-story/sources/ (commit them)
node tools/build-story/src/cli/collect.ts            # runs the whole Vitest suite for the test count (~2–3 min)
node tools/build-story/src/cli/collect.ts --vitest /tmp/report.json   # or reuse a `vitest run --reporter=json` report
# or count tests in a clean extract of the snapshot (what the committed tests.json uses):
#   git archive <sha> | tar -x -C /tmp/snap && (cd /tmp/snap && pnpm i --offline && pnpm vitest run --reporter=json --outputFile=/tmp/report.json)
#   node tools/build-story/src/cli/collect.ts --vitest /tmp/report.json --vitest-root /private/tmp/snap --rev <sha>

# 2. the timeline, measured up to a commit's time (default HEAD)
node tools/build-story/src/cli/build.ts --rev <sha>

# 3. share images + /log screenshots, against a running web dev server
pnpm --filter @wwm/web exec vite --port 5288 &
node tools/build-story/src/cli/social.ts --url http://localhost:5288 --pages
```
After merging more work: run all three with `--rev HEAD`, and add a `RUN_LABELS` entry for each new agent
description (unlabelled runs show up with their raw description and wave −1).

## Segments: Night 1, then Day 2
`timeline.json` `segments[]` measures each stretch of the build with the same rules as the whole (fields below,
over the stretch's own window; agent time clipped to it). Where a stretch ends is the only hand-written part:
`SEGMENTS` in `src/annotations.ts`, matched by **commit subject** (SHAs change when history is rewritten; they
did before publication). Night 1 is the original overnight claim and stays the page's headline; later stretches
are shown after it. Lines and tests for an earlier stretch are taken at its closing commit
(`sources/tests-<id>.json` for the Vitest counts).

## Stale commit ids fail the tests
`test/content.test.ts` checks that every commit `timeline.json`, `bugs.json`, the draft and the test sources cite
exists. It skips only in a shallow clone. After a history rewrite, map old ids with `.git/filter-repo/commit-map`.

## Sources and what each number means
| Field | Source | Method |
|---|---|---|
| `start` | `sources/files.json` | Earliest of: the project folder's birth time, the first owner message, the first commit |
| `wallClock` | start → `asOf` | `asOf` is the snapshot commit's author time |
| `runs[].span` | `sources/session.json` `agents[]` | First to last event in each sub-agent's own transcript, clipped at `asOf` |
| `active` | session | Union of all agent runs and orchestrator turns (turn = prompt dequeued → end-of-turn hook) |
| `idle` | session | Gaps in `active` of at least 30 min |
| `agents.agentMin` | session | Sum of run durations (parallel runs add up: agent-hours) |
| `agents.maxConcurrent` | session | Sweep over run intervals; back-to-back runs don't overlap |
| `owner.*` | session | Messages the owner typed: not tool results, agent notifications or injected text. Only time and word count are kept |
| `runs[].logWindow`, `failedAttempts`, `buildLogs` | `docs/build-log/*.md` | The same parser as `/log` (`apps/web/src/pages/log/parse-log.ts`) |
| `runs[].merge`, `gates`, `git` | `git log` | "Merge phase XX" merge commits; "gate GN passed" subjects |
| `contractVersions` | `git grep` on `plans/contracts.md` | First first-parent commit showing each "Contract version" |
| `lines` | `git ls-tree` at `asOf` | Lines in code files (`.ts .tsx .css .mjs .js .html .sql`) per package, `fixtures/` excluded; test files apart |
| `tests` | `sources/tests.json` | A `vitest run --reporter=json` report (passed / skipped) |

`test/content.test.ts` rebuilds the timeline from git and the committed sources and requires it to equal
`timeline.json`, and checks every quote in `content/build-story/bugs.json` against the file it cites.

## Not measured
The original 2013 team's effort (never published), the owner's time between messages, and anything before the
project folder existed. No speed-up ratios are computed or implied.
