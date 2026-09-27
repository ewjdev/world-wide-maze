# Phase 23 execution log — initial contract and persistence slice

September 26, 2026. Branch: `feat/phase-23-lesson-limits`. This is an implementation slice, not the four-lesson POC or a release.

## Implemented

- A strict, separately versioned `wwm-learning/0.4` Bridge Builders document and inert HTML readback. Existing 0.1–0.3 learning content continues through its existing reader; the sampler remains draft in the path registry.
- Four Bridge Builders encounters with exact totals, authored hints, unique pickup and connector IDs, plus a bound stage and manifest under `fixtures/learning/bridge-builders/`.
- A pure reducer for pickup, prediction, reversible tray staging/return, hints, exact Confirm and encounter transition. Each event names lesson revision, session, attempt, node, event ID and sequence. Duplicate accepted events do not mutate state twice.
- A stage binder that checks the frozen stage hash, every target/connector reference, target clearance and active sensor separation.
- IndexedDB storage (`wwm-learning-poc`, version 1, `sessions` keyed by path/activity) with revision comparison, identity checks and explicit delete functions. A BridgeSession coordinator commits state before world projection; save failure, conflict, projection retry and session-only continuation have separate outcomes.

## Evidence

- `pnpm --filter @wwm/learning typecheck`, learning tests, web typecheck and targeted world/session tests passed.
- The authored stage passes `validateStage`; fixture JSON parses back to the same lesson document.
- Final `pnpm check` passed after regenerating the docent corpus index: 90 test files and 1,197 tests passed; 2 files and 30 tests were skipped. Lint reported two pre-existing advisory findings outside this slice.

## Open gates

- M0 content and page-by-page UI review is incomplete. The four scripts are still drafts requiring educator and fluent-speaker review. The Bridge Builders fixture uses an adapted existing stage; physical traversal and learner usability have not been verified.
- M1 is partial: the 0.4 reader currently supports Bridge Builders, and the other three activity schemas, explicit 0.1–0.3 node adapters, locale-aware audio manifest and consumer rendering remain.
- M2 is partial: storage and commit ordering exist for Bridge Builders, but there is no production game adapter restoring physics/rendering before input and no real browser IndexedDB test yet.
- M3–M7 are not implemented. The sampler has no public or local playable route; no provider audio was generated, no learner clips were recorded, no physical iPhone audio test or comparative playtest occurred, and nothing was deployed.

Keep the sampler hidden until the relevant capabilities and end-to-end tests are present. The old `little-discoveries` path remains the only playable learning path.
