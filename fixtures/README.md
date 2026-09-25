# Fixtures (contracts §8)

```
captures/<slug>/capture.json + screenshot.png   7 real pages (see captures/README.md)
stages/handmade-simple.json + .png              hand-authored StageData + its 1280×1600 texture
replays/                                        InputSample[] replays (Phase 05 adds handmade-simple.keyboard.json)
```

Paths inside the JSON (`screenshot.path`, `texture.path`) are **relative to the JSON file's directory**.

## `stages/handmade-simple`
The stage is authored as code in `tools/fixture-capture/src/handmade.ts` (every coordinate is explicit there) and
written with `pnpm --filter @wwm/fixture-capture handmade`. `pnpm fixture:texture` re-renders only the PNG.
A test asserts that the checked-in JSON equals the generator output and passes `validateStage`.

- 4 rectangular islands: A (L0, start), B (L0), C (L1), D (L3, goal).
- A→B: 3 flat bridges (widths 100/120/100). B→C: 1 ramp (width 120). C↔D: 1 elevator (160×160 platform in the gap, L1↔L3, period 6 s).
- 20 small items, 2 large items, 2 restart points per island, guardrails along every edge with gaps at each bridge and elevator mouth.
- Texture: each island is a colored block with a 40 px (= 1 m) grid and a label. Bridges and the elevator are drawn in grey, so texture orientation and scale are easy to check in the renderer.
- Route: A → B → (ramp) → C → (elevator) → D.
