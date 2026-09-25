# @wwm/stage-debugger

A visual debugger for `@wwm/stage-builder`. It draws every builder step as a toggleable layer over the screenshot,
and it's also the showcase's "how it's made" view (Phase 10 reuses `src/draw.ts`).

## Run
```sh
pnpm --filter @wwm/stage-debugger dev      # http://localhost:5178
```
- **Source:** any `fixtures/captures/<slug>`, or the 2013 AID-DCC stage if `pnpm ref:fetch` has been run. The 2013
  stage is reference only and never committed.
- **Controls:** slice, difficulty, seed (plus a "seed +1" button), zoom, and a slider for every numeric builder
  parameter.
- **Layers:** screenshot, background mask, semantic fill, land before the size filter, dropped land (red = too
  small, orange = unreachable), islands, level heat, contours, candidate bridges, bridges (green = flat, lime = ramp,
  orange = elevator), guardrails, restart points, items (cyan = small, purple = large), start/goal, and island ids
  with their levels.
- **Panels:** build status with `validateStage` errors, hover provenance (the island's source DOM elements), stats
  next to the 2013 stage, per-step timings, and provenance notes.
- The build runs in a Web Worker (`src/worker.ts`). Vite serves `fixtures/` and `reference/` read-only through
  `/files/*`, and serves the fixture list at `/api/fixtures` (`vite.config.ts`).

URL parameters for automation: `?fixture=<slug>|reference&slice=0&seed=1&difficulty=normal&zoom=0.75&layers=a,b&shot=1`.
When drawing is done, the page sets `document.body.dataset.ready = "1"`.

## CLIs (Node)
| Command | What it does |
|---|---|
| `node tools/stage-debugger/src/cli/report.ts [--seeds 1-5] [--difficulties easy,normal,hard] [--slug s] [--md]` | builds every fixture, validates and times it, and prints the stats table next to the 2013 stage |
| `node tools/stage-debugger/src/cli/shots.ts [--out dir] [--slug s] [--slices all] [--zoom 0.6] [--layers …] [--clip x,y,w,h] [--reference] [--ui slug]` | takes Playwright screenshots of the debugger (default `docs/build-log/assets/phase-03/`). `--reference` output must never be committed |
| `node tools/stage-debugger/src/cli/goldens.ts` | regenerates `fixtures/builder/<slug>.normal.seed1.json` |

## API
`import { drawStage, drawMask, islandAt, DEFAULT_LAYERS, LAYER_LABELS, levelColor } from '@wwm/stage-debugger'`.
`drawStage(ctx, stage, { image, debug, layers, highlight })` draws in stage px on any 2D canvas context
(`OffscreenCanvas` works too).

Tests: `pnpm vitest run --project @wwm/stage-debugger`.
