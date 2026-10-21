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

## M2: push-through, the travel window and the cut into the intro (2026-10-20)

Built in the main Claude Code session (Claude Opus 5.5) on branch `portal-windows/m2`, stacked on `portal-windows/m1`. The user checked M1 on the iPhone first.

### What was built
- **Engine (additive):**
  - **`playPortal(id, { onHandoff })`:** with a handoff, the camera glide pushes on to 1.9 m in front of the gate (Phase 13: 3.6 m), unless reduced motion is on. The first frame the gate's disc spans a third of the canvas's shorter side, it reports the disc's on-screen rectangle once.
  - **`introPageScreenRect()`:** where the upright page sits at intro t = 0. It uses a closed form, `introPageRect`, because key 0 looks head-on from `fitDistance × INTRO_FIT_MARGIN`. That margin is now a named constant shared with the camera keys.
- **Game:**
  - **State:** `view.travel` gains `preview` (the fixture screenshot URL) and `handoff` (a rect, or `'full'` when the gate never got big enough). A new `view.arrival` holds the loaded image and the cut rect, and outlives `travel`, which still clears on entering the intro, as the input gates expect.
  - **Waiting for cover:** `#playLoaded` waits for the window to cover the screen before swapping the world, with a 2.5 s timeout so a build can never hang. It records `travelTiming` for the tests.
  - **Arrival:** after the load it sets `arrival`, and BUILT waits at least 0.85 s (develop and cut). `#startIntro` refreshes the cut rect.
  - **Cleanup:** leaving building or intro, the end of the intro, and dispose all clear it.
- **UI:**
  - **`TravelWindow`** (`ui/Journey.tsx`, `ui/journey.css`), mounted from `Screens` so it survives play → building → intro.
  - **Grow:** a `clip-path` circle grows from the handoff rect to full screen (600 ms) with a glowing ring in the portal colour. Inside is the destination page top-anchored, or the postcard (monogram, host and a slow conic vortex).
  - **Covered:** `travelWindowCovered()` fires when it reaches full screen. The building panel sits on the window, and the veil is suppressed.
  - **Arrival:** the loaded texture (exactly what the engine shows) replaces the preview (200 ms), or develops in after a postcard (400 ms). It then tweens onto the intro's page rect over the fog colour, and the window fades out (250 ms) as the intro starts, then calls `travelWindowDone()`.
  - **Reduced motion:** opacity fades only.
  - **Flag off:** `TravelIris` is unchanged.

### Verified
- **`apps/web/test/portal-windows.e2e.test.ts`:** 6 tests, the 2 from M1 and 4 new.
  - The journey: the window grows from the gate; no veil and the building panel visible; `loadAt ≥ coveredAt`; the stage changes; the window unmounts while the intro is still playing; score, spares and the trail (`start` then `portal`) carried.
  - Cancel while building leaves the window cleanly.
  - A failed build: the destination's capture is blocked, giving the error screen, a closed window, and the trail without the stop.
  - Reduced motion.
- **Runs:** green locally on WebGPU, and **three serial CI-mode runs** (`CI=true`, WebGL2/SwiftShader, low tier) passed, with no quarantine. The flag-off `portal.e2e.test.ts` still passes in CI mode. Its travel test stays under #36.
- **Engine:** `introPageRect` equals a real `PerspectiveCamera` projecting the upright page's corners from intro key 0, in landscape (1280 × 800) and portrait (390 × 844).
- **Screen sequences:** desktop (portal-hub to example.com) and portrait phone size (portal-hub to Wikipedia). The picture is never interrupted, and the cut lands on the intro's upright page.

### Screenshots (reviewed) — `docs/build-log/assets/portal-windows/`
- `m2-handoff-from-gate.jpg`: the window starting from the gate disc, with the glowing ring.
- `m2-window-covering-build.jpg`: full screen, "Rolling to example.com" on the destination.
- `m2-cut-onto-intro-page.jpg`: the arrival settled on the intro's page rect.
- `m2-phone-window.jpg` and `m2-phone-into-intro.jpg`: portrait, Wikipedia full screen, then fading into the 3D intro.

### Found, pre-existing (not fixed here)
- **WebGPU travel error:** Phase 13 travel on WebGPU logs one uncaptured `GPUValidationError: [Invalid Texture] … CreateView` per travel. It reproduces on untouched `origin/main` (a temporary worktree with only the `portal-hub` fixture and catalog entry copied in) and with the flag off. The new tests ignore exactly that message, with a comment. It needs its own fix.
- **`mobile-layout.e2e`:** still fails only on this Mac (font metrics), as in M0.

### Known limits
- **Portrait jump:** the preview (the full page across the width) and the arrival (the stage's slice texture) are framed slightly differently. On a portrait phone the 200 ms crossfade shows a small vertical jump. Aligning them is possible later. The plan already expects a newer capture to differ.
- **Ring vs tear:** the DOM ring is a smooth glow, while the 3D tear is ragged. They meet for about a frame at the handoff.

### Attempts that failed and why
- **Window measured too early:** it measured its container while still rendering nothing, so the view was 1 × 1 px and the arrival canvas collapsed. The blank frame in the first sequence was this. It now measures when it opens and on every resize (`ResizeObserver`).
- **Window never handed back:** the fade-out timer lived in the effect that set the `out` stage, so changing the stage cancelled its own timer and the window stayed up. It now has its own effect, keyed on the stage. This was caught by the screen sequence, not by luck in the first run.
- **Fog between picture and arrival:** the preview faded out (300 ms) while the arrival faded in (200 ms), so the fog showed through. The destination now fades only after the arrival is in (420 ms delay).
- **Ring glow invisible:** the ring's mask also clipped its outer glow. It now uses a border with inner and outer shadows, and no mask.
- **Shared problem list:** the failed-build test's expected `net::ERR_FAILED` messages leaked into the next test through the shared list. It is now cleared before each test.

## M3: previews of sites already built on the service (2026-10-20)

Built in the main Claude Code session (Claude Opus 5.5) on branch `portal-windows/m3`. The user asked to merge M0–M2 and continue.

### What was built
- **Contract (CCR-PW-1, user-approved):**
  - `PortalPreviewsRequest` / `PortalPreviewsResponse` and their Zod schemas in `@wwm/schema`.
  - `CONTRACT_VERSION` 0.3.6 → **0.3.7**, with a CHANGELOG entry.
  - In `plans/contracts.md`: a §7 table row, a §9 resolutions entry and a new §10.6.
- **Worker:**
  - **Route:** `POST /api/portals/previews` under `stagesRoutes`, so it inherits the read limiter. The body is capped at 16 KiB (`MAX_PORTAL_PREVIEW_BYTES`) and checked with the schema.
  - **Per URL:** a static URL policy check, then the opt-out. Next `catalog.peekVariant`, the run `POST /api/stages` would reuse (D3), else `catalog.newestServableRun`. The result is slice 0 via `firstStageId`.
  - **Responses:** `private, no-store`. The `kill:portal-previews` KV key gives all `null` without touching D1.
  - **Catalog:**
    - `peekVariant` is `resolveVariant`'s lookups plus `canServeRun`, with **no writes** and no R2 probe.
    - `newestServableRun` is one candidate query on `url` OR `submitted_url`, plus `canServeRun`. A unary `+` on `status` and `artifacts_available` keeps SQLite off the low-selectivity status index. `EXPLAIN QUERY PLAN` then shows a MULTI-INDEX OR over `moderation_cases_url` and `moderation_cases_submitted_url`, so no migration was needed.
- **Web (`PortalPreviews`):**
  - **Lookup:** after the health probe says online, one batched lookup for the link portals that aren't fixtures, then their textures. Each is decoded at 384 px wide for the atlas; its compressed Blob becomes a `blob:` URL for the travel window.
  - **Retries:** a retry of the same stage reuses the Blobs without new requests.
  - **Leaving a stage:** revokes its `blob:` URLs, except the one `take()` handed to the travel, which the game revokes when the window is done (or on cancel, error, leaving, or dispose).
  - **Failures:** any non-200, offline or `?offline=1`, a malformed response, or a failed texture or decode gives the postcard.
- **Runbook:** §5.1a documents `kill:portal-previews`.

### Verified
- **Worker (`apps/worker/test/portal-previews.test.ts`, production migrations in SQLite):**
  - `peekVariant` with the pointer and with the legacy match, with no `url_variants`/`moderation_cases` writes.
  - Newest-servable ordering, the `submitted_url` match, and pending runs never chosen.
  - The index plan.
  - The route:
    - request order and echoed URLs;
    - the exact variant wins over a newer run at another difficulty;
    - the newest fallback after a builder upgrade;
    - blocked URL, blocked submitted URL, opted-out host, pending and policy-refused URLs all `null`;
    - the kill switch with no catalog calls;
    - limits (0, 7, 2049 characters, junk, over the cap → 413, and 6 × 2,000-character URLs accepted);
    - no build, claim, publish, resolve or record calls and no KV writes.
- **Loader unit tests:** a built site shows its texture with one batched lookup; offline, an unknown site and a failed texture leave the postcard; a retry makes no new requests; `blob:` revocation except the taken one; a stage change mid-lookup drops the result.
- **Browser (`portal-windows.e2e.test.ts`, now 7 tests):** with a mocked health, lookup and texture, the w3.org portal on `portal-hub` becomes `ready` after exactly one lookup, for that one URL.
- **Local end to end** (`pnpm dev`, `MODERATION_MODE=test-allow`, real capture):
  - Built `https://iana.org/domains/example`, which redirects to `www.iana.org/help/example-domains`, so it matched through `submitted_url`.
  - The lookup gave its stage, and `null` for w3.org and a junk string, with `cache-control: private, no-store`.
  - In the game, the example.com fixture's "Learn more" portal showed the IANA page. Travel was a cache hit (`POST /api/stages` returned the run, with no job) and arrived **6.3 s** after Travel, through the full window and cut.
  - The kill switch, set and cleared through local KV, gave `null` and then the stage again.

### Measured
- **D1 statements:** 48 for a lookup of 6 URLs (8 per URL). The plan estimated up to about 54.
- **Slice texture:** 301 KB (WebP) for the one real local capture. That's one sample, below the plan's ~400 KB threshold for a thumbnail derivative. More samples come in M4.
- **Exact-variant hits:** in the local end-to-end, the lookup hit the exact variant (the page was built at default settings). In the route test, a builder upgrade fell back to the newest run, as designed.

### Screenshots (reviewed) — `docs/build-log/assets/portal-windows/`
- `m3-built-site-window.jpg`: example.com's "Learn more" portal showing the IANA page built on the local service (surging as the ball enters).
- `m3-travel-built-site.jpg`: the travel window full screen on the built page.
- `m3-into-intro.jpg`: the cut landing on the 3D intro's upright page.

### Attempts that failed and why
- **Status index chosen:** the first candidate query let SQLite pick the `status` index (every approved case) over the URL indexes. The index-plan test caught it; the unary `+` fixed it with no migration.

## M4: device validation and the production decision (in progress, 2026-10-21)

Built in the main Claude Code session (Claude Opus 5.5) on branch `portal-windows/m4`.

### State at the start
- **M3 in production:** M3 merged (#56) and is live in production. `wwm.ewj.dev/api/health` reports contract `0.3.7`, and `POST /api/portals/previews` answers `200` with `private, no-store` (a w3.org lookup gives `null`). The client feature is still off in production (`VITE_PORTAL_WINDOWS_ENABLED` is unset there).
- **First deploy attempt:** the first run on `main` failed `check` on an unrelated test (`learning-records.integration` "rate limits…", `expected 200 to be 429`), so production was skipped. A re-run of the failed job passed and deployed.
- **Phone testing so far:** the user tested M0–M3 on the iPhone through the branch preview and the `dev:phone` tunnel. The tunnel first showed the joystick deck because `dev:phone` didn't set `VITE_MOBILE_TILT_ENABLED`; that's fixed in #56.

### The inputs for Option B (measured)
- **Preview availability in production:** the production catalog (read-only `SELECT`s on D1 `wwm`) holds **11 runs: 2 approved, 9 pending review**. Only 2 pages on the live site can show a built-site preview today. Production has no curated runs. Under manual moderation (Q2), M3 previews will almost always be postcards in production until more pages are approved.
- **The wait on a cache miss:** time to slice 0 (`runs.timings_json.slice0`) across all 11 production builds was 6.1, 16.3, 17.1, 18.2, 20.0, 20.6, 20.8, 21.2, 24.4, 25.4 and 39.7 s. That's a **median of about 20.6 s**, mostly capture (setup, navigate, extract plus screenshot, textures, about 11–18 s) and store (about 3–7 s). Today the travel window covers that wait on the destination picture or postcard. Option B (start the build when the ball nears a portal) would hide most of it.
- **iPhone frame-time headroom:** this needs the device. A `?perf` readout (dev and preview builds only) now shows average FPS, the worst frame, the quality tier, draw calls and the backend, timed with `requestAnimationFrame`. The user reads it on the branch preview (below).

### Added
- `apps/web/src/ui/PerfReadout.tsx` and its test, mounted from `Screens` with `?perf`. It is never shown in a production build (gated on `import.meta.env.DEV` or `VITE_PREVIEW_COMMIT`).

### Still to do in M4
- The iPhone frame-time reading through `?perf`, and Android if available. The hero clip for the LinkedIn series.
- **The user's sign-off on the feel**, then enabling `VITE_PORTAL_WINDOWS_ENABLED` in the `deploy-production` build step, deleting the branch preview Worker, and the M5 go/no-go. Given 2 approved pages, M5 or the bulk approval of portal targets noted in plan §11 would be the way to make built-site previews common.
