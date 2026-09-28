# Phase 28 — fewer straights, stacked turbos and lives

The straightaway limit applies to all fourteen Race courses. The ten maze layouts now use more curved connectors, compact launch and landing platforms, offset approaches, and bending catch-return paths. The three earlier ground courses were recaptured from revised HTML; Island Leap gained a curved ground-return connector. Each course retains at most one long authored straight.

The repeatable audit defines a long straight as more than three seconds at the course cruise speed before accumulating 20 degrees of heading change. It measures actual curved bridge sections, island-centre approaches, full jump spans and authored catch returns. Shared spans count once. The threshold is 24m for thirteen courses and 30m for Island Leap. This checks authored routes, not all conceivable player shortcuts.

Race now banks one turbo for every uninterrupted 360 ticks at qualifying speed, including turns and flight. Inventory has no cap and survives slowing down. A fresh press spends one charge, including while airborne or stationary; holding the button consumes only once. A boost at the velocity cap preserves the charge. The progress meter restarts after each earned charge and resets when speed drops below the threshold.

Attempts start with three lives and no turbos. A fall removes one turbo, floored at zero, and one life. A fall followed by the physics lost event is one penalty. Manual recovery takes the same penalty. Recovery retains the remaining inventory and lives; retry creates a fresh attempt. Zero lives stops the attempt, saves it as abandoned, and presents retry/course navigation. Replay rules apply matching penalties, reject fabricated fall-recovery events, and use new compatibility versions to isolate older ghosts.

The desktop HUD and phone controller show inventory, next-charge progress and lives. Instructions distinguish the three ground courses from jump courses. Original and Education gameplay remain separate.

## Verification

- The 421-test affected regression suite passed, followed by fourteen final course artifact/audit checks; six affected packages typecheck successfully. Race-enabled production build succeeds.
- All 50 authored routes have real 120 Hz Rapier traversal and an independent replay. The 25 course browser runs produced 105 screenshots, with visual review of every course. The screenshot gallery checks final course identities before accepting browser evidence. Browser runs compare full mechanics, checkpoint progress and final pose, not merely a finish screen.
- All nine browser acceptance tests pass, covering turbo controls, falls/exhaustion, retry, stored personal shadows, pause, and desktop/narrow layout. The phone check simulates transport/sensors; it is not physical-device acceptance.
- Screenshot review found overlapping branch connectors in Flow Delta and Hairpin Terraces. Their local approach geometry was corrected and the resulting courses reverified.
- Software-rendered browser concurrency caused capture timeouts. Final runs use bounded longer waits and fewer simultaneous renderers; partial screenshots are withheld from passing evidence.
- An independent code review found no actionable defects in turbo charging/spending, fall deductions, recovery, exhaustion, or replay parity.

See the identity-checked [course evidence](../../fixtures/race/maze-verification.json), [screenshot gallery](../../fixtures/race/review.html), and individual course reviews. `fixtures/race/README.md` contains reproduction commands. This work is local; no deployment is implied.

## Remaining tuning limits

The ten new mazes generally run around a minute with the reference controller, but Sky Weave remains 76–79 seconds. The three introductory ground courses run about 28–33 seconds, and Island Leap about 13–14 seconds. These are scripted feasibility times, not measured practiced human times. Turbo strategy, route balance under aggressive boosts, and most missed-jump catches still need human playtesting. Ground alternatives often bank more turbos than jump-heavy paths; that creates a useful route tradeoff but does not prove balanced fastest times.
