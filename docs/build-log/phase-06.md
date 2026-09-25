# Phase 06: Controller, pairing and input (build log)

- **Agent:** Claude Opus 5.5 (1M context), running as a Claude Code sub-agent in an isolated git worktree (branch `worktree-agent-af29d5753726ca798`).
- **Time:** 2026-09-25, about 08:05Z to 08:45Z.
- **Instructions received:** the Phase 06 brief with its G0 updates (15 s calibration, per-axis tilt limits, any arrow = POWER), contracts v0.2.1 §6/§7, ux-flow, and fidelity-spec §1/§8. Local dev only: no Cloudflare resources, no deploy. Verify with automated tests and a simulated phone. Write a device-test script for the attached iPhone. Leave no tunnel running.

## What was built
- **Room Durable Object** (`apps/worker/src/room.ts`, routes in `apps/worker/src/routes/rooms.ts`, and one registration line in `src/index.ts`):
  - It uses the Hibernation API with one socket per role. A newcomer replaces the old socket, which gets close 4409 "replaced". An unknown or expired room gets close 4404, a bad role 4400.
  - Frames are relayed verbatim and `peer` notices go to both sides.
  - Alarm-driven keepalive pings (negative ids) every 5 s measure per-role RTT, which is logged.
  - Codes expire after 30 min idle. `POST /api/rooms` picks random codes from 100000–999999 and retries on collision (12 tries, then 503).
  - `GET /api/rooms/:code/stats` returns relay diagnostics for remote verification.
- **`@wwm/net`:**
  - `HostConnection` / `ControllerConnection`: backoff reconnect, `reconnectIfSilent` for phone unlock, ping/pong RTT, zod-validated JSON, and binary input with backpressure.
  - The One Euro filter, `RttTracker`, `StreamStats` (rate, jitter, loss, bursts), and the tilt pipeline with calibration and "Too tilted!".
  - The `InputSource` interface with phone, keyboard, gamepad and touch implementations.
- **Phone page `/c/:code`** (`apps/web/src/controller/`):
  - The flow is connect, **Enable tilt** (iOS `requestPermission`), calibrate ("match the dots", 15 s timeout, keyboard hint on failure), then play.
  - Play has MENU at the top, JUMP for the left thumb, a big POWER hold for the right thumb, a live indicator and "Too tilted!".
  - Also: RTT and status, the host's TIME/SCORE/BALLS HUD, wake lock, haptics (`navigator.vibrate`, plus a best-effort iOS 18 switch tick), a portrait advisory banner, a code-entry screen for bad codes, and a `?debug` panel.
  - `window.__wwmController.diag()` is exposed for inspection.
- **Host pieces for Phase 08:** `PairingPanel` (QR via `uqr`, big code, copy link, live connected state, "No smartphone? Play with PC only"), plus `useHostRoom` / `openHostRoom`.
- **`/dev/input` sandbox:** pairs a phone and graphs raw vs filtered tilt. It shows RTT p50/p95, receive rate, inter-arrival p50/p95, jitter, bursts, loss and filter lag, and samples all four sources side by side. It has buttons to send haptic/state messages and live One Euro sliders, and exposes `window.__wwmInput.summary()`.
- **Shared-file edits (kept tiny):**
  - `apps/web/src/routes.tsx`: 2 imports, 2 routes, and the stub `Controller` removed.
  - `apps/web/vite.config.ts`: `allowedHosts` for `*.trycloudflare.com`, and a `WWM_API_URL` proxy override.
  - Package deps: `@wwm/net` for web and worker, `uqr` and a `playwright` devDep for web.

## Design decisions (fidelity labels)
- **Tilt math (N):** gravity comes from beta/gamma, so alpha and compass drift are ignored. It's rotated by `screen.orientation.angle`. Tilt is the pitch about screen x, then the roll about y, that carries the stored zero gravity onto the current one, solved in closed form. The first attempt flattened gravity with a shortest-arc quaternion. A unit test caught that it reads only about 7° when a phone held at 45° rolls 10° about its long axis, so it was replaced. The zero is stored in the device frame, so a screen rotation doesn't break it.
- **Calibration (E flow, R detail):** the dots guide the player toward the 2013 neutral (45° toward the player). Success is the held pose staying within 2° for 700 ms, inside 40° of that neutral. The zero is the held pose, and there's a manual "Use this position" button. The zero persists in `sessionStorage`, so calibration happens once per session (first game only, E) and survives a lock or reload.
- **"Too tilted!" (R):** it shows beyond the clamp limit, which is half the indicator ring (the 2013 "45 of 90 px"). It hides 500 ms after returning (E).
- **Grip (R, open question):** 2013 used gamma for pitch with a portrait lock. That hints the phone was held *sideways* (gamepad grip) while the UI stayed portrait-locked. The mobile bundle is lost. We use a portrait tray grip with orientation normalization, so a landscape grip also works if the OS rotates. Flagged for the device session.
- **Keepalive and Nagle (N):** 2013 needed 50 ms filler packets. Modern browsers set TCP_NODELAY, so the relay pings every 5 s and `StreamStats.bursts` measures delivery gaps. See the device script for when to lower the interval.
- **Locked-phone detection (N):** iOS can keep a suspended page's TCP socket open, so no `peer` disconnect arrives. The phone sends neutral 4 Hz keepalive frames while visible but not playing, and `PhoneInputSource` emits `disconnected` after 1.5 s without frames. That lets Phase 08 auto-pause, and the next frame brings `connected` back.
- **Room codes (N):** no leading zero, so they read and type cleanly.

## Attempts that failed, and why
- `@cloudflare/vitest-pool-workers@0.22` has a peer dependency on Vitest 4, and the repo uses Vitest 5. Instead, the DO tests boot the real Worker and DO in workerd through `wrangler`'s `unstable_startWorker` and drive them over real WebSockets from Node (`apps/worker/test/room.test.ts`, 8 tests). Test-only bindings shorten the idle expiry and keepalive.
- Port 8787 was held by another agent's `wrangler dev` (it answered with contract 0.1.0). I used 8806 and 5186 locally, which is why the `WWM_API_URL` override exists.
- A replaced socket's `close` event arrives about 2 s late in Chromium and about 30 s late in Node's undici, because `wrangler dev` doesn't drop the TCP connection after the close handshake. The relay itself sends 4409 immediately (verified in the DO log). The test asserts `readyState` instead of waiting.
- `setPointerCapture` threw on synthetic pointers in the e2e run. The button press now registers first and the capture call is wrapped in try/catch.
- Biome flagged `useThisPosition()` as a React hook call, so the method was renamed `calibrateHere()`.

## Test evidence
- `pnpm check`: green (typecheck, Biome, Vitest). Phase 06 adds 48 `@wwm/net` tests, 12 worker tests (8 DO integration + 4 route) and 9 controller-session tests.
- The DO integration suite covers:
  - distinct codes
  - binary and JSON relay both ways, with peer notices
  - replacement (4409, and the host sees no disconnect)
  - 4404 / 4400 / 400 / 405
  - host reconnect with the same code
  - stats (frames, seq loss, button presses, calibrated)
  - keepalive RTT for both roles (relay pongs aren't forwarded)
  - idle expiry freeing the code
- **Browser e2e** (`apps/web/test/controller.e2e.test.ts`, Playwright, emulated iPhone 15 Pro with iOS `requestPermission` stubbed and synthetic 60 Hz `deviceorientation`): 10/10 passed against local `vite` + `wrangler dev`, and **10/10 again through a real `cloudflared` HTTPS quick tunnel** (the exact device path). It covers:
  - the QR encodes `/c/<code>`, and the phone connects
  - enable, calibrate, play, with host `calibrated` = 1
  - stream over 40/s with RTT
  - POWER/JUMP/MENU presses = 1/1/1
  - tilt of 10° forward and 8° right reads back as roll 7.x–8.x° and pitch 9.x–10.x° with jitter
  - a 35° roll clamps to 20.0° and shows "Too tilted!"
  - hidden page, then host stale and `disconnected`, then visible and fresh again
  - reload keeps calibration
  - host closes, phone shows the waiting state, host reopens with the same code, phone recovers
  - denied permission, fallback text, and unknown code, code entry
  - zero page errors

  Screenshots were checked by eye (play, too tilted, host left, denied, pairing panel). Regenerate them with `WWM_E2E_SHOTS=<dir>`.
- **Tunnel measurement:** a 15 s simulated session, both browsers on this Mac, going through the Cloudflare edge to the tunnel, then Vite, then `wrangler dev`.

  | Measure | Value |
  |---|---|
  | End-to-end RTT host↔phone | p50 45 ms, p95 114 ms (n=16) |
  | Relay↔client RTT | p50 25 ms, p95 29–30 ms |
  | Phone send | 60/s, interval p95 17.5 ms, jitter 1.5 ms |
  | Host receive | 63/s, interval p50 16 ms, p95 27 ms, jitter 14 ms |
  | Bursts | 29 in 15 s (the tunnel path; recheck on device) |
  | Frames lost | 0 |
  | Filter lag | ≈ 69 ms during motion (τ at rest is 159 ms) |

## Manual human interventions
None. The physical iPhone session is **pending**: `docs/build-log/phase-06-device-test.md` is the script for the orchestrator and user. The agent didn't launch anything on the phone, and no tunnel or dev server is left running.

## Remaining defects and follow-ups
- Physical iPhone verification is pending, covering permission, calibration feel, lock and unlock, and real RTT and bursts. Android is pending (no device).
- iOS haptics: there's no Vibration API, and the switch-tick fallback is unverified on a device.
- The grip question (portrait tray vs sideways gamepad grip) needs a human to judge it on the device.
- Strings live in `apps/web/src/controller/strings.ts` (en + ja) until Phase 08 creates `apps/web/src/i18n`.
- `/api/rooms/:code/stats` is unauthenticated. It shows aggregates only, but Phase 12 should gate it or strip it for production.
