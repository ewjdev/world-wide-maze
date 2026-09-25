# @wwm/capture-script

This package holds the in-page DOM extraction and the page preparation steps. The local fixture tool (Phase 02) and
the hosted capture Worker (Phase 07) both use it, so fixtures and live captures go through the same steps.

## API
- `extractPage(opts?) → Omit<CaptureBundle, 'screenshot'|'captureId'|'capturedAt'>`: a **self-contained** function
  that runs inside the page. It has no runtime imports and no outer references. Options: `maxPageHeight` (6000), `minArea` (16 px²), `maxElements` (6000), `maxTextLength` (120).
- `pageExpression(fn, arg?) → string`: wraps an in-page function for `page.evaluate(expression)`.
  **Always use it** instead of `page.evaluate(fn)`. tsx and wrangler (esbuild `keepNames`) inject a `__name(...)`
  helper into function bodies that doesn't exist inside the page, and the wrapper shims it.
- Preparation helpers take a `PageLike` (`{ evaluate(expression: string): Promise<unknown> }`), which Playwright and `@cloudflare/playwright` pages both satisfy:
  - `dismissCookieBanners` works in 3 steps. First it tries known CMP selectors, reject buttons first. Then a text fallback clicks "Reject…" (or else "Accept…") inside cookie or consent containers. Finally it removes the containers and undoes scroll locks.
  - `freezeMotion` pauses CSS animations and transitions and pauses videos.
  - `scrollThrough` scrolls in viewport steps to trigger lazy loads, then back to the top.
  - `waitForAssets` waits for fonts and pending images, with a bound.
  - `hideFixedElements` sets fixed and sticky elements to `visibility:hidden`. Call it **after** `extractPage`, so they are recorded once with `fixed: true` but don't paint into the full-page screenshot.
  - `preparePage` runs the full sequence (everything except hiding).
- `capturePage(page, url, {screenshotPath, …}) → {bundle, png, prepare, hiddenFixed}` runs the full sequence: viewport 1280×800 → goto → prepare → extract → hide fixed → PNG screenshot (1280 wide, height ≤ 6000) → `CaptureBundle` with `captureId` and a normalized URL.
- `normalizeUrl(url)` lower-cases the host, strips default ports, the fragment and tracking params, and sorts the query.

## Extraction rules (summary)
- **Text ownership.** Each non-blank text node belongs to its nearest non-inline ancestor. `lines` come from `Range.getClientRects()` per text node. Fragments on the same visual line are merged, and rects contained in another rect are dropped.
- A `text` element fully contained in its nearest emitted `text` ancestor is merged into that ancestor.
- **Kind.** `adlike` (ad or sponsor class/id hints, ad iframes) > nav/header/footer (tag or ARIA role) > heading > video/canvas/image > button > input > link > text (owns text) > block (has a background, border or shadow). Plain wrappers are not emitted.
- **Skipped.** `display:none` or `opacity:0` subtrees, `visibility:hidden` elements, zero or tiny area, anything outside the page or clipped away by `overflow` ancestors, `<html>`/`<body>` themselves, and hidden inputs.
- `fixed` is inherited from fixed or sticky ancestors. `z` is the nearest positioned ancestor-or-self's numeric `z-index` (a hint only). `bg` is converted to `#rrggbb`, including `oklch()`/`color()` via canvas.
- `page.width` is capped to the viewport width, so it matches the screenshot.

## Run
Tests: `pnpm vitest run --project @wwm/capture-script`. They drive real Chromium with synthetic pages. They are skipped
locally if Playwright Chromium isn't installed (`pnpm --filter @wwm/fixture-capture browsers`) and are required in CI.
