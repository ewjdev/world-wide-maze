# Jev spectator: independent system-design review

Reviewed draft: `plans/jev-spectator-execution.md`, initial draft on branch `codex/jev-spectator-plan`, base `0a0b941f45f709c378f00ad1f6adaa42a827b5c9`.

Review scope: source inspection and plan consistency only. No code implementation, installation, provider call, test execution, deployment, or remote mutation. The reviewer owns this review file; the plan author owns plan revisions. There was no applicable `AGENTS.md` in the checkout or its ancestor chain. No configured dedicated system-design agent was available; this review was performed by a separately delegated agent in that role.

Initial verdict: **revise before user sign-off**. The direction is bounded and viable, but four consequential details need resolution before the plan is an execution contract. These are design gaps, not runtime defects demonstrated by tests.

## JEV-SD-01 — P1 — Define the final observed-goal action

**Evidence:** Draft §§5–6 defines candidates only as adjacent traversals and stops at a safe island arrival anchor. `packages/physics/src/simulation.ts:305–312` creates the goal sensor at `stage.goal.pos`; lines 629–639 emit `goal` only on contact. Arrival on the correct island is insufficient. `packages/solver/src/plan.ts:51` also retains a nonzero default end speed of 2.5 m/s, so using the current pilot does not supply the promised settled boundary automatically.

**Consequence:** A run can discover the goal, stop elsewhere on its island, then choose a return connection or declare success without triggering the actual goal. Controller behavior and completion metrics would diverge.

**Required plan change:** Once the goal is observed on the current island, expose a local `finish` action with an explicit target at the observed goal, restricted to that island. Make its policy/forced-action treatment identical for Jev and DFS. Only the actual physics `goal` event grants success. Define settling/braking as an explicit controller phase for ordinary arrival and initialization; never manufacture a goal event or hide a global-goal route inside the local controller.

**Acceptance:** A fixture whose arrival anchor is well outside the goal sensor must physically finish; observing goal presence alone cannot finish. Test goal/fall event precedence and the case where the goal event occurs during approach before ordinary settling completes.

Disposition: **RESOLVED IN PLAN**. Revised §§5–6 specify `finish-visible-goal` as a shared forced action, restrict it to the observed island, require the actual goal event, define event precedence, and add zero-speed braking/recentering/settling. Runtime controller reliability remains an M1 acceptance gate.

## JEV-SD-02 — P1 — Select a per-tick result seam for control and arrival

**Evidence:** Draft §6 requires fixed-tick steering and freezing after the exact arrival tick. `apps/web/src/game/sim-driver.ts:42–53` exposes only a pre-step input callback and a physics-event callback. `LockstepDriver.advance`, lines 123–148, may perform up to 30 steps per render frame; the fresh ball state is private until return. Island arrival/settling is not an existing `SimEvent`. `packages/solver/src/pilot.ts:174` onward requires current position and velocity for each control step.

**Consequence:** A session built only on the existing public driver interface will use stale ball state within a frame or detect the boundary after extra steps. This makes control and one-decision stepping dependent on rendering cadence and undermines exact replay.

**Required plan change:** Choose a concrete seam: a dedicated spectator fixed-step driver around `createSimulation`, or a narrowly compatible `afterStep(tick, result)` addition with stop control and fresh result access. Give the session an explicit per-tick order: derive input from the previous completed result, consume/record input, step, process all events, update tracking, check terminal/arrival/settling/deadline conditions, then either freeze or permit the next tick. Define how initial state is acquired without an unrecorded dummy step. Do not imply existing `LockstepDriver` already supplies this.

**Acceptance:** Identical actions under 30 Hz, 60 Hz, irregular/long render frames stop on the same completed tick with identical consumed input/event streams. Pause/resume and repeated step clicks add no extra tick or action.

Disposition: **RESOLVED IN PLAN**. Revised §6 chooses a dedicated `Simulation.step` driver with immediate result/stop control, exact input-index versus completed-step semantics, and a read-only tick-zero getter. The existing `getBallState()` at `packages/physics/src/simulation.ts:894` supplies a concrete source seam. No game-wide driver rewrite is required.

## JEV-SD-03 — P1 — Resolve local server, durable reservation, and startup authority now

**Evidence:** Draft §7 promises a whole-pilot budget and serial reservation but leaves storage/restart/deduplication to M0. `apps/worker/src/limiter.ts:21–32` implements a sliding window, and lines 41–50 can delete state; it is not an append-only campaign ledger. `apps/web/vite.config.ts:72–81` binds the normal dev server beyond loopback, accepts quick-tunnel hosts, and rewrites the proxy Host. `apps/worker/src/security.ts:isCrossSite` accepts requests without Fetch Metadata. These defaults do not establish the proposed local authority boundary.

**Consequence:** The implementer must invent the principal security and billing-state architecture after sign-off. A restart, browser reload, duplicate attempt or proxy path can defeat assumptions about reservation or local-only access if treated as ordinary dev defaults.

**Required plan change:** Prefer a dedicated loopback-only `dev:jev` launcher and dev-only Node/Vite middleware owning provider dispatch and an append-only filesystem ledger. This is simpler than adding local-only durable storage to a Worker for the pilot. Fix a private ignored data directory outside published assets, one process lock, serialized pre-dispatch durable reservation, persistent pilot/run/attempt keys and maximums, and duplicate handling that never dispatches twice. Reserved-but-uncertain attempts remain consumed across restart. Unreadable/corrupt ledger or failure to reserve must refuse a provider call. Specify token bootstrap, exact Host/Origin checks, proxy precedence and disabled behavior under normal dev/build/production; never expose the key through client variables. An alternative Worker design is acceptable only if these mechanisms are equally concrete.

**Acceptance:** Two tabs/processes, request abort, server crash after reservation, restart, duplicate same-ID requests, exhausted budget, corrupt ledger, invalid/missing origin/token and normal/tunneled dev entry all have defined outcomes and tests. A browser abort must not imply the upstream dispatch is cancelled or free. Mobile-width UI review can remain an emulated viewport; physical phone access is outside this loopback pilot.

Disposition: **RESOLVED IN PLAN**. Revised §7 selects dev-only Node/Vite middleware, a dedicated loopback launcher, explicit request/token checks, filesystem process lock, serialized fsynced reservations, persistent pilot/run budgets and deduplication. Unknown reservations remain counted and cannot redispatch. Fault and restart cases are part of implementation acceptance.

## JEV-SD-04 — P2 — Make the recording sufficient for inspection and reproducibility

**Evidence:** Draft §5's `RunRecording` includes inputs, receipts and action results, but no frozen observations/candidate descriptors or required decision checkpoint records. Section 6 nonetheless promises inspecting prior knowledge and comparing state/event digests. Existing `packages/physics/src/replay.ts:17–19` uses 1-based event ticks, while `apps/web/src/game/sim-driver.ts:130–131` calls the first input at tick zero. `replay.ts:90–96` also restarts on `lost` by default and throws for zero inputs.

**Consequence:** A hash-only receipt cannot explain what was known without regenerating policy context, and the missing tick convention permits off-by-one timeline/checkpoint errors. Matching only final position does not establish faithful historical decisions.

**Required plan change:** Define state tick zero and input `i` advancing state `i` to `i+1`; stamp emitted events at the completed state tick. Store the frozen canonical model-facing observation and ordered candidates at each decision, full ordered physics events, initial state/config identity, and explicitly specified decision/final digests. Distinguish recorded metadata/control events from regenerated physics events: compare the latter, do not inject them twice. The existing replay helper requires `autoRestart:false` and a fall stop hook, or a dedicated equivalent. State what an incompatible replay can still display. Include an export/import round trip within the size cap for the maximum run.

**Related boundary clarification:** The hidden-topology test should compare canonical provider-facing state/questions, excluding transport run/attempt IDs and manifest hashes, since those legitimately differ across fixtures. The provider-facing bytes must not include the full fixture hash or global identity as model input. Preserve the same observed IDs and ordering seed during that test.

**Acceptance:** Timeline inspection displays saved options/observation even after projection code changes. Same-build replay compares every recorded boundary plus terminal state/events; one deliberately altered input fails verification. Empty, stopped, failed and capped recordings export/import predictably.

Disposition: **RESOLVED IN PLAN**. Revised §§5–6 add complete `DecisionFrame` snapshots, full ordered physics events, initial/boundary/final digests, an explicit tick convention, and replay that regenerates and compares physics events without injecting them. Incompatibility preserves read-only historical inspection. Export/import size and decoded-shape limits are bounded; the hidden-state test now checks actual model-facing bytes.

## Assessment of the remaining design

The same-observation DFS baseline, separately labeled controller assistance, forced moves without inference, no invented narration, and explicit failure attribution are sound. Keep the feasibility claim modest: nine Jev runs establish demonstration behavior, not superiority. The loop fixture needs deterministic graph-DFS cycle handling defined with a stack and visited identities; it should not become an omniscient route solver. Pausing/restarting/replaying and deferred human takeover form a coherent first scope when the tick and cancellation contracts above are resolved. No public release, Race integration or general AI framework is needed.

## Re-review

Re-read the revised plan after the author incorporated all four findings, then reviewed a second small revision correcting input-index wording, replay event injection ambiguity, initial-state acquisition, braking, and terminal precedence. All four findings are resolved at the **design-document level**; no material blocking contradiction remains in the reviewed local-pilot scope.

Final verdict: **READY FOR USER REVIEW AND SIGN-OFF**. This is execution-plan readiness, not implementation acceptance. No implementation, installation, credentials, paid inference, live gameplay, or deployment has been performed in this review. Provider schema/model/pricing confirmation and controller/visual/replay behavior still require the explicit post-approval gates in the plan. The 3.5–7 day range is a planning estimate whose primary uncertainty remains local controller reliability.

The author also clarified graph-DFS cycle handling and a bounded recording-limit outcome. Keep those constraints during implementation rather than silently widening policy, content or public-service scope.

**User approval remains PENDING. Stop before execution.**
