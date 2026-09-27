# Phase 29 — Elevation, momentum and Race turbo

Status: approved for implementation on 2026-09-27; plan committed before code changes. Prepared against Race branch `codex/race-mode`, baseline `0832b4c`. Existing Race work is in PR #17. Work in this checkout; preserve unrelated changes and the running preview.

## Goal

Make elevation a meaningful part of racing: descend to build momentum, choose how much speed to carry through turns and jumps, climb to trade speed for height, and spend earned turbo where it helps most. Course difficulty should come from controlling speed and choosing lines across varied islands, rather than adding long straight ramps or making one island skip the obvious route every time.

The finished experience should still support approximately 60-second practiced clean runs, personal ghosts, keyboard and phone controls, and distinct Original, Education and Race modes. Automated completion establishes feasibility; human play establishes whether the rhythm feels engaging.

## Requirements and proposed defaults

| Topic | Contract for execution |
| --- | --- |
| Elevation | Vary island heights to create connected climbs, descents, crests and recovery areas. Include different elevation patterns across all 14 Race courses. |
| Ramp limit | No drivable ramp exceeds 20° longitudinal pitch, measured locally rather than from endpoint average alone. Validate bank-induced surface gradients separately. |
| Shallow connectors | Ramps below 5° must be short. Proposed prototype maximum: 4 m of horizontal centerline arc length, or four current ball diameters. Flat bridge connectors also follow this limit; ordinary island surfaces do not. |
| Higher speed | User requested up to twice the current maximum. Proposed common Race ceiling: 48 m/s horizontal speed, based on the 24 m/s turbo cap used by most courses. Island Leap currently uses 26 m/s; normalize the new profile to 48 rather than silently giving it 52. Flat-ground turbo retains its existing impulse ceiling; only terrain momentum can exceed it. Carry excess momentum onto level ground with gradual damping, not an immediate speed reset. Calibrate this interpretation before course layout finalization. |
| Earning turbo | One charge for every uninterrupted three seconds of qualifying full-speed travel. Downhill travel cannot earn turbo. Inventory remains stackable. |
| Charge threshold | Keep the existing course-specific cruise threshold initially (usually 8 m/s, Island Leap 10 m/s). This is distinct from the proposed 48 m/s ceiling. Tune explicitly; do not make earning require 48 m/s. |
| Downhill transition | Proposed rule: reset partial charge when descending, retain stored charges, and allow spending stored turbo downhill. |
| Airborne travel | Proposed rule: airborne time cannot earn turbo and resets partial charge. This prevents launching off a descent from turning gravity speed into free charges. Existing explicit landing rewards remain a separate rule, not three-second charging. |
| Falling | Preserve the existing loss of one turbo and one life per fall, clamped at zero; preserve three starting lives and exhaustion behavior. |
| Course shape | Preserve at most one long straight per course, including all branches and recovery paths. Keep the existing audit's distance/heading definition; raising maximum speed must not loosen this rule. |
| Route choice | Keep a viable ground route and meaningful alternatives. A skip can be faster with a strong approach, but must not be both easiest and fastest across all tested entry conditions. |

Execution defaults adopted following plan review: 4 m shallow connectors, 48 m/s horizontal ceiling, reset partial charge downhill and airborne. Keep existing landing rewards and stored-turbo spending. Record calibration-driven refinements in the implementation report. No rollback infrastructure or historical archive UI is required for this beta. Preserve stored data where practical; incompatible ghosts are excluded, and old attempts are not promised to remain visible.

## Current implementation constraints

- `packages/schema/src/constants.ts` and `validate.ts` enforce a shared slope limit near 10°. Existing validation uses average bridge grade. Introduce an explicit, trusted Race validation policy without raising the limit for Original or Education.
- `packages/schema/src/bridge-surface.ts` shares curved, banked bridge sections between rendering and collision geometry, but interpolates elevation linearly. Elevation transitions must use the same surface definition in both consumers.
- `packages/physics/src/simulation.ts` uses shared gravity/input and damping behavior. The ball state exposes grounded status, but Race needs reliable information about the supporting surface and direction of travel. A global damping change would affect other game modes.
- `packages/race/src/simulation.ts` caps boost impulses, not all physical motion. Charging currently checks speed without excluding downhill or airborne travel. A speed-cap edit alone will not produce the intended downhill behavior.
- `packages/race/src/attempt.ts` fingerprints default physics parameters. A Race-specific profile must be represented in compatibility and used identically by live sessions and replay.
- Existing builders, route drivers, straight audits, browser capture and replay verification provide a starting point. Existing recordings cease to be comparable when geometry or physics changes.

## Architecture decisions and non-goals

- Add optional `Bridge.elevationProfile: 'smoothstep'` to TypeScript and Zod contracts. For normalized horizontal arc distance u, use h(u) = hA + (hB - hA) * (3u² - 2u³). Absence keeps the original linear surface. Max centerline grade is 1.5 * abs(deltaH) / arcLength. Validate actual tessellated deck triangles including banking, and analytic centerline maximum. All renderer/collider/heightfield branches select shared geometry when this field is present, even for straight unbanked ramps. Round-trip JSON through parseStage before geometry tests.
- Add an optional trusted `RaceCourse.physicsProfile: 'elevation-v1'` discriminator, validated at the course boundary. Unknown values fail. The profile selects Race-only physics options and rules; it is not an arbitrary parameters object supplied by a course. Original and Education defaults stay unchanged. Course IDs hash profile and geometry. One compatibility factory resolves both rules and physics for live sessions and replay.
- Surface support is deterministic actual-contact data, with upward normal and stable surface identity. Downhill is the signed grade along horizontal travel; airborne support is null. Ignore walls as support, resolve multiple contacts deterministically, and document the numerical deadband.
- Calibrate terrain-only drag changes and momentum retention first. Full-speed charging keeps existing cruise thresholds. Turbo must not reduce existing downhill overspeed or consume a charge when its impulse cannot help.
- Keep data/schema validation for previous recording formats, but exclude incompatible histories from current-course comparisons. No archive browser, migration project, deployment, multiplayer, global physics retuning, or rollback feature is in scope.
- The existing PR #17 remains the review vehicle if still open. User authorized plan commit, implementation, progress screenshots, final review and PR delivery. Map and prototype checkpoints are progress artifacts and internal acceptance gates during this authorized execution, not additional permission stops.

## Stage 1 — Fix definitions and create the 2D prototype

Deliverables: a mechanics contract, calibration evidence, and one proposed elevation course shown as an overhead 2D map plus a side elevation profile. Implement the minimal Stage 2 foundation and run Stage 3 calibration before finalizing this map. Measure attainable descent speed, braking distance and crest contact loss; use those measurements to choose ramp runs and exit radii. Keep the existing playable catalog available during this work.

1. Select one representative forked course with a ground line, an optional island-clear jump, an uphill section and a controlled downhill exit. Create a separate prototype identity.
2. Annotate every island height, ramp run, height difference, maximum local angle, width, gap, jump landing, checkpoint and route merge. Show expected speed ranges and where charging is eligible. Label predictions as estimates until simulation proves them.
3. Sketch a rhythm of climb → crest → descent → controlled turn → optional jump → recovery island. Include enough curves and recovery space to retain the existing straight limit.
4. Solve connected island heights consistently: shared islands must have one height, and each edge must satisfy its length/angle constraints. For a linear ramp, `angle = atan(abs(height difference) / horizontal arc length)`; for a smoothed profile, validate its derivative throughout.
5. Define slope rounding and tolerances. Exactly 5° belongs to the normal ramp category; less than 5° uses the short-connector limit. Exactly 20° is allowed; anything above it is rejected beyond numerical tolerance.
6. Define transition easing explicitly. Brief near-flat portions at the ends of a qualifying ramp may blend into an island, but cannot hide a long shallow connector. Bound their length and validate local pitch. Account for the extra run needed when easing reduces the usable steep section.
7. Check the downhill exit has enough width, turn radius and braking distance for its predicted arrival speed. Required uphill sections must be restartable without stored turbo, or provide a reachable recovery route that cannot trap a player.

Acceptance: the map is internally consistent, has no more than one audited long straight, and clearly shows how both routes reach ordered gates. Share the 2D map/profile as a progress screenshot before building the integrated prototype, then continue under the user's execution authorization. Required calibration comes before final layout acceptance.

## Stage 2 — Build the shared technical foundation

After the mechanics contract is fixed (before final Stage 1 layout acceptance), the following workstreams can run in parallel with explicit ownership. Integration must use one agreed surface-state and physics-profile contract.

### A. Ramp geometry and validation

Primary files: `packages/schema/src/bridge-surface.ts`, `validate.ts`, relevant schema types, and geometry consumers in `packages/physics` and `packages/engine`.

- Add the minimal elevation-profile representation needed for smooth entry/exit. Preserve existing bridge output when the new profile is absent.
- Resolve one shared surface for rendering, collision, camera support and validation. Measure maximum local pitch and crossfall, including bank transitions and edge paths; prevent banking from introducing unvalidated steep regions.
- Add an explicit Race policy at every validation/loading entry point. Do not infer relaxed limits from arbitrary metadata or change the default global limit.
- Reject long shallow connectors, excessive local grades, invalid endpoints and unsupported profiles with actionable diagnostics.
- Preserve layered-course behavior: overhead structures must not become the selected floor or camera support for a ball beneath them.

### B. Race physics and support information

Primary files: `packages/physics/src/simulation.ts`, `params.ts`, physics public types and supporting tests.

- Expose deterministic supporting-surface identity and normal/gradient from actual contact. Define stable selection across multiple contacts and seams. Reuse this contact data for the Race slope classifier.
- Compute travel grade along horizontal velocity over the supporting surface. Reverse travel on a ramp reverses uphill/downhill classification. Camera heading and world vertical velocity are not substitutes for travel direction and surface slope.
- Define a small numerical deadband and contact stabilization tolerance in the contract. Test shallow descents outside that tolerance; a gameplay-wide exemption for ramps below 5° would violate the charging rule.
- Add a Race-only physics profile for damping, gravity-driven acceleration and the horizontal speed ceiling. Keep Original/Education default behavior unchanged.
- Apply the ceiling consistently after boosts and physics steps. Preserve vertical launch/fall velocity. Decide and document how existing landing rewards interact with the ceiling.
- Demonstrate legitimate downhill acceleration into the higher speed range. Retain useful braking and steering, controllable transitions, and sufficient uphill ability. Do not use state injection as evidence of a playable run.
- Verify continuous collision detection, narrow bridge contacts and high-speed gate crossings at the existing 120 Hz step. Fix missed crossings with swept checks where necessary rather than changing replay timing ad hoc.

### C. Race rules, replay and HUD

Primary files: `packages/race/src/simulation.ts`, `attempt.ts`, `replay.ts`, `recording.ts`, `types.ts`, and `apps/web/src/race`.

- Implement an explicit charging predicate: active run, grounded, sufficient horizontal speed, not descending, not recovering or exhausted. Evaluate support state before awarding a charge on that tick.
- At 120 Hz, award one charge at each 360 qualifying ticks and start the next interval. Reset partial progress on a disqualifying tick under the proposed rules. Preserve stored charges and single-press spending behavior.
- Keep landing rewards distinct in state and player guidance. A downward flight cannot accrue timed charges; an existing earned landing reward must not be mistaken for downhill charging.
- Show stock, partial progress, lives and a concise reason such as “Downhill · no charge” or “Airborne · no charge.” Do not say “paused” if progress resets.
- Version the new Race rules and geometry identities. Fingerprint the actual resolved physics profile, not `DEFAULT_PARAMS`, throughout session creation, saving, workers and replay.
- Preserve existing records without building an archive UI, while excluding incompatible ghosts from current comparisons. Update recording validation to recognize historical rules versions explicitly; a new current-version constant must not invalidate old saved attempts accidentally.

Integration exit: all workstreams pass focused tests using the same contact, profile and charging definitions. No new course ships with mixed old/new replay rules.

## Stage 3 — Prove the mechanics on calibration tracks

Build small deterministic fixtures before tuning a full course. Tests should catch failures of the intended behavior, not merely mirror implementation branches.

| Test group | Required evidence |
| --- | --- |
| Geometry limits | Valid 0°, 4.9°, 5°, 12° and 20° examples; reject 20.1°. Accept short shallow connectors and reject long ones. Cover curved, eased and banked ramps whose average grade hides a local violation. |
| Mode isolation | Race accepts its intended geometry/profile; Original/Education retain their previous validation and physics behavior. |
| Direction | The same ramp blocks charging downhill and permits it uphill at qualifying speed. Cover side-to-side motion, reversing, seams, overlapping levels and near-zero motion. |
| Charge boundary | Enter downhill at 359/360 ticks: no award, partial progress resets, stock remains. Repeated downhill travel never earns timed charges. Resume level qualifying travel and earn only after a fresh 360 ticks. |
| Air and spending | No timed charge during jumps/falls under the proposed policy; stored turbo still spends where allowed. Preserve landing reward validation and prevent repeat reward farming. |
| Penalties | One fall removes exactly one life and one stored turbo, without duplicate contact/event penalties or negative inventory. Exhausted runs remain stopped. |
| Speed | Ordinary input on a descent can exceed the old boost cap and approach the proposed ceiling. No sustained horizontal overspeed; no clipping of vertical jump velocity; no tunneling through ramps or gates. |
| Climbing and recovery | Restart from representative uphill positions with no turbo. Reach the intended route or a valid recovery path without a soft lock. |
| Replay | Record and replay acceleration, turbo awards/spending, jumps and recovery. Match final pose, gate progression and complete mechanics state. Reject incompatible ghosts. |

Record observed acceleration, braking distance, turn tolerance and minimum crest curvature that maintains contact at the intended approach speed. Treat unintended crest launches separately from authored jumps. Check a descent-to-flat-to-uphill sequence for gradual momentum carry and decay. If 48 m/s cannot be controlled on credible course dimensions, report the evidence and adjust the layout/profile through the prototype instead of claiming the target is satisfied by an unreachable cap.

## Stage 4 — Playable prototype and balance review

Build the approved 2D proposal in 3D using the validated foundation. Tune this one course before applying elevation patterns everywhere.

1. Drive each intended route using ordinary bounded controls. Record clean completion, entry/exit speed, charge inventory, jumps, landings and gate progression; independently replay the results.
2. Compare routes with equal starting conditions and comparable control effort. Test zero/one/multiple stored charges, slower approaches, heading errors and imperfect landings. Include the turn after a merge when comparing a jump to the ground route.
3. Require a clean practiced candidate route near 60 seconds; initial acceptance band is 50–70 seconds. Show alternative route times separately. Scripted completion does not establish a human practiced time.
4. Reject a shortcut that is both faster and more forgiving across every tested entry condition. Also reject layouts that effectively require saving turbo for an unavoidable hill, or constant-forward-plus-turbo can finish without meaningful steering.
5. Capture the 2D map/profile and browser screenshots at climb, crest, descent, jump, landing and finish. Review camera visibility, speed readability and live HUD changes. Include a short recorded run if available because screenshots cannot demonstrate acceleration or control feel.
6. Verify keyboard and phone-layout behavior in-browser. Explicitly leave physical-phone feel and human flow-state assessment for hands-on review.

Acceptance: no unresolved critical geometry, collision, charge or replay failures; the evidence identifies useful route tradeoffs; share prototype screenshots and test evidence before catalog-wide conversion; continue with validated defaults under the execution authorization, and mark human feel assessment pending final user review.

## Stage 5 — Convert and verify all 14 courses

Proceed after the technical prototype review resolves the speed interpretation, charging defaults and controllability. Human handling feedback remains part of final beta review.

- Prepare 2D maps and elevation profiles for all courses first. Use varied patterns: rolling terraces, climb-first loops, descending switchbacks, ridge traverses, short steep transfers and controlled jump descents. Assign difficulty through width, curvature, landing alignment and recovery options, not simply greater height.
- Keep heights consistent at forks/merges, preserve purposeful alternative routes and at least one reachable ground route, and avoid making every optional jump the easiest finish.
- Partition course files among implementers only after the shared builder contract is stable. One owner handles shared generator changes; course owners should not independently edit shared physics.
- Rebuild course identities and assets. Re-run the all-14 straight audit, slope/connector validation, layered reset checks, route proofs and independent replays. Reuse the current coverage inventory as a minimum baseline and add proofs for new routes/features rather than silently dropping difficult ones.
- Re-capture ready, representative feature and finish screenshots for each changed course. Update the catalog report with route times, speed ranges, charge eligibility, failures and evidence links.
- Do not bulk-regenerate immutable historical recordings as if they were still the same course. Keep old records identified as old; no archive UI or rollback mechanism is required.

## Final verification and delivery

- Run focused tests throughout development, then `pnpm check`, the Race-enabled production build, applicable browser acceptance, straight audits and course verification against the final integrated state.
- Update gameplay instructions, contracts, build log and review artifacts. Run `pnpm docent:index` when indexed documentation changes, then `pnpm docent:index --check`.
- Independently review the final diff for accidental changes to Original/Education, mixed physics profiles, broken old history and unsupported claims of human playability.
- Deliver the playable local URL, 2D/elevation artifacts, per-course evidence report, screenshots and known limitations. Separate simulated passes, browser observations and hands-on playtest results.
- Commit/push and update PR #17 for the authorized implementation. Check its current state first; do not assume it is still open. This plan does not authorize merging or deployment.

## Sequence and stop conditions

`Mechanics contract → minimal geometry / physics / rules foundation → calibration → informed 2D prototype → integrated prototype → technical review and progress screenshots → 14-course conversion → full verification → user PR/play review`

Stop progression to the next stage for incorrect downhill charging, mismatched render/collision surfaces, a ramp above the angle limit, non-replayable behavior, unavoidable uphill soft locks, unmanageable high-speed exits, or a dominant effortless shortcut. Resolve these on the prototype before multiplying them across the catalog. Numerical tests and screenshots alone cannot close the human handling/flow review.
