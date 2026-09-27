# Phase 26 — Competing Island Leap routes

User-approved refinement of Phase 25. The first layout proved jumps and replay, but its straight launch-to-finish route and long ground detour made the choice uninteresting. Work stays in the existing `codex/race-mode` worktree, based on `9796295`; no deployment is requested.

Implementation: eight captured islands, two rising launch ramps, an offset far landing, a shorter ground route, a shared southward exit, and a lower catch-and-return path. Clean candidate times span 12.983–13.900 seconds; caught recovery takes 21.842 seconds. Exact position replay and a finite 270-condition input sensitivity matrix are recorded in [the build log](../docs/build-log/phase-26-race-route-balance.md). Human flow and physical-phone review remain open.

## Outcome

Rebalance this one authored course before extending procedural generation. A player's approach speed, heading, turbo availability and landing exit should affect the useful route. Ground flow, short island hops and a whole-island skip must all have a credible purpose. A fixed time trial may still have a fastest expert line; do not claim universal equality or human flow from simulated runs.

## Scope and ownership

- Course agent: captured HTML, builder geometry, course/texture assets, common route driving policy, clean-run fixtures and course tests. Shorten the ground detour, offset the far landing, and put a substantial shared turn between the merge and finish. Try a second small hop and a lower catch path where actual collision geometry permits.
- Validation agent: independent deterministic balance harness and report. Reuse a comparable adaptive route driver; change actual input, never physical state. Compare ordinary and disturbed approaches, turbo availability/timing and route completion.
- Browser agent: stunt browser acceptance and screenshots, adapting obsolete fixed tick/count assumptions to independently generated reports. Inspect the actual course, keyboard controls, mobile instructions and replay.
- Lead: player guidance, coordination, review, plans/build log, final repository checks and commit. Existing mechanics and shared schema are unchanged unless an explicit contract issue is found and approved locally.

## Evidence required

1. Every intended route completes ordered gates without falls and replays exactly.
2. Whole-island clearance is measured using the ball bottom, not only its center.
3. Fair route drivers use comparable speed/control budgets and make useful turbo available on every route. Report their limits; they are candidate lines, not proven world records.
4. Evaluate perturbations through normal steering/turbo input with adaptive corrections. Record finish time, failures and landing outcomes. Demonstrate why an imperfect approach can make a different route useful, or state when the evidence does not establish this.
5. Constant forward plus turbo must not finish automatically.
6. Review the revised landing/exit scene, map and instructions in the browser. Existing history remains course-ID scoped; changed geometry must get a new identity rather than reuse old ghosts.
7. Run `pnpm check`, production build and relevant browser acceptance; document the human playtest and physical-phone limitations.

## Future generator contract

A later generalized race generator should produce connected forks and merges and validate route transitions as `entry speed + heading + turbo → exit speed + heading + turbo`. Compare complete sections including the next turn, and reject routes dominated in time and tolerance across tested entry states. This iteration implements and evaluates one authored example, not that general generator.
