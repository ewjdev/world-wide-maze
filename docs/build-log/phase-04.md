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

## Phase 04b: engine polish follow-ups (2026-09-25)
- **Agent:** Claude Opus 5.5 (1M context), a Claude Code sub-agent in an isolated worktree (branch `worktree-agent-aaf7e1009c7fb9cc7`). It ran alongside Phase 08, so the public API is unchanged (additive only; nothing was added in the end).
- **Instructions:** clear up the three overview "Polish backlog" items for the engine: weak goal fireworks, the always-drawn idle particle pool and motes, and the private `renderer._nodes.nodeFrame`. Then re-capture the goal, chase and map screenshots.

### What changed
- **Streak particles** (`world/particles.ts`): the pool is now one instanced quad `Mesh` (still 1 draw) instead of sprites.
  - Each particle is drawn as a camera-facing capsule from its position `trail` seconds ago to its position now. Both points come from the same analytic motion law, so trails curve with gravity and drag.
  - The fragment shader adds a soft tail, an optional white-hot head (`core`) and an optional darker rim (`outline`).
  - Normal blending with saturated colours plus a rim is what reads on `#F8F8F8`. Additive or glow-only light vanishes there, and the bloom composite is a screen blend, which adds nothing over white.
- **Fireworks** (`world/fireworks.ts`, pure and tested). The count stays E: remaining seconds mod 10, 300–800 ms apart. New (N):
  - A golden rocket decelerates up to the burst point: its velocity is solved analytically so it arrives exactly at `launch + flight`, shedding 16 sparks on the way.
  - The burst is scheduled in the future on the GPU (birth = launch + flight), so there's no CPU work at burst time.
  - Shapes: peony (always first), chrysanthemum (long trails, white tips), ring (faces the camera, with a contrasting core), willow (gold, drooping), double.
  - Bursts are placed in world space relative to the goal vantage camera: 20–30 m out, 14–44° up, spread across the view width.
  - The goal camera now tilts at most 26° up (was 38°), so bursts stay in the sky and the ball leaves the top of the frame.
  - The worst case is 9 × 187 particles, which fits the 4096 pool.
- **Idle cost:**
  - The pool hides itself when every particle is dead and instances only the used prefix of its ring (the ring restarts at 0 once all are dead). `count` stays ≥ 2 so the render-object cache key never flips.
  - The motes are hidden when their slab's bounding box (after the tilt lean) is outside the camera frustum, and on the cheap-background tier as before.
- **Private three.js field** (`src/three-private.ts`). Checked in three r186.1 source:
  - The node frame advances only in the renderer's internal `Animation` rAF (`nodeFrame.update()`, then `info.frame = frameId`) and in `compile*()`, which is too heavy to call per frame.
  - `setAnimationLoop` only installs a callback inside that same rAF, and `info.autoReset` only resets counters. **There is no public way** to advance the frame on demand.
  - So `NodeFrameClock.tick()` compares the public `renderer.info.frame` against the previous `frame()` and advances the private field only if the renderer's rAF hasn't done so since. A one-frame-per-rAF game loop never touches it. If the field is gone, it warns once and degrades.
  - `test/polish.test.ts` fails loudly if `Renderer._nodes`, `NodeManager.nodeFrame` or the `Animation` → `info.frame` mirroring changes.

### Evidence
- **Triangles** (`stats().triangles`, scene pass, handmade-simple, 1600×900 WebGPU; `metrics.json`):

  | View | Before | After |
  |---|---|---|
  | chase | 27 676 | 19 484 |
  | map | 27 678 | 19 486 |
  | items-pop at 0.12 s | 27 676 | 19 720 |
  | goal-fireworks at 2.9 s | 27 436 | 20 580 |

  In a probe, idle chase showed `particles.visible = false`. It flipped to true for a large-item pop and back to false about 1 s later.
  - The motes stay visible in chase, map and goal views because their slab is genuinely in view. They're culled only when the camera looks away from it.
- **Draw calls:** chase 45 (was 46), map 46 (was 47), goal 41–44. Every view stays under 50. The WebGL2 fallback gives the same numbers and renders the streaks identically (checked `goal-fireworks-3_6s` with `--backend webgl`).
- **Node frame:** with the real rAF clock, `nodeFrame.frameId` equalled `info.frame` (10→131 over 2 s), so the private path was never used. With `?clock=manual`, 60 frames in one tick used it 59 times, as intended.
- **Screenshots** (`docs/build-log/assets/phase-04/`, overwritten, 1280×720):
  - `goal-fireworks` (2.9 s)
  - the goal sequence frames `goal-fireworks-1_6s`, `-2_2s`, `-3_6s` and `-4_6s`
  - `chase-start`, `chase-route`, `chase-ramp`, `map`, `items-pop`, `elevator`, `fall-ripple`, `spawn-cage`, `intro-skip` and `intro-14_8s`

  Iterations:
  1. The first streak version read well but the bursts were small.
  2. Scaled the shells up.
  3. Bursts placed by NDC ended up low on screen once the camera tilted up, so I switched to world-space placement from the vantage and capped the tilt.
- **Tests:** `pnpm check` is green. There are 8 new engine tests: the node-frame guard (5), fireworks (2) and pool idle bookkeeping (1).

### Remaining
- Fireworks draw on top of the transparent goal vase where they overlap. The vase doesn't write depth; this is minor.
- The motes are rarely culled in practice, because they're usually in view. Saving more there would take a lower count or fog-based distance culling, not frustum tests.
