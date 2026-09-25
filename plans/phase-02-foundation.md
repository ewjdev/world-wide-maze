# Phase 02 — Foundation: Monorepo, Schema, Capture Script, Fixtures

**Wave:** 0 (parallel with 01) · **Depends on:** — · **Blocks:** everything in Wave 1

## Goal
Create the skeleton every other agent builds in. That means a working monorepo, the **`@wwm/schema` package implementing `plans/contracts.md` exactly**, the shared in-page capture script, and the fixtures everyone tests against.

## Read first
`plans/00-overview.md`, `plans/contracts.md` (you're implementing it), and `RESEARCH.md` Part 4.1.

## Owns
Repo root config (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `vitest.workspace.ts`, `.gitignore`, `.github/workflows/ci.yml`), `packages/schema/**`, `packages/capture-script/**`, `tools/fixture-capture/**`, `fixtures/**`, and empty scaffolds (only `package.json`, `src/index.ts`, `README.md` stub) for every package and app in the overview's layout.

## Tasks
1. **Monorepo:**
   - `git init`, pnpm workspaces, TS project references (or plain `tsc -b`), Biome, Vitest workspace, Playwright installed.
   - Root scripts: `pnpm check` (typecheck + lint + test), `pnpm dev` (web + worker), `pnpm ref:fetch` (placeholder that Phase 01 fills in).
   - `.gitignore` includes `reference/`, `node_modules`, `.wrangler`, `dist`.
2. **Scaffolds:**
   - `apps/web` (Vite + React + TS, with an empty route shell: `/`, `/play/:stageId`, `/c/:code`, `/about`)
   - `apps/worker` (Wrangler, TS, `wrangler.jsonc` with R2, D1, KV and a Browser Rendering binding placeholder, and a Durable Object class stub `Room`)
   - `packages/{schema,capture-script,stage-builder,engine,physics,net,solver,ai}`
   - `tools/{fixture-capture,stage-debugger,batch-eval}`

   Each one builds and exports something trivial.
3. **`@wwm/schema`:**
   - Every type, constant and error code in contracts.md.
   - `space.ts` (`pageToWorld`, `worldToPage`) and `rng.ts` (seeded mulberry32 with `fork(label)`).
   - Zod schemas mirroring the TS types, with `parseStage`, `parseCapture`, and `validateStage(stage): {ok, errors[]}`, which implements every invariant in contracts §3.
   - `encodeInput` / `decodeInput` for the 12-byte controller frame (contracts §6).
   - `CHANGELOG.md` at `0.1.0`.
   - Thorough unit tests, including property tests for the codec and space round-trips.
4. **`@wwm/capture-script`:** exports `extractPage(): Omit<CaptureBundle,'screenshot'|'captureId'|'capturedAt'>` as a **self-contained function** that runs in the page (with `page.evaluate`), so it has no imports at runtime. It must:
   - Walk visible elements and classify `kind` (heuristics: tag, role, ARIA, class hints like `ad`/`sponsor` → `adlike`).
   - Collect per-line text rects with `Range.getClientRects()`.
   - Resolve each element's computed background, depth, `fixed`/`sticky`, and a z hint.
   - Skip invisible and zero-area elements and anything outside the page bounds.
   - Merge text rects that are fully contained in their parent.

   Also export `preparePage(page)` helpers, written as plain functions that take a Playwright-like `Page` interface:
   - Scroll through to trigger lazy loads, then back to the top.
   - Wait for fonts.
   - Pause animations with CSS, and pause videos.
   - Hide `fixed`/`sticky` elements after capturing them once.
   - Dismiss common cookie banners (selector list).
5. **`tools/fixture-capture`:** a local Playwright CLI: `pnpm fixture:capture <url> <slug>`. It writes `fixtures/captures/<slug>/capture.json` and `screenshot.png` (1280 wide, full page, height capped at 6000). Capture **6 contrasting pages**:
   - long article: a Wikipedia article
   - dense list: Hacker News front page
   - card grid: a news or portfolio site
   - dark theme: a dev docs page in dark mode
   - sparse landing page: example.com-like or a minimal personal site
   - image-heavy: a gallery-style page

   Record the source URL and date in `fixtures/captures/README.md`. Prefer pages with permissive terms, and note any concerns.
6. **Hand-made stage:** `fixtures/stages/handmade-simple.json` + `.png` (a simple drawn 1280×1600 texture with 4 colored blocks). It has 4 islands (levels 0, 0, 1, 3), 3 flat bridges, 1 ramp, 1 elevator, 20 small items, 2 large items, a start and a goal, guardrails with gaps at bridge mouths, and restart points. It must pass `validateStage`. It lets Phases 04 and 05 start before the builder exists.
7. **CI:** a GitHub Actions workflow that runs `pnpm check` on push and PR.
8. **Root `CLAUDE.md` update:** add the concrete commands (`pnpm check`, `pnpm dev`, `pnpm fixture:capture`).

## Acceptance criteria
- A fresh clone passes `pnpm i && pnpm check` with no errors.
- `pnpm --filter web dev` serves the route shell. `pnpm --filter worker dev` starts Wrangler locally.
- `@wwm/schema` has 100% of the contracts.md surface, plus tests for `validateStage` (at least 1 negative test per invariant) and for the codec.
- The 6 capture fixtures exist, and each `capture.json` passes `parseCapture`. Screenshots are 1280 wide.
- `handmade-simple.json` passes `validateStage`.

## Out of scope
Any builder, render or physics logic. Deployed infrastructure (Phase 07/12).
