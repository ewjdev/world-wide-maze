# Phase 25 — Island jumps and earned turbo

Status: implemented experiment; browser/regression review recorded in `docs/build-log/phase-25-race-jumps.md`. Builds on committed Race baseline `50a1fc4` in the same isolated branch. No deployment authorized or performed.

## Accepted direction

The user wants more difficult Race courses with smaller ramps, exposed edges, speed rewards, and ramps that launch the ball far enough to clear whole islands. The chosen first experiment combines one stored player-triggered turbo with automatic designated-ramp launches and modest clean-landing bursts. This is a Race extension; Original, Education and baseline Race courses retain their handling and compatible history.

## Playable scope

One actual HTML-captured six-island course, **Island Leap**, has a long runway, a rising launch ramp, nearer receiving island, farther receiving island, and a continuous safe route through two lower islands. The safe route uses narrow ramps. The airborne corridor and receiving approaches have no rails. A checkpoint before the route choice and another after the merge allow all three valid routes; the skipped island is not mandatory.

A normal launch reaches the near island. Saving turbo for the lip lets the ball clear that island and land on the far island. The existing jump button remains available, but no jump press is needed for a launch-ramp crossing. A deterministic upward assist at the marked ramp lip makes this an explicit arcade mechanic. Rendered ramp geometry itself remains an ordinary validated incline (1.5 m rise over 10 m); no curved geometry or new general collision representation is claimed.

## Rules and inputs

- Three seconds (360 physics ticks) of grounded forward progress near the course's cruising threshold earns one stored turbo. Backtracking and circular motion cannot farm progress; airborne time does not charge. Hard bumps clear unearned charge. Falls/recovery clear charge and airborne reward provenance.
- Keyboard **T**, the on-screen Turbo control, or the phone Turbo button requests activation. Phone keeps both existing POWER and JUMP controls. A request is consumed at a physics input tick and recorded exactly.
- Turbo adds a bounded forward velocity impulse, capped by course tuning. It does not stack continuously; a stopped/already-capped no-op preserves the charge. The first course uses a 12 m/s increment with a 26 m/s cap. This is experimental tuning, not a universal default.
- Launch requires a forward crossing at sufficient speed near the lip, with recent ground contact. A pad can award one launch per attempt.
- A valid first landing after meaningful airtime/forward travel on a different allowed island adds 1.5 m/s, capped. Backwards/side impacts, hard collisions, bridge contacts and repeated same-island hopping do not earn the reward.
- Existing control and ball physics are reused; no additional air steering is added.

## Contracts and isolation

`@wwm/race` owns the optional stunt configuration, runtime wrapper and v2 input recording. Both browser play and ghost replay use the same `createRaceSimulation` path. Old courses use their existing rules and v1 recordings. New course identity hashes geometry, all tuning, gates, authored source and texture. Runtime limits and cancellation remain unchanged.

Shared contract 0.3.4 adds optional stunt capability, turbo request and boost HUD state. New hosts require a compatible calibrated phone for stunt courses, with refresh/keyboard fallback. The relay remains payload-agnostic. `RapierSimulation.applyVelocityDelta` is additive and preserves angular/contact state; original physics version remains unchanged because its normal path is unchanged.

## Validation and handoff

Require each safe/near/far route to complete in actual physics, prove which island receives the first landing, measure full-ball clearance above the skipped island, and replay the full pose track exactly. Browser acceptance must verify earned charge, actual keyboard/button/phone inputs, persisted v2 recording, ghost replay, mobile HUD and visible landing targets. Run the full existing suite and both enabled/disabled production builds; inspect airborne screenshots before handoff.

Remaining human questions: Is turbo timing understandable? Can players anticipate near versus far landing? Is the wider safe route forgiving enough? Do the landing burst and quick retry encourage another attempt? The traces establish feasibility, not subjective flow or physical phone acceptance.

Next iteration is tuning this course from play, not adding every proposed reward at once. Corner bonuses, precision strips, richer momentum chains, chained jumps, multiple stunt courses, curved ramps and banking remain future work.
