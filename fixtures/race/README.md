# Curated Race courses (new gameplay)

These are owned HTML pages captured with the same Playwright `capturePage` pipeline used by ordinary fixtures. No network assets, fonts, fabricated DOM rectangles, or synthetic screenshots are used. The capture recipe fixes Chromium viewport (1280×1200), DPR (1), locale, reduced motion, clock and localhost URL. A fresh browser/font installation may change screenshot pixels: that intentionally creates a new course identity rather than reusing older records.

Each directory contains source `index.html`, original `capture.json` and `texture.png`, an `authoring.json` mapping stable section IDs to measured centers and captured element IDs, the frozen `course.json`, solver trace/report, exact solver inputs, and Race reducer/replay evidence.

Reproduce from owned HTML:

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
| Flow Sprint | 9 | 47.45 s | 5669 ticks / 47.242 s | 0 / 0 |
| Switchback | 9 | 47.75 s | 5705 ticks / 47.542 s | 0 / 0 |
| Longline | 8 | 36.733 s | 4383 ticks / 36.525 s | 0 / 0 |

Solver completion uses the ordinary goal sensor just beyond Race's independent finish plane, explaining the small time difference. For a Race replay, stop input consumption at the Race finish tick. `race-verify.ts` does exactly this and proves all sector/finish ticks again through `replayRace` in a second physics simulation.

Automated traversal is useful geometry/replay evidence; it does not establish human flow, race-speed comfort or physical-phone acceptance. Longline is deliberately shorter than the provisional 45–90 second target and remains a short-course option pending human tuning. No curves, overpasses, banking or required jumps are included.
