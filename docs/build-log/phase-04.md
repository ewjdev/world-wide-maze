# Build log: Phase 04 (Renderer, `packages/engine`)

- **Agent:** Claude Opus 5.5 (1M context), run as a Claude Code sub-agent in an isolated git worktree (branch `worktree-agent-af1d14dcbe4d70da4`).
- **Start / end:** 2026-09-25 ~08:05Z → ~09:05Z.
- **Environment:**
  - macOS (arm64), Node 26.0.0, pnpm 11.5.0, three r186.1.
  - Evidence was captured in Playwright 1.63 headless Chromium with a real GPU (Metal ANGLE). The WebGPU backend was available headless. The WebGL2 fallback was forced via `?backend=webgl`.

## Instructions received (summary)
- Execute `plans/phase-04-renderer.md`. Its **G0 updates** override the earlier text: a faceted pastel "ocean" instead of water, faithful 2013 camera numbers, `cameraYaw()`, the intro sequence and the perf ladder.
- Test with `handmade-simple` and with the converted 2013 stage `reference/aid-dcc` (gitignored, never committed).
- Own `packages/engine/**` and `apps/web/src/dev/engine-sandbox.tsx`, plus one route line. No physics dependency: fake the ball.
- Visual quality matters. Screenshot every view with Playwright, look at the PNGs, iterate, and save the finals to `docs/build-log/assets/phase-04/`. Record draw calls and triangles.
- Mid-task, the orchestrator issued **contracts v0.2.2** (Phase 05 CCRs):
  - the yaw convention
  - the quat order `[x, y, z, w]`
  - the two-platform elevator footprint ending at `b`
  - `SLAB_THICKNESS_M` / `RAIL_HEIGHT_M` / `ELEVATOR_MIN_PLATFORM_PX`, with rails just outside the edges

  I merged `main` and adopted all of it.

## What was built
- `@wwm/engine` (TypeScript, three `WebGPURenderer` + TSL, automatic WebGL2 fallback). `createEngine()` exposes the brief's API plus `setControl`, `setElevators`, `spawnBall`, `playGoal`, `skipIntro`, `unloadStage`, `cameraYaw`, `setQuality`, `setPixelLook` and `debug`. See `packages/engine/README.md`.
- Pure, unit-tested modules:
  - `geom/tiling` (texture bands and triangle clipping)
  - `geom/structures` (merged island tops/bottoms/sides, bridge decks with aprons, rails, elevator pillars; mirrors the `@wwm/physics` collider layout)
  - `geom/heightfield` (the camera's line of sight)
  - `camera/chase` (the 2013 leash), `camera/intro` (timeline and Catmull–Rom camera keys)
  - `quality` (the ladder)
- World modules (TSL):
  - stage objects: website tops with the E ball shadow; fragmented sides, bridges and rails; two-platform elevators driven by a uniform array
  - the faceted ocean with in-shader wires, dots and ripples, plus floating dots and a cloud ring
  - the chrome ball with a 2-faces-per-frame cube map, glowing seams, the materialize dissolve and the cage
  - instanced items with a shader pop
  - the goal: title ribbon spiral, wire vase and pad
  - one analytic GPU particle pool
  - speed streaks and the map "YOU" sprite
- `/dev/engine` sandbox with stage picker, auto route / keyboard drive, all views and events, a stats overlay, a leak test, and the `window.wwm` automation hook with a manual clock.
- Scripts: `scripts/shots.ts` (deterministic screenshots and stats), `scripts/ladder.ts` (CDP CPU throttling), `scripts/probe.ts`.

## Attempts that failed, and why
- **Draw-call counter read 13 while the env pass alone was 12.** The renderer re-runs pass nodes only once per its own rAF node-frame id. With several `frame()` calls per rAF (the manual clock), the scene pass silently didn't re-render, so screenshots showed stale frames. Fix: `frame()` advances `renderer._nodes.nodeFrame` itself. The scene-pass draw count is now measured with scene `onBeforeRender`/`onAfterRender`. This uses a private field; it's recorded in the README.
- **Bridge side faces rendered black.** The fake-light factor used `normalWorld` inside a `select()` branch. A per-vertex dot of the geometry normal (`vertexStage`) fixed it. I found it by switching to flat debug colours in the sandbox.
- **The goal wire bloomed while invisible during the intro fold.** An alpha-blended material still writes full emissive into the glow MRT target. Emissive is now multiplied by the same alpha, and not-yet-appeared parts are hidden.
- **WebGL2 fallback lost its device immediately.** React StrictMode created, disposed and recreated the engine on the same `<canvas>`, and a disposed WebGL2 renderer loses that canvas's context. The sandbox now creates a fresh canvas per engine (documented for Phase 08).
- **The map view was too far away** (stage ≈ 30 % of the frame, from the literal "1.7 × fit"), then too close. It now fits the stage's bounding sphere at 52° (R).
- **Reference stages didn't load in the sandbox** because of an id mismatch (`aid-dcc.stage`).
- **The fireworks read as pale confetti on the near-white sky.** Additive or glow-only particles vanish against `#F8F8F8`. I switched to saturated, hard-edged, normally-blended sparks with a white-hot inner ring, and pulled the camera back to a vantage point. This is still the weakest visual (see defects).
- **CPU throttling ×10** didn't move the fps (the engine's JS per frame is tiny). ×60 was needed to show the ladder.

## Manual human interventions
None.

## Test evidence
- `pnpm check`: typecheck (all packages) + `biome check .` + `vitest run` are green. Engine tests: 25 passing (tiling, meshes, triangulation with holes, physics-matching helpers, heightfield, yaw convention vs three.js YXZ, tilt quaternion, chase steady state, intro timeline, quality ladder).
- **Screenshots** (`docs/build-log/assets/phase-04/`, handmade-simple, 1280×720, WebGPU):
  - `chase-start`, `chase-route` (POWER streaks, large item), `chase-ramp`, `map` (orbit, YOU marker, scaled items, goal beacon)
  - `items-pop`, `elevator` (platform mid-lift between C and D, both platforms, pillars and rails), `fall-ripple`, `goal-fireworks`, `spawn-cage`
  - intro frames `intro-0_4s` … `intro-14_8s` (upright page → fold → extrude → bridges → fly-over → cage drop), `intro-fast-3s`, `intro-skip` (chase view 0.3 s after skipping at 3 s)
  - The same views on the real 2013 stage (`aid-dcc`) are in `reference/shots/phase-04/` (gitignored, because they show the 2013 texture). Regenerate with `node packages/engine/scripts/shots.ts http://localhost:5174 reference/shots/phase-04 --only aid-chase,aid-map,aid-intro-3s`.
- **Draw calls and triangles** (`metrics.json`; the same numbers on the WebGL2 backend):
  - handmade chase: 46 total = scene 20 + env cube 12 + post 14, 27.7 k scene triangles
  - map: 47
  - aid-dcc (38 islands, 31 bridges, 6 elevators, 505 items) chase: 46 total, 78.0 k triangles
  - tier 3: 21
  - intro frames: 23–47
  - Every view is **under 50**.
- **Quality ladder** (`ladder.json`, `ladder-throttled.jpg`, `ladder-recovered.jpg`): with DevTools CPU throttling ×60, fps went 60 → 11 and the tier stepped 0→1→2→3→4 at 2.5 s intervals (the draw count fell to 20 with glow and env off). After unthrottling it climbed back 4→3→2→1→0 over about 32 s with hysteresis.
- **Leaks:** `wwm.leakTest()` measured `renderer.info.memory` with no stage loaded as `{geometries 2, textures 19, programs 17, renderTargets 14}`. After 5 load/unload cycles of handmade-simple it was identical. `wwm.disposeCycles(5)` created, loaded and fully disposed 5 whole engines with no errors.
- **Anisotropy:** the device max is 16 and is applied. An A/B of `?aniso=1` vs the default on aid-dcc (in `reference/shots`, gitignored) shows distant page text on the far island strips resolving only with 16×. handmade-simple (2× texture) text such as "level 1.5" is legible at the default chase distance (`chase-ramp.jpg`).
- **Backends:** WebGPU (headless Chromium, Metal) and forced WebGL2 both render every view. Console: only the React Router `HydrateFallback` dev warning.
- **fps:** headless fps is not representative (manual clock / headless rAF). The orchestrator's real-GPU 1080p check is still needed for the "60 fps on the reference desktop" criterion.

## Remaining defects and limitations
- **Fireworks** are serviceable but not spectacular on a white sky: they read as dots with no trails. A streak or trail pass would help.
- **aid-dcc's texture** is 0.8 image px per stage px (the 2013 capture). Close text is soft by source, not by filtering. New captures at DPR 2 look sharp.
- **The particle pool** (4096 sprites) and the 1400 floating dots are always drawn, as degenerate quads when dead. That is cheap, but skipping them when idle would save about 11 k triangles.
- **The env cube size** (128 or 64 px) is chosen at load time; the ladder only toggles its updates.
- **`frame()` relies on a private three.js field** (`_nodes.nodeFrame`). Re-check it on three.js upgrades.
- **The chase camera's `lean` also rotates the camera offset,** faithful to 2013 `camera.world`. Under strong tilt the camera swings up to ±0.5 × roll. Tune in playtest.

## Contract Change Requests
None blocking. The contract v0.2.2 conventions are adopted as specified: yaw, quat, elevator footprint and platform B, slab and rail dimensions, and rails outside edges and decks.

Notes for the orchestrator:
- I added `@wwm/engine` to `apps/web/package.json` dependencies and one `/dev/engine` route line in `apps/web/src/routes.tsx`.
- pnpm 11 auto-added `three@0.186.1` to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`.
