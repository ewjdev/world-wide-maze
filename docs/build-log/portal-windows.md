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
