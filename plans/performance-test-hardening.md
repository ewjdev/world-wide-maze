# Performance test hardening and temporary quarantine

## Decision and scope

On September 27, 2026, Eric authorized temporarily skipping the failing tests so test instability does not block performance work in PR #34, with high-priority GitHub follow-ups. Quarantine exactly three observed browser failures in CI; keep their bodies and assertions intact and keep ordinary local runs enabled. `WWM_RUN_QUARANTINED_TESTS=1` enables them in CI mode. New failures require their own diagnosis rather than automatic quarantine.

The quarantine is accepted missing coverage, not evidence that the affected behavior is correct. It changes no game code, contracts, physics, timeouts, or performance thresholds. The source-bound audio/resource performance gates remain blocking: benchmarks from before the merge of main cannot qualify the merged runtime.

## Evidence

At `fedb9bc`, [CI run 36373983075](https://github.com/ewjdev/world-wide-maze/actions/runs/36373983075) failed two ghost lifecycle tests, and [staging run 36373977527](https://github.com/ewjdev/world-wide-maze/actions/runs/36373977527) failed the initial portal travel prompt test. Each failed test passed in the other workflow on the same head. All six tests in both files passed in an unchanged serial local CI-mode run (82.17 seconds, macOS/Node 26 versus hosted Linux/Node 24). Scheduling sensitivity is inferred; the exact triggers remain unknown.

Confirmed test weaknesses include cleanup skipped after assertion failures, ghost retry calls without observed intermediate phase transitions, and portal timeout output without simulation/visibility diagnostics. None establishes a product regression by itself.

## Work packages

1. **[Ghost lifecycle and stale response — #35 (P1)](https://github.com/ewjdev/world-wide-maze/issues/35).** Guarantee browser context/worker cleanup on every exit. Assert the actual pause/retry transitions and new request identity before waiting for completion. Record ghost status, request sequence, dispatch/termination, visibility and page errors on failure. Distinguish network failure, a rejected retry and failed synthesis. Preserve exact pose parity, cancellation, stale-response rejection and unmount assertions.
2. **[Initial portal travel — #36 (P1)](https://github.com/ewjdev/world-wide-maze/issues/36).** Guarantee cleanup and capture phase, visibility, physics ticks, ball position/distance, portal sensor events and browser errors on timeout. Establish whether the failure is stalled progress, camera-dependent fixture steering or a missed sensor event before changing the helper. Keep real physics crossing, score carryover, travel, decline suppression and offline behavior covered; do not replace crossing with a direct prompt trigger.
3. **Restore required coverage.** Each issue's implementing engineer owns removing its quarantine. Reproduce with Node 24/Linux software rendering, both serially and under the normal suite load. Use a documented bounded repeat experiment (proposed: ten consecutive focused runs), a full suite, and a targeted negative control for the behavior being protected. Retain failed runs and artifacts. A retry that happens to pass is insufficient justification to close an issue.
4. **Requalify merged performance separately (#28).** Rebuild and collect fresh native frame/GPU/replay/lifecycle/stall/learning and sound-enabled startup evidence for the current runtime, compare against accepted baselines, and update the evidence/report references. Do not remove fingerprint checks, relabel old samples or claim native GPU timing from software-rendered CI.

Ghost and portal repairs can be assigned to separate agents with exclusive test-file ownership. Serialize benchmarks on the measurement host. Shared game helper changes require coordination and independent review. Owner is the engineer taking the linked issue; no individual is assigned by this plan.

## Quarantine operation

| File | Exact test | Tracking |
| --- | --- | --- |
| `apps/web/test/ghost.e2e.test.ts` | game stays playable, retries cancel preparation, and unmount terminates workers | #35 |
| `apps/web/test/ghost.e2e.test.ts` | late network response cannot replace a newer same-stage ghost | #35 |
| `apps/web/test/portal.e2e.test.ts` | roll into a portal, confirm, and the linked site’s maze loads with the score carried over | #36 |

Default CI skips the two named ghost lifecycle tests and the first portal travel test. The real-worker ghost parity test and portal decline/offline tests remain required. Other test suites, typecheck, lint, documentation freshness and performance comparison gates remain required.

```sh
# Verify the narrow quarantine: three pass, three skip.
CI=true pnpm vitest run --project @wwm/web apps/web/test/ghost.e2e.test.ts apps/web/test/portal.e2e.test.ts --maxWorkers=1

# Explicit diagnostic/reinstatement run: all six tests enabled.
CI=true WWM_RUN_QUARANTINED_TESTS=1 pnpm vitest run --project @wwm/web apps/web/test/ghost.e2e.test.ts apps/web/test/portal.e2e.test.ts --maxWorkers=1

# The required repository suite retains the three CI skips.
CI=true pnpm check
```

Review the quarantine at the next performance promotion review and every PR touching these tests. Remove each skip only with its issue's evidence and restored required CI coverage. There is no automatic expiry that would create unrelated failures and no blanket `continue-on-error` on the required suite.
