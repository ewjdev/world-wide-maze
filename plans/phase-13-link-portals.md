# Phase 13 — Link Portals ("roll across the web")
**Wave:** 5 · **Contracts:** §10.1 (v0.3.0 types already in `@wwm/schema`) · **Label:** N (new; not in 2013)

## Goal
Links on a page become glowing portals. Rolling into one offers to travel there, which builds the linked site's maze and continues the run as a **web journey** with a shareable breadcrumb trail. This is the feature that makes the name literal, and the showcase moment for the video.

## Owns
- `packages/capture-script/**` (collect `href`)
- `packages/stage-builder/**` (portal placement)
- `packages/physics/**` (the portal sensor and event)
- `packages/engine/**` (portal visuals, additive API only)
- `packages/solver/**` (ignore portals, or treat them as non-goal)
- `apps/web/src/game/**` and `apps/web/src/ui/**` (the travel flow, journey HUD, trail share)
- `fixtures/builder/**` (regenerated goldens)

Phase 14 edits `apps/web/src/local-capture/**` plus one hook in `GameApp.tsx`, so keep your `GameApp.tsx` edits minimal.

## Tasks
1. **Capture:** set `href` for links (absolute, normalized, http(s) only, same-page anchors dropped). Recapture isn't needed for the tests; synthetic captures are enough.
2. **Builder:** choose up to `MAX_PORTALS` portals. Prefer off-site, distinct, well-labelled links that sit on reachable islands (use the Phase 03b walkable region), and avoid the start and goal islands' safe spots. It must be deterministic per seed. Bump `BUILDER_VERSION` (minor).
3. **Physics:** add a portal sensor (`PORTAL_RADIUS_M`) that emits `portal` once and re-arms after the ball exits. Bump `PHYSICS_VERSION` only if replay behavior changes (it shouldn't: a sensor with no contact response).
4. **Engine:**
   - A portal look: a swirling ring or gate with the target site's favicon or hostname label floating above it. It must be readable at chase distance. Use a single instanced draw so the draw-call budget stays under 50.
   - Map view markers.
5. **Game:**
   - The confirm overlay "Travel to <label> (<host>)?". It pauses the timer and the keyboard or phone MENU cancels it.
   - On yes, go through the normal build progress screen, with SSE and the error fallbacks from `POST /api/stages`.
   - Carry the score and spares over.
   - A journey trail HUD (favicons or hosts).
   - The result and ranking show the journey, and there's a "Share my web journey" link: `/j/<base64url trail>` or a query param listing stage IDs. Ranking treats a journey as a run.
   - Offline or fixture stages: portals show "Needs the online service" when the API is unreachable.
6. **Tests:**
   - Builder determinism and golden updates.
   - Validation of portal invariants on all fixture stages.
   - A physics portal-event test.
   - A game E2E: roll into a portal, confirm, and the second site's maze loads. Use the local capture service on a fixture URL, or a mocked `/api/stages`.
7. **Screenshots** in `docs/build-log/assets/phase-13/`, reviewed by the agent: a portal close up, the confirm overlay, the journey trail, and the share card.

## Acceptance
- On the 7 fixture sites, portals appear on real link islands (Hacker News story links, Wikipedia links). Every stage still passes validation and the solver.
- The E2E journey works.
- `pnpm check` is green.
- Build log `docs/build-log/phase-13.md`.
