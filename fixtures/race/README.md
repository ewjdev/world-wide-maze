# Curated Race courses (new gameplay)

These are owned HTML pages captured with the same Playwright `capturePage` pipeline used by ordinary fixtures. No network assets, fonts, fabricated DOM rectangles, or synthetic screenshots are used. The capture recipe fixes Chromium viewport (1280×1200), DPR (1), locale, reduced motion, clock and localhost URL. A fresh browser/font installation may change screenshot pixels: that intentionally creates a new course identity rather than reusing older records.

Each directory contains source `index.html`, original `capture.json` and `texture.png`, an `authoring.json` mapping stable section IDs to measured centers and captured element IDs, the frozen `course.json`, solver trace/report, exact solver inputs, and Race reducer/replay evidence.

The current beta adds an explicit elevation-design pass after base extraction. See [elevation review](elevation-review/README.md) for the complete rebuild sequence and all fourteen 2D maps. Base commands below must be followed by `race-elevation-build.ts` before final verification.

Reproduce base geometry from owned HTML:

```sh
node scripts/race-capture.ts
pnpm biome format --write apps/web/public/race
pnpm --filter @wwm/fixture-capture exec tsx ../../scripts/race-verify.ts
```

Rebuild frozen captures without launching a browser:

```sh
node scripts/race-capture.ts --build-only
```

If a source, texture or setting changes, update `apps/web/src/race/courses.ts` with the resulting content-derived IDs. The loader rejects unrecognized assets. `course.json` is duplicated into the public directory for immutable browser loading; the test compares rebuilt geometry with the saved fixture. Do not overwrite a released course under an old identity.

The Race builder extracts screenshot/DOM terrain before selecting topology. It validates every authored section, every cardinal connector and interior approach with ball clearance, assigns heights along route progress, builds rails/mouths and ordered directional gates, and runs shared StageData validation. It never calls Original's maze DFS. Original source is unchanged. Explicit author order constrains these curated routes. The optional `routeStrategy: search` performs a deterministic bounded search through all curated islands, scoring verified interior travel, incoming/outgoing turn angle, reversal and narrow connections. It keeps the authored first/last section, stops after at most 4096 explored states, reports rejected interior approaches and budget exhaustion, and throws if no complete route is found. The shipped courses retain authored order so captured arrows agree with the generated route. Arbitrary-page guarantees remain outside scope.

| Course | Islands | Solver finish | Race gate finish | Falls / jumps |
| --- | ---: | ---: | ---: | ---: |
| Flow Sprint | 9 | see solver report | 2974 ticks / 24.783 s | 0 / 0 |
| Switchback | 9 | see solver report | 3006 ticks / 25.050 s | 0 / 0 |
| Longline | 8 | see solver report | 2561 ticks / 21.342 s | 0 / 0 |

Solver completion uses the ordinary goal sensor just beyond Race's independent finish plane, explaining the small time difference. For a Race replay, stop input consumption at the Race finish tick. `race-verify.ts` does exactly this and proves all sector/finish ticks again through `replayRace` in a second physics simulation.

Automated traversal is useful geometry/replay evidence; it does not establish human flow, race-speed comfort or physical-phone acceptance. These three earlier courses remain shorter introductory options after their straightaways were replaced with turns. They include ground bridges and turbo, with no required jumps. Island Leap is the separate short stunt course with three routes and a curved ground connector.

## Ten authored race mazes

Flow Delta through Redline Relay use the reviewed branching 2D graphs in each `maze.json`. Their builder is separate from the three original HTML-extraction fixtures above: it authors explicit island contours, directed flight links, ground connectors, gate planes and physical jump approach ramps, then captures its owned SVG/HTML as a texture. Source/spec/texture hashes are recorded in provenance. No arbitrary-webpage extraction guarantee is implied.

```sh
node scripts/race-maze-build.ts --slug flow-delta
node scripts/race-maze-verify.ts --slug flow-delta
node scripts/race-maze-catalog.ts
node scripts/race-maze-browser.ts --slug flow-delta --route route-0 --base-url http://127.0.0.1:5214
node scripts/race-maze-browser.ts --slug flow-delta --route route-2 --base-url http://127.0.0.1:5214
node scripts/race-maze-report.ts
```

Each maze owns `review.md`, per-route ordinary inputs and traces, exact-replay reports, and screenshots. `review.html` is the consolidated screenshot gallery; `maze-verification.json` is its identity-checked summary. The browser verifier compares final pose and complete checkpoint progress to the independent physics run and rejects stale course identities. It suppresses Vite HMR during a run so another course rebuild cannot reset the test.

Rail-free bridges are explicit. Curved/banked meshes share geometry with colliders; Sky Weave adds a verified crossing with four metres between deck tops. Physical ramp lips retain the existing automatic upward assist. Downhill and airborne travel reset partial charging but preserve stored turbo. Race elevation enables terrain momentum up to 48 m/s, with local ramp grades limited to 20° and sub-5° connectors limited to 4 m. Turbo now stacks without an inventory cap: each uninterrupted 360 ticks at the course cruise speed earns one charge, while grounded on level or uphill terrain, including turns. A fresh press spends one charge for an impulse; at the speed cap the charge is retained. These baseline maze runs bank charges but do not spend them. Timing is a scripted feasibility baseline, not a claim of optimal routes or practiced human times. Catch recovery, human difficulty and progressive risk require further playtesting as noted in each review.

## Straightaways, turbo stacks and lives

All fourteen courses are audited by `node scripts/race-maze-straights.ts`. A long straight exceeds three seconds at the course cruise speed (24m for the mazes and the three ground courses; 30m for Island Leap) before accumulating 20 degrees of heading change. The audit measures island approaches, real curved bridge sections, full jump spans, and authored catch returns. Shared spans are counted once. This is an authored-route check, not an exhaustive search for every possible player shortcut.

Each attempt starts with three lives and no turbos. A fall removes one stored turbo, floored at zero, and one life; recovery preserves the remaining stock. The fall/lost event pair charges the penalty once. Manual recovery uses the same penalty. At zero lives the attempt stops. Retry starts fresh; slowing down only clears progress toward the next charge, not existing inventory. Rules versions partition prior ghosts from the changed mechanics.

The HUD and phone controller show stored turbos, next-charge progress and lives. Use T / the Turbo button to spend a charge. Held buttons consume once per press. Reproduction:

```sh
node scripts/race-verify.ts
node scripts/race-stunt-verify.ts
node scripts/race-stunt-balance.ts
node scripts/race-maze-straights.ts
node scripts/race-maze-resets.ts
node scripts/race-maze-browser.ts --slug flow-sprint --base-url http://127.0.0.1:5214
```

Browser replays require the development server; production intentionally disables injected test inputs. `--quality low` is available for software-rendered test runs. Browser evidence compares full mechanics as well as progress and final pose; incomplete screenshots are never published as a passing run.

The inline SVGs in the captured source HTML are frozen texture fixtures, not shipped interactive UI. Their title lint rule is excluded narrowly in `biome.json` to preserve the recorded source hashes. Public course JSON is formatted for repository lint; verification compares parsed content with the frozen fixture.
