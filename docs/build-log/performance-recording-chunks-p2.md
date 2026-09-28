# Performance #33 — exact compact input recording

**Date:** 2026-09-27. **Branch:** `codex/performance-recording-p2`, based on accepted P2 `2629523`. Follow-up to #26; no overflow-policy decision assumed.

Implemented lazy typed chunks of consecutive exact input values with Uint32 run lengths, preserving Float64/signed-zero values and the existing replay envelope. Completed attempts retain compact data until first submission, which materializes once and drops compact references. Independent debug snapshots cannot corrupt submitted replays. No change to input sampling, physics, timer/score rules, eligibility, or recording horizon.

The [measurement report](../launch/performance-recording-chunks-p2.md) describes all 126 paired triplets, raw/retained export checkpoints, append/conversion costs, short-recording allocation floor, and the rejected fixed-width candidates. The final changing-input retention gain is approximately 59–62% at 36,000 ticks; idle runs compress further. Export still allocates the original wire array/JSON and may temporarily increase pre-GC memory. Total long-run growth remains unbounded; #26 policy and #27 physical-device acceptance remain open.

## Validation

- Eight focused recorder tests and web typecheck pass. Tests include exact value/flag/signed-zero preservation, source/snapshot isolation, over-72,000-tick availability, count overflow splitting, chunk boundaries, reset, fixture score/timer envelope equivalence, and first/repeated submission ownership.
- Native Chromium memory probe: all 126 triplets match JSON SHA-256 and report zero browser errors. Source and integration SHA-256 are in the raw report.
- Existing game E2E passes: reference samples match, deterministic goal/items/score replay matches, actual workerd verifies the 5,429-tick submission. Added assertions prove debug export mutation cannot affect submission and saved compact bytes become zero after submission.
- Initial fixed-width full check failed an absolute worker cached-POST budget (120.97 ms versus 100 ms) and a cards afterAll harness-close timeout. Both full logs and rejected measurements remain preserved. A focused unchanged retry passed all 53 worker/cards tests in 38.30 seconds; this is not proof of a repaired root cause.
- Final RLE first full check: typecheck/lint pass; 1,390 tests pass, 32 skipped, one extension capture assertion fails (source-tab scrollY 0 instead of 420). Extension source/test files are unchanged from base; the failing source-page restoration happens before gameplay/recording. Independent review identified several plausible setup/capture restoration paths, but the log does not establish the exact cause. An unchanged focused retry passed 5/5 in 36.11 seconds. Both outcomes are retained.
- The one unchanged full-suite retry passed: `pnpm check` green, 1,391 tests passed / 32 skipped, 119 files passed / 3 skipped, 150.09 seconds. [Final log](../launch/evidence/recording-chunks-p2/full-check-final.txt). No assertion or timeout was relaxed. The earlier intermittent extension restoration failure remains a test-reliability issue with unresolved exact cause; a green retry does not claim it was fixed.
- `pnpm docent:index` regenerated the documentation corpus; `pnpm docent:index --check`, owned-file Biome and `git diff --check` pass after final documentation updates.

Independent source review by the audio agent found no blocker in exact values, chunk/count boundaries, ownership, or debug/submission isolation. Shared-host browser/benchmark/full-suite work ran only in assigned exclusive slots. The probe closes its own browser/server. Parent integration and fresh combined source-bound evidence remain separate gates; this worktree does not merge, push, or deploy.
