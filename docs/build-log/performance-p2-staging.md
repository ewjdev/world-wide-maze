# Performance P2 staging integration

September 27, 2026. User authorized committing pending plans, then continuing remaining performance epic work in isolated worktrees with tested, measured agent changes integrated into staging.

## Plans preserved

Committed all five pending plan files as `f362b45` on the original `feat/phase-23-lesson-limits` checkout: overview, cost controls, cost-controls execution, extension release and Phase 24 race. Docent index/check and whitespace validation passed; that checkout is clean. This local planning commit was not moved into the unrelated performance branch.

## Integration

- `8b387ac`: stage-owned GPU attributes and generated bitmap cleanup, individually measured on WebGPU/WebGL2 with full check (1,370 passed).
- `a6d7aed`: controller presentation cadence with exact paired input/timing traces; recording research only.
- `02ec024`: idle rendering/worker suspension, three native pairs and keyboard/gamepad/phone visibility, reconnect and worker parity tests.
- Parent startup research: 18 attributed production runs plus 12 exact-synthesis prototype runs; production audio unchanged.
- Parent regression tooling: 25 controlled tests and strict post-warmup allocation plateaus. Current CI rejects the historical P1 leak waiver.

Merged the qualified individual branches with explicit merge commits. Generated docent corpus conflicts were resolved by regeneration, preserving every agent's report. No product-source conflict required manual resolution. Independent merged-path review found no blocker between idle cadence and adaptive timing, resource ownership or current controller samples. Runtime source is frozen at `7eb2309`, SHA-256 `36bcaafb2c26d87ee779d57e7419e088c2c8d1f645de28225716aad557488669`, 382 served assets.

## Combined validation

Six native modes completed with zero captured browser errors. All 51 strict comparison checks pass; all three reference replays finish at 5,429 ticks / score 1,484 / one saved replay, and 15 retries retain exactly 65 attributes / 1,473,380 bytes. The first full check stopped on 11 generated JSON formatting errors; formatting preserved every parsed value. The next full run passed typecheck/lint and 1,382 tests, with one portal return-crossing test failure (distance polling at line 263); the failed output is retained. The owning agent is diagnosing the timing-dependent test before qualification. Published-head CI is also required before handoff. The final results are recorded in [P2 staging report](../launch/performance-p2-staging.md). Main/production remain unchanged. No P2 research prototype is presented as a shipped runtime change; physical lower-tier acceptance and recording overflow policy remain open.
