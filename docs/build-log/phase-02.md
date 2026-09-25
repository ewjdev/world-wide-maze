# Build log: Phase 02 (Foundation)

- **Agent:** Claude Opus 5.5 (1M context), run as a Claude Code sub-agent in an isolated git worktree (branch `worktree-agent-a7d3ff90dee27e684`).
- **Start / end:** 2026-09-25 ~07:20Z → ~07:45Z.
- **Environment:** macOS (arm64), Node 26.0.0, pnpm 11.5.0, Playwright 1.63 Chromium (headless shell).

## Instructions received (summary)
- Execute `plans/phase-02-foundation.md`. Implement `plans/contracts.md` exactly and record any inconsistency as a Contract Change Request (CCR) instead of deviating silently.
- Phase 01 runs in parallel and owns `tools/ref-fetch/**` and `docs/reference/**`, so I added only the root `ref:fetch` script plus a `tools/*` workspace glob.
- Capture 6 real pages with local Playwright. Generate the `handmade-simple` texture programmatically and check the generator in.
- Wrangler config gets placeholder IDs only: no Cloudflare resources and no deploys.
- `pnpm check` must be green from a clean install.

## What was built
- Root: `package.json` (pinned `packageManager: pnpm@11.5.0`), `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `vitest.config.ts` (Vitest 5 `test.projects`), `.gitignore` additions, `.github/workflows/ci.yml`, and the CLAUDE.md Commands section.
- `@wwm/schema`: every contracts §1–§7 type, constant and error code; Zod mirrors; `parseStage`, `parseCapture`, `parseControlMessage`, `validateStage` (22 error codes); `space.ts`; `rng.ts`; the INPUT codec; sha256 id helpers; shared geometry.
- `@wwm/capture-script`: `extractPage` (self-contained), `pageExpression`, the prepare helpers, and `capturePage` (the full sequence Phase 07 can reuse unchanged).
- `tools/fixture-capture`: the `fixture:capture` CLI and the `handmade-simple` generator (stage JSON plus a texture rendered from HTML by Chromium).
- Fixtures: 7 captures (6 required plus a permissive card-grid alternative) and `handmade-simple.{json,png}`.
- Scaffolds: `apps/web` (Vite 8 + React 19 + react-router 8, routes `/`, `/play/:stageId`, `/c/:code`, `/about`) and `apps/worker` (bindings `wrangler.jsonc` STAGES/DB/CACHE/BROWSER/ROOM, a `Room` DO stub, `/api/health`, generated `worker-configuration.d.ts`). Also stage-builder, engine, physics, net, solver, ai, stage-debugger and batch-eval, each with `package.json`, `src/index.ts`, a README and a trivial test.

## Attempts that failed, and why
- **Bash loop over captures.** zsh doesn't word-split `$args`, so the first batch passed "url slug" as one argument. I re-ran the captures as separate commands.
- **First Wikipedia pick.** `Marble_run` redirected to a short article (2707 px). I replaced it with `Labyrinth`, which reaches the 6000 px cap.
- **GOV.UK consent banner** stayed on the page because no known selector matched. I added a text-based fallback (reject first, accept second, only inside cookie or consent containers) with a test, then recaptured.
- **Two capture-script tests failed** on the first run. The transformed function source prints `6e3` rather than `6000`, so I changed the assertion to parse the number. The test page's footer sat below the 6000 px cap and was correctly dropped, so I fixed the expectation.
- **Guessed mulberry32 reference values** in a test were wrong. I replaced them with values computed by an independent canonical implementation.
- **pnpm 11** blocked the esbuild and workerd build scripts (`allowBuilds` fixes it) and auto-added `minimumReleaseAgeExclude` for very new vite and wrangler versions. Both are kept in `pnpm-workspace.yaml`.
- **Biome 2.5** deprecated `linter.rules.recommended`. I ran `biome migrate`, which switched it to `preset`.

## Manual human interventions
None.

## Test evidence
- Output of `pnpm check` on a fresh `git clone` + `pnpm i` (also `pnpm install --frozen-lockfile`):
  ```
  $ biome check .
  Checked 87 files in 19ms. No fixes applied.
  $ vitest run
   Test Files  17 passed (17)
        Tests  106 passed (106)
  ```
  The typecheck ran first and passed in all 13 packages.
- `pnpm --filter worker dev`: `Ready on http://localhost:8787`. It listed the bindings KV/D1/R2/Browser as local, and `GET /api/health` returned `{"ok":true,"contract":"0.1.0"}`.
- `pnpm --filter web dev`: I opened `/`, `/play/abc`, `/c/123456` and `/about` in Chromium. Each rendered its heading and there were 0 console errors. The `/api` proxy reaches the worker. `vite build` also succeeds.
- Capture runs (elements / time): wikipedia-article 399 / 2.4 s, hn-front 354 / 1.0 s, an internal news-site fixture (removed before publication) 327 / 3.1 s, govuk-card-grid 243 / 1.8 s, mdn-dark-docs 312 / 1.8 s, example-sparse 4 / 0.9 s, image-gallery 400 / 2.6 s.

## Remaining defects and limitations
- The `adlike` heuristic misses ads without class or id hints, e.g. the MDN top and footer ad bands.
- `z` is only a hint: the nearest positioned numeric z-index, with no full stacking-context resolution.
- Fixed and sticky elements are hidden in the screenshot, which leaves blank space where sticky elements were in flow.
- An internal news-site fixture contained copyrighted news photos. It was for internal testing only and was removed before publication (see `NOTICE.md`).
- Fixture PNGs total about 9.8 MB, with the news-site fixture (since removed) alone at 3.7 MB. WebP or quantization could shrink them if repo size matters.
- Worker tests run in plain Node. Binding-level tests (`@cloudflare/vitest-pool-workers`) are left to Phase 07.

## Contract Change Requests (interpretations implemented; the orchestrator should confirm or amend contracts.md)
1. **Ring orientation.** "CCW" is implemented as a positive shoelace area on raw page (x, y), which looks clockwise on screen because y points down. Holes are the opposite (CW). The helpers are `isCCW`/`signedArea`. Affects 03, 04, 05 and 09.
2. **Id hashing.** `captureId = sha256(url|capturedAt)` and `stageId = sha256(captureId|seed|builderVersion|difficulty)`, joined with `|` to avoid concatenation collisions. Affects 03 and 07.
3. **`JobEvent` SSE shape.** It is `{type:'progress',step,pct} | {type:'done',stageId} | {type:'error',code,message}`, where `type` doubles as the SSE `event:` name. `pct` is 0–100. Affects 07 and 08.
4. **Extra validation rules** beyond the listed §3 invariants, derived from the field comments: bridge `levelA`/`levelB` equal their islands' levels; `flat` ⇔ equal levels; bridge endpoints lie on or within 20 px of their islands; guardrails must not cross a bridge's walkable lanes (the centerline and ±(width/2 − 20 px)); elevator `levelLow`/`levelHigh` equal the min/max island levels; start is inside its island with 20 px clearance; goal is inside its island; ids are unique; contours are simple; holes are inside their contour. Affects 03, 09 and 11.
5. **Derived constants added:** `CONTRACT_VERSION`, `MAX_PAGE_HEIGHT_PX`, `DEFAULT_VIEWPORT`, `MAX_TILT`, `BALL_RADIUS_PX`, `INPUT_STALE_MS`, `ROOM_CODE_LENGTH`. **Helper types added:** `Difficulty`, `ItemKind`, `DropReason`, `BuildStageFn`, `CreateSimulationFn`, `Replay`, `ControllerInputFrame`, the per-message `ControlMessage` union, and the §7 request/response bodies. `SubmitScoreRequest.name` is limited to 1–32 characters.
6. **Unspecified by the contract:** relative asset paths. `screenshot.path` and `texture.path` are relative to their JSON file. `CaptureBundle.page.width` is capped to the viewport width, so it equals the screenshot width.
7. **Elevator geometry is underspecified.** The contract gives only `pos`/`size`. The handmade stage treats it as a `size`×`size` square platform centered at `pos` that fills the gap between the two islands. Phases 04 and 05 need a definitive rule, ideally from Phase 01's bundle findings.

---

# Phase 02b (contract v0.2)

- **Agent:** Claude Opus 5.5 (1M context), a Claude Code sub-agent in an isolated git worktree (branch `worktree-agent-aa08707eac875c925`).
- **Start / end:** 2026-09-25 ~07:50Z → ~08:10Z.
- **Environment:** macOS (arm64), Node 26.0.0, pnpm 11.5.0, Playwright 1.63 Chromium.

## Instructions received (summary)
Gate G0: make the code match `plans/contracts.md` v0.2.0 exactly (the orchestrator rewrote it from Phase 01's contract deltas).
Update `@wwm/schema` to 0.2.0 (constants, types, Zod, `validateStage`, ids, slicing helpers), regenerate
`handmade-simple` at the new scale, add DPR support to the capture pipeline, move `tools/ref-fetch` onto `@wwm/schema`
and the real `validateStage`, and keep `pnpm check` green. Don't touch `plans/**`.

## What changed
- `@wwm/schema` 0.2.0: see `packages/schema/CHANGELOG.md`. New `slice.ts` (`sliceCount`, `sliceRange`), `rampSlope`,
  9 new `validateStage` codes (31 in total), each with at least one negative test.
- `@wwm/capture-script`: `capturePage` records `screenshot.scale` from `window.devicePixelRatio` and the real PNG size
  (new `pngSize`). There is a DPR 2 end-to-end test.
- `tools/fixture-capture`: captures at `CAPTURE_DPR` (2) by default, with `--dpr` and a `CAPTURE_DPR` env override (`defaultDpr`).
  The handmade generator was rewritten for a 640×800 stage (levels 0/0/1.5/4, 3 flat bridges, a 160 px ramp at
  slope 0.127, an elevator across a 16 px gap, 20 small + 2 large items, and a 2× texture with a 13.5 px grid).
- The 7 capture fixtures gained `"scale": 1`. They were not recaptured.
- `tools/ref-fetch`: the TEMP `stage-types.ts` and `checkStructure` were deleted. It now imports `@wwm/schema`, emits `wwm.stage/2`, and writes
  the `validateStage` report to `reference/aid-dcc.check.txt`. Plain `node src/*.ts` resolves the workspace package fine.
- No other scaffold needed changes. They only import `CONTRACT_VERSION`.

## Attempts that failed, and why
- The worktree's `plans/contracts.md` was still v0.1.0, because the orchestrator's v0.2.0 rewrite is uncommitted in the main checkout.
  I read v0.2.0 from there (read-only).
- The worktree guard refused compound shell commands (heredocs, globs in `sed`), so I made the edits file by file.
- Biome flagged `forEach((x) => bounds(...))` as returning a value (`useIterableCallbackReturn`), so I rewrote those as `for…of`.
- Two of my own negative tests picked coordinates that tripped a different invariant first (an endpoint exactly at the
  20 px tolerance, and an elevator footprint that missed island B). I fixed the coordinates.

## Test evidence
- `pnpm check` is green: typecheck for 15 packages, Biome clean, **18 test files and 130 tests passed**.
- `pnpm --filter @wwm/fixture-capture handmade` validates the stage before writing. The texture was inspected visually.
- `pnpm ref:fetch --only wwmmm-json,wwmmm-png` produced 62 `validateStage` issues on aid-dcc in 4 codes, analysed in the hand-off below.
- DPR 2 sample captures (to a temp dir, not committed): hn-front grew from 284 KiB to 653 KiB (2.3×), and wikipedia-article
  (2560×12000) grew from 2.4 MiB to 6.8 MiB (2.8×).

## Remaining defects and follow-ups
- The 7 capture fixtures are still DPR 1. A 2× recapture would grow them from about 9.2 MiB to about 22–26 MiB (estimated from the samples) and
  would also change their content, because pages drift. That should be a deliberate orchestrator decision.
- aid-dcc still fails 62 checks, all attributable to contract choices (see the CCRs below).

## Contract Change Requests (Phase 02b)
1. **`MAX_RAMP_SLOPE` = 0.176 is slightly below the 2013 data.** 17 of the 18 sloped 2013 ramps have slopes of 0.17625–0.17643
   (≈ tan 10° = 0.17633, plus integer rounding in the original generator). Proposal: `MAX_RAMP_SLOPE = 0.1765`
   (or `tan(10°)` with a validator tolerance of about 0.1 %). Affects 03, 05 and 09.
2. **Item edge clearance.** 32 of the 505 2013 items sit inside their island but only 3.75–6.54 px (0.28–0.48 D) from the edge.
   That is closer than `BALL_RADIUS_PX` = 6.75. 2013 items are sensors, and the ball can collect them while its center is on the deck, so the §3
   rule is stricter than 2013. Proposal: keep it for the builder, or relax it for items only to about 0.25 D. Affects 03 and 09.
3. **`MIN_BRIDGE_WIDTH_PX` = 34 (2.5 D)** rejects 11 of the 31 2013 bridges and 2 of the 6 elevators (1.6–2.9 D wide). This is an intentional,
   accessibility-leaning choice, and nothing needs to change. It is listed only so the aid-dcc report is understood.
4. **Elevator width minimum.** The contract states the width minimum only for bridges. I also applied it to elevators
   (`elevator-too-narrow`) because they share the bridge footprint convention. Please confirm.
5. **Endpoint tolerance.** §9 says "within 20 px". It used to equal `BALL_RADIUS_PX`, but at the new scale they differ. I kept 20 px as
   `ENDPOINT_TOLERANCE_PX` (≈ 1.5 D). Please confirm, or restate it in D.
6. **Tiny tail slices.** Slicing exactly per §4 gives a 1 px last stage for a 1701 px page. Consider a minimum tail height,
   e.g. merging a tail under about 400 px into the previous slice (slightly over 1700) or balancing the slice heights. Affects 03, 07 and 08.
7. **`texture.path` may be `''`.** §4 says `buildStage` returns an empty path. The Zod schema now allows it, so validation still
   works on builder output.
8. **`stars` range.** `CuratedResponse.runs[].stars` is implemented as an integer from 0 to 5. The contract doesn't give a range.
