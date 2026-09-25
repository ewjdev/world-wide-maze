# Phase 06: physical device test script (iPhone now, Android pending)

The agent couldn't tilt or tap a phone. Everything below has been checked with an emulated iPhone in Playwright, including over a real `cloudflared` HTTPS tunnel (see phase-06.md). This script is for the orchestrator to run with the user. The **Human** column is the only part the user needs to see.

## A. Orchestrator setup (Mac, repo root, after merge)
1. `pnpm i`
2. Worker: `pnpm --filter @wwm/worker dev` (http://localhost:8787).
   If 8787 is taken, run `pnpm --filter @wwm/worker exec wrangler dev --port 8806` and prefix step 3 with `WWM_API_URL=http://localhost:8806`.
3. Web: `pnpm --filter @wwm/web dev` (http://localhost:5173, which proxies `/api` and its WebSockets to the worker).
4. Tunnel: `/opt/homebrew/bin/cloudflared tunnel --url http://localhost:5173`. Note the `https://<name>.trycloudflare.com` URL; call it `T`. iOS only grants motion access over HTTPS, so the tunnel is required.
5. On the Mac, open `T/dev/input` (the input sandbox, which acts as the host). Note the 6-digit code `C`. The QR code already encodes `T/c/C`.
6. Get the phone onto the page, either way:
   - the user scans the QR on the Mac screen with the iPhone Camera and taps the link, or
   - `xcrun devicectl device process launch --device 00008150-000E3CC80ADA401C --payload-url "T/c/C?debug" com.apple.mobilesafari`. `?debug` adds a small diagnostics panel at the bottom of the phone screen.
7. Watch remotely while the user works through part B:
   - `curl -s T/api/rooms/C/stats | jq`: relay RTT per role, input rate, jitter, bursts, lost frames, button presses, `calibrated` count, event log.
   - The worker terminal: `[room C] …` lines (connect, calibrated, keepalive RTT every 5 s, close codes).
   - The sandbox page: live graphs and stats. In DevTools run `JSON.stringify(__wwmInput.summary())`, or click "Log session summary".

## B. Human steps (iPhone, Safari; takes about 5 minutes)
| # | Do this | You should see |
|---|---|---|
| 1 | Open the link (scan the QR on the Mac screen, or it opens by itself) | A dark page with **Enable tilt**. At the top right: a green dot and "Code C". The Mac shows **Connected!** |
| 2 | Tap **Enable tilt**, then tap **Allow** on the iOS motion prompt | "Tilting the phone, match the dots": a ring with three coloured dots and a countdown from 15 |
| 3 | Hold the phone in both hands, screen toward you, tilted back about 45° (like reading), and keep it still for a second | A green arc fills, then the controller appears: **MENU** at the top, **JUMP** bottom left, big **POWER** bottom right |
| 4 | Slowly tip the top of the phone away from you, then toward you, then roll it left and right | The white ring on the phone follows your tilt. The orange and blue lines on the Mac graph move with it |
| 5 | Tilt hard to one side | Red **Too tilted!** on the phone. It clears about half a second after you straighten up |
| 6 | Hold **POWER** for 2 seconds. Tap **JUMP** once. Tap **MENU** once | The Mac row "presses POWER / JUMP / MENU" goes up by 1 each. The Mac event log shows "phone: POWER down", "phone: JUMP", "phone: MENU" |
| 7 | (Mac operator clicks "state: play (+100)" and "haptic goal") | A TIME / SCORE / BALLS bar appears on the phone. Say whether you felt a buzz (iPhone has no web vibration; a haptic tick is best effort) |
| 8 | Press the side button to lock the phone. Wait 10 seconds. Unlock it (Safari is still on the page) | While the phone is locked, the Mac log shows "phone: disconnected" within about 2 s (Phase 08 will auto-pause here). After you unlock, the dot is green again within about 2 s, the log shows "phone: connected", and the controller works **without** recalibrating |
| 9 | Tap **Recalibrate**, then keep moving the phone around for 15 seconds | "Couldn’t read a steady position." plus the keyboard hint and **Try again**. Tap **Try again** and hold still to recover |
| 10 | Turn off rotation lock and turn the phone sideways | A yellow banner: "Lock smartphone to portrait orientation". Tilt keeps working. Turn it back upright |
| 11 | (Optional, last. It needs a Safari restart afterward.) The operator starts a **new** tunnel so the origin is new. Open that link, tap **Enable tilt**, then tap **Don’t Allow** | "Motion access was denied…" with **Try again**. To recover: swipe Safari away in the app switcher and reopen |

## C. What to record in the build log (orchestrator)
- The `stats` JSON after step 6: `rtt.host/controller` p50/p95 (the relay), `input.ratePerSec`, `jitterMs`, `bursts`, `lost`, `buttonPresses`, `counts.calibrated`.
- The sandbox summary: `rttHostToPhone` p50/p95 (end-to-end, phone ↔ Mac through the tunnel), `receive.intervalP50/P95`, `phone.filterLagMs`.
- Did steps 1–10 match? Note anything that didn't, with a screenshot (`xcrun devicectl` can't capture screenshots on iOS 17+, so the user takes one with side + volume up).
- The Nagle check: iOS sends at 60 Hz. `bursts` counts gaps over 3× the median interval. If `intervalP95` is ≥ 100 ms or bursts come in 500 ms clumps, lower `KEEPALIVE_MS` in `apps/worker/src/room.ts` (the 2013 fix was relay pings every ~50 ms).
- Close the tunnel (Ctrl-C) when you're done.

## Android (Chrome): PENDING
No Android device is available. When one is: repeat part B. Android doesn't show the permission prompt in step 2, and Chrome also enters fullscreen and locks portrait on the **Enable tilt** tap. Haptics use `navigator.vibrate`, so step 7 should buzz. Step 11 doesn't apply.
