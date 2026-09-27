# Jev website maze score runs

User request: select an existing website maze, watch Jev play live, collect gems, and chase a high score. The user selected the existing website library as the first source.

## Behavior

- The spectator loads the same six captured websites and practice stage as the main game. Multi-section websites expose a section selector. Hacker News is the default (34 islands, 237 gems).
- Jev chooses among up to seven reachable gem targets and the goal. The whole board is visible in this mode. A deterministic local route planner proposes targets and estimates travel time; Jev chooses the next target; the physics controller steers that route. It does not ask Jev to generate per-frame controls or expose private model reasoning.
- Actual physics pickup events award one point per small gem and 100 per large gem. Reaching the goal awards five points per rounded remaining second, matching the game scoring function. The scoreboard shows current points, pickups, remaining time, and the best completed local Jev run for the exact stage hash.
- This is a one-ball challenge: a fall, timeout, or stuck controller ends the run. The simulation clock pauses for model decisions, durable saves, manual pause, and hidden tabs. Scores are local to this spectator; nothing is submitted to the public leaderboard.
- Each run persists a validated stage snapshot, compressed website texture, exact observations/options/receipts, all physics inputs, pickups, movement outcomes, and terminal status. Replay uses the saved stage and verifies checksums/events. Seeking restores collected gems and elevator positions before applying recorded events.
- Existing authored runs and recordings continue to use their original local-exploration contract. Website runs use a distinct visible score-target observation. The existing provider budget and credential boundary remain in force.

## Verification

- All six website captures, every section: deterministic score baseline reaches the goal with actual gem pickups.
- Session integration: a website run finishes, persisted score equals live score, replay reproduces the exact ball state, pickups and finish bonus, seeking to the beginning clears replay score, modified stage snapshots are rejected.
- Live provider and browser verification results are recorded below after the run completes.

## Scope

The selector uses the existing offline website library first, as requested. New URL capture is not part of this increment. Model strategy remains an experiment; a completed run does not establish an optimal score or guarantee every target choice succeeds.

## Live evidence

Run `3d1c1c6c-90b7-4c46-9978-d6c5568554ae`, model `jev-1.13.0`, Hacker News: finished after 9,771 simulation ticks (81.425 seconds); three provider decisions; 19 collected gems including two large; 217 gem points + 1,095 finish bonus = 1,312. The model chose `gem-0`, then `gem-43`, then `finish`. Browser reported no application errors; recorded playback opened successfully. Mobile viewport width 390 had no horizontal overflow.

Screenshots: `docs/build-log/assets/jev/library-desktop.png`, `library-live.png`, `library-history.png`, `library-mobile.png`, `library-mobile-history.png`. Run evidence and credentials remain in the ignored local archive and environment file, respectively.

Final validation: all 25 focused maze-agent/runtime tests passed; repository type checking and lint passed (lint warnings remain); production web build passed (existing bundle-size warning). Browser replay seek at decision three restored 213 points, 15 gems including two large, 259 seconds remaining, and the 1,312 local Jev record with no replay errors. Library selection also loaded MDN section two successfully at 390px width with no overflow.

Fresh independent UI finish review disposition: **ship**. No material fixes. The named Impeccable reviewer role was unavailable, so a fresh general agent performed the review using the supplied finishing-review contract, source files and screenshots. Incumbent type/material fidelity and mobile controls were retained; no new design system was introduced.

## Animated controller display

The spectator now displays an animated arrow-key cluster and spacebar with the current target. Arrow highlights project the real analog input into the current camera frame, including diagonal combinations, with a small deadzone for noise. Press/release uses 100 ms transitions; reduced-motion mode retains highlights without transforms. Pause, run end, stage changes, and replay seek release the displayed inputs. Replay uses its recorded inputs and a target derived from the playback tick, independently of the notebook's selected decision.

The current controller issues no jumps, so the spacebar remains idle and the UI explicitly says jumping is off. The display supports actual jump input pulses but does not invent them or alter the controller's policy. On mobile the input strip sits beneath the maze to avoid covering the ball.

Validation: camera-frame/deadzone/diagonal and jump-pulse/paused display tests passed, along with both session/replay integration tests. Browser smoke verified live steering, pause release, real Jev recording target/inputs, mobile overflow, and reduced-motion styles. Type checking and web build passed.
