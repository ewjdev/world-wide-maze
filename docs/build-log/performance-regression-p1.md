# P1 performance regression tooling — issue #28

- Agent/tool: Codex (GPT-6), isolated `codex/performance-cache-p1` worktree, shell/Node/Vitest/Playwright.
- Work interval: September 27, 2026, approximately 20:45–21:00 UTC for tooling preparation; integrated native runs are recorded separately on the staging branch.
- Instruction: support the performance epic with testable, opt-in evidence gates; preserve P2 scope and require measured individual gains before integration. Parent delegated this alongside cache issue #23.

Added a read-only evidence comparator with hard reference-replay and retained-render-target checks, explicit missing evidence, timing review, and visible known P2 #24 attribute growth. Fourteen controlled fixture tests prove score/resource regressions and missing data cannot silently pass. Audit output can go to a distinct `AUDIT_OUT`, wrappers preserve every engine frame argument, and viewport/instrumentation metadata is explicit. The standalone overhead probe prepares three ten-second pairs with minimal measurement versus audit-style observers and CPU wrappers.

The staging-only workflow installs frozen dependencies with Node 24 and Chromium, runs `pnpm check` and the tooling tests, compares committed native evidence and retains artifacts for 14 days. It cannot deploy, does not request provider credentials, and does not change production CI. Known P2 retention returns nonzero from the comparator and an explicit workflow warning; other incomplete/failing evidence blocks it.

Validation during preparation: `node --test infra/perf/p1-regression.test.mjs` passed 14/14; Node syntax checks and Biome passed. Native overhead and combined staging comparison are intentionally run by the parent after individual measured improvements are integrated, to avoid simultaneous workloads contaminating their measurements. Full repository validation is recorded with the cache handoff and on the staging branch.

No production diagnostics or telemetry were added. Disabled product cost is zero by construction; enabled sampling cost is measured by the prepared probe, not assumed to be zero. CPU profiler and GPU timestamp overhead are explicitly outside that comparison. Physical lower-tier desktop/mobile and thermal acceptance remain open under issue #27. No human intervention was needed; parent serialized heavy workload windows.
