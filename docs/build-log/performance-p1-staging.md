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

Combined measurements and final repository/CI validation are in progress. Final results are recorded in `docs/launch/performance-p1-staging.md` and its linked raw evidence before handoff. Individual logs preserve all failed attempts and scope limitations rather than relabeling them as passing checks.
