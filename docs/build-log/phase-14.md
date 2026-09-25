# Build log: Phase 14 ("Maze this page": browser extension + bookmarklet)

- **Agent:** Claude Opus 5.5 (1M context), run as a Claude Code sub-agent in an isolated git worktree
  (branch `worktree-agent-ad4d356a8465a5f48`). Wave 5, in parallel with Phases 13, 15 and 16.
- **Start / end:** 2026-09-25 ~16:58Z → ~17:45Z.
- **Environment:** macOS (Apple M5 Max), Node 26, pnpm 11.5, Vite 8.3, esbuild 0.28, wrangler 4.140 (workerd),
  Playwright 1.63 with Chromium build 1243 (the full `chromium` channel, new headless).

## Instructions received (summary)
- Execute `plans/phase-14-mazify-extension.md` against contracts §10.2, using `LocalCaptureMessage` and the
  capture limits already in `@wwm/schema` 0.3.0. Don't change the schema; file CCRs instead.
- Build:
  - a Chrome MV3 extension (`activeTab` + `scripting` only; scroll-stitched full-page capture; popup with
    progress and errors)
  - the `/play/local` receiver (origin checks, client-side build, Share)
  - a bookmarklet with a "sketch mode" texture, a link on the select screen, and a `/mazify` install page
  - `POST /api/stages/upload` with limits, rate limits, moderation, solver and reroll, plus integration tests
  - an E2E from the extension click to a playable maze
  - a zip build and a DRAFT store listing
- Constraints: no deploys, no Cloudflare resources, no pushes, no store submission, and leave other people's
  dev servers alone. Stay inside the owned paths; edits to `GameApp.tsx` and `routes.tsx` must be tiny. Use
  `impeccable` for the popup and the install page.

## What was built
**Extension** (`apps/extension`, new package `@wwm/extension`):
- `src/capture.ts` is the capture sequence, with injected browser APIs:
  1. `pagePrepare`: freeze motion, scroll through for lazy content, wait for fonts and images.
  2. `extractPage` from `@wwm/capture-script`, bundled.
  3. Frame 0 → `pageHideFixed` → the rest of the frames (`framePlan`, at most 2 `captureVisibleTab` calls per
     second).
  4. `pageRestore` in a `finally`.
  5. OffscreenCanvas stitching at `min(frame scale, CAPTURE_DPR, the 30 MP budget)`, then WebP (PNG as the
     fallback).
  6. The bundle is checked with `parseCapture`.
- `src/job.ts`:
  - checks the game-origin permission up front, then capture → `tabs.create(<origin>/play/local?via=extension)`
    → wait for load → inject `pageDeliver`
  - `pageDeliver` waits for `wwm:ready`, posts `wwm:capture` to the same window and origin with the image
    transferred, and resolves on `wwm:ack` or `wwm:reject`
  - the badge shows `…` while working and a red `!` on an error
- The popup (`static/popup.{html,css}`, `src/popup.ts`) starts when it opens (one click), shows six steps with
  a frame counter, the colour-role progress strip, errors with Try again, an explanation for restricted pages,
  and a game-address setting. The setting requests an optional host permission for just that origin and is
  stored in the popup's `localStorage`, so no `storage` permission is needed. en/ja strings.
- `scripts/build.ts` uses esbuild (minified, not obfuscated). It generates the manifest (game origin from
  `--origin` or `WWM_GAME_ORIGIN`) and procedural PNG icons (the four colour-role islands, so there are no
  binary assets). It copies the self-hosted Unbounded and Figtree fonts and writes a reproducible zip. With
  `--firefox` it also writes a Firefox manifest variant, which is untested.
- `README.md` covers how to load it, how it works, the permissions and security. `STORE_LISTING.md` is the
  DRAFT listing.

**Receiver** (`apps/web/src/local-capture`, new):
- `protocol.ts` handles the §10.2 handshake (`wwm:ready` / `wwm:capture` / `wwm:ack` / `wwm:reject`):
  - `isTrustedSource` accepts only its own window and origin (the content script) or `window.opener` (the
    bookmarklet).
  - `validateCaptureMessage` runs `parseCapture` (the v0.2.7 limits) plus receiver limits: 64 MB of image, 32 MP,
    3840 px width, scale ≤ 3, and screenshot size = page × scale. It requires http(s) pages, normalizes the URL,
    recomputes the capture id, and requires a screenshot from the extension.
- `LocalPlayPage.tsx` moves through waiting → checking → playing, or rejected. While waiting it announces
  readiness every 500 ms; after 8 s it shows help and links. While playing it mounts the unchanged `GameApp`
  with a `LocalRun`, plus the origin plate: a Local capture or Sketch mode tag, the host, a privacy line, and
  Share, which switches to link, Copy and Open once shared.
- `local-run.ts` and `build.worker.ts` build the stages: `@wwm/stage-builder` runs in a Web Worker that
  receives a transferred `ImageBitmap`, and the slice textures are cropped from the bitmap. The stages are
  tagged `provenance.notes: ['local-capture']`, plus `'sketch-mode'` for bookmarklet runs.
- `sketch.ts` draws a stand-in texture at 2× for bookmarklet captures (N): each box in its own background
  colour, text in contrast ink on the surface beneath it (links in blue and underlined), images as hatched
  frames, and buttons and inputs outlined.
- `share.ts` builds the multipart upload: a 1× analysis PNG (≤ 8 MP) plus one WebP texture per slice at up to
  2× (PNG if WebP encoding isn't available). It then POSTs to `/api/stages/upload`.
- `bookmarklet.ts` inlines `extractPage`. It opens `/play/local?via=bookmarklet`, sends only to the game origin
  and only to the tab it opened, and warns when a page's COOP cuts the link.
- `MazifyPage.tsx` is the `/mazify` install page: the extension steps, the draggable bookmarklet, and what
  happens to the page. `SelectHint.tsx` is the select-screen line: a draggable "Maze this page" chip plus
  "Extension and more". `strings.ts` holds en/ja, and `routes.tsx` adds `/play/local` and `/mazify`.

**Worker** (`apps/worker/src/routes/upload.ts`, `upload-limits.ts`, `upload-png.ts`, and one line in `router.ts`):
- `POST /api/stages/upload` checks the kill switch, then reads the multipart body with a hard cap, whatever
  `content-length` claims. It validates the upload (limits below), then checks the opt-out list, the per-IP
  build limit and the global build cap. Rejected uploads don't use up build quota.
- It then runs the unchanged `runBuildJob` with an **upload `Capturer`**, so moderation, the builder,
  `validateStage`, the solver hook and seed reroll, and storage are all the hosted pipeline's.
- The store wrapper never caches by URL (uploads are unlisted), and the builder wrapper tags
  `local-capture`.
- The response is `200 {runId, stageIds}` once every slice is stored.
- **The capture id is derived on the server** from the URL, the time and the sha256 of the image. So an upload
  can't claim another run's id and overwrite its stages or textures (tested).
- Limits (the `UPLOAD_LIMITS` constant):

  | Part | Limit |
  |---|---|
  | Whole body | 40 MB |
  | `bundle` | 8 MB |
  | `image` | 16 MB, PNG only (sniffed), ≤ 8 MP |
  | `page.width` | ≤ 2560 |
  | Each `texture<i>` | 12 MB, WebP or PNG, scale 1–2, height matching its slice |
  | Texture count | all slices or none |
  | Field names | no unknown fields |

- If the client sends no textures, the Worker crops each slice from the analysis image and encodes it with
  a small streaming PNG encoder (`CompressionStream('deflate')`).

**Small edits outside the owned folders** (for the orchestrator's merge; each one is a few lines):
- `apps/web/src/routes.tsx`: one spread line, `...localCaptureRoutes`, and its import.
- `apps/web/src/ui/GameApp.tsx`: a `localRun?: RunSource` prop passed to `Game`.
- `apps/web/src/game/game.ts` (Phase 13's area this wave): a `GameOptions.localRun`, and a 4-line branch in
  `mount()` that starts it like a deep link. A hook in `GameApp` alone wasn't enough: `Game.#beginRun` is
  private, and calling it after `mount()` would race the title's attract stage load.
- `apps/web/src/ui/Screens.tsx` (Phase 13's area): one `<SelectHint />` line and its import, under the URL
  field's tip.
- `apps/web/public/_headers`: a `/play/local` rule that detaches `Cross-Origin-Opener-Policy`, because COOP
  `same-origin` would sever the bookmarklet's `window.opener` handoff. Every other header, including the CSP,
  still applies.
- `apps/web/package.json` adds a `@wwm/capture-script` dependency (for the bookmarklet and `normalizeUrl`).

## Attempts that failed, and why
- **`captureVisibleTab` without a real click.** The first E2E opened the popup page itself for the fixture tab.
  Chrome refused with "Either the '<all_urls>' or 'activeTab' permission is required": host permission for
  127.0.0.1 isn't enough, and `activeTab` is granted only by a real action invocation. The fix was to have the
  test *click the toolbar action* through CDP `Extensions.triggerAction` on the browser session. That needs
  `--enable-unsafe-extension-debugging` and the **tab** target id, not the page target. So the E2E runs the
  shipped manifest, unchanged, through the real click path.
- **Workers can't fetch `blob:` under the CSP.** The offline builder worker takes a screenshot URL, and
  `connect-src 'self'` would block a worker `fetch` of a `blob:` URL. So the local builder worker takes a
  transferred `ImageBitmap` instead.
- **`tabs.query` URLs are hidden without the `tabs` permission.** This hit the test, not the product. The E2E
  finds tabs through host-permitted URLs and creates the `chrome://` tab from the service worker.
- **The popup bundle was 820 KB,** because importing `capturable` from `capture.ts` pulled in zod. The URL check
  moved to `url.ts`, and the popup is now 8.6 KB.
- **The worker's Node tsconfig failed** when a test imported `routes/upload.ts`, which reaches Worker-only
  types through Hono's `AppEnv`. The limits moved to a type-free `upload-limits.ts`.
- **The wrangler test harness stringifies a Node `FormData` body.** The integration test encodes the multipart
  body through a `Request` first.
- **React refuses `javascript:` hrefs.** The bookmarklet anchors render `href="/mazify"`, and an effect swaps in
  the bookmarklet URL. Clicking it here shows "drag it instead".

## Manual human interventions
None. Loading the unpacked extension by hand, and a click from a real toolbar, are still for the user (see
below).

## Test evidence
- `pnpm check`: green. **56 files, 788 tests passed, 13 skipped** (the pre-existing skips).
- `apps/extension/test/extension.e2e.test.ts` (5/5, about 40 s, real Chromium with the unpacked extension,
  Vite, workerd):

  | Test | Result |
  |---|---|
  | Extension click (CDP `triggerAction`) → capture → `/play/local` → playable | Scroll-stitched 3 frames of a 2,300 px local page on another origin. The game tab opens, the handoff is acknowledged (`via: extension`), and the game reaches `play`. The keyboard rolls the ball more than 0.5 m. The original page is back at scrollY 420 with no marks left. No console errors. |
  | Share | `POST /api/stages/upload` → `/play/<stageId>`. The stored stage has `local-capture` and the page URL. The link plays from the server and the ball rolls. |
  | Wrong origin | A frame on another origin posts two captures (targets: the game origin and `*`). The receiver's `ignored` count is 2, `rejected` is 0, and it's still `waiting`. |
  | Bookmarklet | The `/mazify` link's code runs on the page → `via=bookmarklet` → sketch mode (`data-sketch`) → `play`, and the ball rolls. |
  | Restricted | The popup on `chrome://version` shows "This page can't be captured". The receiver shows help after 8 s. The select screen shows the hint. |

- `apps/extension/test/capture.test.ts` (28 tests, mocked `chrome.*`):
  - the call order: prepare → extract → frame 0 → hide → frames → restore
  - where each frame is drawn
  - the rate-limit sleeps
  - the DPR 3 → 2 and 1× cases, and the pixel budget
  - restore after a failed screenshot
  - restricted URLs are never touched, and unscriptable pages
  - the job's success, missing-permission and reject paths
  - `parseOrigin`, the manifest's permissions (dev and production), the icons, and en/ja key parity
- `apps/web/test/local-capture.test.ts` (26 tests):
  - trusted sources: self and same origin, the opener; rejected: another window, same window on another
    origin, no source, and no opener
  - validation: URL normalization, the recomputed id, sketch mode, a missing extension screenshot, a bad
    type or version or schema, the element limit, `file:` pages, huge pages, GIF, missing bytes, too many
    bytes, a size mismatch
  - the bookmarklet compiles, embeds the origin, is origin-strict, and round-trips through `javascript:`
  - sketch paint calls, and string parity
- `apps/worker/test/upload.integration.test.ts` (5 tests, workerd) and `upload-png.test.ts` (2):
  - upload → valid, tagged, Worker-cropped PNG texture
  - a three-slice run
  - client textures stored byte-for-byte
  - a forged `captureId` can't overwrite an existing run
  - 13 malformed-upload cases (415 JSON, 413, missing parts, not JSON, bad schema, a non-PNG image, an unknown
    field, a size mismatch, the wrong texture count, a bad texture, `file:` URLs, too many elements), none of
    which count against the limit
  - the per-IP limit gives 429 with `Retry-After`
  - cross-site gives 403
  - a PNG encoder round-trip
- **Screenshots** (`docs/build-log/assets/phase-14/`, from the E2E with `WWM_SHOTS=1`), reviewed by eye:
  `01-popup-capturing`, `02-popup-done`, `03-play-local`, `04-shared`, `05-play-sketch`,
  `06-popup-restricted`, `07-mazify` (full page), `08-receiver-waiting`, `09-select-hint`.
- **Impeccable detector** on `apps/web/src/local-capture` and `apps/extension/static` has one finding, the
  four-colour top stripe on the `/mazify` cards. It's kept on purpose, as in Phase 08: it's the islands' slab
  edge, the same motif as the select cards.

## Fidelity notes
All of this is N (new). 2013 captured pages on the server only and had no extension or bookmarklet. Sketch mode
is new. The 2013 look is carried by the existing colour roles, not reconstructed.

## Remaining defects and follow-ups
- **A real toolbar click and a real display DPR** haven't been exercised by a human. The E2E uses CDP
  `triggerAction`, which is the same code path, at the headless DPR of 1. Retina capture at 2× is unit-tested
  with mocks only.
- **Pages that scroll inside an element** (app shells with `body { overflow: hidden }`) capture one viewport,
  because the stitching scrolls the window. Lazy content that loads during the frames can shift the layout
  away from the DOM that was read.
- **Sticky elements in the middle of a page** are hidden after frame 0, as the service does it.
- **Bookmarklet limits:**
  - Pages with a strict CSP can block bookmarklets in some browsers (Firefox exempts them).
  - Pages whose COOP severs `window.opener` get an alert suggesting the extension.
  - Sketch mode is only as good as the DOM: images become hatched frames.
- **The in-game Result "share" link** for a local run points at `/play/local`, which is not shareable (it opens
  the waiting page). Hooking it to the upload would need an edit in Phase 13's `src/ui/Result.tsx`. The plate's
  Share button is the working path today.
- **Local runs skip the solver.** The server runs it on Share, and a reroll can then give the shared maze a
  different seed from the local one.
- **The Firefox build is untested.**
- **Worker README:** the upload route is documented here and in the extension README. Add a row to
  `apps/worker/README.md` (Phase 07's file) at merge.
