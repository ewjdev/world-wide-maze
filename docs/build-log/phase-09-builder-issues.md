# Phase 09 → Phase 03: builder issues (round 1)

**Filed by:** the Phase 09 solver (`@wwm/solver`), 2026-09-25, against builder **0.3.0**.

**Status (Phase 03b/05b, 2026-09-25): all five resolved** in builder **0.4.0** and physics **0.2.0**. The batch eval
(same 819 stages) now solves 819/819 with no failure class, no stage that needs a jump, no split island in the solver's
audit, and 315/315 runs fully playable. Details: `docs/build-log/phase-03.md` ("Phase 03b") and `phase-05.md`
("Phase 05b").

> **Publication note (2026-09-25):** before the repo went public, seven captures whose content we had no clear right to redistribute were removed: an internal news-site fixture from Phase 02, and six eval pages (a text-only news site, a classifieds site, a CSS-framework marketing page, a Linux kernel portal, a digital library home page and a Google experiments gallery). The figures in this log were measured with them and are left as recorded. The re-run on the remaining 28 captures is in `fixtures/eval/report.json`; see `NOTICE.md`.

| # | Resolution | Where |
|---|---|---|
| BI-1 | **Resolved.** Walkable-area analysis per island (final polygons at 1.5 px, eroded by r + 1 px); mouths, lift ends, start, goal, items and restart points only on the main part; diagonal contacts between two islands are cut instead of fused; island-sized parts joined by a sub-ball neck are split; ≤ 2-cell inlets inside one island are filled; decks whose rail stubs would pinch an island are not carved; a reachability audit rerolls. narrow-neck 13 → 0, jump-solved 57 → 0, audit split stages 241 → 0. | builder |
| BI-2 | **Resolved.** A lift needs main-walkable ground 1 D beyond both platform ends, and its lower platform (a trigger zone, a wall for routing) must not disconnect any of its islands' anchors. elevator-blocked 37 → 0. | builder |
| BI-3 | **Resolved twice.** Builder: lifts rise ≥ 3.7 D (the smallest 2013 rise), low loops are dropped. Physics 0.2.0: the partner platform is re-enabled only after the ball has left its volume, and on a low ride down the ball is eased clear of the upper island's slab (the second wedge the fix exposed). | builder + physics |
| BI-4 | **Resolved in the builder.** Bands whose side rails would run more than a ball radius over their island are rejected (the renderer and the solver draw rails over the full a→b, so physics clipping would have split the three). Rail stubs also count as walls in the reachability checks. | builder |
| BI-5 | **Resolved.** `DIFFICULTY_PARAMS` (all N): easy = loops + gentler heights; hard = 2.67 D decks, bumpier heights, more lifts, restart points on one ring 4 D apart, 2 D rail gaps every 16 D. | builder |

**How the evidence was gathered:**
- The batch eval: 35 captures × all slices × easy/normal/hard × seeds 1–3 = 819 stages
  (`node tools/batch-eval/src/cli/batch.ts`). The report is `fixtures/eval/report.json`.
- The dashboard: `fixtures/eval/index.html`. Filter it with "Show: with an unplayable seed".

**Repro format:** `slug slice difficulty seed` → `buildStage({capture, image, sliceIndex, seed, difficulty})`.
Coordinates are stage-local px.

**How to see one:**
```sh
node tools/batch-eval/src/cli/thumb.ts <slug>:<slice>:<difficulty>:<seed> /tmp/x.png --width 3840 --crop x,y,w,h  # debugger-style render
node packages/solver/scripts/probe.ts   <slug>:<slice>:<difficulty>:<seed> x y 40                  # geometry + ball states
```
**Calibration the claims rest on:** these are `@wwm/solver` tests against `@wwm/physics`.
- A neck 13 px wide stops the ball and 14 px lets it through. The ball diameter is 13.5 px, and the rails sit just
  outside the edge.
- The planner uses the same 6.75 px centre clearance.
- Every "geometric" verdict below was also retried physically: on a looser grid, then with clearance relaxed by
  1.5 px, and also with jumps. All of those retries failed.

**Summary (easy + normal; hard has the same geometry as normal, see BI-5):**

| # | Issue | Unplayable stages | Also affects |
|---|---|---|---|
| BI-1 | Islands split by necks narrower than the ball | 9 | 57 solved stages needed JUMP; 241/819 stages have ≥ 1 split island (audit) |
| BI-2 | Elevator platform ends with no room for the ball | 25 | — |
| BI-3 | Elevators rising < 1.463 D pin the ball between the platforms | 1 (easy) | 42 of 1,273 elevators, all on easy: a **softlock** for a human who takes that loop |
| BI-4 | Deck side rails standing on the island (slanted mouths) | 0 now (the solver routes around them) | 124 of 22,020 deck corners |
| BI-5 | `hard` builds exactly the `normal` geometry | — | 273/273 hard stages |

---

## BI-1: islands split by a neck narrower than the ball (`narrow-neck`)
**Symptom:** a bridge or elevator mouth, the start or the goal sits in a part of its island that the ball can't reach
from the rest of it. The island is wide enough somewhere (it passes the "can hold a 2 D disc" check), but it's joined
by a neck under 13.5 px wide.

**Typical cause:** an HN or Wikipedia text block whose title line and indented, thinner meta line are one island.
The solver now jumps necks up to 22 px long when there's land under the whole jump (JUMP is a 2013 mechanic), which
rescues most of them. A human has to discover that jump, though, and nothing on screen tells them to.

**Repros:**
- **Unplayable** (easy and normal unless noted):
  - Google experiments gallery (removed before publication) `2 * 2`: island 32, bridge 17 mouth at (915, 1095).
  - Google experiments gallery (removed before publication) `3 * 2`: island 22, bridge 5 at (174, 627).
  - `eval-go-dev 0 easy 2`: island 9, bridge 31 at (893, 414).
  - `eval-ja-wikipedia-meiro 3 * 2`: island 29, elevator 2 at (519, 1304).
  - `eval-python-home 1 * 1`: island 32, elevator 1 at (465, 719).
  - Neck gaps across the failures: 7–63 px. The short ones are now jumped.
- **Solved only by jumping** (examples):
  - `hn-front 0 normal 1`: island 3, the "3. CVE-2025-…" row. Bridge 1 lands on the title line and bridge 2 leaves
    from the part below it. They're joined by an 18 px gap of land that's too thin to roll across.
  - `eval-debian 0 normal 1`: island 1, the Debian swirl. Bridge 2's mouth is cut off by a neck *and* by BI-4.

**Root-cause hypotheses:**
1. `islands.ts` checks that an island *can hold* a 2 D disc, but not that its **ball-walkable area** (the island
   eroded by 6.75 px) is connected.
2. `thickenThin` grows one-line strips but not necks between wide parts.
3. `bridges.ts` and `placement.ts` choose mouths, start and goal without checking that they sit in the same eroded
   component.

**Suggested fix (builder):**
- Erode each island mask by the ball radius and label the components.
  - Either keep only the component that carries the mouths, and demote the rest to separate islands or drop them.
  - Or restrict candidate mouths, start, goal and elevator ends to one component per island.
- `@wwm/solver` `auditIslands(buildNavGrid(stage))` reports exactly this per island (`split` / `no-ground`), so it
  can serve as the regression check.

## BI-2: elevator platform ends with no room for the ball (`elevator-blocked`)
**Symptom:** the elevator platform has side rails, so the ball boards and leaves **through the platform ends** only.
The footprint is `max(|b−a|, 18.75 px)` long, ending at `b`. When the gap is short (typically 9 px), the platform
reaches about 10 px into the lower island. On a thin text strip, its end then sits on or near the island's far edge,
so the ball can't get on or off.

This was also confirmed physically. In `wikipedia-article 0 normal 1` (older solver run), the ball rode down,
rolled off the end, and got stuck between the island edge and the rail ends. The current jump recovery gets it out
there, and 25 other stages stay unplayable.

**Repros** (easy and normal):
- text-only news site (removed before publication) `0 * 1`: island 31, elevator 0 (boarding end) at (300, 1178).
- text-only news site (removed before publication) `0 * 2`: island 3, elevator 0 (arrival end) at (267, 163).
- text-only news site (removed before publication) `0 * 3`: island 20, elevator 1 at (372, 751).
- text-only news site (removed before publication) `1 * 1`: island 12, elevator 1 at (432, 392).
- text-only news site (removed before publication) `1 * 2`: island 6, elevator 0 at (309, 187).
- text-only news site (removed before publication) `1 * 3`: island 4, elevator 0 at (294, 133).
- `eval-ja-wikipedia-meiro 1 * 3`: island 19, elevator 3 at (657, 1357).
- `eval-ja-wikipedia-meiro 2 * 2`: island 14, elevator 3 at (513, 1258).
- `eval-ja-wikipedia-meiro 3 * 3`: island 19, elevator 0 at (660, 994).
- `eval-python-home 1 * 2`: island 3, elevator 0 at (735, 92).
- `eval-react-dev-dark 3 * 3`: island 4, elevator 0 at (201, 112).
- `eval-wikipedia-main 0 * 2`: island 22, elevator 0 at (285, 1141).

The text-only news site (removed before publication), a list of thin headline strips, fails on every seed at both of its slices.

**Root-cause hypothesis:** `levels.ts` turns short gaps into elevators without checking the **depth of each island
along the elevator axis** beyond the platform end. The lower platform overlaps the lower island by
`18.75 − |b−a|` px, and the ball then needs another ≥ 13.5 px of walkable ground straight beyond it.

**Suggested fix:**
- Accept an elevator only if, on both islands, the ball-eroded mask (BI-1) contains the point 1 D beyond the
  platform end along a→b.
- Otherwise use another candidate link, or keep the edge flat or as a ramp and re-level.

## BI-3: elevators rising less than ball diameter + slab pin the ball (softlock)
**Symptom:** both platforms share one footprint. After a ride, the partner platform ends up directly above the
ball: its underside is at `levelHigh − 0.463 m`, while the top of the ball is at `levelLow + 1 m`.
- When `levelHigh − levelLow < 1.463 D`, the ball is **wedged**. It's pushed into the lower slab (y 22.30 instead
  of 22.66) and can't move under any tilt.
- Measured: `eval-rust-lang 0 easy 3`, elevator 0 (rise 1.04 D). The ball stayed frozen for more than 10 s with
  full tilt, with |v| = 0.
- The ball never falls, so a human player would be stuck until the 300 s timer runs out.

**Scale:** 42 of the 1,273 elevators in 546 easy and normal builds, **all on `easy`**. They're the extra loop
edges. The rises are 0.14–1.38 D, for example:
- `eval-python-home 0 easy 3` elevator 8 (0.14 D);
- `image-gallery 3 easy 3` elevator 0 (0.22 D);
- `hn-front 0 easy 3` elevator 7 (0.57 D);
- `eval-react-dev-dark 3 easy 2` elevator 1 (0.82 D).

The full list comes from `node packages/solver/scripts/geomstats.ts`. The solver never uses these elevators (it
treats them as `trapped`). Only `eval-react-dev-dark 3 easy 2` has no alternative route.

**Root-cause hypothesis:** the loop edges added on easy (`loopShare` 0.15) connect two islands whose levels were
already fixed by the tree walk. A short gap with any level difference becomes an elevator, however small the rise.

**Suggested fix:**
- Builder: for elevators, require `levelHigh − levelLow ≥ 2·BALL_RADIUS_M + SLAB_THICKNESS_M` plus a margin (use
  2 D to match the 2013 minimum of 3.7 D in spirit). Otherwise make the loop a flat bridge or a ramp if the slope
  allows, or drop it.
- Also worth a Phase 05 note: re-enabling the partner platform's colliders on top of the ball is what creates the
  wedge.

## BI-4: deck side rails standing on the island at slanted mouths
**Symptom:** `@wwm/physics` runs each deck's side rails over the full a→b length. Where the island edge at a mouth
is slanted, a deck **corner** lies up to 20 px inside the island (`ENDPOINT_TOLERANCE_PX`). That rail segment then
stands on the island as a wall, and it can cut the ball's path along the island next to the mouth.

**Repro:**
- `eval-debian 0 normal 1`: bridge 1, from island 2 to island 1, with a = (610.5, 141) and b = (610.5, 171). The
  left rail at x ≈ 588 reaches y 171, but island 1's edge there is at y ≈ 156.
- The original solver (without rail modelling) pinned the ball at (594.7, 166) for 20 s.

**Scale:** 124 of the 22,020 deck corners in easy and normal builds are more than a ball radius inside their island
(`geomstats.ts`). The solver now models the rails exactly and routes around them. Stages break only when the rail
also closes a neck (debian).

**Suggested fix:** either
- the builder moves each deck end to the island edge **per corner** (for example, by shortening the deck until
  both corners are on or outside the edge),
- or Phase 05 clips the side rails to the part of the deck outside the islands.

## BI-5: `hard` is identical to `normal`
`params.ts` has `loopShare: { easy: 0.15, normal: 0, hard: 0 }`, and no other parameter depends on difficulty. All
273 hard stages have exactly the normal geometry, with only the `stageId` differing (checked for every capture's
slice 0, seed 1).

For reference, par at normal is p50 49.8 s and at easy 44.6 s. Easy is only slightly shorter.

**Suggestion:** give `hard` real levers, for example:
- decks toward the 2.5 D minimum;
- goal farther along the tree (the deepest leaf instead of the bottom-right);
- fewer rails on wide islands;
- more elevators or ramps.

The 2013 difficulty rules aren't evidenced, so label them N.

---

## Not builder issues (for the record)
- **Converted 2013 AID-DCC stage:** the solver's 2D planner can't route it, because decks cross over other decks at
  different heights (bridge 13). Our builder never makes overlapping decks. The Phase 05 test pilot still traverses
  it.
- **Legacy fixtures:** all 180 stages from the 7 Phase 02 fixtures are solved; every failure is on eval-* pages.
  Thin-strip text layouts (the text-only news site, Japanese Wikipedia, python.org) are over-represented.
