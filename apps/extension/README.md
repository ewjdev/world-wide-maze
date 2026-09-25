# @wwm/extension: "Maze this page"

A Chrome MV3 extension (Phase 14, contracts §10.2). Click it on any page you're looking at, including pages
behind a login or a bot wall, and that page, as you see it, becomes a World Wide Maze. The capture and the
maze are made in your browser. Nothing is uploaded unless you press **Share** in the game.

## Load it (unpacked)
1. `pnpm --filter @wwm/extension build`. This writes `apps/extension/dist/chrome/` and a zip next to it.
   - Pass `--origin https://your-game.example` (or set `WWM_GAME_ORIGIN`) to point it at a deployed game.
     The default is the dev server, `http://localhost:5173`.
   - Add `--firefox` to also write `dist/firefox/` (Firefox manifest; untested).
2. Open `chrome://extensions`, switch on **Developer mode**, click **Load unpacked**, and pick
   `apps/extension/dist/chrome`.
3. Pin "World Wide Maze: Maze this page", run the game (`pnpm dev`), open any website, and click the icon.

After a rebuild, press the reload arrow on the extension's card in `chrome://extensions`.

## How it works
1. **Click.** The popup opens and starts at once. Opening it grants `activeTab` for that tab.
2. **Capture** (service worker, `src/capture.ts`):
   1. Prepare the page: pause animations and transitions, scroll through once so lazy images load, and wait
      for fonts and images (bounded).
   2. Read the DOM with `@wwm/capture-script`'s `extractPage` (the same extraction the capture service uses).
   3. Take frame 0 at the top, then hide fixed and sticky elements so a site header appears once. Scroll-stitch
      the remaining frames with `chrome.tabs.captureVisibleTab` (at most 2 per second, Chrome's limit).
   4. Put the page back: unhide, unfreeze, restore the scroll position.
   5. Stitch at `min(devicePixelRatio, CAPTURE_DPR)`, within 30 MP and at most `MAX_PAGE_HEIGHT_PX` tall.
      Encode as WebP, or PNG where WebP isn't available.
   6. Check the `CaptureBundle` with `parseCapture`. That includes the v0.2.7 size limits.
3. **Hand off** (`src/job.ts`): open the game at `/play/local?via=extension`, inject `pageDeliver` into that
   tab, wait for the receiver's `wwm:ready`, and `postMessage` one `wwm:capture` to the same window and origin.
   The receiver answers `wwm:ack` or `wwm:reject`.
4. **Play** (`apps/web/src/local-capture/`): the receiver validates the capture, builds it in a Web Worker
   with `@wwm/stage-builder`, and plays it in the normal game shell.

The popup shows each step, and errors stay in the popup. The job lives in the service worker, so it keeps
running after the popup closes, which happens when the game tab takes focus. If the popup is gone when a
later step fails, the icon shows a red `!`, and the next popup shows the error.

## Permissions
| Permission | Why |
|---|---|
| `activeTab` | Read and screenshot the tab you clicked on, only then. |
| `scripting` | Run the extraction in that tab and hand the capture to the game tab. |
| `host_permissions`: the game origin only | Inject the handoff into the game tab. Dev builds list `http://localhost/*` and `http://127.0.0.1/*`, and a `--origin` build lists only that origin. |
| `optional_host_permissions` | Asked for only if you point the extension at another game address in the popup's settings. Chrome shows no warning for these at install. |

There's no `tabs`, `storage` or `<all_urls>`. The chosen game address lives in the popup's `localStorage`.

## Security notes
- The injected page functions (`src/page-fns.ts`) run in the extension's isolated world. The page's own
  scripts can't call or alter them.
- `pageDeliver` refuses to post unless the tab is at `<game origin>/play/local`. It posts only to
  `location.origin`, and the image is transferred rather than copied.
- The receiver accepts a capture only from its own window and origin (this content script) or from its
  `window.opener` (the bookmarklet). Messages from frames or other tabs are dropped, and there's an e2e test
  for that.
- The receiver recomputes the capture id. The server computes its own from the uploaded bytes on Share.

## Tests
- `test/capture.test.ts` covers the capture sequence against a mocked `chrome.*`: call order, frame
  placement, the fixed-element rule, DPR caps, the pixel budget, restore on failure, restricted pages, the
  job's permission and handoff paths, the manifest's permissions, icons and strings.
- `test/extension.e2e.test.ts` loads the unpacked extension in Playwright Chromium with the `chromium`
  channel (new headless), the game on Vite and the Worker in workerd. It clicks the toolbar action through
  CDP `Extensions.triggerAction`, which needs `--enable-unsafe-extension-debugging`, and checks:
  - scroll-stitched capture → `/play/local` → a maze the ball rolls on, with the page restored
  - Share → `POST /api/stages/upload` → the shared link plays from the server
  - a capture posted from another origin is ignored
  - the bookmarklet's sketch mode is playable
  - the popup explains pages it can't capture

  `WWM_SHOTS=1` writes screenshots to `docs/build-log/assets/phase-14/`, and `WWM_HEADED=1` shows the browser.
- Run them with `pnpm vitest run --project @wwm/extension`. Without Playwright Chromium the e2e is skipped
  locally; it's required in CI.

## Publishing
Not published. `STORE_LISTING.md` is a **draft** of the Chrome Web Store listing. Publishing needs the
project owner's developer account and a production `--origin` build.
