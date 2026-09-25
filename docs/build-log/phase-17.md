# Build log: Phase 17 (Cloudflare environments, provisioning, PR Previews)

- **Agent:** Claude Opus 5.5 (1M context), run as a Claude Code sub-agent in an isolated git worktree
  (branch `worktree-agent-a376b059a8354fb2f`), with the `wrangler` skill loaded. Docs were checked through the Cloudflare docs search
  tool and the pages themselves.
- **Start / end:** 2026-09-25, about 17:00Z to 17:30Z.
- **Environment:** macOS 26, Node 26.0.0, pnpm 11.5, wrangler 4.140.0 (already ≥ 4.135.0, the minimum for Worker
  Previews, so no upgrade was needed), actionlint 1.7.7 (downloaded to /tmp for linting only).

## Instructions received (summary)
Replace the Phase 12 `env.staging` Worker with Cloudflare **Worker Previews** (released 2026-09-22):
- Keep the production Worker `wwm` and put Preview-only resources in a `previews` block.
- Keep all names in one file, `infra/cloudflare.config.json`.
- Provisioning script: idempotent, dry-run by default, `--apply` to create, writes ids back, applies migrations,
  lists missing secrets, and has unit tests.
- GitHub Actions: a per-PR Preview with a sticky comment and a delete on close, plus production on `main`.
- Rewrite the runbook in `infra/README.md`.

Hard constraints: no command with remote Cloudflare effects, no push, no GitHub changes, don't stop other
processes. Local `pnpm dev` and every test must keep working. Include the Phase 15 AI Gateway vars.

## What was built
- **`infra/cloudflare.config.json`**: worker `wwm`, wrangler env `production`, domain `{{DOMAIN}}`. Production
  resources: D1 `wwm`, R2 `wwm-stages`, KV `wwm-cache`, AI Gateway `wwm`, rate-limit ids 7201–7203. Preview
  resources: D1 `wwm-preview`, R2 `wwm-stages-preview`, KV `wwm-cache-preview`, AI Gateway `wwm-preview`, rate-limit
  ids 7301–7303, name prefix `pr-`. Required secrets: `IP_HASH_SALT`, `ANTHROPIC_API_KEY`.
- **`apps/worker/wrangler.jsonc`**:
  - The top level is still local dev/test and is unchanged, apart from new vars `AI_GATEWAY_ACCOUNT_ID`,
    `AI_GATEWAY_ID` and `DOCENT_DAILY_LIMIT`.
  - `env.staging` was removed.
  - `env.production` gained `preview_urls: true`, explicit `limits`/`observability`, the AI vars, and
    `routes: []`, which provision fills from the domain.
  - The new `env.production.previews` block repeats every var and binding (D1, R2, KV, browser, rate limits,
    DO bindings) against the preview resources. It sets `WWM_ENV=preview`, `ROOM_STATS=0`, telemetry off, a
    60/h global build cap, 1 browser and a 1-day cache.
  - DO classes and migrations stay at the env level, so each Preview gets its own DO namespaces.
- **`apps/worker/wrangler.preview-migrations.jsonc`**: the docs' pattern for Preview D1 migrations (binding
  `PREVIEW_DB`).
- **`infra/scripts/lib/cloudflare-infra.mjs`** (+ `.d.mts`): pure helpers.
  - A JSONC parser that records value spans, so ids are patched in place and comments survive.
  - Config validation: Preview resources must differ from production, and rate-limit ids must be unique.
  - Tolerant parsers for `d1 list --json`, `kv namespace list`, `r2 bucket list` (text), `whoami --json`, secret
    lists and the AI Gateway API.
  - Plan diffing, the patch set, and the deploy checks for production and Previews.
- **`infra/scripts/provision.mjs`**:
  - Three modes: dry-run (read-only listings), `--apply`, and `--offline`.
  - D1/R2/KV are created with wrangler. Ids are read back from the list commands, not scraped from create output.
  - AI Gateways are created through `POST /accounts/:id/ai-gateway/gateways` when `CLOUDFLARE_API_TOKEN` is set.
    Otherwise the script prints the dashboard steps.
  - It patches both wrangler files, regenerates types, and applies migrations to both databases.
  - It lists missing secrets by name, with the exact `wrangler secret put` / `wrangler preview base-config
    secret put` commands.
- **`infra/scripts/check-deploy-config.mjs production|previews|all`**: rewritten on top of the lib.
- **`.github/workflows/preview.yml`** (new) and **`deploy.yml`** (rewritten: push to `main` → production, optional
  approval through the `production` GitHub Environment). Both are inert until `WWM_PREVIEWS_ENABLED` /
  `WWM_DEPLOY_ENABLED` is set. Other properties:
  - Per-job least-privilege permissions.
  - The Cloudflare token is exposed only to the migrate/deploy/preview/delete steps.
  - PRs from forks are skipped.
  - No `${{ }}` inside `run:` scripts.
- **`apps/worker/src/routes/scores-rules.ts`** (one line): `ipHashSecret` now fails closed for any `WWM_ENV` other
  than `development`. Without this change, Previews (`WWM_ENV=preview`) would have hashed IPs with the public dev
  salt.
- **Docs:** `infra/README.md` rewritten as the runbook. Staging references updated in
  `docs/launch/{runbook,checklist,performance}.md`, `apps/worker/README.md`, `.dev.vars.example`, `_headers` and
  `infra/perf/frames.mjs`.

## Decisions
- **Where production lives: `env.production`, not the top level.** The proposal was top level = production. I
  kept the top level as local dev/test and put production in `env.production`, with Previews in
  `env.production.previews`. Cloudflare documents this pattern ("Compare workflows → Wrangler environments"):
  `wrangler preview --env <env>`.
  - Reason: `pnpm dev`, `wrangler dev`, and five test suites (`createTestHarness` / `unstable_startWorker`) load
    the top level. They depend on `ROOM_STATS=1`, `WWM_ENV=development` and the absence of an assets directory.
    Moving production to the top level would have meant editing other phases' tests and the dev script.
  - Cost: every command needs `--env production`. The scripts and workflows read it from the config. A bare
    `wrangler deploy` hits only the all-zero placeholder ids, so it can't touch production data.
- **Variable naming:** `WWM_ENV` rather than a new `ENVIRONMENT` var, because the code already reads `WWM_ENV`.
- **Two AI Gateways:** `wwm` and `wwm-preview`, so Preview traffic stays out of production logs, analytics and
  rate limits. Gateways are free.
- **Recommended pipeline: GitHub Actions over Workers Builds.** Actions runs the `pnpm check` gate (with Playwright),
  the smoke test, `pr-<N>` naming, and delete-on-close. The Workers Builds setup is documented as the alternative.

## Verification (all local)
- `pnpm check`: green. 52 test files passed, 2 skipped. Those 2 were already skipped before this phase: gitignored
  reference data and Playwright phone e2e.
- New `apps/worker/test/infra-provision.test.ts` (16 tests):
  - JSONC parsing and patching, and config validation.
  - Parsers on canned wrangler output.
  - Plan diffing.
  - Patch → both targets pass. Comments survive, the top level is untouched, and a second run is idempotent.
  - A Preview bound to production KV is refused, and so is a mismatched migrations file.
- `security.test.ts` now checks production and Previews, and that `preview` fails closed without a salt.
- `wrangler deploy --dry-run --env production` on the committed config, and on a config patched by the lib with
  fake ids and a domain: no warnings. Biome accepts the patched file unchanged.
- `wrangler d1 migrations list PREVIEW_DB --local --config wrangler.preview-migrations.jsonc`: lists 0001–0003.
- `wrangler types` regenerated `worker-configuration.d.ts`.
- `node infra/scripts/provision.mjs --offline`: prints the plan, the manual gateway steps, the migrations and the
  secret commands. `check-deploy-config.mjs all` fails as intended: placeholder ids, no domain.
- `actionlint` on all three workflows: clean.

## Not verified (can't be verified without an account)
- `wrangler preview` has no `--dry-run`, so the `previews` block has only been validated by the config schema and
  by `deploy --dry-run` of the parent env.
- The exact JSON shape of `wrangler preview --json` (the workflow uses `.preview.urls[0]`, as the docs example does),
  and the output of `preview base-config secret list --json` (parsed tolerantly).
- Token permissions. The Previews examples say the token needs "the resources used by the Preview". The Workers
  authorization page says bindings need no resource permissions. The runbook lists Workers Editor + D1 Edit;
  add KV/R2 Edit if `wrangler preview` is refused.
- The Workers Builds commands for this pnpm monorepo.

## Manual human interventions
None.

## Remaining defects / follow-ups
- Crons don't run on Previews, so nothing sweeps the preview R2/D1. This is documented; a periodic purge is manual.
- The Phase 15 var names (`AI_GATEWAY_ACCOUNT_ID`, `AI_GATEWAY_ID`, `DOCENT_DAILY_LIMIT`) are taken from the plan.
  If Phase 15 renames them or adds a rate-limit binding, mirror the change in `env.production` and in
  `env.production.previews`. `security.test.ts` will flag missing vars.

# CI stability

- **Agent:** Claude Opus 5.5 (1M context), a Claude Code sub-agent in an isolated git worktree, branch
  `ci/stability`, PR #4. The PR was opened against `launch/config-legal-story`, then rebased onto and retargeted to
  `main` after PR #1 was merged. The agent pushed only to `ci/stability` and merged nothing.
- **Date:** 2026-09-25, about 20:25Z to 21:40Z.

## Instructions received (summary)
- Make CI reliably green and stop running the suite three times per PR push. Before this change, each push ran
  `pnpm check` from ci.yml on `push`, from ci.yml on `pull_request`, and from the Preview workflow's own `check` job.
- Make timing-sensitive tests robust by waiting for conditions or quiescence, bounding by measured time, or asserting
  invariants. Never weaken an assertion or delete a test.
- Prove it with 3 consecutive green runs of the full pipeline, with one `pnpm check` per PR head.

## What failed (run 36185237555, launch/config-legal-story)
- `room.test` "a flood beyond the token bucket is dropped": 297 < 300. The test counted after a fixed 300 ms sleep,
  while relayed frames were still in flight.
- `room.test` "keepalive pings measure per-role RTT…" and `scores.integration` "board is capped at 50" both hit
  Vitest's default 5 s timeout. The runner executes every Vitest project in parallel on a few vCPUs, so real
  workerd round trips are several times slower there than on a laptop.
- `worker.integration` "…the second POST is a cache hit < 100 ms": 155 ms.

## What changed
**Workflows.** `.github/workflows/ci.yml` is now the only workflow. `preview.yml` and `deploy.yml` were removed and
their jobs moved into ci.yml unchanged.
- Triggers: `pull_request` (opened/synchronize/reopened/closed), `push` to `main`, and `workflow_dispatch`.
- Jobs: `check` runs `pnpm check` once per PR head and once per `main` push. `preview` (PRs) and
  `deploy-production` (main) both `needs: check`. The closed event runs only `preview-cleanup`.
- Branch pushes without a PR run nothing.
- Concurrency: one group per PR, where a new push cancels the stale run, and one per ref on `main`, where runs queue.
  The deploy job also keeps its non-cancelling `deploy-production` group.
- Kept from the old workflows:
  - the `WWM_PREVIEWS_ENABLED` / `WWM_DEPLOY_ENABLED` gates and the fork skip;
  - workflow default `permissions: {}`, with per-job `contents: read` (+ `pull-requests: write` for the comment);
  - Cloudflare secrets only on the migrate / deploy / preview / delete steps;
  - the `wrangler preview --json` parse from the first `{` line;
  - cleanup on close from the base branch's config.
- Docs updated to match: `infra/README.md` (Part B has an event → jobs table), `docs/launch/{runbook,checklist}.md`,
  and comments in `wrangler.jsonc` and `check-deploy-config.mjs`.
- actionlint (with shellcheck) is clean. One SC2129 style note in the deploy step was fixed.

**Tests** (audit: `setTimeout`, `waitForTimeout`, `performance.now`/`Date.now` budgets, `expect.poll`/`vi.waitFor`
deadlines, rate windows, event counts):
- `room.test` flood: waits for quiescence. First the relay has handled all 500 frames, measured by stats
  `input.frames + dropped.rate === 500`. Then the host has received exactly `input.frames` frames. Neither client
  answers keepalive pings, because their pongs would spend (and could be dropped from) the same token bucket. All
  the old bounds are still asserted: ≥ 300 relayed, ≤ 300 + 150/s × measured elapsed, and dropped = 500 − relayed.
- `room.test` keepalive: polls stats until both roles have an RTT sample. Then a relay barrier runs in each
  direction before checking that no pong was forwarded. The relay handles each socket's messages in order, so a
  forwarded pong would arrive before the barrier.
- `room.test` expiry: polls for the 404 and asserts it did not come before the idle window. Wait deadlines are now
  10 s and per-test timeouts 30–45 s. Deadlines only matter when a test fails.
- `scores.integration` board cap: its own 60 s timeout. It now also asserts that all 55 submissions got 201 and that
  the best one is on the board.
- `worker.integration` cache hit: now checked by behaviour: a 200 with the finished run, and the fixture site saw
  no new request. The latency budget is 100 ms locally and ×4 on CI, the same factor as stage-builder's. It must
  also be under ¼ of the cold build.
- Suite-wide 30 s per-test timeouts for the workerd suites (scores, docent, upload, cards, worker, capture-guard).
  capture-guard's control test polls for the attacks instead of sleeping 1 s.
- `pipeline.test` queue-vs-budget: 1.5 s queue against a 1 s budget, instead of 600 ms against 400 ms. Same proof,
  but a stalled event loop can no longer fail it for the wrong reason.
- e2e:
  - `expect.poll` deadlines that were still at the 1 s default are now 15 s.
  - Ghost movement and keyboard rolling are polled.
  - The phone disconnect/reconnect waits are now 15 s.
  - The extension receiver polls its ignored-message count instead of sleeping 400 ms.
- Not changed, on purpose:
  - Settle sleeps before negative assertions ("the internal server saw nothing"). Load makes them less sensitive,
    not flaky.
  - Screenshot pauses.
  - Perf budgets that already have a CI factor.
  - `controller.e2e` deadlines only went from 1 s to 10 s. It is a manual harness against `BASE` and is skipped in CI.

## Verification
- `pnpm check` green locally: 74 files passed, 2 skipped. Also ran the worker suites under 24–36 busy-loop processes;
  they passed. The old flood test didn't fail locally either, so the runners are the real test.
- CI on PR #4:

| Run | Base | Head | Result | Wall time (`check` / `preview`) |
|---|---|---|---|---|
| [36187290365](https://github.com/ewjdev/world-wide-maze/actions/runs/36187290365) | launch/config-legal-story | 13d37e9 | green | 8m10s (7m23s / 41s) |
| [36188164645](https://github.com/ewjdev/world-wide-maze/actions/runs/36188164645) | launch/config-legal-story | bb9244f (empty) | green | 8m01s (7m15s / 41s) |
| [36189057840](https://github.com/ewjdev/world-wide-maze/actions/runs/36189057840) | main | b1527cc | green | 7m43s (6m47s / 44s) |
| [36189862914](https://github.com/ewjdev/world-wide-maze/actions/runs/36189862914) | main | 3d27cc6 (empty) | green | 5m23s (4m43s / 34s) |
| the run for the commit that adds this section | main | (this commit) | see PR #4 checks | |

The three consecutive green runs on the final base (`main`) are 36189057840, 36189862914 and the run for this
commit. The two earlier runs against `launch/config-legal-story` were green too. Wall times are 5½ to 8 minutes, and
`check` takes 85–90% of that.

- One `pnpm check` per PR head: each push produced exactly one CI run, and no Preview/Deploy workflow runs exist any
  more. When the force-push and the base retarget happened together, GitHub started two runs for the same head. The
  concurrency group cancelled one within a second, before any step ran (36189057832).
- The Preview job really deployed on every run: `WWM_PREVIEWS_ENABLED` is on in this repo. It created
  `https://pr-4-wwm.ewjdev.workers.dev` and the smoke test passed. So the `needs: check` → `preview` path is
  verified end to end. `deploy-production` stayed skipped (PR runs), as intended.

## Manual human interventions
None. The orchestrator asked mid-task to rebase onto `main` after PR #1 was merged.

## Follow-ups
- Merging PR #4 into `main` triggers `check` → `deploy-production` (if `WWM_DEPLOY_ENABLED`), the first run of the
  folded deploy job.
- Optional: make `check` a required status check (skipped gated jobs count as passed).
