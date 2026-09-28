# Phase 29 — terrain-driven Race elevation

Race now uses island height as a driving mechanic. All fourteen courses contain climbs and descents, with shared smooth ramp geometry for rendering, collision and camera height sampling. Local deck gradients—including banking and inside-turn effects—stay within 20°. Connectors whose mean grade is below 5° are limited to 4m. Each course retains at most one long authored straight.

A trusted `elevation-v1` profile changes only Race physics. Descents build momentum toward a 48m/s horizontal ceiling; excess speed carries onto level ground and decays gradually. Flat-ground turbo keeps its previous impulse ceiling. Uphill tuning permits restarting without a stored turbo. Original and Education retain their default physics and validation policy.

Turbo charges after 360 uninterrupted qualifying grounded ticks at the course cruise threshold (usually 8m/s; Island Leap 10m/s). Descending or becoming airborne resets partial progress. Stored turbo remains available, including downhill, and a boost that cannot increase speed does not consume inventory. Falling still removes one turbo and one of three lives. The desktop and phone HUD explain charging state and display speed.

## Implementation decisions

- A bridge's optional `smoothstep` elevation profile eases its entry and exit over horizontal arc distance. The shared schema validates analytic grade and actual deck triangles. Authored geometry has a strict 20° limit; Float32 collider rounding has a separately documented 0.01° allowance.
- Actual contact normals identify uphill/downhill along the direction of travel. At seams, support selection rejects separating contacts and selects the contact carrying the ball by impulse, depth, normal and stable handle. This fixes false airborne classifications without permitting airborne charging.
- The horizontal ceiling preserves surface-normal velocity when grounded and vertical velocity while airborne. The complete trusted physics profile, course geometry and rules version participate in replay compatibility. Incompatible old ghosts are excluded; this beta adds no archive or rollback workflow.
- Skipping Stones needed separated ramp mouths and a wider merge island after real runs exposed overlapping colliders. Overlapping landing platforms now share a height with a 3.9m connector.
- The three introductory ground courses retain their single existing straight and use short level connectors there to provide a continuous charging section. Hairpin Terraces and Twin Canyons include separate ordinary-input charging proofs because the conservative full-course driver brakes too frequently to earn a charge.

## Evidence and review

The plan was revised and committed as `913da6f` before implementation. [All fourteen 2D maps and elevation profiles](../../fixtures/race/elevation-review/index.html) preceded integrated course acceptance. [The course gallery](../../fixtures/race/review.html) contains final browser captures; [geometry audit](../../fixtures/race/elevation-validation.json) records every ramp. The [calibration report](../../fixtures/race/elevation-calibration.json) and per-course input/replay reports provide reproducible evidence.

Calibration uses ordinary bounded inputs rather than injected poses or velocities. A keyboard-driven 120m descent reaches 45.92m/s, exits at 43.36m/s and retains 38.11m/s after 10m of level ground. Maximum phone tilt reaches the 48m/s cap. Braking from high speed to below 1m/s takes about 25.48m in the calibration scenario. A 20° uphill section can be restarted, reversed and resumed without turbo. These isolated measurements establish the physics envelope; they do not claim every authored course reaches maximum speed.

- All 50 authored routes across fourteen courses finish with no falls and exact independent replay. Browser replay covers 29 runs and 121 course screenshots, with identical checkpoint/mechanics state and zero final position error. Every accepted report matches the current course and complete physics/rules fingerprint.
- All fourteen geometry and straightaway audits pass: 318 connectors, maximum local grade 19.593°, and all six shallow connectors at most 3.9m. All 337 restart points resolve to the intended surface height. Separate ordinary-input proofs demonstrate timed turbo earning on the three introductory ground courses, Hairpin Terraces and Twin Canyons.
- Ten browser acceptance tests pass; one optional test is skipped. Coverage includes downhill reset, grounded charge resumption, narrow HUD, simulated phone controls, falls/exhaustion, retry, pause and personal shadows. The phone transport/sensors are simulated, not a physical-device acceptance test.
- Repository typecheck and lint pass (one existing warning and one informational lint finding). The full regression run reports 1,432 passed, 43 skipped and one intermittent Original-mode portal re-entry failure: a polling assertion missed the portal crossing. The entire portal suite then passes independently, 3/3, without source changes. All Race tests pass. Race-enabled production build and docent index validation succeed.
- A 270-case Island Leap approach/balance matrix and catch-return traversal were regenerated. It preserves a clean ground option and distinct jump approaches; it does not establish an optimal human racing strategy.

[Final HUD and acceptance screenshots](../../fixtures/race/elevation-review/acceptance) supplement the per-course gallery. Review found and repaired false airborne support at seams, overlapping Skipping Stones ramp colliders, insufficient introductory charging corridors, and stale test setup that omitted the new profile or elevation authoring pass.

## Beta review limits

Automated driving establishes traversal, deterministic replay and visible rendering. It does not establish human flow, optimal route choice or physical-phone handling. Most ten-maze reference routes take about a minute; Sky Weave remains roughly 77–79 seconds and one Skipping Stones route is about 73 seconds. The four earlier courses remain short introductions (about 13–25 seconds). Higher-speed racing and aggressive turbo strategies need beta playtesting; the conservative completion driver does not spend turbo on most maze routes.

Static validation does not exhaustively detect bridge-to-bridge intersections. Actual traversal caught and resolved the observed Skipping Stones overlap; future junction edits still require collision and browser verification.

The original HTML and maze specifications remain base authoring inputs. The explicit elevation design pass produces the current playable courses; run it after rebuilding base fixtures. Reproduction commands and the distinction between frozen course identity and physics compatibility are documented in [the elevation review README](../../fixtures/race/elevation-review/README.md). This work is local and has not been deployed.
