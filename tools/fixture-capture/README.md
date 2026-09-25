# @wwm/fixture-capture

This is a local Playwright CLI that writes `fixtures/captures/<slug>/`. It also contains the generator for the `handmade-simple` stage.

## Commands (from the repo root)
```sh
pnpm --filter @wwm/fixture-capture browsers           # once: install Playwright Chromium
pnpm fixture:capture <url> <slug> [--dark] [--dpr <n>] [--out <dir>] [--timeout <ms>]
pnpm --filter @wwm/fixture-capture handmade           # regenerate fixtures/stages/handmade-simple.{json,png}
pnpm fixture:texture                                  # re-render only handmade-simple.png
```

`fixture:capture` launches Chromium with a 1280×800 viewport, DPR `CAPTURE_DPR` (2; override with `--dpr` or the `CAPTURE_DPR` env var), reduced motion, en-US and UTC. It runs
`capturePage` from `@wwm/capture-script` and validates the result with `parseCapture` before writing
`capture.json` (diff-friendly: one element per line; `screenshot.scale` = the DPR) and `screenshot.png` (1280 × DPR image px wide, CSS height ≤ 6000).
`--dark` sets `prefers-color-scheme: dark`.

## Programmatic API
`captureToDir(url, dir, {colorScheme?, timeoutMs?, dpr?})`, `defaultDpr()`, `buildHandmadeStage()`, `railsAround(ring, mouths)` (guardrails with gaps), `formatJson`.

## Tests
`pnpm vitest run --project @wwm/fixture-capture`. The tests check that every checked-in capture passes `parseCapture` and that
its PNG is 1280 × `screenshot.scale` wide and matches the bundle. They also check that `handmade-simple.json` passes `validateStage`, equals the generator output, and that its texture is `size × texture.scale` (640×800 stage → 1280×1600 PNG).
