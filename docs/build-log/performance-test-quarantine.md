# Performance browser-test quarantine

September 27, 2026. Codex, with a separate issue-grooming agent. Continues PR #34 after merging main at `fedb9bc`.

## Request and scope

Eric requested a test-hardening plan and high-priority GitHub issues, and explicitly authorized temporarily skipping failing tests so they do not block performance work. Exactly two ghost lifecycle tests and one initial portal travel test are quarantined in CI. Ordinary local runs still execute them; `WWM_RUN_QUARANTINED_TESTS=1` opts CI-mode diagnostic runs in. Test bodies, assertions, timeouts and game code remain unchanged. The remaining ghost parity and portal decline/offline checks stay required.

The [hardening plan](../../plans/performance-test-hardening.md) covers guaranteed cleanup, explicit lifecycle transitions, failure-state capture, negative controls and evidence required to remove the quarantine. The P1 follow-ups are [#35, ghost lifecycle](https://github.com/ewjdev/world-wide-maze/issues/35) and [#36, portal travel](https://github.com/ewjdev/world-wide-maze/issues/36), both children of epic #19. These follow-ups are separate from performance requalification after the merge of main. Source-fingerprint checks are retained; stale measurements are not an accepted waiver.

## Validation

- Before changes: serial local CI-mode run passed all six tests in 82.17 seconds; hosted failures remain real and their exact triggers unresolved.
- Quarantine mode: three tests passed and exactly three skipped, 17.17 seconds.
- Opt-in diagnostic run: all six tests passed, zero skipped, 82.82 seconds.
- Full `CI=true pnpm check`: typecheck and lint passed; 144 test files / 1,560 tests passed, six files / 47 tests skipped, 203.56 seconds. Exactly three skips are newly authorized by this quarantine; 44 were pre-existing in CI mode.
- Runtime fingerprint remains `b420b32e2c08409ee28e057cfda81c6e622548f29eb4f69a1ade05dc0d723584` (1,036 files), unchanged from the merged head.
- Generated documentation corpus rebuilt and freshness checked before publication.
- Independent review confirmed the quarantine scope and preserved assertions.
- macOS/Node 26 local results are separate from hosted Linux/Node 24 acceptance.

## Remaining work

Implement the linked P1 repairs, remove each quarantine with evidence, and collect fresh native evidence for the merged runtime under #28. No flaky-test root cause is claimed fixed by skipping it. No production merge is part of this change.
