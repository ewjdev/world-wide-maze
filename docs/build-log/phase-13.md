# Build log: Phase 13 (Link portals: "roll across the web")

- **Agent:** Claude Opus 5.5 (1M context), run as a Claude Code sub-agent in an isolated git worktree
  (branch `worktree-agent-a43d91a043a2afc0d`), in parallel with Phases 14, 15 and 16.
- **Start / end:** 2026-09-25 ~09:58 → ~10:45 PDT.
- **Environment:** macOS, Node 26.0.0, pnpm 11.5, Vite 8.3, wrangler (local `wrangler dev` on :8797 with local
  Browser Run), Playwright Chromium. My own servers ran on :5391, :5392 and :8797; nothing on :5173/:8787 was touched.
- **Label:** N (new; not in 2013).

## Instructions received (summary)
Execute `plans/phase-13-link-portals.md` against contracts §10.1 (v0.3.0 types already in `@wwm/schema`; no schema
changes). No deploy, no Cloudflare resources, no push. Stay inside the owned paths; keep `GameApp.tsx` /
`routes.tsx` edits minimal. The portals are the showcase moment for a LinkedIn video: use the `impeccable` skill for
the UI, make the journey feel magical, `pnpm check` green, screenshots reviewed, hand-off report.

## What was built
**Capture (`packages/capture-script`).** `extractPage` records `href` on `link` elements (and buttons wrapped in
`<a>`): absolute, http(s), no credentials, ≤ 2048 chars, normalized exactly like `normalizeUrl` (inlined, since
the function runs in the page); same-page anchors and other schemes dropped. Browser test on a synthetic page.

**Legacy fixtures.** The 7 Phase 02 captures predate `href`. Rather than recapture them (every screenshot and golden
would change, and `fixtures/captures` isn't mine), `scripts/resolve-fixture-links.ts` recovered targets into
sidecars `fixtures/builder/links/<slug>.json`: the live page re-extracted and matched by link text (nearest rect for
repeated texts; never for repeated texts on Hacker News, whose rows reorder), plus rotated-off HN stories by exact
title through the HN Algolia API. Result (links recovered): HN 57 live + 16 via Algolia (the story titles), Wikipedia 105, GOV.UK 76, MDN 105, Commons 199, BBC 34, example.com 1. `applyLinkTargets` merges a
sidecar only into the capture it was made for (checked by `captureId`).

**Builder (`packages/stage-builder`, 0.4.0 → 0.5.0).** Step 10c `portals.ts`: rank link candidates (junk/chrome/
counter labels, files and wiki meta pages dropped; off-site first, then label quality and type size, seeded
tie-break; unique href and label; repeated hosts penalized), then place each on the island under the link, nearest
the link text, on ground the ball can roll to (the 03b walkable raster after the reachability audit), clear of the
edge, start, goal, mouths, large items and other portals. Small items inside a portal ring are removed. Every
stage carries `portals`. Goldens regenerated.

**Physics.** A geometric portal sensor (no collider, so Rapier state and replays are untouched;
`PHYSICS_VERSION` stays 0.2.0): fires `{type:'portal'}` on entering, re-arms after leaving, never fires for a ball
placed onto it, not while falling or after the goal.

**Engine (additive).** `world/portals.ts`: one InstancedMesh (one draw call) of billboarded gates: a log-spiral
vortex with a white-hot eye, rim, halo, breathing ground ring, a label card (monogram "favicon", link text on up to
two lines, host), map-view beams and enlarged labels. `setPortalState`, `playPortal` (the ball spirals in and
shrinks, the gate surges, the camera glides in, sparks), the `portal` event pulse, `spawnBall({faceTo})`.
Measured in the game on HN with 6 portals: **46 draw calls** (scene 20, env 12, post 14), 60 fps.

**Game (`apps/web/src/game`, `ui`).** Portal prompt "Travel to <label>?" with the host, pausing sim and timer;
Travel (Enter/Y/JUMP) / Stay (Esc/M/MENU/N). Travel banks the stage (items only, `exit: 'portal'`), keeps score and
spares, starts `POST /api/stages` during the gate animation, then the usual build screen ("Rolling to <host>",
with the trail), SSE progress and error fallbacks. Links to offline fixture pages build in the browser. `/api/health`
probe → offline gates are grey and the prompt says "Needs the online service". Journey trail in the HUD, building
screen, result and ranking; "Share my web journey" → `/j/<base64url>`; the `/j/:trail` page is a light share card
(no renderer) with a play link per stop. Strings en + ja in `ui/journey-strings.ts`, registered at runtime.

## Screenshots (reviewed) — `docs/build-log/assets/phase-13/`
`portal-approach.jpg` (close-up at chase distance), `portal-prompt.jpg` (confirm), `portal-offline.jpg`,
`portal-map.jpg`, `travel-gate.jpg`, `travel-iris.jpg`, `travel-building.jpg`, `journey-hud.jpg` (on grantland.com
after a real local capture), `journey-result.jpg`, `journey-ranking.jpg`, `journey-share-card.jpg`,
`journey-share-card-phone.jpg`. The travel shots are a real journey: HN fixture → portal "The Board Game of the
Alpha Nerds (2014)" → local `wrangler dev` captured grantland.com → its maze, with its own portals.

## Attempts that failed and why
- First resolver pass matched repeated HN texts ("hide", "2 hours ago") by position: the rows had reordered, so the
  targets were other stories. Repeated texts are no longer matched on HN.
- The engine sandbox can't show builder goldens (their `texture.path` is empty), so screenshots come from the real
  game via `debugRollIntoPortal` (real physics) instead.
- The first gate had a red eye and red arcs. Cause: `NodeMaterial` adds `emissiveNode` to the output colour, and the
  composite screen-blends bloom as `colour + bloom × (1 − colour)`, so over-white pixels subtracted the teal bloom.
  An opacity above 1 made it worse. Fixed by clamping opacity and carving the glow out of the shown colour.
- Labels truncated long story titles; they now wrap to two lines.
- The HUD trail at top centre collided with the floating label cards; it moved to the bottom right.

## Manual human interventions
None.

## Test evidence
- `pnpm check`: typecheck, lint, **760 tests passed**, 13 skipped (environment-gated suites, e.g. ones needing `WWM_E2E_BASE`).
- New: capture-script link targets (browser); builder `test/portals.test.ts` (synthetic placement, ranking,
  helpers, `applyLinkTargets`, all 7 fixtures × every slice × 3 difficulties keep §10.1 invariants on link islands,
  HN portals all off-site, ≥ 3 Wikipedia article portals per slice); physics `test/portal.test.ts` (fires once,
  re-arms, placement doesn't fire, bit-identical trajectories with and without portals); solver
  `test/portals.test.ts` (a portal on the route changes nothing; every slice of the 7 fixtures still solves);
  web `test/journey.test.ts` and the machine `TRAVEL` edge; `test/portal.e2e.test.ts` (Chromium: roll in → prompt,
  sim paused → stay → re-arm → travel → mocked `POST /api/stages` + SSE → second site loads, score and spares
  carried, trail + share link → `/j/` card without three.js; and the offline prompt).
- Every fixture stage still passes `validateStage` (fixture matrix) and the solver.

## Remaining defects / follow-ups
- The `/j/` share card has no server-rendered Open Graph image; link unfurls show the generic page. A Worker route
  like `/s/:id` would fix it (Phase 10/12 territory).
- The eval-* captures have no link sidecars (no portals); the batch eval report was not regenerated.
- `fixtures/builder/links/*.json` could be folded into `fixtures/captures/*/capture.json` by the orchestrator (or
  the fixtures recaptured) to drop the sidecar mechanism.
- The phone controller shows the normal play UI during the prompt (JUMP/MENU work; no special phone screen).
- The time bonus is forfeited on a portal exit; a "travel bonus" is a design choice left open.
