# Phase 26 — Island Leap route balance

Date: 2026-09-27 (America/Los_Angeles). Codex with parallel course, independent simulation-evaluation and browser-review agents. Existing isolated `codex/race-mode` worktree; starting commit `9796295`. User requested meaningful alternatives to an overly easy island skip and approved the recommended course rebalance. No deployment.

## Problem and evidence boundary

Phase 25 established deterministic ramp launches and whole-island clearance. It did not establish interesting route choices. Its recorded runs were 29.850 seconds on ground, 11.092 near and 10.375 far, but the ground policy imposed a 5 m/s target and never spent turbo. Those were feasibility traces, not fair optimal-time comparisons.

This iteration changes the course and the validation policy together. It uses real physics and bounded player inputs, with adaptive route steering shared by independent sensitivity evaluations. Timings remain policy-specific candidate lines; neither optimality nor human success rates are claimed.

## Review record

The course agent owns HTML capture, geometry and clean route replay evidence. A separate agent owns the imperfect-approach matrix, scrutinizes control-budget fairness and checks route outcomes. Browser review covers the actual changed course, repeated ghost play, keyboard steering, controls and mobile readiness. Final command outcomes and limitations are recorded after those checks.

The first revision kept six islands and made the routes competitive, but review found that its second hop used a flat assisted launch pad and it lacked the proposed lower catch route. The final geometry adds two real captured HTML islands: a raised second launch deck with a sloped approach, and a lower catch island linked back to the ground branch. This uses existing island levels and straight bridge geometry. Review also corrected the raised launch marker's vertical position and oriented ground/merge labels toward approaching players.

The far island is offset, both jumping branches must turn toward a common southward exit, and the finish is beyond the merge. Ground connectors are shorter and wider. The course retains deterministic arcade launch assistance; neither new ramp is claimed to simulate a passive ballistic takeoff without assistance. No generalized procedural race generator or shared-physics change is included.

## Frozen physics evidence

Final course ID: `26c62767177702939c8147f1f5915fc43a234511916c9bcc1c52e0afb7d0b83b`. A changed ID keeps old geometry's ghosts out of this revision without deleting stored history.

| Candidate route | Time | Launches / clean landings |
| --- | ---: | ---: |
| Ground | 13.633 s | 0 / 0 |
| Near | 13.900 s | 2 / 2 |
| Far | 12.983 s | 1 / 1 |
| Weak launch, lower catch and return | 21.842 s | 1 / 0 |

Recorded ball positions for every clean route and the recovery match a fresh replay at every tick; this route-specific check does not compare quaternion tracks. Far clears the near island with at least 3.838 m beneath the ball. The recovery physically touches island 7, returns to ground island 4, reaches merge island 5 and crosses the ordered finish without a fall, reset or teleport. Testing caught a real return-ramp seam collision: the high endpoint was inside the upper island, leaving a small vertical step at the entry. Moving the endpoint before the edge lets the flat apron meet the island at its full height.

The independent matrix covers **270 deterministic conditions** across 8/10/12 m/s controller targets, with equal input limits and turbo headroom on all routes. At the 10 m/s target, ground and near complete all 15 turbo-enabled conditions; far completes 14 and fails the reduced-thrust approach. At the 8 m/s target, the near candidate finishes in less time than the ground candidate. Both constant-forward-plus-turbo strategies fail to complete the turning exit. These finite, adaptive-controller tests do not establish human success rates or universal route dominance; the report records ambiguous/fallback landings separately.

Evidence and reproduction: `fixtures/race/island-leap/{race-validation,balance-validation,recovery-validation}.json`, consumed input/trace files, `scripts/race-stunt-verify.ts` and `scripts/race-stunt-balance.ts`. The balance report includes exact course-file and driving-policy hashes. Four new acceptance tests cover comparable clean routes, no-turbo alternatives, failure of constant-forward input, artifact freshness and physical recovery. Existing route tests independently verify the three clean paths.

## Verification and remaining gates

Focused course/route tests and four balance acceptance tests passed; workspace typecheck and the enabled production build passed. Browser and full-suite results follow below before handoff. The build's only warning was the existing large-chunk advisory.

Human fun, route discovery and physical-phone handling remain unverified. This is one authored course demonstrating competing route transitions, not a generalized race-maze generator or a proof that equally skilled players will choose every route equally often.

## Browser and independent review

All four dedicated browser checks passed on the frozen eight-island course: three normal routes with matching timings, stored ghost playback, simulated phone transport, actual keyboard charge/T/steering, mobile readiness, and a separate catch-and-return playthrough matching 2621 ticks with zero recorded recoveries. The prior six-island browser pass was intermediate evidence and is not used as final course validation.

The lead and independent reviewer inspected the final [second ramp](route-balance-review/second-ramp.png), [far exit](route-balance-review/far-exit.png), [catch island](route-balance-review/catch.png), [return ramp](route-balance-review/return-ramp.png), [mobile instructions](route-balance-review/mobile-ready.png) and [catalog map](route-balance-review/map.png). Independent disposition: **ship this experiment**, no blocking code or visual findings. Asset identity, source hashes and generated evidence were checked against the frozen course.

An intermediate combined browser pass timed out opening its mobile context; isolation passed, and the final mobile check passed after closing the unused desktop context. The local dev server also required restarting before final tests. The production catalog rendered and an isolated direct course request reached ready; its first catalogue-to-ready attempt timed out, so a separate production keyboard smoke is required after the full suite.

The first full suite found two 5-second UI-test timeouts and one stage-build timing-threshold failure while browser work overlapped, plus an overly broad build-story wording assertion triggered by a sentence comparing route speeds. The route sentence was rephrased without changing its meaning. The three affected UI/documentation test files passed together in isolation (22 tests). A full rerun without concurrent browser work still hit the Original-route cold-import timeout. Root Vitest concurrency is now bounded at four workers to reduce contention between browser, WASM and SSR suites while preserving all existing assertions and timeouts. The full check is repeated with that setting before handoff.

## Final check

`pnpm check` passed with the bounded worker pool: typecheck, lint, **101 test files and 1,265 tests passed; 41 tests skipped**. Test phase: 175.88 seconds. All four dedicated browser checks passed separately. Both Race-enabled and Race-disabled production builds succeeded. No deployment was performed.

The isolated production smoke at `http://127.0.0.1:5200` passed catalog → Island Leap → ready on the frozen eight-island identity. Actual ArrowUp earned the 360-tick charge, T consumed it, ArrowRight steered, and Escape paused. No injected movement hooks or JavaScript exceptions. The only failed network requests were `/api/t` telemetry returning 502 because the local preview has no telemetry backend; course assets loaded successfully. Browsers were closed and the local preview remains available.

The generated documentation corpus is refreshed after this final record; its freshness and build-story checks are rerun before commit.
