# Performance P1 staging integration

## Request and boundary

September 27, 2026. Eric requested subagents to execute performance epic #19's P1 work, test each change, admit only measured improvements, and combine qualified changes in a staging branch before P2. Both desktop and mobile are in scope. Main and production deployment are outside this staging step.

Coordinator: Codex, with isolated rendering/timing, ghost, and cache/regression workers. Base `d88697f` combines current main `433943d` and the original performance audit. Managed worktrees preserve the user's original checkout and its unrelated plan files. Branch: `codex/performance-p1-staging`.

## Integration discipline

- Browser benchmarks and full suites ran serially on the shared host. Other ordinary host activity was not controlled.
- Runtime acceptance required a measured benefit and correctness checks. Regression tools and device-matrix documentation support validation; they are not claimed as runtime speedups.
- Peer review found and repaired stale retry ownership, asynchronous world-install cleanup ordering, incomplete FXAA render-target disposal, and evidence checks that could accept stale builds, missing scenarios or worsening known leaks.
- Rendering candidates with retained high-tier targets were rejected before staging admission. Final component evidence must demonstrate convergence after lowering quality.
- The original synchronous ghost audit is retained as a reference; worker responsiveness is measured by the separate paired ghost harness.
- Native evidence is bound to a runtime source fingerprint and verified served asset hashes. Documentation-only commits do not invalidate the runtime fingerprint.
- Known P2 #24 attribute retention remains visible. No P2 implementation was started.

## Validation

Qualified branches merged: ghost `ff7eaa3` as `737649c`; cache/tooling through `1cd13a4` as `4882a6f`; renderer `566d9d6` as `b03830a`. Integration preserved both ghost and stage cancellation in Game.dispose and regenerated the documentation corpus. Independent source reviews cleared cache/ghost lifecycle and renderer timing/compile ownership after merge.

The final production runtime fingerprint is `7ec6d5eb369258f8d58e47c31222bda8ad395505dfbc13597f3bfee45509ba1e`, measured at `b03830af177f54301a67027c0e0c4838885d7a42`. Parent ran the source-bound build, native GPU, all 12 frame cases, replay at 1×/6×/20×, 15 retries plus seven fixture loads, artificial stall/recovery, three instrumentation pairs, two cache A/B tours, and six ghost reference/worker pairs. Raw results and distinctions are in `docs/launch/performance-p1-staging.md` and its evidence directory.

Final comparator returns exit 3 solely for existing P2 #24: 44,800 bytes and two attributes per retry, identical to baseline. No P1 hard failure, missing evidence or timing-review gate remains. All six ghost pairs retain exact pose parity and improve frame/heartbeat gaps; one throttled worker trial retains a 79 ms long task, explicitly reported. Source/manifest/382-asset integrity and frame/GPU sampling were independently rechecked by the ghost agent.

Renderer full check was green: 1,333 passed, 32 skipped. Ghost/cache component logs retain their earlier isolated full-suite failures and passing focused regressions. Combined full correctness is enforced by the published staging-only GitHub workflow before handoff; its run is linked from the staging report and epic update. The coordinator independently ran 22 controlled gate tests, documentation checks, lint and diff validation. No deployment or main merge, no physical-device/thermal/controller acceptance, and no P2 implementation. Every task-owned browser and preview was stopped after measurement.
