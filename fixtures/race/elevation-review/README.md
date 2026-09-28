# Race elevation review

Open `index.html` for all fourteen courses, or a named HTML file for its overhead island map and side profiles. PNG files are browser screenshots of those review pages. Colours encode island height, dashed gold links show flights, and the profile panels connect island centres; they are not collider cross-sections.

`../<course>/elevation-design.json` is the authored elevation override for the frozen layout. It records island heights and, where necessary, bridge controls, endpoints or island contours. `../elevation-validation.json` contains the measured local ramp grades for every generated course. The shared schema validates full deck triangles, including bank and inside-turn effects, against the Race slope and shallow-connector limits.

Rebuild the underlying owned Race fixtures with their existing capture/build scripts when changing the source layout, then apply the elevation designs:

```sh
node scripts/race-elevation-build.ts
node scripts/race-maze-catalog.ts
node scripts/race-elevation-audit.ts
node scripts/race-maze-straights.ts
node scripts/race-maze-resets.ts
node scripts/race-maze-verify.ts
node scripts/race-classic-charge-probe.ts
```

`node scripts/race-elevation-build.ts --draft` regenerates the diagrams without changing course JSON. `--slug flow-delta` limits generation to one course. Changing authored XY geometry can require updating `route-points.json`, replaying all affected routes, and recapturing their browser evidence. Validation reports include a resolved physics/rules compatibility fingerprint; a matching course ID alone does not prove a run used the current physics.

The elevation update retains one long straight at most on each course. Most mean ramp grades are deliberately below the 20-degree maximum local grade because smooth crests and banking increase the steepest point. Skipping Stones required a wider G2 merge island and separate ramp mouths after real traversal exposed overlapping ramp colliders. Its overlapping JT4/J landing platforms share a height and use a 3.9 m connector. The three classic courses also use level 3.9 m connectors on their existing final straight, with adjacent platform edges extended to meet them, providing a continuous grounded charging section.

Automated runs demonstrate bounded-input feasibility and deterministic replay, not optimal routing or human difficulty. The original Sky Weave layout still takes roughly 77–79 seconds with the conservative waypoint driver; most other maze routes take about a minute. Use the playable beta to review handling and route choice at higher speeds.
