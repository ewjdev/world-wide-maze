# Portal windows: see the next site, roll into it (Option A) — execution plan

**Date:** 2026-10-20 (reviewed and revised the same day)

**Status:** Planned, not started. The decisions below are recorded. Option B (speculative build on approach) is planned separately after M4 (§11).

**Label:** N (new; not in 2013). Builds on Phase 13 link portals ([phase-13-link-portals.md](phase-13-link-portals.md), contracts §10.1, build log [phase-13.md](../docs/build-log/phase-13.md)).

**Outcome:** A link portal stops being a generic swirl and becomes a window onto the linked site: a ragged, glowing tear in the air with the destination page visible inside it. Travelling pushes the camera through the tear, the window grows to fill the screen, and the player waits *inside the next world* instead of on a white build screen. When the maze is ready, the destination page is already standing upright in front of the camera, and the existing intro folds it flat and extrudes it into islands. The page in the portal literally becomes the floor of the next maze.

Inspiration: "portal jumping through gaussian splat worlds with WebGPU" (a social video shared on 2026-10-20). We borrow the portal edge and the step-through transition, not splats. WWM worlds are web pages printed onto islands, so the picture in the window is the page itself.

### Decisions recorded (user, 2026-10-20)

| ID | Decision |
| --- | --- |
| CCR-PW-1 | **Approved.** The read-only preview lookup `POST /api/portals/previews` (§5). It is implemented in M3. |
| D1 | **Keep the "Travel to <label>?" prompt** unchanged in A. |
| D2 / D4 | **The page's `og:image` previews and telemetry move to a new milestone, M5** (§7). It is gated on M4 results and needs its own contract change, CCR-PW-2. |

## 1. Success criteria

1. On HN with 6 portals, the scene stays at **≤ 46 draw calls** (the Phase 13 measurement), and iPhone 17 Pro frame time shows no measurable regression at chase distance.
2. A portal whose target is an offline fixture, or a site that has already been built, shows that page in the window. Every other portal shows the postcard. No portal ever renders empty, black or broken.
3. Travel from portal to arrival shows **no white frame and no hard cut** on desktop Chrome and on the iPhone. The destination picture remains visible from the push-through until the intro's fold.
4. Travel behaves exactly as it does today when previews are missing, fail, or are disabled by the flag or the kill switch. That covers score and spare carry-over, the journey trail, SSE progress, Cancel, the error screens and the paired-phone JUMP/MENU.
5. The preview lookup never starts, queues or reserves a build, and never serves a run that `canServeRun` rejects.
6. Reduced motion is honoured: a static window, and a crossfade instead of the grow and the tween.

## 2. Non-goals (A)

- Building or prefetching destinations before Travel (Option B), and rendering a live second scene through the portal (Option C).
- `og:image` or any other preview of a page that hasn't been built, and new telemetry events. Both are in M5.
- Changing `StageData`, `Portal`, stage-builder portal placement, physics sensors, the confirm prompt, or journey and share semantics.
- Changing Pip gates (`wwm-learning:` hrefs). They keep the Phase 13 look and never fetch previews.
- Race mode, which has no link portals.
- New image storage or thumbnail derivatives (a possible follow-up if M3 measurements require it, §8).

## 3. Player experience

### Approaching a portal
1. Each open link portal shows a picture of its destination inside the disc. The edge is a ragged, moving, luminous tear in the portal's host colour (`portalColor(href)`), replacing the hard rim and log-spiral vortex. The label card is unchanged.
2. With no picture available, the disc shows a **postcard**: the host colour, the monogram and a slow vortex.
3. The picture shows the **top of the page** (above the fold), with slight parallax against the tear as the camera moves.
4. Offline portals stay grey and show the postcard. Declined ("used") portals stay dimmed.
5. The confirm prompt and the Stay-here rule from the 2026-09-26 playtest are unchanged (D1).

### Travelling
1. **Travel** starts the build at once and plays the existing gate animation, as today (`Game.travelPortal`).
2. The camera then pushes into the disc. When the disc covers about a third of the viewport, the engine reports its on-screen rectangle. A DOM layer, `TravelWindow`, mounts at that rectangle showing a **full-resolution** version of the same picture, and grows a ragged-edged mask to full screen over ~0.6 s.
3. The building UI (copy, trail, progress strip, Cancel) renders on top of the picture. SSE progress, the error screens and the fallbacks are unchanged.
4. **Cache miss:** the layer shows the postcard world while the site is captured. When the stage loads, the layer draws the loaded page texture, "develops" it in over 0.4 s, and then does the matched cut below. Hits and misses end the same way.

### Arriving (the matched cut)
1. After `loadStage`, the engine reports the upright page's on-screen rectangle at intro time 0 (the intro starts upright: `packages/engine/src/camera/intro.ts`).
2. The layer's image tweens from "top of the page covers the viewport" to that rectangle (~0.35 s), then crossfades to the canvas. The `fast` intro folds and extrudes as today.

### Reduced motion and failures
- `prefers-reduced-motion` (and the engine's `reducedMotion` option) gives a static picture with no edge turbulence. The push, grow and tween become a single crossfade.
- Any preview failure (no preview, a failed fetch or decode, a lost texture, the kill switch, the flag being off) silently gives the postcard. Travel never waits on a preview.

## 4. Verified starting point

Inspected on 2026-10-20 on `codex/fix-mobile-game-layouts` at `cf1b830`.

| Area | Existing implementation | Planned change |
| --- | --- | --- |
| Portal visuals | [world/portals.ts](../packages/engine/src/world/portals.ts): one `InstancedMesh` of billboarded gates. Parts are 0 vortex, 1 rim, 2 halo, 3 ground ring, 4 label, 5 beam. Labels come from one canvas atlas with a row per portal. Glow is carved out of the colour for the bloom composite (`glowC ≤ shown`) | Part 0 samples a preview atlas; the edge becomes a noise-displaced tear. Still one draw call |
| Engine API | [engine.ts](../packages/engine/src/engine.ts): no outbound event callbacks. `playPortal(id): Promise<void>` (~1.6 s); `setPortalState`; `StageImage = ImageBitmap \| HTMLImageElement \| HTMLCanvasElement \| OffscreenCanvas`; `EngineStats.drawCalls` / `sceneDrawCalls` | Additive changes only (§6.1): a per-call `onHandoff` option, `setPortalPreview`, `introPageScreenRect` |
| Intro | [camera/intro.ts](../packages/engine/src/camera/intro.ts): upright page, fold, extrude; `fast` is 7.9 s. Travel uses `fast` because `#firstStageOfVisit` is false | The timeline is unchanged; expose the page's screen rectangle at t = 0 |
| Travel flow | `Game.travelPortal()` in [game/game.ts](../apps/web/src/game/game.ts): `createApiRun` or `FixtureRun`, started during `playPortal`, then `TRAVEL`, then `#loadSlice` (which calls `e.loadStage(got.stage, got.image)`); `cancelBuild()` | `view.travel` gains a `preview` field; `#loadSlice` hands the loaded image to the layer when a travel is active |
| Portal states | `#applyPortalStates`, plus `#probeApi` (`/api/health`, once per session) | The preview loader starts after the probe resolves, only for open link portals |
| Fixture images | `FixtureRun` in [game/stages.ts](../apps/web/src/game/stages.ts) loads `fixtures/captures/<slug>/screenshot.png` through a Vite glob; `fixtureFor(href)` is in [game/journey.ts](../apps/web/src/game/journey.ts) | Export a small `fixtureScreenshotUrl(entry)` helper so the loader can reuse the same asset |
| Travel UI | `TravelIris` in [ui/Journey.tsx](../apps/web/src/ui/Journey.tsx), mounted from [ui/Play.tsx](../apps/web/src/ui/Play.tsx) when `v.travel` is set; building screen `travel` branch in [ui/Screens.tsx](../apps/web/src/ui/Screens.tsx); reduced-motion rules in [ui/journey.css](../apps/web/src/ui/journey.css) | `TravelWindow` replaces `TravelIris` when the flag is on |
| Stage texture route | `GET /api/stages/:stageId/texture` in [routes/stages.ts](../apps/worker/src/routes/stages.ts): checks `canServeStage` on every request; artifact cache; `REVOCABLE` cache header | Reused as the source for previews of built sites. No new image route in A |
| Serving rules | `Catalog.canServeRun` in [catalog.ts](../apps/worker/src/catalog.ts): the moderation case is `approved` with `artifacts_available`, the run is `complete`/`partial`, and the URL is not blocked. `moderation_cases(url)` is indexed ([0005_url_catalog.sql](../apps/worker/migrations/0005_url_catalog.sql)) | The lookup query reuses these rules |
| Read limiting and CSRF | `stagesRoutes.use('*', readLimit)`; the router refuses cross-site non-GET requests ([router.ts](../apps/worker/src/router.ts)) | Mount the lookup under `stagesRoutes`, so it inherits both |
| Kill switches | KV `CACHE` key precedent: `kill:capture` ([refresh.ts](../apps/worker/src/refresh.ts)) | Add `kill:portal-previews` |
| Client flags | `VITE_MOBILE_TILT_ENABLED` pattern in [input/flags.ts](../apps/web/src/input/flags.ts), set per environment in [ci.yml](../.github/workflows/ci.yml) | Add `VITE_PORTAL_WINDOWS_ENABLED` |
| Telemetry | [schema/telemetry.ts](../packages/schema/src/telemetry.ts) has `portal_selected {action}` | No change in A (M5) |
| E2E | [apps/web/test/portal.e2e.test.ts](../apps/web/test/portal.e2e.test.ts) (Chromium, mocked `/api/stages` + SSE) | Extended in M2 and M3 |

## 5. Contract change CCR-PW-1 (approved 2026-10-20)

The orchestrator applies this as the first step of M3. Add the endpoint to contracts §7 and as a new §10.x. Add a resolutions-log entry in §9. Put the request and response types and the Zod schema in `@wwm/schema`, and bump `CONTRACT_VERSION` from `0.3.6` to `0.3.7`. `StageData` and `Portal` do **not** change, because previews are resolved at runtime and are never stale in a stored stage.

**`POST /api/portals/previews`**
- **Request:** `{ urls: string[] }`, with 1–`MAX_PORTALS` entries, each ≤ 2,048 characters.
- **Response:** `200 { items: { url: string; stageId: string | null }[] }`, in request order, each `url` echoed exactly as sent.
- **Resolution, per URL:** run `normalizeTargetUrl`, then `checkUrlStatic` (no DNS, because nothing is fetched). A blocked URL or host (`isUrlBlocked` / `isHostBlocked`) gets `null`. Otherwise return the slice-0 `stage_id` of the newest run for that normalized URL, at any difficulty or seed, that passes the `canServeRun` rules. Prefer a single D1 query joining `moderation_cases`, `runs` and `stages`. Add an index only if `EXPLAIN QUERY PLAN` shows a scan.
- **Guards:** it is read-only and never calls build admission, `claimBuild`, or the budget controller. It inherits `readLimit` and the cross-site refusal by mounting under `stagesRoutes`. The response is `cache-control: private, no-store`, so takedowns apply on the next stage load.
- **Kill switch:** when `kill:portal-previews` is present in `CACHE`, every item is `null` (still `200`).
- **Errors:** `400` for a malformed body (generic body, no new code) and `RATE_LIMITED`. The client treats any non-200, including the 404 an older worker returns, as "no previews".
- **Images:** the existing `GET /api/stages/:stageId/texture`.
- **Forward compatibility:** M5 may add optional fields to each item through CCR-PW-2. Clients must ignore unknown fields.

## 6. Architecture

### 6.1 Engine API (additive)
```ts
export interface ScreenRect { x: number; y: number; width: number; height: number } // CSS px, canvas-relative

/** Show `image` (any StageImage) inside portal `id`; `null` restores the postcard. Safe before/after loadStage. */
setPortalPreview(id: number, image: StageImage | null): void;

/** Existing; `onHandoff` fires once, when the disc covers ≈ ⅓ of the viewport during the push-through. */
playPortal(id: number, opts?: { onHandoff?: (rect: ScreenRect) => void }): Promise<void>;

/** After loadStage, before the intro's fold: where the upright page is on screen at intro t = 0. */
introPageScreenRect(): ScreenRect | null;
```
- The push-through extends `playPortal`'s existing `portalWatch` camera glide forward through the gate. The promise still resolves when the gate animation ends, so `travelPortal`'s ordering is unchanged. If `onHandoff` never fired (an off-screen gate, reduced motion), the layer mounts full screen and crossfades.
- **Preview atlas** in `world/portals.ts`: one texture with up to `MAX_PORTALS` tiles (for example 3 × 2 tiles of 384 × 384). A per-instance tile index (−1 is the postcard) lives in the existing instanced attributes. Each tile is a centred crop of the top `min(h, w)` region of the image, drawn into the atlas canvas, and only the updated texture is marked `needsUpdate`. `loadStage` / `unloadStage` reset all tiles.
- **Shader:** sample the tile using the disc UV plus a camera-direction parallax offset (about 4–6 %, clamped so tile edges never show). Warp the disc edge radius with two octaves of animated value noise, and drive an emissive tear rim in the host colour. Add an inner vignette for depth. Keep the bloom rule (`glowC ≤ shown`). States: open is the full tear; offline is a grey postcard with the tear frozen; used is dimmed as today; surge flares the tear and whitens the picture.
- **Quality:** under low tiers ([quality.ts](../packages/engine/src/quality.ts)) or `reducedMotion`, use one noise octave and a static edge.

### 6.2 Web: preview loader (`apps/web/src/game/portal-preview.ts`, new)
- **Inputs:** the loaded stage's link portals, the `#api` state, the flag.
- **Per-portal state machine:** `none → looking-up → ready | postcard`. Option B will later add `building` (§11).
- **Sources:** a fixture target uses `fixtureScreenshotUrl(entry)` (works offline, no request). Otherwise, when `#api === 'online'`, one batched `POST /api/portals/previews` for the remaining hrefs, then up to 6 parallel `GET /api/stages/:id/texture`.
- **Two resolutions per ready portal:** the original **compressed `Blob`**, kept as an object URL for the full-screen layer, and a downsampled `ImageBitmap` (`createImageBitmap` with `resizeWidth`/`resizeHeight`, falling back to a canvas draw) for `setPortalPreview`. Close the bitmap once the atlas tile is drawn.
- **Lifecycle:** one `AbortController` per loaded stage. Abort and revoke every object URL on stage change, `unloadStage`, travel completion, or `dispose`. Drop late results whose stage no longer matches `this.#stage()`. The travelled portal's object URL is handed to `view.travel.preview`, and its ownership passes to the layer, which revokes it on unmount.
- **Failures** set that portal to `postcard` with no UI and no retry within the stage.

### 6.3 Web: game state and the `TravelWindow` layer
- `view.travel` becomes `{ label; host; href; preview: { src: string } | null; handoff: ScreenRect | null; arrival: StageImage | null; cut: ScreenRect | null }`. The new fields are optional to consumers, so `TravelIris` still works when the flag is off.
- `travelPortal()` passes `onHandoff` to `playPortal` and sets `travel.handoff`. In `#loadSlice`, when a travel is active and `loadStage` succeeds, it sets `travel.arrival = got.image` and `travel.cut = e.introPageScreenRect()` before starting the intro.
- **`TravelWindow`** (in `ui/Journey.tsx`, with styles in `ui/journey.css`):
  - Mounts at `handoff`, or full screen if there is none. Shows `preview.src`, or the postcard.
  - Grows a `clip-path: circle()` mask, and animates a pre-rendered noisy glow ring as a separate element. No full-screen SVG `feTurbulence`.
  - On `arrival` without a preview, develops the arrival image (drawn into a `<canvas>`).
  - On `cut`, tweens the image transform to `cut` and crossfades out.
  - The building screen's `travel` branch renders inside it.
- **Unmount rules:** the layer unmounts whenever `view.travel` becomes `null` (arrival complete, Cancel, a build error leading to today's error screen, or dispose). It also unmounts if the intro is skipped or the phase leaves `intro` before the cut finishes, and when the test `skipIntro` option is set.
- The canvas stays mounted underneath. The layer never intercepts focus or input outside the building UI, and the existing Cancel and error buttons keep their accessible names.

## 7. Milestones

Every milestone ends with `pnpm check` green and reviewed screenshots in `docs/build-log/assets/portal-windows/`. Milestones are sequential unless noted.

| ID | Milestone | Depends on | Status |
| --- | --- | --- | --- |
| M0 | Look test on the phone | — | pending |
| M1 | Window shader, atlas, postcard, fixture previews | M0 | pending |
| M2 | Push-through, `TravelWindow`, matched cut | M1 | pending |
| M3 | Previews of built sites from the service (CCR-PW-1) | M1 (the M3 worker work can run in parallel with M2) | pending |
| M4 | Device validation, preview-environment rollout, showcase clip | M2, M3 | pending |
| M5 | `og:image` previews and telemetry (CCR-PW-2) | M4 decision gate | pending |

**M0 — Look test (sandbox only).** In [dev/engine-sandbox.tsx](../apps/web/src/dev/engine-sandbox.tsx), add a toggle that swaps in the window shader, using one fixture screenshot as a single-tile atlas. Record a 10 s clip on the iPhone 17 Pro.
*Exit:* the user approves the look on the phone; `sceneDrawCalls` is unchanged; no visible frame-time regression on the phone.

**M1 — Window shader and fixture previews.**
- Add the atlas, shader and `setPortalPreview` (§6.1).
- Add `portal-preview.ts` with the fixture source only.
- Add `fixtureScreenshotUrl` and the `VITE_PORTAL_WINDOWS_ENABLED` flag (when off, nothing changes visibly).

*Exit:* the HN fixture's portal to a fixture site shows that page. Offline, used and Pip-gate states are correct. HN with 6 portals stays at **≤ 46 draw calls**. The bloom shows no tint.
*Validate:* `pnpm vitest run --project @wwm/engine` and `--project @wwm/web`.

**M2 — Push-through and matched cut.**
- Add `playPortal`'s `onHandoff` and `introPageScreenRect`.
- Add the `view.travel` fields, `TravelWindow`, the develop path, the reduced-motion path and the unmount rules.

*Exit:* a journey between fixtures shows no white frame or hard cut on desktop Chrome and the iPhone. Cancel and a forced build error both leave cleanly. Reduced motion works.
*Validate:* extend `apps/web/test/portal.e2e.test.ts`. Check the layer mounts from the handoff rect, the building UI is inside it, the second stage loads, the layer unmounts at the intro, score, spares and trail carry over, Cancel mid-travel works, and there's a reduced-motion variant.

**M3 — Built-site previews from the service.**
1. Orchestrator: apply CCR-PW-1 (contracts, `@wwm/schema`, version bump).
2. Worker: add the route under `stagesRoutes`, the catalog query, the kill switch and the tests.
3. Web: add the batched lookup and texture fetches to `portal-preview.ts`.
4. Measure the median slice-texture bytes.

*Exit:* on local `pnpm dev`, build site A, then build a site B that links to A. B's portal shows A's page, and travelling is a cache hit with the full matched cut. A blocked URL and the kill switch both give `null`, and travel is unaffected.
*Validate:*
- Worker route tests: batch order, unknown, blocked and non-servable URLs give `null`, limits (0, 7 and over-length URLs), the kill switch, no build or budget calls, `no-store`.
- Loader unit tests: abort on stage change, late results dropped, object URLs revoked, offline gives no request, Pip gates give no request.
- An E2E variant with a mocked lookup and texture.

**M4 — Device validation and rollout to the preview environment.**
- Set `VITE_PORTAL_WINDOWS_ENABLED: "true"` for the preview build in `ci.yml`, and leave production off.
- On the iPhone 17 Pro (and Android Chrome if available): tilt-steer into a portal, travel, arrive.
- Record the hero clip for the LinkedIn series.
- Write `docs/build-log/portal-windows.md` with honest timings and these **B inputs**: the share of portals with a built-site preview across several real journeys, the median wait on a cache miss, and the iPhone frame-time headroom.

*Exit:* the user signs off on the feel, then production is enabled in `ci.yml`. Go/no-go for M5 is decided from the measured preview availability.

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
- **Draw calls:** zero added in play. The DOM layer sits outside the WebGPU budget.
- **GPU memory:** about +3.4 MB for the atlas. Decoded bitmaps are closed after drawing into the atlas.
- **CPU memory:** up to 6 compressed blobs, about the size of the textures. If M3 finds a median above about 400 KB, consider a thumbnail derivative written at build time (a storage follow-up, not part of A).
- **Network:** one small POST per stage load, plus up to 6 texture GETs, only when online and only for previews that exist. Cached artifact reads count against the read limiter, not the build budgets.
- **Main thread:** decoding goes through `createImageBitmap`. The frame loop never waits on previews.

## 9. Rollout and rollback
- **Deploy order:** the worker (M3 route) can ship before or after the client. The client treats a 404 as "no previews", and the route is unused until the client calls it.
- **Flag:** `VITE_PORTAL_WINDOWS_ENABLED` defaults off. It is enabled in the preview build at M4, and in production after sign-off. Merges auto-deploy, so every milestone must merge with the production flag off until M4.
- **Rollback:** turning the flag off restores the Phase 13 visuals and `TravelIris` exactly. Setting the `kill:portal-previews` KV key disables lookups server-side without a deploy. Neither touches stored data. There are no migrations unless M3 adds an index, which is additive and safe to leave in place.

## 10. Risks and open questions
- **D3 — Difficulty mismatch (open, measured in M3).** The preview uses the newest servable run at any difficulty, while travel builds at the default difficulty and seed. The page picture is the same, so the only cost is a "hit" preview followed by a build miss.
- **Risk — the matched cut misaligns on unusual aspect ratios** (tall pages, landscape phones). Always tween to the reported rectangle, and fall back to a crossfade when it is off-screen or `null`.
- **Risk — the tear shader costs too much on phones.** M0 measures this first. Quality tiers drop to one octave or a static edge.
- **Risk — previews of removed content.** The lookup and texture route both apply moderation on every request with `no-store` / `REVOCABLE`, so a takedown disappears on the next stage load. Previews already shown stay until the stage ends.
- **Risk — leaking object URLs or bitmaps across stage loads.** The lifecycle rules in §6.2, plus a loader test that asserts revocation.

## 11. Handing off to Option B
- The loader's state machine gains a `building` state. A dwell near a portal starts a real build, and the finished stage's texture flows through the same `setPortalPreview` path and object-URL handoff.
- The travel path already treats "build finished before arrival" as the cache-hit choreography, so a successful prefetch needs no new transition work.
- B is planned from the M4 inputs: preview availability, the wait on a miss, and the iPhone frame-time headroom for an optional live second scene (Option C).

## 12. Ownership
This work touches Phase 13 paths: `packages/engine/**` (additive API only), `apps/web/src/game/**`, `apps/web/src/ui/**` and `apps/web/src/dev/**`. It touches Phase 07 worker paths (`apps/worker/src/routes/stages.ts`, `catalog.ts`) for M3 and M5, and `.github/workflows/ci.yml` for the flag in M4. Edits to the contract, `@wwm/schema` and `cost-controls.md` belong to the orchestrator. Keep `GameApp.tsx` untouched. No original 2013 assets are involved.
