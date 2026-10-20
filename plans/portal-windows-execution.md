# Portal windows: see the next site, roll into it (Option A) — execution plan

**Date:** 2026-10-20 (reviewed and revised the same day; independently reviewed against `ea22fcb` the same day)

**Status:** Planned, not started. All open questions were answered by the user on 2026-10-20 (decisions below). Every milestone is deployed to a branch preview for testing (§9.1). Option B (speculative build on approach) is planned separately after M4 (§11).

**Label:** N (new; not in 2013). Builds on Phase 13 link portals ([phase-13-link-portals.md](phase-13-link-portals.md), contracts §10.1, build log [phase-13.md](../docs/build-log/phase-13.md)).

**Outcome:** A link portal stops being a generic swirl and becomes a window onto the linked site: a ragged, glowing tear in the air with the destination page visible inside it. Travelling pushes the camera through the tear, the window grows to fill the screen, and the player waits *inside the next world* instead of on a white build screen. When the maze is ready, the destination page is already standing upright in front of the camera, and the existing intro folds it flat and extrudes it into islands. The page in the portal literally becomes the floor of the next maze.

Inspiration: "portal jumping through gaussian splat worlds with WebGPU" (a social video shared on 2026-10-20). We borrow the portal edge and the step-through transition, not splats. WWM worlds are web pages printed onto islands, so the picture in the window is the page itself.

### Decisions recorded (user, 2026-10-20)

| ID | Decision |
| --- | --- |
| CCR-PW-1 | **Approved.** The read-only preview lookup `POST /api/portals/previews` (§5). It is implemented in M3. |
| D1 | **Keep the "Travel to <label>?" prompt** unchanged in A. |
| D2 / D4 | **The page's `og:image` previews and telemetry move to a new milestone, M5** (§7). It is gated on M4 results and needs its own contract change, CCR-PW-2. |
| D3 | **Prefer the exact run that travel would hit.** The lookup returns the run behind travel's cache key, and falls back to the newest servable run (§5). The contract shape is unchanged. |
| Q1 | **Create a small test fixture:** `portal-hub`, a page we write ourselves that links to existing fixtures (§7 M0). |
| Q2 | **Manual review is fine for now.** Previews follow the existing serving rules. A possible later improvement: list a page's portal links so an operator can approve or pre-generate them more easily (§11, not in A). |
| D5 | **Every milestone is deployed to a preview branch for the user to test** (§9.1). The static branch preview covers M0–M2 and M4. The built-site path in M3 is tested through a `pnpm dev:phone` tunnel, because previews have no live API. |

## 1. Success criteria

1. **No added draw calls.** On HN with 6 portals, `EngineStats.drawCalls` and `sceneDrawCalls` with the flag on equal the flag-off values on the same tier (Phase 13 measured 46 total: scene 20, env 12, post 14). iPhone 17 Pro frame time shows no measurable regression at chase distance.
2. A portal whose target is an offline fixture, or a site with a **servable** run (approved by moderation and passing `canServeRun`), shows that page in the window. Every other portal shows the postcard. No portal ever renders empty, black or broken.
3. Travel from portal to arrival shows **no frame of the old or new world popping in and no hard cut** on desktop Chrome and on the iPhone. The destination picture remains visible from the push-through until the intro's fold.
4. Travel behaves exactly as it does today when previews are missing, fail, or are disabled by the flag or the kill switch. That covers score and spare carry-over, the journey trail, SSE progress, Cancel, the error screens and the paired-phone JUMP/MENU.
5. The preview lookup never starts, queues or reserves a build, and never serves a run that `canServeRun` rejects.
6. Reduced motion is honoured: a static window, and a crossfade instead of the grow and the tween.

## 2. Non-goals (A)

- Building or prefetching destinations before Travel (Option B), and rendering a live second scene through the portal (Option C).
- `og:image` or any other preview of a page that hasn't been built, and new telemetry events. Both are in M5.
- Changing `StageData`, `Portal`, stage-builder portal placement, physics sensors, the confirm prompt, or journey and share semantics.
- Changing Pip gates (`wwm-learning:` hrefs). They keep the Phase 13 look and never fetch previews.
- Race mode, which has no link portals. The title attract stage (`#loadAttract`) never fetches previews either.
- New image storage or thumbnail derivatives (a possible follow-up if M3 measurements require it, §8).
- Changing moderation: previews follow the existing serving rules, so with `MODERATION_MODE=manual` only operator-approved or curated runs can appear.

## 3. Player experience

### Approaching a portal
1. Each open link portal shows a picture of its destination inside the disc. The edge is a ragged, moving, luminous tear in the portal's host colour (`portalColor(href)`), replacing the hard rim and log-spiral vortex. The label card is unchanged.
2. With no picture available, the disc shows a **postcard**: the host colour, the monogram and a slow vortex.
3. The picture shows the **top of the page** (above the fold), with slight parallax against the tear as the camera moves.
4. Offline portals stay grey and show the postcard. Declined ("used") portals stay dimmed.
5. The confirm prompt and the Stay-here rule from the 2026-09-26 playtest are unchanged (D1).

### Travelling
1. **Travel** starts the build at once and plays the existing gate animation, as today (`Game.travelPortal`).
2. The camera then pushes towards the disc. When the disc's on-screen diameter reaches about a third of the viewport's shorter side, the engine reports its on-screen rectangle. A DOM layer, `TravelWindow`, mounts at that rectangle showing a **full-resolution** version of the same picture, and grows a ragged-edged mask to full screen over ~0.6 s.
3. The building UI (copy, trail, progress strip, Cancel) renders on top of the picture, without today's white veil. SSE progress, the error screens and the fallbacks are unchanged.
4. **Cache miss:** the layer shows the postcard world while the site is captured. When the stage loads, the layer draws the loaded page texture, "develops" it in over 0.4 s, and then does the matched cut below. Hits and misses end the same way.

### Arriving (the matched cut)
1. After `loadStage`, the engine reports where the upright page will be on screen at intro time 0 (the intro starts upright: `packages/engine/src/camera/intro.ts`).
2. The layer's image tweens from "top of the page covers the viewport" to that rectangle (~0.35 s) over an opaque backdrop in the scene colour (`FOG_COLOR`). When the intro starts, it crossfades to the canvas (≤ 0.25 s, inside the `fast` intro's 0.3 s upright hold). The `fast` intro then folds and extrudes as today.

### Reduced motion and failures
- `prefers-reduced-motion` (and the engine's `reducedMotion` option) gives a static picture with no edge turbulence. The push, grow and tween become a single crossfade.
- Any preview failure (no preview, a failed fetch or decode, a lost texture, the kill switch, the flag being off) silently gives the postcard. Travel never waits on a preview.

## 4. Verified starting point

First inspected on `cf1b830`. Re-verified on 2026-10-20 on `plan/portal-windows` at `ea22fcb` (origin/main `edb90c1`). Rows marked **⚠** record facts the first pass missed, and they constrain §6.

| Area | Existing implementation | Planned change |
| --- | --- | --- |
| Portal visuals | [world/portals.ts](../packages/engine/src/world/portals.ts): one `InstancedMesh` of billboarded (yaw-only) gates, built per stage in `buildPortals` and disposed with the stage bin. Parts are 0 vortex, 1 rim, 2 halo, 3 ground ring, 4 label, 5 beam. Labels come from one `CanvasTexture` atlas with a row per portal (`flipY` off, mipmaps on). Instanced attributes: `data` (xyz + slot), `style` (rgb + phase), `state` (pulse, state, surge, **`w` unused**). Glow is carved out of the colour for the bloom composite (`glowC ≤ shown`); the label card has zero emissive so its text stays crisp | Part 0 samples a second, per-stage preview atlas in the same material; the edge becomes a noise-displaced tear. Still one draw call |
| Engine API | [engine.ts](../packages/engine/src/engine.ts): no outbound event callbacks. `playPortal(id): Promise<void>` surges the gate (scale up to 1.45×) and glides the camera (`portalWatch`, 1.35 s) to 3.6 m in front of the gate, 0.7 m up; it resolves at 1.6 s. `setPortalState`; `StageImage = ImageBitmap \| HTMLImageElement \| HTMLCanvasElement \| OffscreenCanvas`; `EngineStats.drawCalls` / `sceneDrawCalls`; no tone mapping; `scene.background = FOG_COLOR` (`#f8f8f8`) | Additive changes only (§6.1): a per-call `onHandoff` option, `setPortalPreview`, `introPageScreenRect` |
| ⚠ Engine between TRAVEL and arrival | The old stage stays loaded and rendered (at 30 fps, since `building` is a slow phase in [render-cadence.ts](../apps/web/src/game/render-cadence.ts)) with the camera parked at the gate. `loadStage` then clears it and leaves the **new stage fully extruded in chase view** (`u.extrude = appear = 1`, `view = 'chase'`) until `playIntro` runs | The layer must be opaque before `loadStage` runs, and stay opaque until the intro starts (§6.3) |
| Intro | [camera/intro.ts](../packages/engine/src/camera/intro.ts): upright page, fold, extrude; `fast` is 7.9 s and its fold starts at 0.3 s (`full`: 1.0 s). Key 0 (camera head-on at `fitDistance(W, D) × 1.04`) is the same for both modes. Travel uses `fast` because `#firstStageOfVisit` is false; `reducedMotion` forces `fast` | The timeline is unchanged; expose the page's screen rectangle at t = 0 |
| Travel flow | `Game.travelPortal()` in [game/game.ts](../apps/web/src/game/game.ts): sets `view.travel`, starts `createApiRun` or `FixtureRun` during `playPortal`, then `TRAVEL` (→ `building`), then `#loadSlice` → **`#playLoaded`**, which calls `e.loadStage(got.stage, got.image)`, keeps the image as `#engineImage`, and sends `BUILT` after `MIN_BUILD_SEC` (2.2 s from Travel). `cancelBuild()` = `back()` | `view.travel` gains `preview` and `handoff`; `#playLoaded` waits for the layer to cover the screen before `loadStage`, and a new `view.arrival` carries the cut (§6.3) |
| ⚠ Travel state and input | Entering `intro` runs `this.#set({ travel: null, portal: null })`. `!this.#view.travel` gates `ownsInput`, `#autoPause`, MENU and portal events | `travel` must still clear at `intro`; the cut needs its own field (§6.3) |
| Portal states | `#applyPortalStates` (called from `#playLoaded`), plus `#probeApi` (`/api/health`, memoized once per session; `?offline=1` forces offline) | The preview loader starts from `#playLoaded` after the probe resolves, only for open link portals |
| Fixture images | `FixtureRun` in [game/stages.ts](../apps/web/src/game/stages.ts) loads `fixtures/captures/<slug>/screenshot.png` through a **lazy** Vite glob (`() => Promise<string>`), and crops the slice out of the full-page screenshot. The screenshots measure 1280 × 800 to 1280 × 6000 px, up to 5.7 MB. `fixtureFor(href)` is in [game/journey.ts](../apps/web/src/game/journey.ts). ⚠ No committed fixture stage has a portal to *another* fixture: `fixtures/builder/links/*.json` only self-link among fixture URLs, and the builder prefers off-site targets | Export an async `fixtureScreenshotUrl(entry): Promise<string \| null>` so the loader reuses the same asset. The new `portal-hub` test fixture supplies one (Q1, §7 M0) |
| ⚠ Travel UI | `TravelIris` in [ui/Journey.tsx](../apps/web/src/ui/Journey.tsx) is mounted from `PlayLayer` in [ui/Play.tsx](../apps/web/src/ui/Play.tsx) only while `phase === 'play'` (`PlayLayer` renders nothing in `building`). In `building`, [ui/Screens.tsx](../apps/web/src/ui/Screens.tsx) draws `.wwm-veil` (82–90 % white plus blur, [game.css](../apps/web/src/ui/game.css)) and the `Building` panel in a `<main key={phase}>`. This is "the white build screen". Reduced-motion rules are in [ui/journey.css](../apps/web/src/ui/journey.css). `main.tsx` renders under React `StrictMode` | `TravelWindow` is mounted from `Screens` so it survives `play → building → intro`, and the veil is suppressed while it is mounted. It replaces `TravelIris` when the flag is on |
| Stage texture route | `GET /api/stages/:stageId/texture` in [routes/stages.ts](../apps/worker/src/routes/stages.ts): checks `canServeStage` on every request; artifact cache; `REVOCABLE` (`private, no-store`) header; content type defaults to `image/webp` | Reused as the source for previews of built sites. No new image route in A |
| ⚠ Serving rules | `Catalog.canServeRun` in [catalog.ts](../apps/worker/src/catalog.ts): the moderation case is `approved` with `artifacts_available`, the run is `complete`/`partial`, and **both** `m.url` and `m.submitted_url` pass `isUrlBlocked`. `isUrlBlocked` → `isHostBlocked` walks the domain chain and also reads legacy KV `optout:<domain>`, so the rules **cannot** be one D1 query. Indexes: `moderation_cases(url)`, `moderation_cases(submitted_url)` ([0005_url_catalog.sql](../apps/worker/migrations/0005_url_catalog.sql)), `stages(run_id, slice_index)` ([0001](../apps/worker/migrations/0001_runs_stages.sql)). `MODERATION_MODE=manual` in every environment, so new captures stay `pending_review`. `test-allow` approves builds only when `WWM_ENV=development` ([moderation.ts](../apps/worker/src/moderation.ts)) | The lookup finds a candidate with one indexed query per URL, then calls `canServeRun` (§5) |
| Read limiting and CSRF | `stagesRoutes.use('*', readLimit)` (100 reads/min/IP); `stagesRoutes` is mounted at `/api`. The cross-site refusal for every non-GET/HEAD request is app-wide middleware in [router.ts](../apps/worker/src/router.ts). `POST /api/stages` caps its body with `readJsonCapped(…, MAX_STAGE_REQUEST_BYTES)` (8 KiB) | Mount the lookup as `stagesRoutes.post('/portals/previews')`. It inherits `readLimit`, and the router refuses cross-site requests anyway |
| Kill switches | KV `CACHE` keys: `kill:capture` ([routes/stages.ts](../apps/worker/src/routes/stages.ts), [refresh.ts](../apps/worker/src/refresh.ts), upload and admin) and `kill:docent`; operator commands in [docs/launch/runbook.md](../docs/launch/runbook.md) | Add `kill:portal-previews`, documented in the runbook |
| ⚠ Client flags | [input/flags.ts](../apps/web/src/input/flags.ts): `VITE_MOBILE_TILT_ENABLED` needs an explicit `'true'` **even in development** (Race and mobile controls default on in dev). [ci.yml](../.github/workflows/ci.yml) sets flags in the `preview` job's build step and in `deploy-production`'s build step | Add `VITE_PORTAL_WINDOWS_ENABLED` with the explicit opt-in convention |
| ⚠ Preview environment | PR Worker Previews are off (`preview_urls: false` in `wrangler.jsonc`, `vars.WWM_PREVIEWS_ENABLED`). The manual `workflow_dispatch` preview is the static host [static-preview.ts](../apps/worker/src/static-preview.ts), which answers `/api/health` with `ok: true` and every other `/api/*` with **429** | The static branch preview validates fixture windows, postcards and travel to fixture targets. The built-site path uses a `pnpm dev:phone` tunnel (§9.1) |
| Telemetry | [schema/telemetry.ts](../packages/schema/src/telemetry.ts) has `portal_selected {action}` | No change in A (M5) |
| ⚠ E2E | [apps/web/test/portal.e2e.test.ts](../apps/web/test/portal.e2e.test.ts) (Vite dev server and Chromium, mocked `/api`, `skipIntro: true`). Its travel test is **quarantined in CI** (`WWM_RUN_QUARANTINED_TESTS=1` to opt in; issue #36 is open). The decline and offline tests stay required | New travel coverage goes in its own file (§7 M2) |

## 5. Contract change CCR-PW-1 (approved 2026-10-20)

The orchestrator applies this as the first step of M3. Add the endpoint to the contracts §7 table and as a new §10.6. Add a resolutions-log entry in §9 and a `packages/schema/CHANGELOG.md` entry. Put the request and response types and the Zod schema in `@wwm/schema`, and bump `CONTRACT_VERSION` from `0.3.6` to `0.3.7`. `StageData` and `Portal` do **not** change, because previews are resolved at runtime and are never stale in a stored stage.

**`POST /api/portals/previews`**
- **Request:** `{ urls: string[] }`, with 1–`MAX_PORTALS` entries, each ≤ 2,048 characters (`MAX_URL_LENGTH`). The body is read with `readJsonCapped` and a dedicated cap of 16 KiB, because six maximum-length URLs exceed `MAX_STAGE_REQUEST_BYTES` (8 KiB).
- **Response:** `200 { items: { url: string; stageId: string | null }[] }`, in request order, each `url` echoed exactly as sent.
- **Resolution, per URL:**
  1. Run `checkUrlStatic(url, policy)`, which normalizes with `normalizeTargetUrl` (no DNS, because nothing is fetched). A failure gives `null`.
  2. **Exact variant first (D3).** Compute travel's cache key exactly as `POST /api/stages` does for a request with no difficulty or seed: `runCacheKey(url, 'normal', builder.version, undefined)`, with the legacy fallback inputs `{ url, difficulty: 'normal', seed: defaultSeed(url), builderVersion: builder.version }`. Resolve it with a new **read-only** `catalog.peekVariant(cacheKey, legacy)`. It shares `resolveVariant`'s two SELECTs (`url_variants.cache_key`, then the legacy `runs`/`moderation_cases` match) and its `canServeRun` check. Unlike `resolveVariant` and `store.cachedRunId`, it never writes: no `INSERT INTO url_variants`, no `moderation_cases.cache_key` update, no KV `cacheRun`. A servable hit is returned.
  3. **Newest fallback.** Otherwise one indexed D1 query finds the newest candidate run (`ORDER BY runs.created_at DESC LIMIT 1`). It matches `m.url = ?` **or** `m.submitted_url = ?`, at any difficulty, seed or builder version, with `m.status = 'approved'`, `m.artifacts_available = 1`, `runs.status IN ('complete','partial')` and a slice-0 row in `stages`.
  4. Call `catalog.canServeRun(candidate)`. Don't re-encode its rules in SQL: they include `submitted_url`, the domain chain and the legacy KV opt-out. A rejection gives `null`. Don't fall back to older runs.
  5. Return that run's slice-0 `stage_id`.

  Add an index only if `EXPLAIN QUERY PLAN` shows a scan. The cost is about 6 to 9 D1 reads plus a few KV reads per URL, so up to about 54 D1 reads per lookup. M3 records the measured count and how often step 2 hits.
- **Guards:** it is read-only and never calls build admission, `claimBuild`, `scheduleRefresh`, or the budget controller. It inherits `readLimit` from `stagesRoutes`, and the router's cross-site refusal covers it. The response is `cache-control: private, no-store`, so takedowns apply on the next stage load.
- **Kill switch:** when `kill:portal-previews` is present in `CACHE`, every item is `null` (still `200`), and no D1 query runs.
- **Errors:** `400` for a malformed body (the generic `{error:'bad request'}` shape, no new code), `413` over the cap, `403` cross-site (router), and `RATE_LIMITED`. The client treats any non-200 as "no previews". That includes the 404 an older worker returns and the 429 from the static preview host.
- **Images:** the existing `GET /api/stages/:stageId/texture`.
- **Forward compatibility:** M5 may add optional fields to each item through CCR-PW-2. Clients must ignore unknown fields.

## 6. Architecture

### 6.1 Engine API (additive)
```ts
export interface ScreenRect { x: number; y: number; width: number; height: number } // CSS px, relative to the canvas box

/**
 * Show `image` (any StageImage) inside portal `id`; `null` restores the postcard. Draws into the atlas synchronously
 * and never retains `image` (the caller may close it on return). No-op with no stage or an unknown id.
 */
setPortalPreview(id: number, image: StageImage | null): void;

/** Existing; `onHandoff` fires at most once, when the disc's projected diameter first reaches ⅓ of min(canvas width, height). */
playPortal(id: number, opts?: { onHandoff?: (rect: ScreenRect) => void }): Promise<void>;

/**
 * After loadStage: where the upright page will be on screen at intro t = 0, computed from intro key 0
 * (mode-independent) and the current camera aspect. Null with no stage. Call it when the cut starts, not earlier,
 * so a resize or rotation during the build is respected.
 */
introPageScreenRect(): ScreenRect | null;
```
- **Push-through.** It extends `playPortal`'s existing `portalWatch` glide towards the gate. It stays inside the current 1.6 s, so the promise resolves at the same time and `travelPortal`'s ordering is unchanged. The camera stops short of the disc plane, at least `CHASE.near` plus a margin. "Through" is drawn by the DOM layer, so the near plane never clips the disc into a see-through hole. At today's end pose the disc already fills about 45 % of the viewport height at a 70° FOV with the surge, so the handoff normally fires during the glide. If `onHandoff` never fires (an off-screen gate, reduced motion), the layer mounts full screen and crossfades.
- **`introPageScreenRect`.** Project the upright page's corners (x 0…W, y `pageY`…`pageY + D`, z = D) with the key-0 camera (`introCameraKeys(introGeometry(), tl)[0]`, `camera.fov`, the current aspect). This is pure maths and needs no render.
- **Preview atlas** in `world/portals.ts`: one `CanvasTexture` per stage (in the stage bin, like the label atlas) with `MAX_PORTALS` tiles, for example 3 × 2 tiles of 384 × 384. Use the instance's existing slot (`data.w`, the label row) as its tile, and the free `state.w` as a 0/1 "has picture" flag (0 = postcard). This needs no new attributes. Each tile is a centred crop of the top `min(h, w)` region of the image, drawn into the atlas canvas, and only that texture is marked `needsUpdate`. Leave a gutter of at least 8 px between tiles and inset the sampling, because the mip chain otherwise bleeds neighbouring tiles into the disc edge. `loadStage` / `unloadStage` reset all tiles, because the atlas belongs to the stage.
- **Shader:** sample the tile using the disc UV plus a camera-direction parallax offset (about 4–6 %, clamped so tile edges never show). Warp the disc edge radius with two octaves of animated value noise, and drive an emissive tear rim in the host colour. Add an inner vignette for depth. The **picture itself has zero emissive**, like the label card, so the page stays crisp and the bloom never washes it out. Only the tear and the halo glow. Keep the bloom rule (`glowC ≤ shown`). Sample with `select`, not branches, like the label atlas, so the WGSL texture sample stays in uniform control flow. States: open is the full tear; offline is a grey postcard with the tear frozen; used is dimmed as today; surge flares the tear and whitens the picture.
- **Quality:** under low tiers ([quality.ts](../packages/engine/src/quality.ts)) or `reducedMotion`, use one noise octave and a static edge.

### 6.2 Web: preview loader (`apps/web/src/game/portal-preview.ts`, new)
- **Inputs:** the loaded stage's link portals, the `#api` state, the flag. It is started only from `#playLoaded` (never for the title attract stage or Race), after `#probeApi()` resolves.
- **Per-portal state machine:** `none → looking-up → ready | postcard`. Option B will later add `building` (§11).
- **Sources:**
  - A fixture target uses `await fixtureScreenshotUrl(entry)`, which works offline with no API request. Decode only the top region for the tile (`createImageBitmap(blob, 0, 0, w, min(h, w), { resizeWidth, resizeHeight })`). The layer uses the asset URL directly, top-anchored.
  - Otherwise, when `#api === 'online'`, make one batched `POST /api/portals/previews` for the remaining hrefs, then up to 6 parallel `GET /api/stages/:id/texture`.
- **Two resolutions per ready built-site portal:** the original **compressed `Blob`** (an object URL for the full-screen layer), and a downsampled `ImageBitmap` (`createImageBitmap` with `resizeWidth`/`resizeHeight`, falling back to a canvas draw) for `setPortalPreview`. Close the bitmap once `setPortalPreview` returns.
- **Lifecycle (per loaded stage, not per `loadStage` call):**
  - Keep one `AbortController` per loaded stage.
  - A reload of the same stage (`retryStage` → `#playLoaded` with the same `got`) resets the engine atlas. The loader then re-decodes its tiles from the retained Blobs or fixture URLs, without new requests.
  - Drop late results whose stage no longer matches `this.#stage()`.
  - At `travelPortal`, the stage is being left: abort all lookups and revoke every object URL **except** the travelled portal's. That one moves to `view.travel.preview`. Also abort and revoke everything on `unloadStage` and `dispose`.
- **Object-URL ownership:** after hand-off, the **Game** owns the travelled portal's URL, not React. It revokes it when `view.arrival` is cleared, or when `view.travel` is cleared without an arrival (Cancel, error, title, dispose). The layer never revokes, because `StrictMode` runs effect cleanups twice in development. Only `blob:` URLs are revoked; fixture asset URLs are not.
- **Failures** set that portal to `postcard` with no UI and no retry within the stage.

### 6.3 Web: game state and the `TravelWindow` layer
- **State:**
  - `view.travel` becomes `{ label; host; href; preview: { src: string } | null; handoff: ScreenRect | null }`. The new fields are optional to consumers, so `TravelIris` still works when the flag is off.
  - `travel` keeps clearing on entry to `intro`, which today's input gates depend on (§4). When the flag is on and a travel layer is up, that same transition sets a new `view.arrival: { src: string | null; image: ImageBitmap; cut: ScreenRect | null } | null`.
  - The layer clears `view.arrival` through a new `game.travelWindowDone()` when its crossfade ends. Skip-intro, any phase leaving `intro`, the test `skipIntro` option and dispose also clear it.
- **Ordering in the game:**
  - `travelPortal()` passes `onHandoff` to `playPortal` and sets `travel.handoff`.
  - `#playLoaded` awaits a `covered` promise before calling `e.loadStage`. The layer resolves it when its mask reaches full screen. It resolves at once when the flag is off, under reduced motion, or when no layer is mounted, so it can never hang a build. This prevents the old world from vanishing, and the new maze from appearing in chase view, around a still-growing mask.
  - After `loadStage` succeeds, the game keeps `got.image` (already owned as `#engineImage`) for the arrival. It sends `BUILT` no earlier than the layer's develop-and-tween time (≈ 0.4 s + 0.35 s) after `loadStage`, so the cut tween ends before the intro starts.
  - `#startIntro` sets `view.arrival.cut = e.introPageScreenRect()` just before `playIntro`.
- **`TravelWindow`** (in `ui/Journey.tsx`, with styles in `ui/journey.css`):
  - It is mounted from `Screens` in `ui/Screens.tsx`, outside the phase switch, so it persists from `play` through `building` into `intro`. It sits above the canvas and below the `Building` `<main>`, in the same box as the canvas, because the rects are canvas-relative. `Screens` skips `.wwm-veil` while it is mounted.
  - It mounts at `handoff`, or full screen if there is none. It shows `preview.src`, or the postcard.
  - It grows a `clip-path: circle()` mask, and animates a pre-rendered noisy glow ring as a separate element. No full-screen SVG `feTurbulence`.
  - On arrival it always switches to the arrival image (drawn into a `<canvas>`; never closed by the layer), because that is exactly what the engine textures. Without a preview, it "develops" the image in. With a preview, it crossfades quickly, since a newer capture can differ from the preview.
  - It tweens the image to `cut` over an opaque `FOG_COLOR` backdrop, because the canvas shows the new stage's chase view until `playIntro`. On intro start it crossfades the whole layer out in ≤ 0.25 s, then calls `travelWindowDone()`. If `cut` is `null` or off-screen, it skips the tween and crossfades.
- **Unmount rules:** the layer unmounts when both `view.travel` and `view.arrival` are `null`. That happens on arrival complete, Cancel (`building → select`), a build error leading to today's error screen, the title, or dispose. It also unmounts at once if the intro is skipped or the phase leaves `intro` before the crossfade finishes, and when the test `skipIntro` option is set.
- The canvas stays mounted underneath. The layer never intercepts focus or input outside the building UI, and the existing Cancel and error buttons keep their accessible names.

## 7. Milestones

Every milestone ends with `pnpm check` green, an entry appended to `docs/build-log/portal-windows.md`, and reviewed screenshots in `docs/build-log/assets/portal-windows/`. Milestones are sequential unless noted.

| ID | Milestone | Depends on | Status |
| --- | --- | --- | --- |
| M0 | Flag, `portal-hub` fixture, preview wiring, first look on a preview branch | — | done: PR #53, look approved by the user on the iPhone (2026-10-20) |
| M1 | Window shader, atlas, postcard, fixture previews (production quality) | M0 | built (PR stacked on #53); branch preview redeployed for the user |
| M2 | Push-through, `TravelWindow`, matched cut | M1 | pending |
| M3 | Previews of built sites from the service (CCR-PW-1) | M1 (the M3 worker work can run in parallel with M2) | pending |
| M4 | Device validation, preview-environment rollout, showcase clip | M2, M3 | pending |
| M5 | `og:image` previews and telemetry (CCR-PW-2) | M4 decision gate | pending |

**M0 — First look on a preview branch.** The `/dev/engine` sandbox exists only in dev builds (`import.meta.env.DEV` in [routes.tsx](../apps/web/src/routes.tsx)), so it can't be the look test on a deployed preview. M0 puts a first-cut window in the real game instead, behind the flag.
- Add the `VITE_PORTAL_WINDOWS_ENABLED` flag (explicit `'true'` even in development, like `VITE_MOBILE_TILT_ENABLED`; when off, nothing changes visibly).
- Add the **`portal-hub` test fixture** (Q1):
  - **Page:** `fixtures/pages/portal-hub/index.html`. We write the page ourselves (MIT), with a heading, short paragraphs and clearly labelled links to:
    - at least three committed fixtures with permissive licences: `https://example.com/` (IANA), `https://en.wikipedia.org/wiki/Labyrinth` (CC BY-SA) and `https://www.gov.uk/` (OGL);
    - one site that isn't a fixture (for example `https://www.w3.org/`), for the postcard and offline states.
  - **Capture:** capture it into `fixtures/captures/portal-hub/` from a local static server with `pnpm fixture:capture <local url> portal-hub`. The current capture script records `href`, so no link sidecar is needed. If the capture tool refuses a local URL, generate the bundle the way `tools/fixture-capture/src/handmade.ts` does.
  - **Canonical URL:** set the catalog URL to a page on the project's own domain, because nothing travels *to* the hub.
  - **Playable but hidden:** it must be playable at `/play/fixture-portal-hub`, but not listed in the public site picker. Use a test-only flag on `CatalogEntry`, or a separate list that `/play` and `fixtureFor` resolve but the picker doesn't show.
  - **Provenance:** record it in `fixtures/captures/README.md` and `NOTICE.md` as authored for this repo.
  - **Builder test:** the builder places at least 3 portals on it, all with fixture targets except the non-fixture link.
- **Preview wiring** (§9.1): set `VITE_PORTAL_WINDOWS_ENABLED: "true"` in the `preview` job's build step in `ci.yml`, and add portal-window links to its "Preview test links" summary. The production build step stays off.
- **First-cut window:** the tear edge plus a single fixture picture for fixture targets. It can be a minimal version of §6.1 (one atlas, the fixture source only), and M1 hardens it. The sandbox toggle is optional, for local iteration.
- **Deploy** the `portal-windows` branch preview and give the user the URL (§9.1).

*Exit:* the user approves the look on the iPhone 17 Pro through the preview URL. `sceneDrawCalls` is unchanged with the flag on, and there's no visible frame-time regression on the phone.

**M1 — Window shader and fixture previews (production quality).**
- Finish the atlas, shader and `setPortalPreview` (§6.1): every state, quality tiers, gutters, and reset on `loadStage`.
- Add `portal-preview.ts` with the fixture source only.
- Add `fixtureScreenshotUrl`.
- Tests and E2E use `portal-hub`. The E2E can still mock a stage where that's simpler.
- Redeploy the branch preview (§9.1).

*Exit:* a portal to a fixture site shows that page. Offline, used and Pip-gate states are correct. On HN with 6 portals, the draw counts equal the flag-off counts (≤ 46). The bloom shows no tint, and the picture shows no glow.
*Validate:* `pnpm vitest run --project @wwm/engine` (atlas tiling, gutter and reset on `loadStage`) and `pnpm vitest run --project @wwm/web` (the loader's fixture path, flag off gives no calls, Pip gates are skipped).

**M2 — Push-through and matched cut.**
- Add `playPortal`'s `onHandoff` and `introPageScreenRect`.
- Add the `view.travel` fields and `view.arrival`, `TravelWindow` mounted from `Screens`, veil suppression, the `covered` gate, the `BUILT` delay, the develop path, the reduced-motion path and the unmount rules.

*Exit:* a journey from `portal-hub` to a fixture target shows no world pop or hard cut on desktop Chrome, and on the iPhone through the redeployed branch preview (§9.1). Cancel and a forced build error both leave cleanly. Reduced motion works.
*Validate:*
- Engine unit tests: `introPageScreenRect` against projected corners for portrait and landscape aspects, and `onHandoff` fires once.
- A new `apps/web/test/portal-windows.e2e.test.ts` with its own Vite server and `process.env.VITE_PORTAL_WINDOWS_ENABLED = 'true'` set before `createServer`. The existing file keeps covering flag-off, including `travel-iris`. Check that:
  - the layer mounts from the handoff rect, the building UI is inside it, and no `.wwm-veil` appears;
  - `loadStage` happens only after coverage, and the second stage loads;
  - with `skipIntro` off, `view.arrival` is set at the intro and the layer unmounts after the crossfade;
  - score, spares and the trail carry over;
  - Cancel mid-travel works, and object URLs are revoked;
  - a reduced-motion variant works.
- Do not add these tests under the #36 quarantine. Reuse the repaired observer pattern from [performance-portal-test-repair.md](../docs/build-log/performance-portal-test-repair.md), and record a serial CI-mode run: `CI=true pnpm exec vitest run --project @wwm/web apps/web/test/portal-windows.e2e.test.ts`.

**M3 — Built-site previews from the service.**
1. Orchestrator: apply CCR-PW-1 (contracts, `@wwm/schema`, CHANGELOG, version bump).
2. Worker: add the route under `stagesRoutes`, the catalog query, the kill switch and the tests. Document `kill:portal-previews` next to `kill:capture` in `docs/launch/runbook.md` (orchestrator).
3. Web: add the batched lookup and texture fetches to `portal-preview.ts`.
4. Measure the median slice-texture bytes, the D1 reads per lookup, and how often the exact variant (§5 step 2) hits.
5. Redeploy the static branch preview, which shows the lookup's 429 fallback as postcards. Then hand the user a `pnpm dev:phone` URL for the built-site path (§9.1).

*Exit:* run local `pnpm dev` with `MODERATION_MODE=test-allow` in `apps/worker/.dev.vars`; with the committed `manual` mode, local builds stay `pending_review` and are never servable. Build site A, then build a site B that links to A. B's portal shows A's page, and travelling is a cache hit with the full matched cut. Rebuild A at another difficulty: the lookup still returns the default-difficulty run (D3). A blocked URL, a blocked `submitted_url`, a `pending_review` run and the kill switch all give `null`, and travel is unaffected.
*Validate:*
- `pnpm vitest run --project @wwm/worker`. Route tests cover: the exact variant preferred over a newer run at another difficulty; the fallback to newest when there's no exact variant; `peekVariant` doing no writes (no `url_variants`, `moderation_cases` or KV writes); batch order; unknown, blocked, opted-out (KV `optout:`) and non-servable URLs give `null`; limits (0 URLs, 7 URLs, over-length URLs, over the body cap); the kill switch with no D1 call; no build, claim, refresh or budget calls; `no-store`.
- `pnpm vitest run --project @wwm/schema` for the new request and response schemas.
- Loader unit tests: abort on stage change and at Travel, late results dropped, object URLs revoked except the hand-off, retry re-decodes without requests, offline gives no request, Pip gates give no request.
- An E2E variant with a mocked lookup and texture in `portal-windows.e2e.test.ts`.

**M4 — Device validation and the production decision.**
- Redeploy the branch preview from the final branch head (§9.1). It validates fixture windows, postcards and travel to fixture targets.
- Validate built-site previews on the iPhone 17 Pro through `pnpm dev:phone` (local worker with `test-allow`, HTTPS tunnel), and on Android Chrome if available: tilt-steer into a portal, travel, arrive.
- Record the hero clip for the LinkedIn series.
- Write the M4 entry in `docs/build-log/portal-windows.md` with honest timings and these **B inputs**: the share of portals with a built-site preview across several real journeys, the median wait on a cache miss, and the iPhone frame-time headroom. In production only approved or curated runs count (§2), so measure availability against production data after the production flag is on, or state the proxy used.

*Exit:* the user signs off on the feel, then production is enabled in `ci.yml` (`deploy-production` build step). Go/no-go for M5 is decided from the measured preview availability. The branch preview is deleted (§9.1).

**M5 — `og:image` previews and telemetry (gated; CCR-PW-2).** Start only if M4 shows built-site previews are too rare to matter, or the user wants the data. Contract work comes first.
- **CCR-PW-2 (orchestrator approval required):**
  - An optional `image?: string` (a same-origin path) on each lookup item.
  - A new `GET /api/portals/preview-image/:key`.
  - New telemetry events in `TelemetryEventSchema`:
    - `portal_preview_shown { source: 'fixture' | 'built' | 'og' | 'postcard' }`, at most once per portal per stage.
    - `portal_travel_arrived { preview: 'hit' | 'miss' | 'none', waitBucket }`.
  - No URLs or hosts in telemetry. Ingest stays governed by `TELEMETRY_INGEST`.
- **Fetch pipeline (worker):**
  - Full `checkUrl` with DNS, plus `createRequestGuard` for every hop and redirect.
  - The HTML response is capped (for example 512 KB, 5 s) and parsed only for `og:image` / `twitter:image`.
  - The image URL is policy-checked again and fetched with caps: the content types `image/png`, `jpeg` and `webp` only, ≤ 2 MB, and dimensions checked.
  - Stored in R2 under `previews/<sha256(normalized url)>` with a TTL, and served with `canServe`-style blocked-URL and blocked-host checks on every request.
- **Decision gate before code: the moderation posture.** These images have not been reviewed. Recommended: only for hosts with at least one `approved` run, never for blocked hosts, with a separate kill switch (`kill:portal-og`).
- **Cost controls:** per-IP and global hourly limits, and a new row in [cost-controls.md](cost-controls.md). Fetches happen only when a portal is in the loaded stage, never speculatively for linked pages two hops away.

*Exit:* the gate decision is recorded, CCR-PW-2 is applied, SSRF and size-limit tests pass, the kill switch is verified, and the events validate in `@wwm/schema` tests.

## 8. Performance and budgets
- **Draw calls:** zero added in play. The DOM layer sits outside the WebGPU budget. During `building` the engine still renders the old stage at 30 fps under the opaque layer, as it does today under the veil.
- **GPU memory:** the 1152 × 768 RGBA atlas is about 3.4 MiB, or about 4.5 MiB with mipmaps, per loaded stage. Decoded bitmaps are closed after drawing into the atlas.
- **CPU memory:** up to 6 compressed blobs, about the size of the textures. If M3 finds a median above about 400 KB, consider a thumbnail derivative written at build time (a storage follow-up, not part of A). A fixture layer image decodes the full screenshot (up to 1280 × 6000, about 31 MB decoded) for the travelled portal only.
- **Network:** one small POST per stage load, plus up to 6 texture GETs, only when online and only for previews that exist. Cached artifact reads count against the read limiter (100/min/IP), not the build budgets. The lookup costs up to about 36 D1 reads (§5).
- **Main thread:** decoding goes through `createImageBitmap`. The frame loop never waits on previews.

## 9. Rollout and rollback

### 9.1 Preview deployments for user testing (D5)
Every milestone, M0 to M4, ends with a deployed preview the user can open on the iPhone, and the URL is posted in that milestone's PR and in the hand-off.

- **What exists:** PR Worker Previews are off (`vars.WWM_PREVIEWS_ENABLED=false` since 2026-09-29), and even when on they disable dynamic APIs to avoid separate spending allowances. The supported path is the manual **static branch preview**: `workflow_dispatch` with `deploy_preview`, deploying [static-preview.ts](../apps/worker/src/static-preview.ts) with only the built assets as the Worker `wwm-preview-<name>` on workers.dev. It never touches production data or bindings, and `check-static-preview-config.mjs` enforces that.
- **Deploy (agent, from the milestone branch, after `pnpm check` and a push):**
  ```sh
  gh workflow run ci.yml --ref <branch> -f deploy_preview=true -f preview_name=portal-windows
  gh run watch "$(gh run list --workflow ci.yml --branch <branch> --limit 1 --json databaseId -q '.[0].databaseId')"
  ```
  - **URL:** the job prints it in the "Preview test links" summary, as `https://wwm-preview-portal-windows.<subdomain>.workers.dev`.
  - **Check:** the workflow already verifies that `/api/health` reports `mode: "static"` and the branch head commit.
  - **Reuse:** every milestone overwrites the same `portal-windows` preview.
- **Test links** (added to the summary in M0):
  - `/play/fixture-portal-hub?offline=1` is the main test.
  - `/play/fixture-hn-front?offline=1` shows real-site portals as postcards.
  - Use `?offline=1` because the static host answers `/api/health` with `ok: true` but every other `/api/*` with 429. Without it, portals to sites that aren't fixtures look open, and Travel fails with `RATE_LIMITED`. With it, they're grey, and portals to fixture targets travel in the browser.
- **The built-site path (M3, and in M4):** the static host can't serve `POST /api/portals/previews`. It returns 429, which only tests the postcard fallback. To test built-site previews:
  - The agent runs `VITE_PORTAL_WINDOWS_ENABLED=true pnpm dev:phone` on this Mac, with `MODERATION_MODE=test-allow` in `apps/worker/.dev.vars`, and gives the user the `https://….trycloudflare.com` URL.
  - It is live only while that process runs.
  - Turning on API-backed previews would change the cost policy, which is outside this plan.
- **Production stays off:** only the `preview` job's build sets the flag before M4 sign-off.
- **Cleanup** after M4: `pnpm --filter @wwm/worker exec wrangler delete --name wwm-preview-portal-windows`.

### 9.2 Production rollout
- **Deploy order:** merges to `main` auto-deploy, so the M3 worker route goes live in production when it merges, before any client calls it. It is read-only and serves only what `canServeRun` already allows. The client treats a 404 or 429 as "no previews".
- **Flag:** `VITE_PORTAL_WINDOWS_ENABLED` uses the explicit opt-in convention: off unless `'true'`, including under `pnpm dev`. Use `VITE_PORTAL_WINDOWS_ENABLED=true pnpm dev` locally. It is enabled in the preview build from M0 (§9.1), and in production after M4 sign-off. Every milestone must merge with the production flag off until M4.
- **Rollback:**
  - Turning the flag off restores the Phase 13 visuals and `TravelIris` exactly. This needs a rebuild and redeploy.
  - Setting the `kill:portal-previews` KV key disables only built-site lookups, server-side and without a deploy. Fixture previews, the tear shader and `TravelWindow` stay until the flag is turned off.
  - Neither touches stored data. There are no migrations unless M3 adds an index, which is additive and safe to leave in place.

## 10. Risks and open questions
- **D3 — Difficulty, seed and builder mismatch (resolved 2026-10-20: prefer the exact variant).** Travel builds at `normal`, `defaultSeed(url)` and the current `builder.version` (the `runCacheKey` inputs). The lookup now returns that exact run when it's servable, so a preview usually means a cache hit. It falls back to the newest servable run, so pages remain previewable across builder upgrades. A fallback preview can still be followed by a fresh build. The cut always uses the arrival image (§6.3).
- **Q1 — Fixture-target stage (resolved 2026-10-20: the `portal-hub` test fixture, M0).** Rights stay clean because we write the page ourselves, and its targets are committed fixtures that already carry their licences. `fixtures/captures/**` is Phase 02 territory, so the orchestrator approves the addition (the user approved it on 2026-10-20).
- **Q2 — Preview availability under manual moderation (resolved 2026-10-20: manual review stays).** With `MODERATION_MODE=manual`, only operator-approved and curated runs can be previewed. Travel to a page someone else has built that is still awaiting review ends in `CAPTURE_BLOCKED` ("awaiting content review"); a page nobody has built yet still builds normally. M4 still measures availability before the M5 go/no-go. A later improvement is noted in §11.
- **Risk — the preview host fakes "online".** The static host reports `ok: true` on health but refuses the API. Test links use `?offline=1` (§9.1). A deeper fix (treating `mode: "static"` as offline in `#probeApi`) is a small separate change. Don't fold it into this work unless testing shows confusion.
- **Risk — the matched cut misaligns on unusual aspect ratios** (tall pages, landscape phones, a rotation during the build). Compute the rectangle at the cut, not at load. Fall back to a crossfade when it is off-screen or `null`.
- **Risk — the tear shader costs too much on phones.** M0 measures this first. Quality tiers drop to one octave or a static edge.
- **Risk — previews of removed content.** The lookup and texture route both apply moderation on every request with `no-store` / `REVOCABLE`, so a takedown disappears on the next stage load. Previews already shown stay until the stage ends.
- **Risk — leaking object URLs or bitmaps across stage loads.** The lifecycle rules in §6.2 keep ownership in the Game, not in React effects. A loader test asserts revocation.
- **Risk — the new travel E2E inherits the #36 flake.** The repaired observer pattern and a recorded serial CI-mode run are required. A quarantine is not an acceptable exit for M2.

## 11. Handing off to Option B
- The loader's state machine gains a `building` state. A dwell near a portal starts a real build, and the finished stage's texture flows through the same `setPortalPreview` path and object-URL handoff.
- The travel path already treats "build finished before arrival" as the cache-hit choreography, so a successful prefetch needs no new transition work.
- B is planned from the M4 inputs: preview availability, the wait on a miss, and the iPhone frame-time headroom for an optional live second scene (Option C).

**Possible later improvement (Q2, not in A or B):** list each approved page's portal links in the admin, so an operator can approve or pre-generate those targets in bulk. That would raise preview availability under manual moderation without changing the moderation posture. It belongs with the admin and moderation work, and would need its own plan.

## 12. Ownership
This work touches:
- Phase 13 paths: `packages/engine/**` (additive API only), `apps/web/src/game/**`, `apps/web/src/ui/**` (including `Screens.tsx` for the mount and the veil) and `apps/web/src/dev/**`.
- Phase 07 worker paths (`apps/worker/src/routes/stages.ts`, `catalog.ts`) for M3 and M5.
- `.github/workflows/ci.yml`: the `preview` job's flag and test links in M0, and the `deploy-production` flag in M4.
- The new `portal-hub` fixture in M0: `fixtures/pages/portal-hub/`, `fixtures/captures/portal-hub/`, and its `fixtures/captures/README.md` and `NOTICE.md` entries (approved by the user on 2026-10-20), plus `apps/web/src/game/catalog.ts`.
- New test files under `apps/web/test/`, `packages/engine/test/` and `apps/worker/test/`.

Edits to the contract, `@wwm/schema` (including `CHANGELOG.md`), `cost-controls.md` and `docs/launch/runbook.md` belong to the orchestrator. Keep `GameApp.tsx` untouched. No original 2013 assets are involved.
