# Build log: Phase 01 (Reference & Fidelity Spec)

- **Agent:** Claude Opus 5.5 (1M context), running as a Claude Code sub-agent in an isolated git worktree (branch `worktree-agent-a96da1d45bef0d045`).
- **Start / end:** 2026-09-25 about 07:18Z → about 07:50Z.
- **Instructions received (summary):** execute `plans/phase-01-reference-spec.md`. Orchestrator notes: Phase 02 is running in parallel, so don't touch the root `package.json`, `pnpm-workspace.yaml` or `.gitignore`. Make `tools/ref-fetch` standalone (`@wwm/ref-fetch`, script `fetch`). Use a TEMP local copy of the StageData types. Fetch with the Wayback `id_` URLs and verify sha256. Query the CDX index and record the assets. Never execute the original JS. Hunt for concrete physics/camera/rule numbers and label each one. Make a best-effort video review.

## What was done
1. Downloaded and hash-verified the desktop `main.js`, `translation-en.json`, the WWMMM JSON (all three match `research/recovery-evidence.json`), plus the newly found `translation-ja.json` (2013-08-28), `physijs_worker.js`, and the WWMMM texture PNG (new pins).
2. Split the bundle on `define("…"` boundaries (109 modules) and reformatted it with js-beautify for reading. Read `common/config`, `presets.json`, `parametergui`, `ball`, `world`, `followcamera`, `elevator`, `stage`, `keycontrol`, `app`, `gateway`, the page modules, the HUD sprites, `renderer`, `performanceadjuster` and `soundeffect`. The code was treated as text only and never executed.
3. Queried the Wayback CDX index. It is full of `/maze/NNNNNN` pairing-code URLs, which were filtered out. The remaining index lists the ja localization, the physics worker, CSS, models, textures, audio, a later Leap Motion library, and no mobile bundle.
4. Computed WWMMM stage statistics (geometry, bridges, items, restart points, rails).
5. Wrote `tools/ref-fetch` (manifest, fetcher with retry/backoff and idempotent hash checks, a minimal PNG codec, and the WWMMM → StageData converter with a structural check), plus node:test unit tests on synthetic data.
6. Wrote `docs/reference/{bundle-notes, ux-flow, stage-format, visual-notes, archive-index, fidelity-spec, contract-deltas}.md`.

## Key findings (for the record)
- **Tilt rotates gravity** (camera-yaw frame) and acts only while POWER is held. Limits are pitch 45° and roll 20° (phone), 25° (keyboard).
- Gravity 50 WU/s², ball mass 1, r 0.54 WU, jump Δv 18 WU/s with a 100 ms ground grace period. Damping, friction and restitution are all recovered from `presets.json`.
- **Fixed 300 s timer, reset on every respawn.** 3 spare balls, so game over happens on the 4th loss. One-up every 3000 points of the session total.
- The ranking is a **global board of session totals**, not per site.
- Elevators are **switch-triggered** bridges (`type 1`), not periodic.
- WWMMM `level` is a **continuous px height**. Ramps have slope ≤ 10°. The bridge graph is a spanning tree.
- **The recovery-evidence counts of 1503/12 items are flat-array lengths. The real counts are 501 small and 4 large.**
- The 2013 ball was about 1 % of the page width, versus about 3 % at our contract scale (CD-1).
- The WWMMM texture contains a small 2013 gameplay screenshot (from PARTY's homepage banner), which gives HUD layout evidence.

## Attempts that failed or needed a workaround
- The CDX API returned "Internet Archive: Temporarily Offline" HTML for the first filtered query. It succeeded on retry with a simpler `filter=!mimetype:text/html` query. The fetcher has retry/backoff for this reason.
- The worktree-isolation guard rejected some compound shell commands (loops with variables, `npx` in loops, piped `node -e` with computed arguments). Those were rewritten as small script files under `reference/scratch/` (gitignored).
- YouTube: the trailer's only caption track is ASR over music, and the talk has no captions. No frame review was possible, so a question list was written instead.
- `.gitignore`'s `reference/` pattern also ignores **`docs/reference/`**. The docs were added with `git add -f`. The orchestrator should change the pattern to `/reference/` (Phase 01 was told not to edit `.gitignore`).

## Manual human interventions
None during this phase.

## Test evidence
- `node --test src/*.test.ts` (in `tools/ref-fetch`): 4/4 pass.
- `tsc --noEmit -p tools/ref-fetch/tsconfig.json` (TypeScript 5.9, run from a scratch install): exit 0.
- `node src/fetch.ts`: first run downloaded all 6 files with sha256 verified. The second run found all 6 cached and verified (idempotent), and the conversion was re-run.
- Converter structural check (`reference/aid-dcc.check.txt`): reachability, crossings, self-intersections and level consistency all pass. There are 47 expected failures from contract constants (bridge width < 100 px ×11, multi-level ramps ×4, items within 20 px of an edge ×32). See contract-deltas CD-1/CD-2.
- `pnpm check` was **not run**: the root workspace belongs to Phase 02 and doesn't exist in this worktree yet.

## Remaining defects / follow-ups
- `tools/ref-fetch/src/stage-types.ts` is a TEMP contract copy. Swap it for `@wwm/schema` and run the real `validateStage` at G0.
- Wire the root script `"ref:fetch": "pnpm --filter @wwm/ref-fetch fetch"` at merge. Also fix `.gitignore` (`/reference/`).
- The mobile controller bundle was not recovered. The phone UI is reconstructed.
- No productivity claims are made. The original team's effort is unknown.
