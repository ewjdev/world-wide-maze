# Phase 04 — Renderer (packages/engine)

**Wave:** 1 · **Depends on:** 02 (`handmade-simple` fixture, schema) · **Blocks:** 08

## Goal
A three.js rendering engine that turns `StageData` plus its texture into a beautiful, fast world:
- islands whose tops *are* the website
- a living ocean
- a glowing reflective ball
- items, bridges, rails and elevators
- a chase camera and a map view
- effects

The game loop is driven externally. The engine only renders the state it's given.

## Read first
- `plans/contracts.md` §1, §3, §5 (`BallState`, `SimEvent`)
- `RESEARCH.md` Part 1.3 "Rendering" and Part 4.3
- `docs/reference/visual-notes.md` and `fidelity-spec.md` (Phase 01), if present

## Owns
`packages/engine/**`, `apps/web/src/dev/engine-sandbox.tsx` (a dev-only route `/dev/engine`)

## Public API (the target, so Phase 08 can wire it)
```ts
export interface EngineOptions { canvas: HTMLCanvasElement; quality?: 'auto'|'low'|'medium'|'high'; reducedMotion?: boolean }
export interface Engine {
  loadStage(stage: StageData, texture: ImageBitmap): Promise<void>; // builds all meshes
  setBall(state: BallState, alpha?: number): void;                  // interpolated render state
  handleEvent(e: SimEvent): void;                                   // item pop, splash, fireworks
  setItemCollected(itemId: number): void;
  setElevatorPhase(id: number, t: number): void;                    // or driven by time; match physics
  setView(mode: 'chase'|'map'|'intro'): void;                       // intro = fly-over of page → islands
  playIntro(): Promise<void>;                                       // the "website becomes maze" transition
  resize(w: number, h: number): void;
  frame(dtSec: number): void;                                       // render one frame
  stats(): { fps: number; drawCalls: number; tier: number; triangles: number };
  dispose(): void;                                                  // full GPU cleanup (no leaks)
}
export function createEngine(opts: EngineOptions): Promise<Engine>;
```

## Tasks
1. **Setup:** three.js (latest). Use `WebGPURenderer` with an automatic WebGL2 fallback, or plain `WebGLRenderer` if the WebGPU post-processing path is unstable. **Decide with a short spike, and record the decision in the README.** Color management is sRGB, with ACES or AgX tone mapping.
2. **Island meshes:**
   - Extrude contours and holes (earcut through `ShapeUtils`) to a slab of thickness about 2 levels, with a small bevel. Top Y = `level × LEVEL_HEIGHT_M`.
   - Top faces use planar UVs from page px into the screenshot texture, so the content lines up exactly.
   - Sides use a stylized material (e.g. a darker extruded tint of the edge color, with subtle stripes).
   - **Merge all island tops into one mesh and all sides into another.** The draw-call budget for the whole scene is **under 50**, as in the original.
3. **Texture:** long pages can exceed the max texture size, so tile vertically into ≤ 4096 px tiles with per-tile UV remapping and a material index or array texture. Use max anisotropy, mipmaps, and sRGB.
4. **Bridges and ramps:** merged meshes with a planked or light-strip look. Ramps interpolate height. **Guardrails** are merged tubes or extruded posts along the polylines. **Elevators** are separate moving platforms (a few meshes) with glowing edges.
5. **Ocean:** a large plane with a Gerstner-wave vertex shader, fresnel, fog toward the horizon, and a foam line where the island sides meet the water (a depth-based or distance-field approximation). A cheaper variant is used on low tier.
6. **Ball:** a metallic shell (PBR) around an emissive core. The reflection is a CubeCamera env map **updated every 3 frames** (faithful trick), with a static env on low tier. Add a spawn "materialize" effect: a wireframe shell dissolving via a shader.
7. **Items:** small items are **one InstancedMesh**, with bob and spin in the vertex shader and collection hidden through an instance attribute. Large items are distinct glowing models. Add a pop particle burst on collect.
8. **Selective glow:** bloom only emissive and "glow" layers (the ball core, items, goal, elevator edges), never the website texture. This is the core problem the original solved with a separate glow target. Use an MRT/emissive-buffer or a layer-based bloom composer.
9. **Effects:** goal fireworks (GPU particles), fall splash, a goal beacon beam visible from afar, and speed streaks while POWER is held.
10. **Cameras:**
    - **Chase:** spring-damped, looking ahead along the velocity. It pulls back on bridges and avoids clipping through islands (raycast against a low-res island heightfield).
    - **Map:** an orthographic-ish top-down view of the whole page with ball, goal and items marked (the MENU/M feature).
    - **Intro:** starts as a flat, full-screen view of the website screenshot (so it's instantly recognizable), then islands rise and extrude out of the page, the background dissolves into ocean, and the camera swoops to the start. **This is the signature moment. Spend time on it.**
11. **Auto quality ladder** (modern version of the original). Measure the rolling frame time over 2 s, degrade in this order, and recover with hysteresis:
    - env-map updates off
    - DPR to 0.7×
    - anti-aliasing off
    - bloom off
    - cheap ocean
12. **Dev sandbox** `/dev/engine`:
    - Loads `handmade-simple`, plus any `fixtures/builder/*.json` or `reference/aid-dcc.stage.json` if present.
    - Fakes the ball moving along a path, with keyboard free-fly.
    - Shows a stats overlay and buttons to trigger each event and view.

## Acceptance criteria
- `/dev/engine` renders `handmade-simple` with every feature visible. Save screenshots to `docs/build-log/assets/phase-04/`.
- Under 50 draw calls on every fixture stage. 60 fps at 1080p on the reference desktop (record the GPU). The quality ladder visibly steps down when throttled (DevTools CPU/GPU throttling). Record the evidence.
- The website text on the island tops is legible at the default chase distance (anisotropy verified).
- `dispose()` leaves `renderer.info.memory` back at baseline after 5 load/dispose cycles (test in the sandbox).
- The intro transition runs 3–5 s and is skippable.
- Unit tests for the pure geometry helpers (UV mapping, tiling math, mesh merge counts).

## Out of scope
Physics, input, UI/HUD (Phase 08), and audio.
