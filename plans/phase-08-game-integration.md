# Phase 08 — Game Integration: Shell, State Machine, HUD, Audio

**Wave:** 2 · **Depends on:** 03, 04, 05, 06 (07 for live URLs; the curated and fixture path works without it) · **Blocks:** G2 "First playable", 10, 12

## Goal
Wire the components into **the game**:
- title → pair → calibrate → select site → build → intro → play → result → ranking

It must feel polished and faithful: 3 balls, the original scoring, the timer, the map, and pause on disconnect. This phase owns the player's experience end to end.

## Read first
- `plans/00-overview.md`, `plans/contracts.md` (all)
- **`docs/reference/ux-flow.md` and `fidelity-spec.md`** (Phase 01). They define the screens and rules.
- The READMEs of `@wwm/engine`, `@wwm/physics`, `@wwm/net`, `@wwm/stage-builder`
- The `impeccable` skill for UI work

## Owns
`apps/web/**` **except** `apps/web/src/controller/**` and the `src/dev/*` sandboxes (which belong to their phases), `apps/web/src/i18n/**`, `apps/web/public/audio/**`

## Tasks
1. **Game state machine** (`src/game/machine.ts`): implement `GamePhase` from contracts §6 as an explicit state machine (XState or a hand-rolled typed reducer). Every transition is unit tested. Sync the state to the controller through `state` messages.
2. **Game loop:**
   - Fixed-rate input sampling → `Simulation` (worker) → interpolated `BallState` → `engine.setBall` → `engine.frame`.
   - Route `SimEvent`s to: the scoring rules, `engine.handleEvent`, audio, and controller haptics.
   - Pause the sim when the tab is hidden or the controller disconnects. Show a "Reconnect your phone" overlay with the pairing code.
3. **Rules (faithful defaults, from the fidelity spec):**
   - Score: small item `SMALL_SCORE`, large item `LARGE_SCORE`, `TIME_SCORE` × remaining seconds at the goal.
   - `NUM_BALLS` lives. A fall costs a ball and respawns at `restartAt` after a short splash delay. An extra ball every `ONEUP_SCORE` points while below the max.
   - Timer from `stage.timeLimitSec`. Time up → `timeup` → result.
   - Where the evidence is ambiguous, follow `fidelity-spec.md`'s chosen interpretation and label it in the About page data.
4. **Screens** (HTML/CSS overlays over the canvas, like the original):
   - **Title:** a live attract-mode background. Until Phase 09 lands, use a slow camera orbit of a curated stage; afterwards, a solver ghost playing it.
   - **Pairing:** Phase 06's component, plus "keyboard only".
   - **Calibrate:** mirrors the controller.
   - **Select:** a curated grid (from `/api/curated` or local fixtures) plus a **URL input**. Show the build progress screen from SSE with the step labels. Friendly failure screens per error code, each offering a curated alternative ("some sites can't be converted", faithful copy).
   - **Intro:** `engine.playIntro()`, with the site title and URL overlay.
   - **Countdown**, then **HUD**: score, balls, time, a large item counter (x/N), and a subtle RTT indicator when on phone.
   - **Map:** MENU/M toggles `engine.setView('map')` and pauses the timer (check against the fidelity spec: did the original pause?).
   - **GOAL / TIME IS UP** big CSS animations (faithful), then **Result:** a score breakdown with an animated tally and a "name entry" for the ranking (the ranking API arrives in Phase 10; stub it behind an interface).
5. **Routing:**
   - `/` = title.
   - `/play/:stageId` = direct play (a deep link with the shared stage).
   - `/p/:code` (optional convenience) = the host joining an existing room.
6. **Audio:** a small WebAudio manager with SFX for roll (pitch and volume by speed), item, large item, jump, land, bump, fall splash, elevator, goal fanfare, time warning and UI clicks, plus one music loop. Source royalty-free or generate the sounds. **No original assets.** Record the sources and licenses in `apps/web/public/audio/CREDITS.md`. Mute toggle, respecting autoplay rules.
7. **i18n:** i18next (faithful), `en` complete, `ja` complete for the core screens (a nod to the original's Japanese origin). All strings are externalized.
8. **Onboarding (first run only):** a short tutorial overlay on a tiny built-in stage covering "tilt while holding POWER", "JUMP", and "MENU = map" (faithful to the original tutorial). Persist completion in localStorage.
9. **Accessibility:** fully keyboard-playable menus, visible focus, `prefers-reduced-motion` (skip the intro swoop and reduce shake), non-color item cues (shape and glow pulse), and adjustable tilt sensitivity.
10. **E2E tests (Playwright):**
    - Keyboard-only full run on `handmade-simple` using the Phase 05 replay injected as the input source → reaches the result screen with the expected score.
    - Pairing flow with a simulated controller (a second browser context sending synthetic frames).
    - A build-failure path showing its fallback.

## Acceptance criteria (= gate G2, together with Phase 09)
- A human can go from title to result on **5 fixture-generated stages** with the keyboard, **and** with a physical phone (iOS Safari + Android Chrome). The orchestrator or user runs this; the agent provides the test script and a recorded keyboard run.
- The E2E suite is green. There are no console errors or warnings during a full run.
- Disconnect mid-play → the game pauses → reconnect → it resumes from the same state.
- `ja` and `en` switch at runtime. Lighthouse accessibility is at least 90 on the menus.
- Screenshots of every screen are in `docs/build-log/assets/phase-08/`.

## Out of scope
Leaderboard persistence, the history/About content (10), AI (11), and deployment (12).
