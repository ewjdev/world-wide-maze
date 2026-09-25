# @wwm/physics

A deterministic Rapier 3D simulation of the ball. It implements the contract `Simulation` (plans/contracts.md §5). The same code runs **headless** (Node: tests and the solver) and **in a Web Worker** (the game). Phase 05.

## API

```ts
import { createSimulation, createWorkerSimulation, replay, record, DEFAULT_PARAMS, PHYSICS_VERSION } from '@wwm/physics';

const sim = await createSimulation();            // headless; RapierSimulation implements Simulation
await sim.load(stage);                            // StageData (wwm.stage/2)
const { ball, events, elevators } = sim.step(input); // advances exactly 1/SIM_HZ
sim.reset(restartAt);                             // teleport to a stage px point (default: start), zero velocity

const ws = await createWorkerSimulation();        // browser only (Web Worker); same interface, non-blocking step()
const r = await replay(stage, inputs);            // { final, events: {tick, event}[], ticks, goalTick }
```

- `createSimulation({ params?, rapier? })`: `params` overrides `DEFAULT_PARAMS`, for example `{ simHz: 60 }` for the 2013 60 Hz parity mode. `rapier` is `'deterministic'` (default) or `'standard'` (benchmark only).
- Extras on `RapierSimulation` beyond the contract: `getBallState()`, `setBallState(pos, vel)` (test hook), `debugLines()` (the Rapier collider wireframe), `stats()` (triangles, colliders, last step ms, tick).
- `createWorkerSimulation({ params?, interpDelayMs?, worker? })` returns a `WorkerSimulation`. It adds `setPaused(bool)`, `replayInWorker(stage, inputs)` (a deterministic replay inside the worker), `debugLines()` and `stats()` (worker step ms and steps per second).
- `replay` / `runInputs` / `record`: replays are `InputSample[]` at SIM_HZ. `runInputs` applies the contract restart flow: on `lost`, it calls `reset(restartAt)`.
- `staticSpecs(stage, params)` and `elevatorFootprint(elevator, params)` are the pure StageData → collider geometry, in world metres.

### Conventions (see the CCRs in docs/build-log/phase-05.md)
- **frameYaw:** yaw 0 means forward (+tiltZ) is world −Z (page up) and right (+tiltX) is +X. Yaw grows counter-clockwise seen from above. This equals three.js `camera.rotation.y` (Euler `'YXZ'`). forward = (−sin ψ, 0, −cos ψ), right = (cos ψ, 0, −sin ψ).
- **BallState.quat** is `[x, y, z, w]`. `pos` and `vel` are world metres and m/s.
- **`step().elevators[].y`** is the world height of the top of platform A, which starts at `levelLow`. Platform B is always at `levelLow + levelHigh − y`. Both share the footprint from `elevatorFootprint()`: length `max(|b−a|, 18.75 px)` along a→b, ending at `b`.
- **Events:**
  - `island` fires on the first contact with a different island. After `load()`, the first contact with the start island emits one. `reset()` silently sets the island under the reset point.
  - `landed` fires on ground contact after ≥ 0.1 s in the air with impact ≥ 1 m/s.
  - `bump` fires on a new non-ground contact with impact ≥ 1 m/s. The impact is the approach speed along the contact normal.
  - `item` and `goal` each fire once per `load()`.
  - `portal` (Phase 13, contracts §10.1): a geometric sensor (no collider, so nothing in the Rapier world changes and replays are unaffected; `PHYSICS_VERSION` unchanged): the ball centre within `PORTAL_RADIUS_M` of a portal horizontally and at most `goalHeight` + r above its island. It fires on entering, re-arms once the ball leaves, and a ball placed onto a portal (`reset`, `setBallState`) doesn't fire until it leaves and re-enters. Not while falling or after the goal.
  - `fell` fires once. `lost` follows 3 s later.
- **Elevators:** entering a platform footprint at either level (an edge trigger, outside the cooldown) starts a ride. The ball becomes kinematic and rides with the platform, and its velocity is zeroed at both ends. The partner platform's colliders are disabled during the ride. After a ride down they come back only once the ball is out of their volume, and on a ride down with a rise under 1.463 D the ball is eased along the platform, clear of the upper island's slab (0.2.0, BI-3: before, such lifts wedged the ball). The builder no longer makes lifts under 3.7 D.

## Model (E = evidenced by the 2013 build, R = reconstructed, N = new)
All tunables live in `src/params.ts`, each labelled. Tilt **rotates gravity** (E). The smoothed tilt is applied in the `frameYaw` frame only while POWER is held (τ 0.18 s, E). Angular damping is 1.20/s with POWER and 4.61/s without (E). Jump gives +16.7 m/s and needs a contact within 100 ms (E). Falls trigger 9 m below the lowest island; after that, input is off and gravity doubles over 1 s. `lost` comes 3 s later (E). Friction and restitution use the 2013 values with Multiply combine (E). Rails are solid boxes 0.556 m tall, placed **just outside** the edge line (R/N: 2013 used zero-thickness ribbons at the edge, and this keeps 1 D-wide text strips walkable).

## Rapier build
`@dimforge/rapier3d-deterministic-compat@0.20.0` (the enhanced-determinism build, with WASM inlined as base64 so it needs no bundler plugin in Node, Vite or workers). Measured with `pnpm --filter @wwm/physics bench:builds` on an M-series Mac:

| build | handmade replay µs/step | 400k-tri µs/step |
|---|---|---|
| deterministic-compat | 21.5 | 18.5 |
| compat (standard) | 16.5 | 17.8 |

The cost is about 5 µs/step against an 8.3 ms budget. In return, replays are bit-identical across Node and a Chromium worker, which the Playwright test verifies. JS-side trig uses `dsin`/`dcos` (arithmetic only), because `Math.sin` is implementation-defined across JS engines.

**Runtimes without WASM codegen (Cloudflare workerd), 0.2.0:** `loadRapier({ wasmModule })` initialises Rapier from a
precompiled `WebAssembly.Module` of the package's `dist/rapier_wasm3d_bg.wasm` (byte-identical to the inlined copy,
asserted in `test/rapier.test.ts`). Call it once before `createSimulation()`; later `loadRapier()` calls reuse the
instance. A failed load isn't cached. The Worker does this in `apps/worker/src/physics-wasm.ts`.

**Web build (Phase 12b): the WASM as a separate `.wasm` asset.** The base64 copy costs 2.8 MB of JS (1,069 KiB gz)
and has to be decoded before compiling. `apps/web/vite.config.ts` (`rapierWasmAsset`, applied to the page and the
physics worker bundle, not to Node/Vitest SSR) rewrites the package's single `init()` argument
(`module_or_path: base64.toByteArray("…").buffer`) to the URL of `dist/rapier_wasm3d_bg.wasm`, emitted as a hashed
asset, so wasm-bindgen fetches it and compiles it while streaming (`WebAssembly.instantiateStreaming`). Same binary,
so replays stay bit-identical (the Chromium worker test runs through this path via the web app's dev server).
`test/rapier.test.ts` asserts the rewritten expression exists exactly once. Sizes: `.wasm` 2,000 KiB raw / 750 KiB gz
/ 549 KiB br + a 154 KiB (28 KiB gz) JS glue chunk, versus 2,822 / 1,069 / 786 KiB before. In that build Rapier is
initialised from the URL, so `loadRapier({ wasmModule })` is for Node/workerd only. The game also creates its
simulation only when a stage starts building, so the title/attract page doesn't download Rapier at all
(docs/launch/performance.md §4).

## Commands
- Tests: `pnpm vitest run --project @wwm/physics`. This covers feel, events, determinism, 1,000 tunneling trials and perf. The Chromium worker test needs Playwright Chromium. The aid-dcc tests need `pnpm ref:fetch`.
- Regenerate the fixture replay after any physics change: `pnpm --filter @wwm/physics replay:make` (also bump `PHYSICS_VERSION`).
- Sandbox: `pnpm --filter @wwm/web dev`, then http://localhost:5173/dev/physics. Arrows tilt, and any arrow or Shift gives POWER. Space jumps and R respawns. The sandbox also has param sliders with JSON export, a worker/main-thread switch, a 60 Hz parity switch and a stage picker (including `reference/*.stage.json` if fetched).
