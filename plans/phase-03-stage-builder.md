# Phase 03 — Stage Builder (the heart of the game)

**Wave:** 1 · **Depends on:** 02 (fixtures, schema) · **Uses if available:** 01's `stage-format.md` calibration targets · **Blocks:** 07 integration, 08, 09

## Goal
A **pure, deterministic TypeScript** library: `buildStage({capture, image, seed, difficulty}) → {stage, debug}`. It turns a screenshot plus DOM layout into a playable, recognizable island maze. It reimplements Saqoosha's 2013 OpenCV/Boost `stage_builder` algorithm, along with a visual debugger that shows each step.

## Read first
- `plans/contracts.md` §1, §2, §3, §4
- `RESEARCH.md` Part 1.3 "Stage builder algorithm" and Part 4.2
- `docs/reference/stage-format.md` (Phase 01), if present

## Owns
`packages/stage-builder/**`, `tools/stage-debugger/**`, `fixtures/builder/**` (golden outputs)

## Constraints
- No DOM, Node or WASM dependencies in the core, so it runs in a Worker, a Web Worker, and Node. Allowed deps: `clipper2-js` (offsets and booleans; check the maintained package name), `earcut` (triangulation checks only), and `@wwm/schema`.
- All randomness comes from `@wwm/schema/rng` seeded by `seed`, forked per step (`rng.fork('maze')`, etc.), so tuning one step never reshuffles another.
- Target under 1.5 s for a 1280×6000 page in Node, and report per-step `timingsMs`.

## Pipeline (implement as separate, individually tested modules)
1. **`grid.ts`:** downsample the image to a cell grid (default 4 px per cell) with an average color per cell.
2. **`background.ts`:**
   - Quantize the colors and find the dominant color. Also treat `capture.backgroundColor` and each element's own `bg` region as local background, so colored sections don't become giant islands.
   - Classify each cell by Lab ΔE < threshold → background.
   - Output `backgroundMask`.
3. **`semantic.ts`:**
   - OR in DOM rects: `image/video/canvas/button/input` become solid, and `text/heading/link` line rects are dilated by 0.5 × line height.
   - Drop `fixed` elements (they were captured once as the header, and are optionally kept as the start plateau).
   - Record every inclusion and exclusion in `provenance`.
4. **`morphology.ts`:** dilate → close → fill holes smaller than N cells, then remove specks. (Equivalent to the original's `dilate → GaussianBlur → threshold`.)
5. **`islands.ts`:**
   - Connected components (two-pass union-find) and drop components smaller than `MIN_ISLAND_SIZE_PX`.
   - **Split oversized components** (area above X% of the viewport) along natural gaps, or a grid, so a hero image doesn't become one flat plain.
   - Map each island back to its `sourceElementIds`.
6. **`contours.ts`:** marching squares → Douglas–Peucker (ε ≈ 1 cell) → light Chaikin smoothing. Force CCW outers and CW holes. No self-intersection: check it, and repair with a Clipper union.
7. **`levels.ts`:** assign an integer `level` per island from a documented heuristic, e.g. header and nav high, main content mid, footer low, and depth or z bumps. Neighbors should differ by at most 1 on most edges. Calibrate against the Phase 01 distribution if available.
8. **`bridges.ts`:**
   - Candidate edges: the original's rule (the nearest island in each of the 4 directions, closest-point connection) **plus** Relative Neighborhood Graph edges, so diagonal layouts connect.
   - Reject candidates that cross a third island, exceed the max span, or can't fit `MIN_BRIDGE_WIDTH_PX` at both mouths.
   - Type: `flat` if the levels are equal, `ramp` if they differ by 1. If they differ by more, create an **Elevator** on the lower island instead.
9. **`maze.ts`:**
   - Randomized DFS spanning tree from the start island (the original's algorithm).
   - Difficulty adds back a share of the removed edges as loops: easy 35%, normal 15%, hard 0%. These are tunable constants.
10. **`placement.ts`:**
    - A distance transform per island gives local maxima = "safe spots".
    - **Start** goes on the island nearest the top-left (faithful).
    - **Goal** goes on the island with the greatest graph distance from the start (an improvement on bottom-right, and labeled as such). Fall back to bottom-right when the distances tie.
    - Up to N large items at the remaining safe spots, preferring dead-end islands.
    - Small items along a Clipper inward offset (inset d), spaced s apart with seeded jitter. Density is calibrated to Phase 01's items per area.
    - Restart points are spaced along the same inset.
11. **`rails.ts`:** guardrails = the island contour offset slightly inward, clipped against bridge-mouth rectangles and elevator access. The result is open polylines.
12. **`time.ts`:** a provisional `timeLimitSec` from route length (the sum of bridge and island traversal distances on the start→goal path) ÷ nominal speed × difficulty factor. Phase 09 later replaces this with solver-based par times.
13. **`index.ts`:** `buildStage` orchestrates the steps, then runs `validateStage`. If validation fails it retries internally with `seed+1..seed+4`, then throws `BUILD_FAILED` with reasons.

## Stage debugger (`tools/stage-debugger`)
- A Vite page that loads any `fixtures/captures/<slug>` (dropdown) and runs `buildStage` in a Web Worker.
- Draws toggleable layers over the screenshot: background mask, semantic fill, islands (colored by label), contours, levels (heat colors), candidate bridges (grey), carved bridges (green), elevators, items (small cyan, large purple), start and goal, restart points (grey), guardrails.
- Controls: seed, difficulty, and each tunable parameter as a slider. It shows `timingsMs` and provenance (hover an island to see its source elements).
- It doubles as the showcase "how it's made" view (Phase 10 reuses its renderer). Keep the drawing code in an exported module: `tools/stage-debugger/src/draw.ts`.

## Acceptance criteria
- `buildStage` succeeds on **all** `fixtures/captures/*` at all 3 difficulties with seeds 1–5, and every result passes `validateStage`.
- Determinism: same input gives byte-identical `JSON.stringify(stage)` (test).
- Golden snapshot tests in `fixtures/builder/<slug>.normal.seed1.json`, plus a count summary test (islands, bridges, items within expected ranges).
- Performance: every fixture builds in under 1.5 s in Node on CI hardware (log the timings).
- Debugger screenshots for each fixture saved to `docs/build-log/assets/phase-03/<slug>.png` for orchestrator review. **Recognizability check:** islands visibly correspond to page content blocks.
- A unit test per module with small synthetic inputs (e.g. two rectangles give 2 islands and 1 bridge).

## Out of scope
Rendering, physics, capture, and AI. Physically validating traversal belongs to Phase 09. This phase only guarantees geometric invariants.

## Tips
Iterate visually first with the debugger. Most of the work is tuning. Keep every magic number in `params.ts` with a comment saying where it came from (evidenced, calibrated or chosen).


---

## G0 updates (2026-09-25). Where these conflict with the text above, these win.
Sources: `docs/reference/fidelity-spec.md` (E = evidenced from the 2013 build) and contracts v0.2.0.

- **Slices:** build one stage per `sliceIndex` (≤ `MAX_STAGE_HEIGHT_PX` = 1700 px of the page). Output **stage-local** coordinates and `size`. Elements that straddle the slice boundary are clipped, and elements outside it are dropped with `out-of-slice`. `texture.path` is left `''`. Export `sliceCount` (re-exported from schema).
- **Scale:** 1 D = 13.5 px, so all thresholds are much smaller than the text above assumes. `MIN_ISLAND_SIZE_PX` is 27 and `MIN_BRIDGE_WIDTH_PX` is 34. A grid cell of 2–3 px is probably right, so re-derive `params.ts` in units of D.
- **Faithful topology (E):**
  - Bridges run in **cardinal directions only** (0/90/180/270°), with deck widths of 1.6–3.6 D (clamped up to the contract minimum).
  - The maze is a **spanning tree** (islands = bridges + 1) from randomized DFS. Loops are an optional difficulty knob (N): easy 15%, normal 0%, hard 0%.
  - **Start at top-left, goal at bottom-right** (distance-transform maxima). Farthest-by-graph is an optional variant labeled N.
  - At most 6 large items (`MAX_LARGE_ITEMS`) at distance-transform maxima.
  - Small items sit on inset rings about 0.9 D and 2.3 D from the edges, spaced about 1.5 D apart, targeting about 1 per 10 D² of island area. Calibrate to `docs/reference/stage-format.md` §8.
  - Restart points go on the same inset rings.
  - Rails cover about 90% of island outlines, open at bridge and elevator mouths.
- **Heights (R: the 2013 method is unknown):**
  - `level` is a float in D. The 2013 range is about 9–23 D above the ground plane, so use a documented heuristic, e.g. tree depth plus DOM depth mixed with seeded noise, then clamped.
  - Where two connected islands differ in height, use a **ramp** if the slope is ≤ 0.176 over the bridge length. Otherwise use an **elevator** (E: short gaps with 40–80 px, or about 3–6 D, rises). The builder should *prefer* height assignments that keep most edges rampable.
- **Time:** `timeLimitSec = TIME_LIMIT_SEC_DEFAULT` (300, E). Drop the route-length formula. Phase 09 checks that par fits.
- **Validation:** the new `validateStage` (slope, elevator shape, `size` bounds, ≤ 6 large items) must pass for every fixture × slice × difficulty × seeds 1–5.
