# Gameplay performance audit — September 27, 2026

## Request and scope

Eric requested a full gameplay/rendering/memory/CPU/GPU audit, actionable GitHub issues under a performance epic, and automatic adjustment for lower-tier hardware. He confirmed both desktop and mobile are in scope. Work was isolated in the managed `game-performance-audit` worktree on `codex/game-performance-audit`, based on `0b33c14cef45c34905d202bbc760b956cb573362`.

Codex performed the work using repository inspection, a production Vite preview, Playwright/CDP, native Metal GPU timestamp queries, process counters and GitHub CLI. No delegated agent work, game behavior changes, deployment or production load testing occurred. Local browser traffic had analytics off and API calls stubbed. The original checkout's existing plan edits were preserved.

## Deliverables

- [Complete audit](../launch/performance-audit-2026-09-27.md), with measured facts, source findings, unproven root-cause candidates and physical acceptance gaps kept distinct.
- [Diagnostic harness](../../infra/perf/audit-2026-09.mjs) and [raw JSON, CPU profiles and screenshots](../launch/evidence/audit-2026-09-27/).
- [Performance epic #19](https://github.com/ewjdev/world-wide-maze/issues/19) and 11 native child issues, #20–#30. Each issue has priority, readiness, bounded scope, evidence, acceptance, validation and dependencies. Creation, content and parent relationships were read back from GitHub.

## Measurement summary

On the available M5 Max/128 GiB/macOS 26.6.2 host, ordinary fixture scenarios rendered near 60 FPS. A 20× CPU stress scenario reached about 36 FPS with p95 frames of 49 ms. Automatic quality misreported a synthetic ~5 FPS stall as 10 FPS; high-to-low quality retained about 126 MiB more renderer-accounted resources than a fresh low-quality start. Retry cycles added two GPU attributes / 44,800 bytes each after the first measured retry. Classic ghost preparation blocked for about 200 ms natively and 1.24 s at 6× CPU stress. All three full reference replays (1×/6×/20×) ended at the same 5,429 ticks and score 1,484.

The main report contains the definitions and limitations of these measurements. Browser CPU throttling is not weak-GPU or physical-mobile emulation. GPU resource byte estimates are not physical VRAM, GPU-process CPU time is not GPU utilization, and page JS heap excludes worker/native memory.

## Validation

- Frozen dependency install and production web build passed.
- All nine measurement modes completed. The initial title case waited for a body attribute absent in initial title state; the harness was corrected to use debug phase and rerun in `idle` mode. The original failure remains visible in raw evidence.
- Initial `pnpm check` passed typechecking but stopped at formatting of the nine new raw JSON files. Those files were formatted; no game-source lint edits were made.
- `pnpm check` passed: all workspace typechecks, lint (32 advisory warnings / 4 informational findings), and 108 test files / 1,328 tests passed; 3 files / 32 tests skipped. Suite duration 148.15 seconds. Node 26.0.0 / pnpm 11.5.0 on this host; the repository requires Node ≥22.12 and CI uses Node 24. No pre-existing advisory source findings were changed.
- Documentation corpus was regenerated after this build log and checked with `pnpm docent:index --check`; `git diff --check` passed. The only existing tracked application file changed is the generated documentation corpus. Validation output is saved as `docs/launch/evidence/audit-2026-09-27/check.txt`.

## Remaining acceptance

Named low-/mid-tier desktops and Android/iOS devices, sustained thermal/battery sessions, direct mobile rendering, actual controller-to-visible-motion latency, slow/production networks, and pending Race PR #17 require their own acceptance. The proposed 60 FPS aim / stable 30 FPS lower-tier fallback and memory ceilings remain calibration decisions. Issues are implementation work; this audit does not claim those changes have shipped.
