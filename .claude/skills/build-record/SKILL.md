---
name: build-record
description: Bring the public build record (/log, docs/facts/whats-built.md, the docent corpus) back in sync with the repo. Use when the CI "Build record" comment or `pnpm record:drift` reports drift, after a phase or feature merges, a build log is added, or a feature flag changes in production.
---

# Build record

The build record is the project's public account of what was built and how: `/log` on the site, the "what exists
today" page the docent answers from, and the docent's corpus. It is a showcase claim, so every line must be
**evidenced** by a build log, a commit, a flag in CI or a measurement.

| Part | Source of truth | Shown at |
|---|---|---|
| Build logs | `docs/build-log/*.md` (each agent writes its own) | `/log`, below the story, verbatim |
| Since launch | `content/build-story/since-launch.json` | `/log` "Since launch" (`SinceLaunch.tsx`) |
| What exists today | `docs/facts/whats-built.md` | the docent's current-state source |
| Docent corpus | `apps/worker/src/docent/corpus.json` (generated) | docent answers |
| Build clock | `content/build-story/timeline.json` (generated, frozen) | `/log` top |

`tools/build-story/src/record.ts` defines the drift checks; CI runs them on every PR (`build-record` job in
`.github/workflows/ci.yml`) and posts a sticky comment. It never blocks a merge.

## Steps

1. **Measure.** `pnpm record:drift --base origin/main`. Done when you have the list of `✗` findings.
2. **Gather the facts** for each body of work the findings name: read its build logs, then its status in
   `.github/workflows/ci.yml` (`deploy-production` `VITE_*_ENABLED` = what production runs; `preview` flags =
   previews only), `git log --first-parent origin/main` for the merge, `gh pr list` for unmerged work. Done when
   every item has a one-sentence what-it-does and a status backed by one of those sources.
3. **Fix each finding** (reference below). Done when every finding id is handled.
4. **Regenerate** `pnpm docent:index` (any facts or log change alters the corpus).
5. **Verify.** `pnpm record:drift --base origin/main` prints `build record: in sync`, and
   `pnpm vitest run --project @wwm/build-story --project @wwm/web --project @wwm/docent-index` is green. Then
   `pnpm check` before hand-off.

## Findings

- **`since-launch-unlisted`**: a log written after the clock's snapshot is in no entry. Add its slug to the entry
  for that body of work, or add an entry (order: roughly when it shipped). Entry fields: `title` (a feature name a
  visitor would recognise), `summary` (one or two plain sentences on what a player or operator gets, no figures
  the logs don't state), `status`, `statusNote` (the evidence: flag and value, PR number, open sign-off), `logs`,
  optional `href` (a site path to try it).
  - `live`: on in production. `switched-off`: merged, flag off in production. `operator-only`: runs only for the
    operator or offline (admin tools, generators). `not-merged`: an open PR whose log is already on `main`.
- **`since-launch-unknown`**: a slug with no `docs/build-log/<slug>.md`. Fix the spelling, or drop it.
- **`since-launch-after`**: `after` must equal `timeline.json` `asOf.sha`. Only changes if the clock is re-measured.
- **`facts-uncited-logs`**: `whats-built.md` must cite every log as `` `slug` `` in backticks. Put the citation on
  the bullet describing that work; a new body of work gets a new bullet under "Features in the live site" (or
  "Built but not switched on").
- **`facts-missing-phases`**: every `plans/phase-NN-*.md` must appear as "Phase NN" on the facts page, either
  built (with its logs) or under "Planned but not built" with what became of it.
- **`facts-clock-snapshot`**: "Numbers from the build story" must quote `timeline.json` at its `asOf.sha`.
- **`docent-corpus`**: `pnpm docent:index`, commit `corpus.json`.
- **`pr-no-record`**: the PR changes `apps/*/src` or `packages/*/src` with no log or facts change. If the change
  adds or alters behaviour a visitor or operator sees, extend the relevant build log or write one in the
  `plans/00-overview.md` §6 format. `/log` parses `- **Agent:**` and `- **Start / end:** 2026-10-21 ~09:00Z →
  ~10:15Z` lines and counts the list items under `##` headings containing "fail" and "human". A refactor or a
  small fix can leave it; the comment is advisory.

## Writing rules

- Plain, factual, present tense. Distinguish **evidenced / reconstructed / new** as `RESEARCH.md` does.
- State only what the logs and CI show; where something is unverified (a physical-device gate, a sign-off), say so.
- "Where AI runs in the live site" lists every model call a visitor's action can trigger. Operator-only and
  offline model use (lesson drafts, voice generation) goes under "How AI was used to make it" or the feature's
  bullet, labelled operator-only.
- Productivity claims stay out: no speed-up ratios, no comparison with the 2013 team's effort.
- The build clock (`timeline.json`, Night 1 / Day 2) is a fixed measurement of the launch build. Carry later work
  in "Since launch". Re-measuring the clock (`tools/build-story/README.md`) changes the published headline: ask
  the owner first.
