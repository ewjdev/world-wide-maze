# Requalify PR #34 performance after main integration

September 27, 2026. Codex with independent review and a lightweight test agent.

## Trigger and work

PR #34's `a022bde` CI and preview succeeded; Performance staging failed only at the source-bound audio gate, which correctly rejected pre-merge measurements. Rebuilt the merged source with race enabled like the preview, collected fresh native evidence, and pointed the staging workflow at the new directory. No product runtime or threshold changes.

Two complete startup attempts were rejected because extra unlocks invalidated first-input attribution. Added harness-only input isolation and privacy-conscious gesture categories; preserved both rejected collections. Rebuilt the original baseline at `7eb2309` in the free performance-render worktree and recollected its audio traces with the same harness instead of comparing incompatible instrumentation. That worktree's prior completed audio branch remains preserved.

A separate agent added seven Node tests against the actual collector instrumentation and interference validation. Independent review checked scope, build flags, source identity, gate coverage and timing-window isolation. [Results and limitations](../launch/performance-main-integration.md).

## Validation

Fresh audio comparison passes with native first-key median 44.90 → 14.75 ms. Core comparison initially returned timing-review for two 20× cases; three alternating old/merged pairs reproduced the timing shift on both builds. Preserved the initial result and all six trials, refreshed all baseline frame/replay scenarios, and retained the documented GPU/lifecycle reference files. The final comparison passes all 51 gates without changed thresholds or substituted candidate samples. All 66 performance-tool tests pass, including seven isolation tests. The first full `CI=true pnpm check` passed typecheck/lint and 1,559 tests but timed out at `learning.e2e.test.ts:377` waiting for the level picker after a 2.3-second Grown-ups hold (47 skipped). The unchanged focused learning suite passed 4/4 in 58.07 seconds. Both outcomes are retained; no learning test assertion, product code or quarantine was changed. The intermittent hold-to-open check is tracked by [P1 #37](https://github.com/ewjdev/world-wide-maze/issues/37) and remains blocking. One unchanged full-suite retry passed typecheck, lint and all 1,560 tests (47 skipped; 144 passing files) in 193.95 seconds. This successful retry does not resolve the intermittent failure in #37. The old measurements and three authorized CI quarantines remain visible. No production merge is part of this work.
