# Build log: Phase 03 (Stage Builder)

- **Agent:** Claude Opus 5.5 (1M context), run as a Claude Code sub-agent in an isolated git worktree (branch `worktree-agent-a91087fbd2a1355b2`).
- **Start / end:** 2026-09-25 ~08:05Z → ~08:45Z.
- **Environment:** macOS (arm64), Node 26.0.0, pnpm 11.5.0, Playwright 1.63 Chromium, Vite 8.3.

## Instructions received (summary)
- Execute `plans/phase-03-stage-builder.md`. Its "G0 updates" section overrides the earlier text: faithful 13.5 px/D scale, slices, cardinal bridges, a spanning-tree maze, float levels with ramps/elevators, and a fixed 300 s time limit.
- Use the real 2013 AID-DCC stage (`pnpm ref:fetch` → `reference/`, never committed) as a statistical and visual target, and report a comparison table.
- Handle any `screenshot.scale` (all fixtures are DPR 1).
- Own only `packages/stage-builder/**`, `tools/stage-debugger/**` and `fixtures/builder/**`. Don't edit `packages/schema`; file CCRs instead.
- Recognizability is the top quality bar. Screenshot the debugger for every fixture, look at the images, and iterate.

## What was built
- `@wwm/stage-builder` (pure TS, no dependencies beyond `@wwm/schema`): 13 step modules (grid, background, semantic, morphology, islands, distance transform, contours, bridges, maze, levels, placement, rails, build) plus `params.ts` (every magic number, tagged E/C/N), `stats.ts` (scale-free statistics), a sync `sha256.ts` (`buildStage` is synchronous, and `computeStageId` is async WebCrypto), and a Node-only `./node` subpath with fixture loading and a PNG codec.
- `@wwm/stage-debugger`: a Vite page (worker build, layer toggles, parameter sliders, hover provenance, stats against 2013, timings) plus three CLIs: `report` (validation matrix + stats table), `shots` (Playwright screenshots) and `goldens`. `src/draw.ts` is exported for Phase 10.
- `fixtures/builder/<slug>.normal.seed1.json`: 7 golden stages (4–70 KB each).
- Screenshots: `docs/build-log/assets/phase-03/<slug>.png` (7 fixtures at the time, slice 0, normal, seed 1; the news-site one was removed before publication) and `debugger-ui.png`.

## How the algorithm maps to 2013
| 2013 (case study / WWMMM) | Here | Label |
|---|---|---|
| remove the most common color | dominant 15-bit color bin (media rects excluded) + `capture.backgroundColor`, ΔE76 < 9 in Lab | E + N |
| dilate → GaussianBlur → threshold, fill `img` rects | pixel mask opening, semantic fill (media solid; text lines padded, lines of one element joined), horizontal closing, hole fill, neck opening | E (intent) + N (method) |
| — | large elements' own `bg` = local background (colored bands and page wrappers don't become one plain) | N (brief) |
| islands = blobs | union-find labels; split > 2500 D² along natural gaps; thicken one-line strips; drop anything that can't hold a 2 D disc | N |
| bridges: nearest island left/right/up/down | per-row/column rays, best band per island pair, deck 2.5–3.6 D, clear of third islands, ≥ 60 % mouth contact | E |
| randomized DFS spanning tree from top-left | same, with non-overlapping decks; easy adds 15 % loops | E (+N) |
| start top-left, goal bottom-right, ≤ 6 large items at distance-transform maxima | same (maxima taken at the centre of the ridge) | E |
| small items / restart points on inset contours | distance-transform bands at 0.9/2.3 D (items, 1.5 D apart) and 0.6/1.3 D (restarts) | E |
| rails along outlines, cut at bridge mouths | outline minus mouth boxes → open polylines, vertices on the outline | E |
| heights: continuous 9–23 D, ramps ≤ 10°, elevators on tiny gaps | trend + chrome bump + noise, walked along the tree within the slope limit; elevators with rises of 3.7/5.6/7.4 D | R/N (method unknown) |

## Attempts that failed, and why
1. **Per-line padding to the minimum thickness** (every text line grown to ≥ 2.2 D) merged whole lists. HN's 30 stories became 4 blobs, because the rows are only 5 px apart. I moved the minimum-thickness rule to a per-island `thickenThin` step, which grows thin components by up to 3 cells and keeps a one-cell moat to other islands. Text padding went down to 0.1 × line height.
2. **A vertical closing** (1 cell) had the same effect, bridging the 1–2-cell gaps between list rows. It's now horizontal only.
3. **With vertical padding that small, a paragraph's own leading (≈5 px) split it into lines.** The fix was to join consecutive lines *of the same element* over their shared x-range. Gaps between elements (paragraphs, list rows) survive, so HN rows and Wikipedia paragraphs each become one island.
4. **Safe spots on strips** tie-broke to the leftmost cell in raster order, so start, goal and large items sat at island ends. They're now the ridge cell nearest the ridge centroid.
5. **A synthetic 3×3 image grid became background.** The images covered most of the page, so their color was "dominant". Media rects are now excluded from the dominant-color histogram. 2013's plain "most common color" rule would have failed the same way.
6. **Debugger screenshots timed out** because `?zoom=0.6` wasn't an `<option>`, so the canvas was 0×0. The page now adds unknown zoom values.
7. **Minor:** Biome `useIterableCallbackReturn` flagged `forEach` arrow returns, and HTML buttons needed a `type`. Two unit-test expectations were wrong (raster label order, and the edge-erosion convention), and I fixed the tests rather than the code.

## Manual human interventions
None.

## Test evidence
- `pnpm check`: green. Typecheck, Biome, and Vitest with **21 files and 200 tests** across the repo. The stage builder has 69 tests (about 29 s, mostly the fixture matrix) and the debugger 3.
- **Validation matrix:** 7 fixtures × every slice (21 slices) × easy/normal/hard × seeds 1–5 = 315 stages. All pass `validateStage` with **0 rerolls** (`node tools/stage-debugger/src/cli/report.ts --seeds 1-5 --difficulties easy,normal,hard`).
- **Determinism:** rebuilding the same input gives byte-identical `JSON.stringify(stage)` (synthetic and every fixture). The goldens match.
- **DPR:** a synthetic capture at scale 2 gives exactly the same contours and bridges as at scale 1. `texture` is `{width: 1280, height: 800, scale: 2}`.
- **Performance** (Node 26, M-series laptop, warm): the news-site fixture 1280×6000 (4 slices; removed before publication) in 437 ms, wikipedia in 372 ms, image-gallery in 359 ms, govuk 1280×4550 in 253 ms, mdn in 216 ms, hn in 91 ms, example in 37 ms. The budget is 1.5 s per page, and the test asserts it.
- **Recognizability:** I reviewed the screenshots in `docs/build-log/assets/phase-03/`.
  - HN: one island per story row, with the orange bar as its own island.
  - Wikipedia: one island per paragraph, the coin image with its caption, and the header search bar.
  - The news-site fixture (removed before publication): every photo, headline and summary is its own island.
  - GOV.UK: the title on the blue band, each card link and the icons.
  - MDN: headings and code blocks on the dark page.
  - Gallery: photos, the language list and the caption blocks.
  - example.com: its 3 text lines.

### Comparison with the 2013 AID-DCC stage (slice 0, normal, seed 1; lengths in ball diameters D)
| metric | 2013 AID-DCC | news site† | example-sparse | govuk-card-grid | hn-front | image-gallery | mdn-dark-docs | wikipedia-article |
|---|---|---|---|---|---|---|---|---|
| islands | 38 | 23 | 3 | 27 | 25 | 22 | 18 | 19 |
| links (bridges + elevators), tree? | 37 (tree) | 22 (tree) | 2 (tree) | 26 (tree) | 24 (tree) | 21 (tree) | 17 (tree) | 18 (tree) |
| island area D² min / median / max | 6 / 90 / 2712 | 23 / 77 / 1632 | 20 / 38 / 140 | 16 / 94 / 573 | 12 / 76 / 210 | 27 / 96 / 1161 | 10 / 43 / 396 | 19 / 112 / 757 |
| largest island share of land | 52 % | 38 % | 70 % | 18 % | 8 % | 30 % | 19 % | 18 % |
| land share of stage | 44 % | 41 % | 4 % | 31 % | 30 % | 36 % | 25 % | 41 % |
| island smaller side D min / median / max | 1.1 / 4.4 / 29.3 | 2.4 / 5.3 / 25.8 | 2.4 / 2.4 / 2.4 | 2.4 / 3.6 / 14.0 | 2.2 / 2.7 / 5.1 | 2.4 / 3.3 / 20.9 | 2.4 / 2.9 / 6.9 | 2.0 / 3.6 / 22.7 |
| contour vertices median | 9 | 20 | 32 | 24 | 44 | 24 | 12 | 36 |
| bridges flat / ramp | 13 / 18 | 11 / 10 | 2 / 0 | 11 / 13 | 11 / 10 | 11 / 10 | 6 / 8 | 8 / 9 |
| elevators | 6 | 1 | 0 | 2 | 3 | 0 | 3 | 1 |
| bridge length D min / median / max | 0.5 / 3.8 / 42.5 | 1.1 / 2.0 / 15.1 | 0.7 / 0.9 / 0.9 | 0.7 / 6.9 / 38.2 | 0.7 / 0.7 / 11.6 | 0.7 / 2.4 / 35.3 | 0.9 / 4.7 / 11.1 | 0.7 / 2.0 / 12.4 |
| bridge width D min / median / max | 1.57 / 3.61 / 3.61 | 2.67 / 3.56 / 3.56 | 3.56 / 3.56 / 3.56 | 3.33 / 3.56 / 3.56 | 3.33 / 3.56 / 3.56 | 2.89 / 3.56 / 3.56 | 3.56 / 3.56 / 3.56 | 2.67 / 3.56 / 3.56 |
| max ramp slope | 0.176 | 0.170 | 0.000 | 0.170 | 0.170 | 0.170 | 0.169 | 0.170 |
| elevator rise D min / max | 3.70 / 7.41 | 7.41 / 7.41 | – | 5.56 / 7.41 | 3.70 / 7.41 | – | 5.56 / 7.41 | 5.56 / 5.56 |
| small items | 501 | 366 | 0 | 330 | 202 | 182 | 346 | 157 |
| small items per 10 D² of land | 0.96 | 0.85 | 0.00 | 1.01 | 0.80 | 0.47 | 1.62 | 0.37 |
| islands with small items | 58 % | 39 % | 0 % | 48 % | 44 % | 36 % | 39 % | 37 % |
| small item spacing D median | 1.48 | 1.46 | – | 1.47 | 1.47 | 1.46 | 1.46 | 1.45 |
| large items | 4 | 3 | 1 | 3 | 2 | 3 | 2 | 3 |
| restart points | 667 | 867 | 53 | 925 | 788 | 854 | 582 | 945 |
| rail coverage of outline | 90 % | 91 % | 92 % | 90 % | 93 % | 91 % | 88 % | 94 % |
| levels D min / median / max | 9.3 / 17.4 / 23.2 | 10.6 / 17.7 / 18.4 | 17.7 / 17.7 / 17.7 | 13.5 / 20.7 / 23.2 | 12.1 / 19.4 / 21.3 | 15.1 / 17.3 / 21.2 | 12.4 / 19.8 / 20.8 | 13.3 / 20.3 / 21.1 |

† An internal news-site fixture, removed before publication together with its screenshot.

**Close to 2013:**
- maze topology (always a spanning tree on normal)
- land share (30–45 % on content pages)
- median island area (≈ 75–110 D²)
- small-item spacing, density and inset rings
- rail coverage (≈ 90 %)
- deck width (3.56 D, the 2013 median 3.61)
- ramp slopes at the 10° limit
- large items (2–4)

**Deliberately different:**
- **No islands narrower than 2 D.** The contract minimum is `MIN_ISLAND_SIZE_PX`. 2013 had 1.1 D strips.
- **No decks narrower than 2.5 D.** That's the contract minimum.

**Lower than 2013, and why:**
- **Fewer islands per slice (18–27 vs 38).** Real pages have fewer separable blocks per 1700 px than PARTY's grid-laid site.
- **Fewer elevators (0–3 vs 6).** They need gaps under 1.2 D.
- **Busier outlines (median 12–44 vertices vs 9).** Contours follow ragged text edges.

## Remaining defects and follow-ups
- **Level heuristic (R/N).** The 2013 method is unknown. Heights don't use the full 9–23 D range on every stage, because short bridges only allow tiny ramp rises. Phase 09 should check traversal physically, especially elevator placement and long ramps.
- **Unreachable islands are dropped.** When no cardinal bridge fits (e.g. a tag too narrow for a 2.5 D deck), the island disappears. It shows as the orange "dropped land" layer, with a provenance note. Across all 21 fixture slices (normal, seed 1) this happens once (wikipedia slice 0). Content thinner than 2 D after thickening, such as MDN's small outlined "Start Free" button, is dropped as too small (the red layer).
- **Busy contours.** Contours on ragged text keep more vertices than 2013 (DP ε = 1.5 px is conservative, to keep islands 1 cell apart). The renderer and physics should be fine, but a smoothing pass that checks for overlaps could cut this further.
- **Oversized splitting** (> 2500 D²) is a tile split along natural gaps. No fixture slice currently triggers it (the largest island was the news-site fixture's hero photo, at 1632 D²), so only the unit test covers it.
- **The 2013 reference render** (`--reference`, `aid-dcc-reference.png`) is for local comparison only and is not committed.

---

# Phase 03b: builder fixes from the solver, difficulty, playability validation in the Worker

- **Agent:** Claude Opus 5.5 (1M context), Claude Code sub-agent in an isolated git worktree
  (branch `worktree-agent-a9059e0a3ac981b9a`).
- **Date:** 2026-09-25 (one session). **Environment:** macOS, Apple M5 Max, Node 26.0.0, pnpm 11.5.0, wrangler 4.140
  (local workerd), Playwright Chromium.

## Instructions received (summary)
Fix the five builder issues the Phase 09 solver filed (`phase-09-builder-issues.md`) at the root, in the builder and,
for BI-3, also in physics. Make `hard` really differ from `normal` in a faithful way. Let `loadRapier()` take a
precompiled WASM module so workerd can run the solver, wire `DEFAULT_HOOKS.validatePlayable` for real, reroll
unplayable slices in the pipeline, and measure the per-slice cost in the Worker. Re-run the batch eval and report
before/after. Regenerate goldens and the fixture replay.

## What changed (builder 0.3.0 → **0.4.0**)
- **BI-1, narrow necks** (new `walkable.ts`, plus `islands.ts`, `contours.ts`, `bridges.ts`, `maze.ts`, `build.ts`):
  - **Walkable parts.** The final island polygons are rasterized at 1.5 px and eroded by the ball radius + 1 px
    (`walkClearancePx`). Their components are the parts a ball can roll between; the largest is the island's *main*
    part. Mouths (reached by rolling straight in along the deck, on land at least a ball wide), lift ends, start,
    goal, large items (safe spots), small items (within pickup reach) and restart points only use it.
  - **Root cause found on HN:** `removeDiagonalPinches` *filled* a cell wherever two islands touched only at a
    corner, fusing two text rows through a one-cell neck. It now **cuts** such contacts between two different
    islands (and still fills within one). HN slice 0 went from 25 islands (several split) to 34 clean ones.
  - Island-sized parts joined by a sub-ball neck are cut apart (`splitAtNecks`), and water gaps ≤ 2 cells wide inside
    one island are filled (`fillInlets`, ≈ 2013's dilate/blur/threshold fusing a title and its meta line).
  - Deck side rails run the full a→b length in physics, renderer and solver, so each deck leaves short rail stubs on
    its islands. On thin strips, stubs from opposite sides pinched the island shut (github-docs-ja). The maze carver
    now skips a deck whose stubs would disconnect an island (a cheap distance test first, a flood fill only when
    stubs are close).
  - A final **reachability audit** (rail stubs and lower lift platforms as walls) rerolls the seed if an island's
    links can't all be reached. `buildStage` returns the first clean attempt, else the first valid one.
- **BI-2, lifts without room:** a lift needs main-walkable ground 1 D beyond both platform ends
  (`elevatorLandingD`), and its lower platform, grown by r + 1 px, must not disconnect any anchor of either island
  (its safe spot, the ground behind each link; other decks' rail stubs count as walls). Otherwise the edge stays a
  bridge.
- **BI-3, low lifts:** `elevatorMinRiseD` = 3.7 D (E: the smallest 2013 rise; physics pinned the ball below
  1.463 D). Loops with a smaller rise are dropped. (Physics fix: Phase 05b.)
- **BI-4, rails on the island:** bands whose side rails would run more than a ball radius over their island are
  rejected (`railDepthOnIslands`). The renderer and the solver draw the rails over the full a→b, so clipping them only
  in physics would have split the three; the builder fix keeps them consistent.
- **Two snags the new eval exposed** (the last stages that still needed a recovery jump): a ramp whose mouth had a
  6 px notch (a step of slope × depth) and a 12 px ramp whose two deck-end seams sit together. Ramps now need
  straight mouths (≤ 4.5 px, `rampMouthMaxDepthPx`) and a span ≥ 1 D (`rampMinSpanPx`); a shorter ramp would rise
  ≤ 0.17 D anyway.
- `elevatorChance` 0.6 → 0.85 (C): the new checks turn many eligible gaps back into bridges.

### Difficulty (BI-5; `DIFFICULTY_PARAMS`, all **N**: 2013 had no known difficulty setting)
| lever | easy | normal | hard |
|---|---|---|---|
| loops (alternative routes) | 15 % | 0 | 0 |
| deck width max | 3.6 D | 3.6 D | 2.7 D (2.67 D on the 3 px grid; 2013 decks 1.6–3.6 D, contract min 2.5 D) |
| level noise / flat chance / lift chance | 3 D / 50 % / 60 % | 4 D / 35 % / 85 % | 5 D / 20 % / 100 % |
| restart points | 0.6 + 1.3 D rings, 1.6 D apart (E) | same (E) | 1.3 D ring only, 4 D apart |
| rail gaps | none | none | 2 D every 16 D of rail (E-anchored: 2013 rails ≈ 90 % of the outline) |

Measured over every capture × slice, seed 1 (91 slices each):

| | easy | normal | hard |
|---|---|---|---|
| deck width median | 3.56 D | 3.56 D | 2.67 D |
| rail coverage of the outline | 0.890 | 0.897 | 0.845 |
| restart points per island | 35.9 | 35.8 | 8.9 |
| lifts (share of links) | 75 (3.5 %) | 156 (7.8 %) | 180 (9.0 %) |
| ramps (share of bridges) | 27.6 % | 35.2 % | 50.7 % |
| loops | 136 | 0 | 0 |
| smallest lift rise | 3.70 D | 3.70 D | 3.70 D |

The goal stays at the bottom-right safe spot on every difficulty (E). The bot doesn't feel narrow decks, rail gaps or
restart spacing, so hard's par is only about 2.5 s longer than normal's. Those levers are aimed at human players.

## Worker (03b)
- `apps/worker/src/physics-wasm.ts`: one loader for workerd, `loadRapier({ wasmModule })` with wrangler's compiled
  `.wasm`. Phase 10's `routes/scores-wasm.ts` shim is gone (the file now re-exports this loader), so replay
  verification and playability validation share one mechanism.
- `builder.ts` `solverHook`: in workerd it initialises Rapier from the module first, then runs `@wwm/solver`
  `validatePlayable`, and returns `parTimeSec` and `solveMs`. It fails open only if the physics can't load or the
  solver throws, so an infrastructure fault can't block every build.
- `pipeline.ts`: an unplayable slice is rebuilt with seed+1 … (`playableSeeds`, default 4) before the job fails with
  `UNPLAYABLE` (listing every seed's reason). The stage ID follows the seed used; the run keeps the requested seed.
  Timings per slice: `build.i`, `solve.i` (all seeds), `seeds.i`, `par.i`, `solveMs.i`, `validate.i`.
- **Verified in workerd** (`test/solver.workerd.test.ts`: the production wrangler config with a test-only entry,
  `src/testing/solver-probe-worker.ts`; also run by hand under `wrangler dev`): user agent `Cloudflare-Workers`; the
  solver solves handmade-simple (par 20 s, 86 ms) and rejects the same stage without its lift.
- **Cost per slice in local workerd** (build + solve every slice of 10 pages, normal, seed 1; 30 slices):
  build 47–239 ms (p50 ≈ 125 ms), solve 9–147 ms (p50 ≈ 85 ms), PNG decode 9–160 ms (once per page in the
  pipeline). The whole request took 67–589 ms per slice, the first one including the cold Rapier init. That's about
  half of what the Phase 09 proposal assumed: a 4-slice page is ≈ 1–2 s of CPU without rerolls, far inside
  `cpu_ms` = 300,000 and the 30 s slice-0 budget. (Local workerd's clock advanced during CPU work here. Production
  freezes timers during execution, so use request wall time rather than in-Worker timings there.)

## Results: batch eval before/after (`fixtures/eval/report.json`, 35 captures, 819 stages)
| | before (builder 0.3.0, physics 0.1.0) | after (builder 0.4.0, physics 0.2.0) |
|---|---|---|
| solved easy / normal / hard | 255 (93.4 %) / 257 (94.1 %) / 257 (94.1 %) | **273 / 273 / 273 (100 %)** |
| failure classes | elevator-blocked 37, narrow-neck 13 | none |
| stages that needed JUMP (planned or recovery) | 17 / 20 / 20 | **0 / 0 / 0** |
| solver audit: stages with a split island | 85 / 78 / 78 (617 issues) | **0** |
| runs fully playable | 283 / 315 (89.8 %) | **315 / 315** |
| par p50 / p90 / max, normal | 49.8 / 78.1 / 133.4 s | 48.9 / 73.0 / 118.2 s |
| par p50, easy / hard | 44.6 s / same as normal | 43.7 / 51.4 s |
| stars 1–5, normal | 29/141/68/13/6 | 30/168/67/8/0 |
| solve CPU p50 / p90 / max | 119 / 245 / 548 ms | 91 / 137 / 350 ms |
| build p50 / max | 147 / 670 ms | 172 / 735 ms (the walkable raster) |
| islands (all stages) | 18,675 | 18,738 |

Screenshots: `docs/build-log/assets/phase-09/dashboard-after.png`, `dashboard-failures-after.png` ("No failures"),
`dashboard-cards-after.png`. The files without `-after` show the before state.

> **Publication note (2026-09-25):** before the repo went public, seven captures whose content we had no clear right to redistribute were removed: an internal news-site fixture from Phase 02, and six eval pages (a text-only news site, a classifieds site, a CSS-framework marketing page, a Linux kernel portal, a digital library home page and a Google experiments gallery). The figures in this log were measured with them and are left as recorded. The re-run on the remaining 28 captures is in `fixtures/eval/report.json`; see `NOTICE.md`. In the dashboard screenshots, the removed pages' card thumbnails are blanked out.

## Attempts that failed, and why
1. **Walkability on the 3 px work grid** matched the solver on most stages but left 3 stages needing jumps: a 15 px
   strip is walkable on that grid, while the bevels on the final outline made it 13–14 px. Moving the analysis to the
   final polygons at 1.5 px (and r + 1 px) fixed them.
2. **A 2 D mouth search** dropped HN's header and top rows (25 → 20 islands, 204 → 110 items). The real cause wasn't
   depth but the diagonal-pinch fill fusing rows. Fixing that (and following lanes straight in) restored them.
3. **The lift fit checked only the landing points.** Two lifts on one thin strip cut it between their footprints
   (python.org). Hence the anchor-connectivity check with footprints as walls, then with rail stubs too, then with a
   1 px margin (a pinch exactly at the ball radius, github-docs-ja hard).
4. **The physics partner-platform fix alone didn't free the ball on a 1.04 D lift** in the new test: carried down at
   the platform's upper end, it sat partly under the *upper island's* slab. Hence the along-axis easing (Phase 05b).
5. **`solver.workerd.test.ts` hung** under `unstable_startWorker`: the test entry didn't export the Durable Object
   classes the production config binds. Re-exporting them fixed it.
6. **Ramp minimum span:** without one, a 12 px ramp still snagged the bot (1 in 3,175 ramps). At 1.5 D, ramps fell to
   36 % of bridges. 1 D keeps 42 % at normal with no snag.

## Contract and fidelity notes
- No contract change. The lift footprint, the deck rails and every constant are unchanged.
- **Fewer lifts than 0.3.0** (normal: 586 → 409 over 273 stages). Most of the removed ones were the broken ones. Still
  below 2013's 6 per stage, because real pages rarely have a ≤ 1.2 D gap with room on both sides.
- **Fewer ramps** (normal: 58 % → 42 % of bridges; 2013: 65 %). The sub-1 D ramps are gone; they rose ≤ 0.17 D.
- Goldens regenerated for all 35 captures. **The eval-* set now has goldens too** (1.9 MB in total; slice 0, normal,
  seed 1, byte-identical rebuild). Its full seed × difficulty matrix stays in the batch eval (about 100 s in Vitest
  otherwise).

## Test evidence
- `pnpm check`: green (typecheck, Biome, Vitest: 47 files passed and 2 skipped; 644 tests passed and 12 skipped).
- `@wwm/stage-builder` (104 tests): the 7-fixture matrix now also asserts, on every build, lift rises ≥ 3.7 D, deck
  rails ≤ r over their islands and no reachability issue. `test/playability.test.ts` covers necks, walkable parts,
  pinch cutting, inlet filling, rail gaps and the difficulty levers (hard ≠ normal, narrower decks, lower rail
  coverage, under half the restart points, easy has loops).
- `@wwm/worker`: the pipeline reroll (the stage ID follows the seed; UNPLAYABLE lists every seed) and
  `solver.workerd.test.ts` (3 tests in workerd). `worker.integration.test.ts` (13) still passes with the hook live.

## Cross-ownership edits (flag for the orchestrator)
- `packages/solver/test/solver.test.ts`: the reroll test asserted that python.org slice 1 seeds 1–2 are unplayable,
  which was the very bug fixed here. It now forces seed 1 unplayable, so it still exercises the reroll with the real
  builder.
- `apps/worker/src/routes/scores-wasm.ts` (Phase 10): the shim is replaced by a re-export of the shared loader, as the
  brief asked. New files: `apps/worker/src/physics-wasm.ts`, `src/testing/solver-probe-worker.ts`,
  `test/solver.workerd.test.ts`.

## Remaining defects and follow-ups
- **Solver (Phase 09):** `nav.ts` still marks lifts under 1.463 D as `trapped`. With physics 0.2.0 they're rideable,
  and the builder no longer makes them, so this is harmless.
- **Items off the main part** are no longer placed, so pages with many unreachable fragments carry fewer items there.
- **Par** is logged per slice (`par.i`) but not stored. Phase 10's `par × 0.5` plausibility check still needs a home.
- Hard's levers (narrow decks, rail gaps, sparse restarts) aren't felt by the bot. Human playtests (G2) should tune
  them.
