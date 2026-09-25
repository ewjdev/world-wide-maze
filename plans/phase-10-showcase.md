# Phase 10 — Showcase: History, Credits, Build Record, "How It's Made", Leaderboards, Sharing

**Wave:** 3 · **Depends on:** 08 (and 09 for ghosts, 03's debugger drawing module) · **Blocks:** G3, 12

## Goal
Deliver the *point* of the project: honor the 2013 creators, make the AI-assisted rebuild **inspectable**, and add the social layer (rankings, sharing, curated collection) that makes people play and share.

## Read first
- `research/world-wide-maze.md` (the credits table, timeline and caveats: **accuracy matters here**) and `research/recreation-plan.md` "Presentation of the finished work"
- `docs/reference/fidelity-spec.md` (evidenced, reconstructed and new labels)
- `docs/build-log/*` (all phases so far)
- The `impeccable` skill

## Owns
`apps/web/src/pages/about/**`, `apps/web/src/pages/making/**`, `apps/web/src/pages/log/**`, `apps/web/src/ranking/**`, `apps/worker/src/routes/scores.ts`, `apps/worker/src/routes/share.ts`, `apps/worker/migrations/*_scores.sql`, `apps/worker/migrations/*_curated.sql`, `content/**` (curated list and copy)

## Tasks
1. **About / History page (`/about`):**
   - Timeline and credits exactly as supported by the research: Google Japan, PARTY, AID-DCC, Katamari, FUTUREK, Saqoosha, and the KAISOKU TOKYO promo song credit, with source links.
   - Include the caveats: "not a complete list", and "this is a tribute, not a restoration".
   - A brief explanation of the original tech (PhantomJS → OpenCV/Boost → Three.js r53 / Physijs / Socket.IO) next to ours.
   - A table of what's **evidenced, reconstructed or new**, generated from `fidelity-spec.md`.
   - **No original art, audio or logos**, unless rights are cleared (flag this for the user).
2. **"How it's made" page (`/making/:stageId`):** an interactive, step-through view reusing `tools/stage-debugger/src/draw.ts`: screenshot → background mask → islands → bridges → carved maze → items and rails → 3D (an engine canvas). A slider scrubs through the steps. The historical comparison caption per step quotes the 2013 approach (short quotes with links).
3. **Build record (`/log`):**
   - Renders `docs/build-log/*.md`: per phase, the models and tools used, timelines, failed attempts, human interventions, test evidence and known defects.
   - Aggregate stats that are honest and sourced from the logs only (**no productivity multipliers**, per the research guidance).
   - Link to the repo if public.
4. **Leaderboards:**
   - D1 schema `scores(stage_id, name, score, time_ms, replay_key, created_at, ip_hash)`.
   - `POST /api/scores`: validate the name (length and a profanity filter), rate limit, and a plausibility check. `score` must be ≤ the theoretical max for the stage, and `time_ms` ≥ par × 0.5. If a replay is provided, verify it headlessly with `@wwm/physics` when CPU allows, otherwise mark it unverified.
   - `GET /api/scores/:stageId` returns the top 50.
   - Wire this into the Phase 08 Result and Ranking screens through the stubbed interface.
5. **Ghosts:** "Race the bot" (the Phase 09 solver replay) and "Race the #1 run" (a stored replay) as a translucent ghost ball in the engine. Coordinate with the engine API. If a new engine method is needed, file a Contract Change Request or engine follow-up rather than editing `packages/engine`.
6. **Curated collection:**
   - 12 or more stages from sites with clear permission or permissive terms (the user should confirm the list: **output a proposal file `content/curated-proposal.md` for approval**).
   - Stored in the `curated` D1 table, with a thumbnail rendered from the engine (an OG image), and prebuilt so they work even if capture is down (the preservation goal).
   - An exportable "offline pack" (`stage.json` + texture) per curated stage.
7. **Sharing:**
   - `/s/:stageId` has an OG/Twitter card image of that site's maze (pre-rendered hero shot stored in R2) and a "Beat my score" link with a score param.
   - Web Share API on mobile.
8. **Daily Maze (stretch):** one curated stage per day with a global board.

## Acceptance criteria (= gate G3)
- The orchestrator cross-checks every credit and date on `/about` against `research/world-wide-maze.md`, with zero unsupported claims.
- `/making` works for any fixture stage. `/log` renders all existing build logs.
- The scores API is tested: validation, rate limiting, top-N ordering, and plausibility rejection.
- The ghost race works on at least 1 curated stage.
- `content/curated-proposal.md` has been delivered for user approval. After approval, 12 or more curated stages are built, validated and solved.
- Share cards render correctly in a card validator (a screenshot of the OG image).

## Out of scope
The AI remix (11) and infrastructure hardening (12).


---

## G0 updates (2026-09-25). Where these conflict with the text above, these win.
Sources: `docs/reference/fidelity-spec.md` (E = evidenced from the 2013 build) and contracts v0.2.0.

- **Ranking (E + N):**
  - A **global run board** of session totals. This is what 2013 had: a top 10 with the name as `[a-z0-9_]`, and skip = not submitted. Ours shows the top 50.
  - **Plus per-stage boards** (N).
  - Use the v0.2 `/api/scores` shapes.
- **Curated collection:** items are **runs** (a page's slices), each with difficulty stars from Phase 09.
- **About page facts:** use the fidelity spec's E/R/N labels. Note the evidence correction: the WWMMM fixture has 501 small and 4 large items, not 1503 and 12.
