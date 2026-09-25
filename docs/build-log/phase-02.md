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
- Capture runs (elements / time): wikipedia-article 399 / 2.4 s, hn-front 354 / 1.0 s, bbc-news-grid 327 / 3.1 s, govuk-card-grid 243 / 1.8 s, mdn-dark-docs 312 / 1.8 s, example-sparse 4 / 0.9 s, image-gallery 400 / 2.6 s.

## Remaining defects and limitations
- The `adlike` heuristic misses ads without class or id hints, e.g. the MDN top and footer ad bands.
- `z` is only a hint: the nearest positioned numeric z-index, with no full stacking-context resolution.
- Fixed and sticky elements are hidden in the screenshot, which leaves blank space where sticky elements were in flow.
- The `bbc-news-grid` fixture contains copyrighted news photos. It is for internal testing only (see `fixtures/captures/README.md`).
- Fixture PNGs total about 9.8 MB, with BBC alone at 3.7 MB. WebP or quantization could shrink them if repo size matters.
- Worker tests run in plain Node. Binding-level tests (`@cloudflare/vitest-pool-workers`) are left to Phase 07.

## Contract Change Requests (interpretations implemented; the orchestrator should confirm or amend contracts.md)
1. **Ring orientation.** "CCW" is implemented as a positive shoelace area on raw page (x, y), which looks clockwise on screen because y points down. Holes are the opposite (CW). The helpers are `isCCW`/`signedArea`. Affects 03, 04, 05 and 09.
2. **Id hashing.** `captureId = sha256(url|capturedAt)` and `stageId = sha256(captureId|seed|builderVersion|difficulty)`, joined with `|` to avoid concatenation collisions. Affects 03 and 07.
3. **`JobEvent` SSE shape.** It is `{type:'progress',step,pct} | {type:'done',stageId} | {type:'error',code,message}`, where `type` doubles as the SSE `event:` name. `pct` is 0–100. Affects 07 and 08.
4. **Extra validation rules** beyond the listed §3 invariants, derived from the field comments: bridge `levelA`/`levelB` equal their islands' levels; `flat` ⇔ equal levels; bridge endpoints lie on or within 20 px of their islands; guardrails must not cross a bridge's walkable lanes (the centerline and ±(width/2 − 20 px)); elevator `levelLow`/`levelHigh` equal the min/max island levels; start is inside its island with 20 px clearance; goal is inside its island; ids are unique; contours are simple; holes are inside their contour. Affects 03, 09 and 11.
5. **Derived constants added:** `CONTRACT_VERSION`, `MAX_PAGE_HEIGHT_PX`, `DEFAULT_VIEWPORT`, `MAX_TILT`, `BALL_RADIUS_PX`, `INPUT_STALE_MS`, `ROOM_CODE_LENGTH`. **Helper types added:** `Difficulty`, `ItemKind`, `DropReason`, `BuildStageFn`, `CreateSimulationFn`, `Replay`, `ControllerInputFrame`, the per-message `ControlMessage` union, and the §7 request/response bodies. `SubmitScoreRequest.name` is limited to 1–32 characters.
6. **Unspecified by the contract:** relative asset paths. `screenshot.path` and `texture.path` are relative to their JSON file. `CaptureBundle.page.width` is capped to the viewport width, so it equals the screenshot width.
7. **Elevator geometry is underspecified.** The contract gives only `pos`/`size`. The handmade stage treats it as a `size`×`size` square platform centered at `pos` that fills the gap between the two islands. Phases 04 and 05 need a definitive rule, ideally from Phase 01's bundle findings.
