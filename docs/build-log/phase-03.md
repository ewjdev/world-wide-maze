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
- Screenshots: `docs/build-log/assets/phase-03/<slug>.png` (7 fixtures, slice 0, normal, seed 1) and `debugger-ui.png`.

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
- **Performance** (Node 26, M-series laptop, warm): bbc 1280×6000 (4 slices) in 437 ms, wikipedia in 372 ms, image-gallery in 359 ms, govuk 1280×4550 in 253 ms, mdn in 216 ms, hn in 91 ms, example in 37 ms. The budget is 1.5 s per page, and the test asserts it.
- **Recognizability:** I reviewed the screenshots in `docs/build-log/assets/phase-03/`.
  - HN: one island per story row, with the orange bar as its own island.
  - Wikipedia: one island per paragraph, the coin image with its caption, and the header search bar.
  - BBC: every photo, headline and summary is its own island.
  - GOV.UK: the title on the blue band, each card link and the icons.
  - MDN: headings and code blocks on the dark page.
  - Gallery: photos, the language list and the caption blocks.
  - example.com: its 3 text lines.

### Comparison with the 2013 AID-DCC stage (slice 0, normal, seed 1; lengths in ball diameters D)
| metric | 2013 AID-DCC | bbc-news-grid | example-sparse | govuk-card-grid | hn-front | image-gallery | mdn-dark-docs | wikipedia-article |
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
- **Oversized splitting** (> 2500 D²) is a tile split along natural gaps. No fixture slice currently triggers it (the largest island is bbc's hero photo, at 1632 D²), so only the unit test covers it.
- **The 2013 reference render** (`--reference`, `aid-dcc-reference.png`) is for local comparison only and is not committed.
