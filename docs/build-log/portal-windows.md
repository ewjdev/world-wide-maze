# Build log: Portal windows (see the next site, roll into it)

Plan: [plans/portal-windows-execution.md](../../plans/portal-windows-execution.md). Label: N (new; not in 2013).
One entry per milestone.

## M0: flag, `portal-hub` fixture, preview wiring, first look (2026-10-20)

Built in the main Claude Code session (Claude Opus 5.5) on branch `portal-windows/m0`, stacked on `plan/portal-windows`.

### What was built
- **Flag:** `VITE_PORTAL_WINDOWS_ENABLED` in `apps/web/src/game/portal-preview.ts`. It needs an explicit `'true'`, even in development (the tilt convention). With the flag off, the game never calls the new engine API, and every portal keeps the Phase 13 look.
- **`portal-hub` test fixture:**
  - **Page:** a page written for this repo, `fixtures/pages/portal-hub/index.html`. It was captured at DPR 2 into `fixtures/captures/portal-hub/` from a local static server, then its `url` was set to `https://wwm.ewj.dev/fixtures/portal-hub/`.
  - **Portals:** the builder places 4 portals on it at every difficulty and seed (1–5): Wikipedia, GOV.UK and example.com, which are fixtures, plus w3.org, which isn't. Every one of those builds passes `validateStage` with no reachability issues.
  - **Derived files:** a golden at `fixtures/builder/portal-hub.normal.seed1.json` (the other goldens are byte-identical) and a thumbnail at `apps/web/public/thumbs/portal-hub.webp`.
  - **Catalog:** a new `TEST_FIXTURES` list in `catalog.ts` makes it resolve at `/play/fixture-portal-hub` while keeping it out of `CATALOG` and the site picker.
  - **Provenance:** recorded in `NOTICE.md` and `fixtures/captures/README.md`.
- **Engine (additive):**
  - `Engine.setPortalPreview(id, image | null)`.
  - **Preview atlas:** each stage with portals gets a second canvas atlas with one 320 px cell per portal slot, sampling only the inner 304 px so neighbours don't bleed in through the mipmaps. It is allocated at full size, because three's WebGPU backend doesn't reallocate a texture whose image changes size.
  - **Has-picture flag:** the unused `state.w` attribute marks portals that have a picture. With it set, the vortex disc becomes the page's top square seen through a ragged tear (three angle harmonics) with camera parallax. The tear glows in the host colour, the picture has zero emissive, and the hard rim is hidden. Offline and used states grey the picture, and the surge whitens it.
  - **Draw calls:** still one for all portals.
- **Web:** `loadPortalPreviews` runs from `#playLoaded` when the flag is on. For each portal whose target is a fixture, it fetches the fixture screenshot and reads the PNG size from the header. It then decodes only the top square, downscaled to 384 px (`createImageBitmap` with a crop and `resizeWidth`/`resizeHeight`). Pictures are cached by fixture slug. A picture that arrives after the stage changed is dropped.
- **CI preview:** the `preview` job's build step sets `VITE_PORTAL_WINDOWS_ENABLED: "true"` and its summary lists the portal test links. The production build is unchanged.

### Measured
- On `portal-hub` with 4 portals, the scene uses **22 draw calls** on both WebGPU and WebGL2 (headless Chromium, 1280 × 800), the same as flag-off. The added atlas texture is bound inside the existing single portal draw.
- No console errors or warnings on either backend while rolling into the portals.

### Screenshots (reviewed) — `docs/build-log/assets/portal-windows/`
- `m0-window-wikipedia-webgpu.jpg`: the Wikipedia portal from chase distance. The article's top (text and the coin image) shows through a teal tear.
- `m0-window-example-webgl2.jpg`: the example.com portal on the WebGL2 fallback. The page is almost empty, so the window is mostly white, with its one line of text near the top.

### Attempts that failed and why
- The first fixture capture went to port 8765, where another local app was already listening. The capture tool recorded that app's page instead. The output was deleted, and the page was recaptured on a port chosen by the OS. The README's recapture steps now note the canonical URL step.
- The first tear mixed the host colour 35 % towards white, so on a white page (Wikipedia) the edge almost disappeared. It is now saturated, and the page darkens towards the host colour near the tear.

### Not yet done (later milestones)
- Postcards (monogram plus vortex) for portals without a picture. They keep the Phase 13 vortex for now.
- The push-through, `TravelWindow` and the cut into the intro (M2). Previews of built sites (M3).
- An iPhone frame-time measurement on the deployed preview, which is the M0 exit with the user.

## M1: production window shader, postcards and the per-stage loader (2026-10-20)

Built in the main Claude Code session (Claude Opus 5.5) on branch `portal-windows/m1`, stacked on `portal-windows/m0`. The user signed off the M0 look on the iPhone first.

### What was built
- **Postcards (engine):**
  - `setPortalPreview(id, image | 'postcard' | null)`. The `'postcard'` value draws the portal's atlas cell itself: the host colour as a radial field, the monogram, and the host name underneath.
  - The shader shows it under a slow vortex, behind the same tear. `state.w` now codes 0 for the Phase 13 vortex, 1 for a picture and 2 for a postcard.
  - The monogram rule is now `monogramLetter`, shared with the label card.
- **States:**
  - Offline and used portals grey the picture or postcard. Surge flares the tear and whitens the window.
  - Under `prefers-reduced-motion`, the tear and the postcard vortex are frozen: still ragged, never moving.
  - Pip gates are never given a preview, so they keep the Phase 13 gate.
- **Loader (`PortalPreviews` in `apps/web/src/game/portal-preview.ts`):**
  - **States:** one loader per loaded stage, with a state per link portal (`looking-up`, `ready`, `postcard`).
  - **Order:** every link portal gets the postcard at once, so it never flashes the vortex first. Fixture targets then get their picture.
  - **Failures:** a failure leaves the postcard, with no retry within the stage.
  - **Stage changes:** `start` aborts the previous stage's work, `stop` runs on dispose, and `show` is also gated on the played stage still being current, because the title's attract stage reuses the engine.
  - **Debugging:** `debugState().portalPreviews` exposes the states.
- **Tests:**
  - **Engine:** the monogram and the state codes.
  - **Loader:** postcard-first ordering, ready, failure without retry, a late picture after a stage change, `stop` and `current()`, and Pip gates.
  - **Browser:** a new `apps/web/test/portal-windows.e2e.test.ts` with its own Vite server and the flag on. On `portal-hub` it expects `{0: postcard, 1–3: ready}`; on Hacker News, all postcards; both under the draw-call budget with no page errors. It passes locally on WebGPU and in CI mode (`CI=true`: WebGL2 on SwiftShader, low tier). The flag-off `portal.e2e.test.ts` is unchanged and still passes.

### Measured
- **Hacker News, 6 portals:** the same view with the flag on and off gives **21 draw calls in both** (scene 20, post 1, WebGL2 at tier 3). With the flag on, all 6 portals are postcards.
- No page errors on WebGPU, WebGL2 or reduced motion.

### Decision: no separate low-tier tear
The plan offered "one noise octave at low tiers". No quality tier lowers shader cost (tiers change render scale, FXAA, glow and environment maps). The tear is three `sin` terms per portal fragment, next to one texture fetch. Only reduced motion changes it, and it freezes the tear rather than simplifying it. Revisit if an iPhone frame-time measurement points at the portal pass.

### Screenshots (reviewed) — `docs/build-log/assets/portal-windows/`
- `m1-postcard-open.jpg`: the w3.org postcard with the API online (health mocked), shown in amber with a dark monogram under the slow vortex.
- `m1-postcard-offline.jpg`: the same portal with `?offline=1`, greyed out.
- `m1-window-reduced-motion.jpg`: the Wikipedia window under reduced motion.

### Attempts that failed and why
- None in this milestone.
