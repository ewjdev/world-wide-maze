# @wwm/ref-fetch

Downloads the surviving 2013 World Wide Maze reference material into `reference/` (gitignored), verifies each file's sha256, and converts the WWMMM installation stage into our `StageData` format as a real-world test level.

**Nothing this tool downloads or produces may be committed.** The 2013 bundle, localization, art and WWMMM data are third-party and unlicensed for redistribution. Inspect the 2013 JavaScript as text only, and never execute it.

## Run
Node ≥ 22.18 runs the TypeScript sources directly (type stripping). There are no dependencies.

```sh
# from the repo root (alias wired at merge): pnpm ref:fetch
cd tools/ref-fetch
node src/fetch.ts                 # download + verify + convert (idempotent; cached files are re-hashed, not re-downloaded)
node src/fetch.ts --force         # re-download everything
node src/fetch.ts --only main-js,translation-en
node src/fetch.ts --no-convert
node src/wwmmm-to-stage.ts [--scale ball|raw|<n>]   # re-run only the conversion
node --test src/*.test.ts         # unit tests (synthetic data only)
```

## Outputs (`reference/`)
| File | What |
|---|---|
| `original/desktop-main.js` | 2013 desktop bundle (Wayback 2013-03-22) |
| `original/translation-en.json`, `translation-ja.json` | i18next localization |
| `original/physijs_worker.js` | Physijs worker fork (fixed 60 Hz step) |
| `wwmmm/http-aid-dcc.json`, `.png` | WWMMM stage + 1024 × 2048 texture (Katamari-Inc/WWMMM@be2bea8) |
| `aid-dcc.stage.json` | Converted `StageData` (default: ball-matched scale ×3.704) |
| `aid-dcc.texture.png` | Page texture cropped from the source PNG (rows 692..2047) |
| `aid-dcc.extra.json` | Exact heights and raw bridge records that `StageData` can't hold |
| `aid-dcc.check.txt` | Structural check report (a stand-in for `validateStage` until `@wwm/schema` exists) |

## API
- `ARTIFACTS` (`src/manifest.ts`): pinned URLs, byte sizes and sha256 values.
- `fetchArtifact(artifact, force?)` (`src/fetch.ts`).
- `convertWwmmm(src, opts) → {stage, extra, issues, unmapped}`, `convertFiles(...)`, `checkStructure(stage)` (`src/wwmmm-to-stage.ts`).
- `decodePng` / `encodePng` / `cropRows` (`src/png.ts`): a minimal 8-bit RGB(A) PNG codec.

`src/stage-types.ts` is a **TEMP** copy of contract v0.1.0 types. Replace it with `@wwm/schema` imports at merge, and replace `checkStructure` with `validateStage`.

See `docs/reference/` for what the material shows.
