# Phase 01 — Reference & Fidelity Spec

**Wave:** 0 (parallel with 02) · **Depends on:** — · **Blocks:** gate G0 (contract reconciliation), 08, 10

## Goal
Turn the surviving 2013 evidence into a concrete, testable **fidelity spec**. The spec says what the original did (evidenced), what we're inferring (reconstructed), and what we're adding (new), so every other phase builds the *right* game.

## Read first
- `plans/00-overview.md`, `plans/contracts.md`
- `research/world-wide-maze.md` (all of it), `research/recovery-evidence.json`
- `RESEARCH.md` Part 1 (the case study summary)

## Owns
`docs/reference/**`, `tools/ref-fetch/**`, the root `package.json` script `ref:fetch` (coordinate with 02: add only this script entry), `.gitignore` entry `reference/`

## Tasks
1. **Fetch tool** (`tools/ref-fetch`): a Node script that downloads the sources below into `reference/` (gitignored) and verifies their sha256 against `research/recovery-evidence.json`:
   - the archived desktop `main.js`
   - the English `translation.json` (and the Japanese one if it's archived)
   - the WWMMM `http-aid-dcc.json` at the pinned commit
   - the WWMMM stage texture, if one is referenced

   Use `curl`-style fetches with the `id_` Wayback URLs.
2. **Bundle archaeology:** inspect `main.js` as text only, and never execute it. Produce `docs/reference/bundle-notes.md` covering:
   - the module list (109 `define`s)
   - `common/config` constants
   - ball, camera, elevator, stage and world module behavior: physics parameters (mass, friction, restitution, gravity, jump impulse, power force), camera distances and angles, elevator timing, restart logic, scoring and one-up logic, the timer and how the time limit is computed
   - the game-state flow, from the templates and routes
   - the input mapping

   Quote short code excerpts (≤ 15 lines each) with line offsets. Don't copy large portions.
3. **Localization mining:** turn `translation.json` into `docs/reference/ux-flow.md`. List every screen and message in order (title → connect → calibrate → select → play → result → ranking), with failure states such as conversion failed, disconnect, and calibration timeout. This becomes Phase 08's screen list.
4. **Stage format semantics:** analyze the WWMMM JSON in `docs/reference/stage-format.md`:
   - the coordinate system (what the 3rd component of start and goal means)
   - the units, and how `level` maps to height
   - bridge fields (angle, width, distance, type values, endpoint levels)
   - how guardrails relate to contours
   - distributions: island size, bridge length and width histograms, items per island area

   These numbers become **calibration targets** for Phase 03 (e.g. "small items per 10k px² ≈ N").
5. **WWMMM → StageData converter** (`tools/ref-fetch/src/wwmmm-to-stage.ts`) that outputs `reference/aid-dcc.stage.json` in our contract format. Phases 04 and 05 can use it as a real-world test level (never committed). List every field that doesn't map cleanly. That list is input for contract changes.
6. **Video review (best-effort):** if the trailer or talk (links in the research) can be retrieved as a transcript or frames, note timestamped observations in `docs/reference/visual-notes.md`: camera angle, ball look, ocean, island edge style, HUD layout, transitions. If you can't, list the questions a human should answer while watching.
7. **Fidelity spec** `docs/reference/fidelity-spec.md` is the main deliverable. It's a table of features, each with a label: **Evidenced** (with source), **Reconstructed** (with reasoning), or **New** (our addition). Include the explicit numeric parameters that later phases will use as defaults.
8. **Contract deltas:** `docs/reference/contract-deltas.md` lists proposed changes to `plans/contracts.md` (fields to add, rename, or retype) with justification.

## Acceptance criteria
- `pnpm ref:fetch` downloads and hash-verifies all artifacts and is idempotent.
- `fidelity-spec.md` covers at least: controls, scoring, lives, timer, falls and restart, items, elevators, bridges and ramps, camera, map, pairing, calibration, the result and ranking flow, and conversion failure. Each item is labeled and sourced.
- The converter's output passes `validateStage` from `@wwm/schema`, or its failures are explained. (If Phase 02 hasn't landed yet, validate the structure by hand and note it.)
- No third-party content is committed, apart from short quoted excerpts.

## Out of scope
Running the original game. Recovering art or audio. Any implementation outside `tools/ref-fetch`.
