# Fixtures (contracts §8)

```
captures/<slug>/capture.json + screenshot.png   7 real pages (see captures/README.md)
stages/handmade-simple.json + .png              hand-authored StageData (wwm.stage/2) + its 1280×1600 (2×) texture
replays/                                        InputSample[] replays (Phase 05 adds handmade-simple.keyboard.json)
```

Paths inside the JSON (`screenshot.path`, `texture.path`) are **relative to the JSON file's directory**.

## `stages/handmade-simple`
The stage is authored as code in `tools/fixture-capture/src/handmade.ts` (every coordinate is explicit there) and
written with `pnpm --filter @wwm/fixture-capture handmade`. `pnpm fixture:texture` re-renders only the PNG.
A test asserts that the checked-in JSON equals the generator output and passes `validateStage`.

Contract v0.2 scale: 1 m = 1 ball diameter = 13.5 px. The stage is **640×800 px (≈ 47 × 59 m)**, a small test course.

- 4 rectangular islands with float levels (in ball diameters): A (0, start), B (0), C (1.5), D (4, goal).
- A→B: 3 flat bridges (widths 40/48/40 px). B→C: 1 ramp (width 48, Δ1.5 m over 160 px = 11.85 m, slope 0.127 ≤ 0.176).
- C→D: 1 elevator across a 16 px gap (width 48, lower platform `a` on C, upper `b` on D, 1.5 → 4, travel 1.405 s, cooldown 2 s).
- 20 small items, 2 large items, 2 restart points per island, guardrails along every edge with gaps at each bridge and elevator mouth.
- `size` 640×800, `source.slice` = the whole stage, `timeLimitSec` 300.
- Texture: rendered at 2× (`texture.scale = 2`, 1280×1600 PNG). Each island is a colored block with a 13.5 px (= 1 m) grid and a label. Bridges are grey and the elevator gap dark grey, so texture orientation and scale are easy to check in the renderer.
- Route: A → B → (ramp) → C → (elevator) → D.
