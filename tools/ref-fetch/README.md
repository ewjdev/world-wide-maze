# @wwm/ref-fetch

Downloads the surviving 2013 World Wide Maze reference material into `reference/` (gitignored), verifies each file's sha256, and converts the WWMMM installation stage into our `StageData` format (contract v0.2, `wwm.stage/2`) as a real-world test level, checked with the real `validateStage` from `@wwm/schema`.

**Nothing this tool downloads or produces may be committed.** The 2013 bundle, localization, art and WWMMM data are third-party and unlicensed for redistribution. Inspect the 2013 JavaScript as text only, and never execute it.

## Run
Node ≥ 22.18 runs the TypeScript sources directly (type stripping). The only dependency is the workspace package `@wwm/schema` (run `pnpm i` at the root first).

```sh
pnpm ref:fetch                    # from the repo root: download + verify + convert
cd tools/ref-fetch
node src/fetch.ts                 # download + verify + convert (idempotent; cached files are re-hashed, not re-downloaded)
node src/fetch.ts --force         # re-download everything
node src/fetch.ts --only main-js,translation-en
node src/fetch.ts --no-convert
node src/wwmmm-to-stage.ts [--scale ball|raw|<n>]   # re-run only the conversion
pnpm vitest run --project @wwm/ref-fetch            # unit tests (synthetic data only)
```

## Outputs (`reference/`)
| File | What |
|---|---|
| `original/desktop-main.js` | 2013 desktop bundle (Wayback 2013-03-22) |
| `original/translation-en.json`, `translation-ja.json` | i18next localization |
| `original/physijs_worker.js` | Physijs worker fork (fixed 60 Hz step) |
| `wwmmm/http-aid-dcc.json`, `.png` | WWMMM stage + 1024 × 2048 texture (Katamari-Inc/WWMMM@be2bea8) |
| `aid-dcc.stage.json` | Converted `StageData` v0.2 (default: ball-matched scale ×1.25 → 1280 × 1697.5 px stage) |
| `aid-dcc.texture.png` | Page texture: source rows 692..2047 padded to 1358 rows, 1024 × 1358 (`texture.scale` 0.8) |
| `aid-dcc.extra.json` | Raw heights and raw bridge records |
| `aid-dcc.check.txt` | `validateStage` report (issues grouped by code, then the full list) |

## Conversion (v0.2)
- **Scale:** `--scale ball` (default) multiplies 2013 px by 6.75 / 5.4 = 1.25, so the 2013 ball matches ours and the 1024 px stage becomes 1280 px wide.
- **Levels:** float, `h × scale / PX_PER_METER` = h / 10.8, i.e. 2013 heights in ball diameters (≈ 9.3–23.2). No offset.
- **Contours:** 2013 outer rings have negative shoelace area; they are reversed to the contract's positive (`isCCW`) orientation, holes to negative.
- **Elevators (type 1):** `islandFrom`/`a` = the lower island's side, `islandTo`/`b` = the upper (descending records are swapped). `travelSec` uses the exact 2013 formula `(1000 + |Δh| × 0.1 × 150) ms`; `cooldownSec` 2.
- `source.slice` = the whole stage (`{0, 1, 0, 1697.5}`), `size` = 1280 × 1697.5, `builderVersion` `0.2.0-wwmmm-import`, `stageId` from `computeStageId`.

## API
- `ARTIFACTS` (`src/manifest.ts`): pinned URLs, byte sizes and sha256 values.
- `fetchArtifact(artifact, force?)` (`src/fetch.ts`).
- `convertWwmmm(src, opts) → Promise<{stage, extra, issues, unmapped}>` (`issues` = `validateStage(stage).errors`), `convertFiles(...)`, `summarise(issues)` (`src/wwmmm-to-stage.ts`).
- `decodePng` / `encodePng` / `cropRows` / `padRows` (`src/png.ts`): a minimal 8-bit RGB(A) PNG codec.

See `docs/reference/` for what the material shows.
