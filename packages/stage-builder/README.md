# @wwm/stage-builder

Screenshot + DOM → `StageData` (contracts §3/§4): islands, bridges, elevators, a maze, items, restart points and
guardrails. This is a pure TypeScript reimplementation of Saqoosha's 2013 OpenCV/Boost `stage_builder`. It is
deterministic and synchronous, and it has no DOM, Node or WASM dependencies in the core, so it runs in a Worker, a
browser and Node.

## API
```ts
import { buildStage, sliceCount, BUILDER_VERSION, BuildError } from '@wwm/stage-builder';

const n = sliceCount(capture);                       // balanced slices of ≤ 1700 px (contracts §9 CCR5)
const { stage, debug } = buildStage({ capture, image, sliceIndex: 0, seed: 1, difficulty: 'normal' });
// stage.texture.path === '' → the caller crops the screenshot to stage.source.slice and stores it.
```
- `buildStage(input, { params? })` → `{ stage, debug }`. `debug` is a `DebugLayersEx`: the contract `DebugLayers`
  plus extra layers for the debugger (`semanticMask`, `landMask`, `lostMask`, `cellRgb`, `safeSpots`, `targetLevels`,
  `treeEdges`, `attempt`, …). If `validateStage` fails, the builder rerolls with `seed+1 … seed+4`. After that it
  throws `BuildError` (`code: 'BUILD_FAILED'`, `reasons[]`).
- `buildStageUnchecked(input)` does the same but never throws. The last attempt's validation errors go in
  `debug.validationErrors`. The debugger uses it.
- `stageStats(stage)` / `statsRows([...])` give scale-free statistics (in ball diameters D), used to compare against
  the 2013 stage.
- `DEFAULT_PARAMS`, `resolveParams(overrides)`: every tunable, with its provenance, lives in `src/params.ts`.
- `sha256HexSync(text)` produces the same digest as the schema's async `sha256Hex`. `stageId` =
  `sha256(captureId|sliceIndex|seed|BUILDER_VERSION|difficulty)`, as in `computeStageId`.
- `@wwm/stage-builder/node` (Node only): `loadCapture(slug)`, `listCaptureSlugs()`, `loadReferenceStage()`,
  `decodePng`/`encodePng`.

Stage coordinates are **stage-local** px (the slice's top-left is the origin). `level` is a float in D. The builder
samples the screenshot at `capture.screenshot.scale` (image px = page px × scale), so DPR 1 and DPR 2 captures give
the same geometry (tested).

## Pipeline (one module per step)
| Step | Module | What it does | Source |
|---|---|---|---|
| 1 | `grid.ts` | 3 px cells over the slice, average color per cell | N |
| 2 | `background.ts` | dominant color (media rects excluded) + `capture.backgroundColor` = background. **Large** elements' own `bg` become local background. ΔE76 in Lab | E (2013 removed the most common color) + N |
| 3 | `semantic.ts` | fills media/button/input rects solid and pads text lines, joining lines of one element into a paragraph block. Only visible rects count | E (2013 filled `img` rects) + N |
| 4 | `morphology.ts` | open pixel mask → OR semantic → horizontal close → fill small holes → open (cuts necks) | ≈ 2013 `dilate → blur → threshold` |
| 5 | `islands.ts` | union-find labeling, split oversized components along natural gaps, thicken one-line strips, fill ≤ 2-cell inlets inside one island, drop islands that can't hold a 2 D disc | N |
| 5b | `walkable.ts` | (03b) cut islands at necks narrower than the ball when both sides are island-sized; label each island's **ball-walkable** parts (final polygons rasterized at 1.5 px, eroded by r + 1 px) and keep the largest as its main part | N |
| 6 | `contours.ts` | exact lattice outline → Douglas–Peucker → small corner bevel; simple rings, contract orientation. Diagonal-only contacts are filled within one island and **cut between two** (03b) | N |
| 8 | `bridges.ts` | **cardinal-only** candidates: per-row/column rays to the next island, and the best band per pair that fits a 2.5–3.6 D deck clear of third islands. (03b) Rejects bands whose side rails would run > r over their island, or whose mouth doesn't lead (rolling straight in) to the island's main walkable part | E + N |
| 9 | `maze.ts` | randomized DFS spanning tree from the top-left island (non-overlapping decks, and (03b) no deck whose rail stubs would pinch an island shut). Easy adds 15 % loops | E (+N loops) |
| 7 | `levels.ts` | float heights 9.3–23.2 D: top→bottom trend + chrome bump + noise, walked along the tree within the ramp slope. Short gaps can become elevators (3.7/5.6/7.4 D rises). (03b) A lift needs a rise ≥ 3.7 D and main-walkable ground 1 D beyond both platform ends, and its lower platform must not cut its island; ramps need ≥ 1 D and straight mouths | R/N (2013 method unknown) |
| 10 | `placement.ts` | distance-transform safe spots. Start at the top-left, goal at the bottom-right, ≤ 6 large items, small items on 0.9/2.3 D rings 1.5 D apart, restart points on 0.6/1.3 D rings | E |
| 10c | `portals.ts` | (Phase 13) link portals: ≤ `MAX_PORTALS` links with an `href` become portals. Junk/chrome/counter labels, files and wiki meta pages are skipped; off-site targets rank first, then label quality and type size (seeded tie-break); one per href/label, a repeated host costs 1.5. Each sits on the island covering most of the link's rect, as close to the link text as possible, on reachable ground, ≥ a ball radius (ideally 0.85 × the portal radius) from the edge, ≥ 4 D from start and goal, ≥ 2 D from mouths and large items, ≥ 6 D from other portals. Small items inside a portal ring are removed | N |
| 11 | `rails.ts` | outline minus bridge/elevator mouth boxes → open polylines on the outline | E |
| 12 | (build) | `timeLimitSec` = 300 | E |
| 13 | `build.ts` | orchestration, provenance, ids, `validateStage` + rerolls; (03b) a reachability audit (rail stubs + lift footprints as walls) also triggers a reroll | — |

**Difficulty (03b, all N; `DIFFICULTY_PARAMS` in `params.ts`):** easy = 15 % loops, gentler heights (noise 3 D,
50 % flat, lifts 60 %). normal = the calibrated defaults. hard = the narrowest legal decks (2.67 D), noise 5 D, 20 % flat,
every eligible gap a lift, restart points only on the 1.3 D ring 4 D apart, and 2 D rail gaps every 16 D of rail.
Caller `params` override the difficulty levers.

**Playability (03b):** every mouth, lift end, start, goal, item and restart point is on (or within pickup reach of)
its island's main walkable part, so a ball can roll to everything. `tools/batch-eval` with `@wwm/solver` is the
end-to-end check (builder 0.4.0: 819/819 stages solved, none needing a jump; builder 0.5.0 on the 28 captures kept
for publication: 666/666).

**Link portals (Phase 13, builder 0.5.0):** every stage carries `portals` (possibly `[]`). Legacy fixtures get
their link targets from `fixtures/builder/links/<slug>.json` (`loadCapture` merges them; the web app does the same
through `@wwm/stage-builder/links`). `node packages/stage-builder/scripts/portals.ts [slug …]` lists the portals per
slice. On the 7 fixtures: Hacker News 6 story links (all off-site), every Wikipedia slice 6 article links.

Islands the maze can't reach (no cardinal bridge fits) are dropped, and a provenance note records it. A slice with
no content gets one plain fallback island, so a run never breaks.

## Tests
`pnpm vitest run --project @wwm/stage-builder` runs:
- a unit test per module on synthetic inputs (two rectangles → 2 islands + 1 bridge, and others)
- end-to-end synthetic builds (determinism, stageId, DPR 2 equivalence, slices, fallback, loops, `BuildError`)
- the fixture matrix: every `fixtures/captures/*` × slice × difficulty × seeds 1–5 passes `validateStage`
- golden snapshots `fixtures/builder/<slug>.normal.seed1.json` for every capture (the eval-* set too), count ranges, and < 1.5 s per page
- the 03b playability invariants per build (lift rises, rail depth over islands, no reachability issue) and `test/playability.test.ts`

Regenerate the goldens after an intentional change with `node tools/stage-debugger/src/cli/goldens.ts`, and check
the debugger screenshots before committing.

Typecheck: `pnpm --filter @wwm/stage-builder typecheck`.
