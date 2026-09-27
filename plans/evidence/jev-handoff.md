# Jev local spectator handoff

Worktree: `/Users/ewj/.codex/worktrees/jev-spectator-plan/wwm`  
Branch: `codex/jev-spectator-plan`  
Local URL: http://127.0.0.1:5176/dev/jev

## Delivered

Real Rapier maze watching with Jev, DFS baseline and clearly labeled scripted policies; pause/resume, one-decision stepping, stop, overview/follow camera; observed graph, options, probabilities and exact evidence; durable run history with pagination/search, JSON recordings, CSV summary, validated read-only import and replay/decision seeking. Mobile notebook collapses and history expands it. The original game routes and Worker API remain independent.

The TypeSafe key is read only on the server from ignored `.env.jev`. It was configured and live calls succeeded. Restart with `pnpm dev:jev`. History is retained in ignored `local/jev/local-pilot`; no automatic rotation or deletion. Read `tools/jev-runtime/README.md` for limits and explicit recovery.

## Measured pilot

Pinned model: `jev-1.13.0`; controller/observation contract: `jev-spectator/1`; deterministic Rapier 0.20.0, physics package 0.2.0, 120 Hz. Fixture hashes and exact settings are in `jev-evaluation/pilot.json`; source hashes are in `jev-evaluation/source-manifest.json`. Source-manifest hashes were recorded after code formatting; the prompt/controller/settings were unchanged during the measured trials.

9/9 Jev runs and 9/9 baseline runs finished. Every one of the 18 final-state replays matched. The additional live smoke completed and replayed too. All failures and interrupted browser-development runs remain in the archive; they are separate from the frozen measured set. This tiny curated pilot establishes feasibility, not superiority or broad maze-solving capability.

| Maze | Policy | Seed | Outcome | Decisions | Active seconds | Provider wait ms | Replay |
| --- | --- | ---: | --- | ---: | ---: | ---: | --- |
| first-fork | baseline | 0 | finished | 7 | 43.62 | 0 | match |
| first-fork | jev | 0 | finished | 7 | 43.62 | 648 | match |
| first-fork | baseline | 1 | finished | 7 | 43.57 | 0 | match |
| first-fork | jev | 1 | finished | 7 | 43.62 | 776 | match |
| first-fork | baseline | 2 | finished | 7 | 43.62 | 0 | match |
| first-fork | jev | 2 | finished | 7 | 43.62 | 654 | match |
| round-trip | baseline | 0 | finished | 5 | 29.43 | 0 | match |
| round-trip | jev | 0 | finished | 5 | 29.43 | 585 | match |
| round-trip | baseline | 1 | finished | 11 | 72.01 | 0 | match |
| round-trip | jev | 1 | finished | 5 | 29.43 | 843 | match |
| round-trip | baseline | 2 | finished | 5 | 29.43 | 0 | match |
| round-trip | jev | 2 | finished | 5 | 29.43 | 607 | match |
| branch-library | baseline | 0 | finished | 8 | 50.70 | 0 | match |
| branch-library | jev | 0 | finished | 8 | 50.70 | 883 | match |
| branch-library | baseline | 1 | finished | 10 | 64.88 | 0 | match |
| branch-library | jev | 1 | finished | 8 | 50.70 | 1378 | match |
| branch-library | baseline | 2 | finished | 8 | 50.70 | 0 | match |
| branch-library | jev | 2 | finished | 8 | 50.70 | 848 | match |

Measured input usage: 31,833 tokens; estimated published-price input cost: $0.001337. This is usage-based estimation, not an invoice. Output is free at the checked [published price](https://docs.typesafe.ai/models). The selected account is the user-provided key; its account identity is not exposed by the used API.

Headless trials use the same local API, observations, selector and physics/controller as the UI, running faster than playback. `executionWallMs` is headless processing time, not wall time of the visible maze. Ordering seeds 0 and 2 repeat the same parity-based candidate order. The separate confirmation fixture was validated only for physical traversal.

## Verification

- 17 focused domain/runtime/session tests passed. Includes real physical completion on four fixtures; hidden-goal/ID/seed isolation; exact replay; missing/invalid provider data; duplicate and delayed responses; interruption/restart; ownership; 25-run retention; torn tails, short writes and failed fsync; orphan budget reservations; exhausted budget/closure space; render-rate invariant pause and stepping.
- Live browser walkthrough: start, pause, Next decision, resume to goal, open history, seek saved decision; no page errors or replay mismatch; no horizontal overflow at 390 px.
- Loopback/origin/session checks and private-file protection passed for archive URLs, Vite @fs/raw paths, encoded URLs, a temporary public symlink and the credential file. Ordinary development returned 404 for the Jev API.
- Typecheck and production web build passed. Production output has no spectator route/API text or credential value.
- The initial full `pnpm check` run had 1,186 passing, 24 failing and 32 skipped tests across 94 files; failures included documentation index scope, timeouts, performance thresholds, and extension capture quota. Evaluation artifacts were moved outside the public documentation corpus; all 44 documentation and main-route tests passed on focused rerun. Remaining failed files were rerun serially; final result recorded below.

## Persistence choices and limits

Inline evidence in the fsynced journal replaces separate immutable artifact files and journal references. The reviewer accepted the simpler commit boundary. A disk write failure freezes further mutations. The ledger remains separately durable and reconciles orphan reservations; unknown outcomes remain counted. Only acknowledged movement is promised after a crash. A response that never becomes durable cannot be recovered. A full page refresh interrupts prior owned physics; history readers do not mutate active runs. Failed recovery retains the owner capability for retry.

No IndexedDB cache is needed for the local authoritative archive. Imported recordings are read-only. Recordings verify fixture/physics versions, chunk continuity, input bounds, ball checkpoints and event streams. Full archive JSON is capped at 32 MiB; replay inputs at 10 MiB. All run IDs in the result JSON can be located in Run history.

## Review

System-design implementation review: complete writes/failure latching, closure allowance, owner refresh recovery and response redaction addressed. Final verification notes below. UI reviewer used an independent fresh agent with the skill fallback contract because this harness does not expose the named finish-reviewer role. One mobile history defect was fixed; final verdict below.

## Rollback

Stop the dedicated server; preserve `local/jev/local-pilot`. Standard dev and production do not enable the experiment. No deployment was performed.

### Final acceptance update

All 10 files that failed in the initial concurrent suite subsequently passed on focused/serial reruns: 44 documentation/main-route tests plus 120 stage-builder, Worker, pipeline, card, integration and extension tests. The original `pnpm check` invocation remains recorded as failed; no claim is made that it passed unchanged. The documentation scope issue was corrected by keeping experimental evaluation artifacts under `plans/evidence`, outside the public docent corpus. Timeout/performance/capture failures did not recur with one worker.

System-design final verification: all four scoped findings resolved. UI final disposition: **ship**; the mobile-history fix is resolved and no attributable regressions were visible. The 390 px browser check confirmed history becomes visible from the collapsed state, zero horizontal overflow and no page errors.
