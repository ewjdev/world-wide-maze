# @wwm/engine

The three.js renderer for World Wide Maze stages. It turns `StageData` and the page texture into the world: island tops that are the website, faceted pastel "ocean", chrome ball, items, bridges, rails, elevators, goal, cameras and effects. It **only renders the state it is given**. Physics (Phase 05), input (Phase 06) and the game loop (Phase 08) drive it.

Labels follow the fidelity spec: **E** = evidenced from the 2013 build, **R** = reconstructed, **N** = new.

## Renderer decision
`WebGPURenderer` (three r186) with its automatic **WebGL2 fallback**, and all materials written in TSL. The spike and the build both render identically on the WebGPU and WebGL2 backends (the sandbox's `?backend=webgl` forces the fallback).

TSL was chosen over plain `WebGLRenderer` for three reasons:
- **Selective glow in one pass.** The scene pass writes two MRT targets: colour and each material's emissive colour. Only the emissive target is bloomed, then screen-blended over the colour, so the website texture can never bloom. This is the 2013 "separate glow target", without rendering the scene twice.
- **Shader-driven animation** (item bob/spin/pop, intro extrusion, elevator heights, particles, ocean swell) without `onBeforeCompile` hacks.
- It is the maintained path in current three.js.

**Colour management:** sRGB output. **No tone mapping** (N): tone curves (ACES, AgX, Neutral) grey the page whites (Neutral maps 1.0 to 0.88). The art is unlit like 2013, so values stay ≤ 1 and the site's colours come out exactly as captured. Bloom is screen-blended, which never pushes past white.

## API
```ts
import { createEngine } from '@wwm/engine';
const engine = await createEngine({ canvas, quality: 'auto', reducedMotion, pixelLook: false });
await engine.loadStage(stage, imageBitmap); // builds everything, compiles pipelines up front
await engine.playIntro({ mode: 'full' });   // 'fast' ≤ 8 s for repeat plays; skipIntro() any time
// every render frame:
engine.setBall(sim.ball, alpha);             // latest sim state; alpha interpolates from the previous one
engine.setControl({ tiltX, tiltZ, power });  // camera/background lean, core glow, speed streaks
engine.setElevators(step.elevators);         // platform A top y (m) per elevator id
for (const e of step.events) engine.handleEvent(e);
engine.frame(dtSec);
input.frameYaw = engine.cameraYaw();
```

| Method | Notes |
|---|---|
| `loadStage(stage, image)` / `unloadStage()` | Accepts ImageBitmap, img, canvas or OffscreenCanvas. The image scale is taken from the image itself (`image.width / stage.size.width`). Unloading frees every GPU resource the stage created. |
| `setBall(state, alpha?)` | `BallState.quat` is `[x, y, z, w]`. With `alpha`, the engine renders `lerp(previous distinct state, state, alpha)`. |
| `setControl({tiltX, tiltZ, power})` | POWER glow: 0.5 s up, 1 s down (E). Lean is off under `reducedMotion`. |
| `handleEvent(e)` | `item` (pop and burst), `goal` (fly-away with 5 fireworks; call `playGoal(n)` yourself to pass the real count), `fell` (the camera holds and watches the drop), `lost` (ripple on the ocean), `landed` (dust above impact 6). The other events are no-ops. |
| `setItemCollected(id)` | Same as the `item` event. |
| `setElevators([{id, y}])` / `setElevatorPhase(id, t)` | `y` is platform A's top, from `sim.step().elevators`. Platform B = `levelLow + levelHigh − y` (contracts v0.2.2). The engine never animates elevators by itself. |
| `setView('chase' \| 'map' \| 'intro')` | Blends over 0.9 s. `'intro'` starts `playIntro()`. |
| `playIntro({mode})` / `skipIntro()` | See "Intro" below. The promise resolves when control can begin, including after a skip. |
| `spawnBall(pos?, {durationSec?})` | The cage drop (E: from 10 WU up, 3 s, cage opens at 2.5 s), plus a materialize dissolve (N). The camera snaps behind the spawn, facing the goal (E `resetToStart`). |
| `playGoal(fireworks)` | E: the ball is pulled into the goal, then rises 1500 WU in 2 s (quintIn). Fireworks = remaining whole seconds mod 10, launched 300–800 ms apart. The camera pulls back to a vantage point (N). |
| `cameraYaw()` | See the yaw convention below. |
| `resize(w, h)`, `frame(dt)`, `stats()`, `setQuality(q)`, `setPixelLook(on)`, `dispose()` | `stats()` returns fps, draw calls (total, scene, env and post), triangles, tier, backend, `renderer.info.memory` counts and the tier log. |
| `debug()` | `{renderer, scene, camera}` for dev tools only. Not a stable API. |

### Conventions (shared with @wwm/physics, contracts v0.2.2)
- **Yaw:** `cameraYaw()` = θ such that forward (away from the camera, +tiltZ) = (−sin θ, 0, −cos θ) and right (+tiltX) = (cos θ, 0, −sin θ). At θ = 0 the camera looks up the page (−Z). Positive yaw is counter-clockwise seen from above. This is exactly three.js `camera.rotation.y` in Euler order `'YXZ'`, and the 2013 formula `−atan2(r.z, r.x) − π/2` (unit-tested).
- **Geometry mirrors the physics colliders:**
  - Slabs are `SLAB_THICKNESS_M` thick.
  - Rails are `RAIL_HEIGHT_M` tall, just **outside** the island edge line and outside each bridge deck's width.
  - Bridges have a sloped main deck a→b plus flat aprons into each island (gap + 0.3 m).
  - Elevator platforms have length `max(|b−a|, ELEVATOR_MIN_PLATFORM_PX)` ending at `b`, with side rails.

## Look (colour roles from the 2013 bundle)
- **Island tops** show the page texture, unlit, with the E shader ball shadow (radius 0.6 WU, darkness 0.8, 15 WU falloff). Tops and bottoms are textured (E). Anisotropy is the device maximum (16 on the test machine). The texture has mipmaps and is sRGB. The optional "pixel look" switches magnification to nearest 10 s into the intro (E; off by default, R).
- **"Fragmented" materials** (E): unlit flat facets, HSV base colour plus animated per-face noise variation (0, .05, .08). Island sides are blue with a white top line, bridges green with white edge lines and plank bands, rails yellow, elevators red with glowing edges.
- **Ocean** (E concept, new art): a 2.8 km faceted plane of the 8 `COLOR_TRIANGLE` pastels, 194 m below the lowest island. It has in-shader `COLOR_WIRE` wire lines and vertex dots (so there is no z-fighting overlay), a slow swell, a double ripple ring on ball loss, 1400 floating "star" dots, and a ring of 30 procedural clouds on the horizon. It **leans with the tilt** around the ball (E; off under reduced motion).
- **Fog** `#F8F8F8` from 370 to 926 m (E).
- **Ball:** a chrome shell reflecting a 128 px cube map (64 px if the stage loads at tier 2 or lower quality). Two cube faces are refreshed per frame, which is a full refresh every 3rd frame (E cadence at a third of the per-frame cost). Lower-hemisphere reflections are darkened towards the 2013 dark base colour. The core (#456e93) shows through two glowing seams and brightens with POWER (N shape, E behaviour).
- **Items:** one `InstancedMesh` of teal icosahedra (E) that bob and spin in the vertex shader, plus a large-item `InstancedMesh` with a wire shell. Collection writes the collect time into an instanced attribute. The shader pops the item, and a GPU particle burst plays.
- **Goal** (E): the site title printed in red, yellow and green letters with a white stroke on a ribbon spiralling 20 WU up, a flared wire "vase", and a glowing pad (N). It doubles as the beacon seen from afar.
- **Effects:** one analytic GPU particle pool for everything (1 draw call): fireworks, pops, dust. There are also speed streaks while POWER is held, the spawn cage, and the map "YOU" marker (a sprite with a coin-flip spin, N).

## Cameras
- **Chase** (E, `followcamera`): leash 2.1 WU → 1.94 m, distance 5 WU → 4.63 m at 35°, lerp 0.11 per 60 Hz tick converted to a frame-rate independent α, FOV 70°, near 0.09 m. `camera.up` and the offset lean with 20 % pitch / 50 % roll of the tilt (E). N: instead of the 2013 `y ≥ 0` clamp, the camera raises its elevation until a heightfield line-of-sight test clears the slabs.
- **Map** (E: orbit at 0.2 rad/s with the "YOU" marker): R: frames the stage's bounding sphere at 52° elevation (2013 used 50 WU height and 1.7 × fit-width). Items scale up ×3.2 so they read from far away.
- **Intro:** see below.

## Intro ("the website becomes a maze")
The E sequence, timed per `introTimeline(mode)`:

| phase | full (first play) | fast (repeat) |
|---|---|---|
| page stands upright, head-on, then folds flat | 1.0–5.0 s | 0.3–2.0 s |
| islands extrude out of the page (staggered from the start island) | 4.6–7.6 s | 1.8–3.3 s |
| page background sinks and fades | 5.0–8.0 s | 2.0–3.4 s |
| bridges rise from 40 m below | 6.2–9.2 s | 2.6–4.1 s |
| rails, items, goal appear | 6.6–9.6 s | 2.8–4.3 s |
| camera fly-over along start → goal, settle behind the start | 9.4–13.2 s | 3.9–5.9 s |
| ball drops in its cage | 13.2–16.2 s | 5.9–7.9 s |

2013 took about 20 s. Reduced motion forces `fast`. `skipIntro()` jumps to the final state at any point.

## Draw calls and performance ladder
Measured with `scripts/shots.ts` (headless Chromium, WebGPU backend, 1280×720):

| view | total | scene pass | env cube (2 faces) | post (bloom + FXAA + output) | scene triangles |
|---|---|---|---|---|---|
| handmade-simple chase | 46 | 20 | 12 | 14 | 27.7 k |
| handmade-simple map | 47 | 21 | 12 | 14 | 27.7 k |
| aid-dcc (38 islands, 505 items) chase | 46 | 20 | 12 | 14 | 78.0 k |
| any stage, tier 3 (glow and env off) | 21 | 20 | 0 | 1 | same |

Draw calls do not grow with stage complexity: everything is merged by type.

Auto quality ladder (`QualityLadder`): a rolling 2 s mean frame time, 1.5 s warm-up, and a full window refill after each change. The rungs are:
- tier 1 below 45 fps: env map updates off (E)
- tier 2 below 40 fps: render scale 0.7 and FXAA off (E)
- tier 3 below 30 fps: glow off (E)
- tier 4 below 24 fps: cheap background, with no wires, dots or motes (N)

It recovers one tier after 6 s above threshold + 10 fps (N; 2013 only went down). DPR is clamped to 2 (N). `quality: 'high' | 'medium' | 'low'` pins tier 0 / 1 / 3.

## Implementation notes
- `frame()` advances the renderer's node frame itself (`renderer._nodes.nodeFrame.update()`, a private field). Pass nodes re-render only once per node-frame id, and the renderer normally bumps that id from its own rAF. That breaks when a host renders several frames per rAF, such as a manual clock.
- A disposed WebGL2 renderer loses its context. Create a new canvas for each new engine (the sandbox does).
- Texture tiling: images taller than the device limit (capped at 4096) are cut into horizontal bands. Island-top triangles are clipped per band, with band-local UVs, into one geometry group and one draw per band. Wider-than-limit images are downscaled uniformly (pages are ≤ 1280 CSS px × DPR 2, so this is rare).

## Sandbox and scripts
- `pnpm --filter @wwm/web dev`, then open `/dev/engine`. It lists handmade-simple, any `fixtures/builder/*.json`, and `reference/*.stage.json` after `pnpm ref:fetch`.
  - Ball modes: auto route (BFS start → goal over bridges and elevators), keyboard drive (arrows/WASD relative to `cameraYaw()`, Space hops), or still.
  - Buttons trigger every view and event. There is also a 5× load/unload leak test and a stats overlay.
  - URL flags: `?stage=`, `?quality=`, `?backend=webgl`, `?clock=manual` (step with `wwm.advance(sec)`), `?ui=0`, `?pixel=1`, `?aniso=N`, `?maxtex=N`.
- `node scripts/shots.ts <baseUrl> <outDir> [--only a,b] [--backend webgl] [--width W --height H]`: deterministic screenshots and stats.
- `node scripts/ladder.ts <baseUrl> <outDir> [cpuRate] [stageId]`: CDP CPU throttling to show the ladder stepping down and back up.
- `node scripts/probe.ts <url> <js> [png]`: an ad-hoc evaluate-and-screenshot helper.

## Tests
`pnpm vitest run --project @wwm/engine` runs the pure helpers:
- tiling math and band clipping (area preserved)
- top/bottom/side meshes: area, UV range, slab thickness, merge counts
- triangulation with holes
- the physics-matching elevator footprint, rail offsets and apron gaps
- the heightfield and line of sight
- the yaw convention against three.js Euler YXZ, and the tilt quaternion
- chase-camera steady state (4.63 m at 35°)
- intro timeline ordering and the ≤ 8 s fast mode
- the quality ladder: down, hysteresis, recovery, fixed modes

GPU behaviour is verified through the sandbox scripts (see `docs/build-log/phase-04.md`).
