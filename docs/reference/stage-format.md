# WWMMM stage format: semantics and calibration targets

Fixture: `reference/wwmmm/http-aid-dcc.json` (Katamari-Inc/WWMMM @ `be2bea8`, 33,748 bytes, sha256 `ba8a6fdf…1377`). Its texture is `reference/wwmmm/http-aid-dcc.png` (1024 × 2048 RGBA, sha256 `0e6e3397…e626`). This is **installation data (dotFes 2013), with no license**. It is used for reference only and never committed.

The semantics below are **evidenced** by the 2013 desktop client code that consumes the same format: `game/object/stage` (`convertCoords*`, `convert2/3`, `uv`, bridge builder) and `game/object/elevator`. The format is the same one the web game received from the stage builder. The fixture's `url` is a dev server (`http://localhost:8089/?99234_48/`) and the page is PARTY's own site, so this is not a preserved public session.

Statistics were computed by the Phase 01 scratch script over the fixture. **D** is the 2013 ball diameter, 10.8 px, used to express targets scale-free.

## 1. Encoding

| Key | Encoding | Meaning |
|---|---|---|
| `title`, `url` | string | Page title and URL. They are shown on the goal pole and the result screen |
| `image`, `mobile_image` | path | Server paths of the stage texture (PC) and a mobile image (probably for the phone's map, **R**). Only the PC texture is in the repo |
| `start`, `goal` | `[x, y, h]` | Page px position and **height** (the 3rd component equals the island's `level`, e.g. start `[44,74,245.02]` sits on island 36 with level 245.02) |
| `islands[]` | `{id, level, contours, guardrails, restartPoints}` | See §2 |
| `bridges[]` | `{start:[x,y], angle, distance, width, level:[h0,h1], type}` | See §3 |
| `small_items`, `large_items` | **flat** `[x,y,h, x,y,h, …]` | 3rd component = `floor(island level)` (all 501 items: −0.97 ≤ h − level ≤ 0) |

**Correction to `research/recovery-evidence.json`:** its counts `small_items: 1503` and `large_items: 12` are *array lengths*. The real counts are **501 small items and 4 large items** (triples). Island (38) and bridge (37) counts are correct. Of the 37 bridges, 31 are static (type 0) and 6 are elevators (type 1).

## 2. Coordinate system and units

- `x` goes right and `y` goes down, in **page px of a fixed 1024 × 1358 stage** (`STAGE_WIDTH/HEIGHT` in `common/config`). Island extents in the fixture are x 1..1022 and y 54..1336.
- `level` and the 3rd component of points are **heights in the same px unit**. They are continuous (e.g. 138.69, 245.02), not integer steps. The client maps everything with `WORLD_SCALE = 0.1`:
  ```js
  v.convert3=function(t){return new THREE.Vector3(t[0]*e.WORLD_SCALE+p,t[2]*e.WORLD_SCALE,t[1]*e.WORLD_SCALE+d)}
  // p = -STAGE_WIDTH/2, d = -STAGE_HEIGHT/2  → world origin at the stage centre, y up = height
  ```
- Fixture heights range from 100 to 250 px (10–25 WU). There are 24 distinct values among 38 islands (median 184.9). The ball radius is 5.4 px, so heights span about 14 ball diameters.
- The texture is a 1024 × 2048 canvas. **Page row 0 sits at texture row 692**, and page rows 0..1358 map to texture rows 692..2048 (`v.uv`, and the client draws the screenshot at y = 692 plus a 16 px stretched top-row band). Island tops, bottoms and a "frame" around them sample the page texture. Island sides and rails are flat-coloured.

## 3. Islands

- `contours` is an array of flat rings `[x0,y0,x1,y1,…]`. Ring 0 is the outer ring and rings 1.. are holes (the client builds `THREE.Shape` + holes). **The fixture has 1 ring per island and no holes.** Rings are **open** (last ≠ first). Every outer ring has **negative shoelace area in raw page coordinates (y down)**, i.e. counter-clockwise as seen on screen. The client ignores orientation anyway: `convertCoords` re-orders rings as needed.
- Vertex counts range from 4 to 95 (median 8). Shapes are mostly axis-aligned rectangles and rounded blobs from the dilate/threshold pipeline.
- The island slab is 5 px (0.5 WU) thick. The side wall runs from `level` down to `level − 5 px`, and the bottom face is drawn 0.5 WU below the top.
- **Size distribution** (area px²): min 727, p25 1,387, median 9,917, p75 12,313, max 316,308 (one large background-ish island, id 25, which is 52% of the total area). Bounding-box smaller side: min 12 px (1.1 D), then many at 21 px (≈2 D), 47, 67, 111, and one at 316. **Narrow strips 1–2 D wide are normal** (text lines).
- Histogram (area): <1k: 2 · 1k–5k: 12 · 5k–10k: 5 · 10k–20k: 18 · 20k–100k: 0 · >100k: 1.

## 4. Guardrails ↔ contours

- `guardrails` is an array of open polylines (flat `[x,y,…]`), 1–4 per island (73 in total, 2–70 vertices).
- **Every guardrail vertex lies exactly on the island contour** (distance 0 for all 936 vertices). Rails are sub-paths of the outline.
- Rails cover **89.8 % of the total outline length**. The gaps are the bridge mouths (and elevator mouths), consistent with the case study ("cut the rails where bridges attach").
- 3D: the client builds each rail as a vertical ribbon from `level + 5 px` to `level + 6 px` (0.5–0.6 WU above the surface, collision mesh = the same ribbon). With a ball radius of 0.54 WU, the rail catches the ball near its equator. It is a **low, thin rail**, not a wall. Bridge side rails use the same design at +6 px. Rail material: friction 0.5, restitution 0.7.

## 5. Restart points

- A flat `[x,y,…]` list per island (1–126 per island, 667 in total). All lie inside their island.
- They sit on **two inset rings: 6 px and 14 px from the edge** (0.56 D and 1.3 D). Spacing along the ring is about 20 px (median nearest neighbour 15 px ≈ 1.4 D).
- Use at runtime (evidenced): respawn at the restart point **of the last-touched island** that is **nearest to the last contact position**.

## 6. Bridges

| Field | Semantics (evidenced) | Fixture distribution |
|---|---|---|
| `start` | Page px point **on the edge of the start island** (distance to the start island's contour is 0 for 35/37, ≤0.5 px for the rest) | — |
| `angle` | Degrees, **cardinal only**: 0 = +x (right), 90 = +y (down the page), 180 = left, −90 = up. The end point is `start + distance·(cos a, sin a)` and lands on the target island's edge (within 0.3 px) | 0: 8 · 90: 7 · 180: 13 · −90: 9 |
| `distance` | Gap length in px | min 4, p25 13, median 41, p75 94, max 459. Histogram: <10: 7 · 10–25: 7 · 25–50: 10 · 50–100: 5 · 100–200: 1 · 200–400: 4 · ≥400: 3 |
| `width` | Deck width in px | {17: 2, 19: 5, 21: 5, 25: 1, 31: 2, **39: 22**}. Median 39 = **3.6 D**, min 17 = **1.6 D** |
| `level` | `[h_start_island, h_end_island]`. It always equals the two islands' `level`s | — |
| `type` | **0 = static bridge/ramp, 1 = elevator** | 31 × type 0, 6 × type 1 |

- **Type 0** is a straight deck from `start` along `angle`, rising linearly by `level[1] − level[0]` over `distance`, with a rail on each side. The **slope never exceeds 0.176 (≈10°)**: static bridges have |Δh|/distance ∈ {0, …, 0.176}. So a big height change is spread over a long bridge (e.g. Δ80.9 px over 459 px). There is no integer "one level" rule.
- **Type 1** has short gaps (4–10 px) and **big height jumps of 40, 60 or 80 px** (multiples of 20, 3.7–7.4 D). The platform is `max(distance, 15)` px long. It spans `[distance − len, distance]` along the axis when rising and `[0, len]` when descending, so it overlaps the island edge because gaps are shorter than 15 px. See bundle-notes §7 for timing.
- **Topology:** 38 islands and 37 bridges, connected from the start island, so **the bridge graph is a spanning tree (a perfect maze)**. This matches the case study's randomized DFS carving. Start (island 36, top-left, `[44,74]`) and goal (island 2, bottom, `[596,1305]`) sit at opposite corners.

## 7. Items

| Metric | Value |
|---|---|
| Small items | 501, on 22 of 38 islands |
| Large items | 4. Three are on the big island 25 (≈100–150 px from its edge), one on island 21 (10 px from the edge) |
| Small per 10k px² of island area | **8.24** overall · 9.19 excluding the giant island · **16.1** on islands that have items |
| Small per 100 px of outline (islands with items) | **4.46** |
| Small nearest-neighbour spacing | median 16 px (**1.5 D**), p25 15.3, p75 22.5 |
| Small item distance from edge | Mostly on inset rings at about 10 px (0.9 D) and 25 px (2.3 D). Min 3 px, max 132 px (a filled interior pattern on the big island) |
| Large per 100k px² | 0.66 |
| Pickup (sensor) radius | 1 WU = 10 px = 1.85 ball radii (ghost sphere from `TetrahedronGeometry(1)`, `collision_flags = 5`) |
| Goal sensor | Ghost cylinder, r = 1 WU (10 px), h = 2 WU. The visual pole is 20 WU tall |

## 8. Calibration targets for Phase 03 (scale-free, in ball diameters D)

The contract ball is 40 px at `PX_PER_METER = 40`. To reproduce the 2013 feel, **1 D ↔ 40 of our px** gives a ×3.70 factor from 2013 px. These are targets, not hard rules:

| Target | 2013 fixture | In our px (×3.70) |
|---|---|---|
| Bridge width typical / min | 3.6 D / 1.6 D | 144 / 63 px (contract minimum 100 px = 2.5 D is stricter, which is fine for accessibility) |
| Bridge gap length median (p75) | 3.8 D (8.7 D) | 152 (348) px |
| Ramp max slope | 0.176 (10°) | same |
| Elevator height jump | 3.7–7.4 D (40–80 px) | 148–296 px |
| Island count per stage | 38 in a 1024 × 1358 page | — |
| Narrowest walkable island | 1.1 D (typical narrow 2 D) | 44 / 78 px (contract `MIN_ISLAND_SIZE_PX = 120` = 3 D is stricter) |
| Small items | 8–16 per 10k px² of 2013 island area, spaced 1.5 D, on inset rings 0.9 D and 2.3 D | ≈0.6–1.2 per 10k px² of ours · spacing 59 px · rings at 37 and 85 px |
| Large items | ≤6 in design (case study). 4 in the fixture, placed at interior maxima of the distance transform | same |
| Restart points | Inset rings at 0.56 D and 1.3 D, spacing ≈1.4–1.9 D | rings at 22 and 52 px, spacing 55–74 px (contract edge clearance of 20 px = 0.5 D matches the inner ring) |
| Rails | Cover about 90 % of the outline, open at every bridge/elevator mouth, 0.5–0.6 WU above the surface (≈ ball equator) | — |
| Height range | 100–250 px (≈9–23 D), ramps up to 10° | — |

## 9. Converter (`tools/ref-fetch/src/wwmmm-to-stage.ts`) and what doesn't map

Output: `reference/aid-dcc.stage.json`, `aid-dcc.texture.png` (rows 692..2047 cropped, 1024 × 1356), `aid-dcc.extra.json` (exact heights and raw bridges), and `aid-dcc.check.txt`. The default is a **ball-matched scale ×3.704** (`--scale raw` keeps 2013 px).

Manual structural check (a stand-in for `validateStage` until `@wwm/schema` lands). The following **pass**: types, sha256 ids, contours (≥3 points, no self-intersection), every island reachable from start, goal ≠ start island, bridge endpoint levels = island levels, no bridge crosses a third island, restart points inside and ≥20 px from the edge. The following **fail** (47 issues). Each is a real difference between 2013 geometry and contract v0.1.0:
- 11 bridges narrower than `MIN_BRIDGE_WIDTH_PX = 100` (2013 widths of 17–25 px become 63–93 px)
- 4 ramps whose quantized level difference is 2–5 (contract requires exactly 1). 2013 used continuous heights with slope ≤ 10°
- 32 small items closer than 20 px to the edge (2013 inset ring at about 10 px ≈ 0.9 D)

Unmapped or lossy fields (input for [contract-deltas.md](contract-deltas.md)):
1. `level`: a continuous px height, quantized to `LEVEL_HEIGHT_M × PX_PER_METER` = 60 px steps.
2. Item and start/goal heights: dropped (implied by the island).
3. Bridge `start`/`angle`/`distance`: replaced by `a`/`b`. `from`/`to` are not in the source and are inferred geometrically.
4. Elevator: switch-triggered with travel time and cooldown; the contract's `periodSec` is approximated as a round trip plus cooldowns. The platform is length × width, but the contract has a single `size`.
5. `mobile_image`: dropped.
6. Goal radius, 10 px × scale: taken from the 2013 sensor size.
7. `timeLimitSec`: not in the data. 2013 used a fixed 300 s.
8. Contour orientation: the contract says "CCW" without an axis convention. The data is CCW-on-screen (negative raw shoelace).
