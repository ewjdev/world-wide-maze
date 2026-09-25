# Phase 08 playtest script (gate G2 "First playable")

The agent can't tilt a phone. Everything below was checked with the keyboard, an injected replay and an emulated
iPhone in Playwright (see [phase-08.md](phase-08.md)). This script is for the orchestrator to run with the user.
The **Human** columns are all the user needs to see. About 25 minutes.

## A. Orchestrator setup (Mac, repo root, after merge)
1. `pnpm i`, then `pnpm --filter @wwm/worker db:migrate:local`.
2. Worker: `pnpm --filter @wwm/worker exec wrangler dev --port 8806` (any free port; 8787 may be taken).
3. Web: `WWM_API_URL=http://localhost:8806 pnpm --filter @wwm/web dev --port 5199`.
4. Tunnel (the phone part only; iOS grants motion access over HTTPS only):
   `/opt/homebrew/bin/cloudflared tunnel --url http://localhost:5199`. Call the URL `T`.
5. On the Mac, open **`T/`** in Chrome, full screen (⌃⌘F). Sound on.
   - Fresh start: DevTools → Application → Local storage → clear, so the how-to and the tutorial show.
6. Helpers for the operator (DevTools console on the Mac):
   - `__wwmGame.debugState()`: phase, timer, score, spares, ball position, fps/draw calls.
   - `__wwmGame.debugSetTimeLeft(35)`: jump to the last-30-seconds music and the TIME IS UP path.
   - The phone's relay stats: `curl -s T/api/rooms/<code>/stats | jq`.

The 5 fixture sites (built in the browser, no capture service needed): **Hacker News** (1 stage),
**Labyrinth – Wikipedia** (4), **GOV.UK** (3), **BBC News** (4), **MDN** (3). Play at least slice 1 of each.

## B. Keyboard (about 10 minutes)
| # | Human: do this | You should see / hear |
|---|---|---|
| 1 | Wait on the title for 10 s | A website-maze slowly orbiting behind the big WORLD WIDE MAZE logo. Nothing flickers |
| 2 | Click **Start** | "How to play" with 4 illustrated steps (first visit only). Click **Let's go** |
| 3 | Click **No smartphone? Play with PC only** | "Choose a site…" with the practice site and 7 saved sites |
| 4 | Click **Hacker News** | "Transforming…" with a progress bar, then the page standing upright and folding into islands (about 16 s). Press Space to skip if you like |
| 5 | Follow the tutorial text | "This is your starting position", then "Control the ball with the arrow keys", "Hit space bar to jump", "Press M to view the map", "Now head for the goal!" |
| 6 | Arrows to roll, Space to jump | The ball rolls only while an arrow is held (it brakes when you let go). TIME counts down from 300 once you first move |
| 7 | Roll over the teal items; find a big crystal | SCORE +1 per small item (a beat later), +100 per big crystal; the crystal slots under SCORE fill |
| 8 | Press **M** | The map: the whole stage orbits, a "YOU" marker over the ball, the timer stops. Press M again (or **Back to the game**) |
| 9 | Jump over a rail and fall off | The ball drops, splashes into the pastel sea, a LIFE icon empties, 3 s later it's dropped back in a cage at the island you last touched. TIME resets to 300 (faithful, 2013) |
| 10 | Reach the goal (the tall wire vase with the site title) | The ball is sucked in and rockets up, fireworks, a tile curtain and **GOAL**, then the result: time left × 5, big × 100, small × 1, a count-up with ticks |
| 11 | Click **Finish**, type a name, **Submit** | The ranking with your rank and the top-10 table |
| 12 | Repeat 3–10 on **Wikipedia**, **GOV.UK**, **BBC News** and **MDN** (Start → site). Use **Next stage** on one of them | "Stage 2 of 4": the next slice of the same page, score and lives carried over |
| 13 | On any stage: M → **Quit to title** → **Yes** | Back to the title. Also try **Retry this stage** once |
| 14 | Switch to **日本語** (top right) on the title, then back | Every menu string is Japanese; switch back to English |

Record per site: reached the goal? (y/n) · time left · anything confusing · any stutter.

## C. iPhone (Safari, about 10 minutes)
| # | Human: do this | You should see |
|---|---|---|
| 1 | Mac: title → **Start** (skip the how-to). The Mac shows "Connect to World Wide Maze" with a 6-digit code and a QR | |
| 2 | Scan the QR with the iPhone camera, open the link | Phone: **Enable tilt**. Mac: "Connected!", then "Tilting the phone, match the dots" |
| 3 | Tap **Enable tilt** → **Allow**; hold the phone tilted toward you and keep still | The phone's ring fills; the Mac moves on to "Choose a site…" by itself |
| 4 | Pick **Hacker News**; after the intro, follow the tutorial on the Mac | "Press and hold POWER and tilt…", then JUMP, then MENU. The Mac's bottom-left ring follows your tilt; tilting hard shows "Too tilted!" |
| 5 | Hold **POWER** and tilt to roll; **JUMP**; **MENU** | Rolling only while POWER is held; JUMP hops; MENU opens the map on the Mac (MENU again returns). The phone shows TIME / SCORE / BALLS. Say whether you feel a tick on item pickups |
| 6 | **Lock/unlock check (not verified in Phase 06):** mid-play, press the side button to lock the phone. Wait 10 s. Unlock (Safari still on the page) | Within ~2 s of locking, the Mac freezes with **Reconnect your phone** and the code; the timer stops. After unlocking, the overlay disappears within ~2 s and play continues from exactly where it stopped, **without** recalibrating |
| 7 | Lock again, and this time click **Continue with the keyboard** on the Mac | Play continues with the arrow keys |
| 8 | Play two more sites to the goal with the phone (e.g. GOV.UK and MDN) | As in B.10 |
| 9 | Optional: put the phone down flat for 20 s during play | Nothing happens without POWER (the ball stays put) |

Record: did 6 match (overlay on lock, resume on unlock)? Tilt feel (too sensitive or too sluggish? On a menu screen, the sliders button at the top right has
"Tilt sensitivity"; note the value you like). Latency feel (the Mac's HUD shows the link
latency next to the tilt ring). Any moment the ball did something you didn't ask for.

## D. What the orchestrator records in phase-08.md (Results section)
- Per site × input: goal reached, time left, falls, notes.
- The lock/unlock result (C.6) and the relay stats JSON after the session.
- `__wwmGame.debugState().engine` on the Mac once during play (fps, tier, draw calls).
- Console: any error or warning in the Mac or phone console (the phone's `WebSocket is closed before the
  connection is established` in **dev** is React StrictMode's double mount; it does not happen in a production
  build).
- Android Chrome: repeat C if a device is available (no permission prompt; haptics should buzz).
- Stop the tunnel and the dev servers.
