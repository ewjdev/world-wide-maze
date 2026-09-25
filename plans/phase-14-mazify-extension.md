# Phase 14 — "Maze this page": browser extension + bookmarklet
**Wave:** 5 · **Contracts:** §10.2 · **Label:** N

## Goal
From any page you're viewing, including pages behind logins or bot walls, one click turns **that page as you see it** into a maze. The capture happens in your browser, the maze is built in your browser, and nothing is uploaded unless you choose Share. This fixes the "any website" promise where server capture is weak, and it's private by design.

## Owns
- `apps/extension/**` (new: a Chrome MV3 extension, with Firefox compatibility where cheap)
- `apps/web/src/local-capture/**` (new: the `/play/local` receiver)
- One route line in `apps/web/src/routes.tsx` and one hook in `GameApp.tsx`
- The worker route `apps/worker/src/routes/upload.ts` and its registration (`POST /api/stages/upload`)
- `docs/build-log/phase-14.md`

## Tasks
1. **Extension (MV3):**
   - A toolbar action runs `@wwm/capture-script`'s `extractPage` (bundled) in the active tab.
   - It captures the full page by scroll-stitching `chrome.tabs.captureVisibleTab`, hides fixed or sticky elements after the first frame, respects the height cap and `CAPTURE_DPR`, and restores the scroll position.
   - It builds a `CaptureBundle`, opens the game (a configurable origin, defaulting to localhost dev) at `/play/local`, and posts a `wwm:capture` message (§10.2).
   - Permissions are minimal: `activeTab` and `scripting`. There's no host-permission sprawl.
   - The popup shows progress and errors.
2. **Receiver (`/play/local`):**
   - Accept messages only from the allowed origin.
   - Validate the payload, decode the image, build client-side through the existing builder worker, and play.
   - A **Share** button uploads to `POST /api/stages/upload`, which creates a shareable service run, stays unlisted, and applies the moderation hook.
3. **Bookmarklet (fallback, lower fidelity):**
   - It opens the game and posts a DOM-only bundle, with **no screenshot**.
   - The game renders islands with a generated texture: each element's box drawn with its text in the page's colors. Clearly labelled "sketch mode".
   - Provide a "drag me to your bookmarks bar" link on the select screen, and a small install page `/mazify`.
4. **Worker `POST /api/stages/upload`:**
   - Multipart, with the v0.2.7 size limits plus a max image size.
   - Rate limits and the global build cap apply, and so do the solver hook and reroll.
   - Returns `{runId, stageIds}`.
   - Integration tests.
5. **Tests:**
   - Extension capture logic, unit-tested with a mocked `chrome.*` API.
   - A Playwright test that loads the unpacked extension (Chromium supports `--load-extension` in headed or new-headless mode), captures a fixture page served locally, and lands in a playable `/play/local`.
   - Receiver origin checks, including a negative test with a wrong origin.
6. **Packaging:** `pnpm --filter @wwm/extension build` produces a zip. Write Chrome Web Store listing text as a DRAFT. Don't publish; that needs the user's developer account.

## Acceptance
- The E2E test goes from extension click to a playable maze of a local page.
- The bookmarklet sketch mode is playable.
- Upload/share works against the local worker.
- `pnpm check` is green. Screenshots are in `docs/build-log/assets/phase-14/`.
