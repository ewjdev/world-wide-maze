# Phase 06 — Controller, Pairing & Input (packages/net, Room DO, phone page)

**Wave:** 1 · **Depends on:** 02 · **Blocks:** 08

## Goal
Make the phone feel like a physical extension of the game. That means:
- 6-digit pairing through a QR code or link (the modern successor to Tab Sync)
- a permission and calibration flow that works on iOS Safari and Android Chrome
- a low-latency tilt stream with filtering
- POWER, JUMP and MENU buttons, plus haptics
- keyboard and gamepad as first-class alternatives

All of it goes behind one `InputSource` abstraction.

## Read first
- `plans/contracts.md` §6, §7 (the rooms rows)
- `RESEARCH.md` Part 1.3 "Controller and networking" (Nagle, EMA, calibration timeout) and Part 4.5
- `docs/reference/ux-flow.md` (Phase 01) for the exact original onboarding copy and states

## Owns
`packages/net/**`, `apps/worker/src/room.ts` (the Durable Object, plus its route registration in `apps/worker/src/routes/rooms.ts`), `apps/web/src/controller/**` (the `/c/:code` page), `apps/web/src/dev/input-sandbox.tsx`

## Tasks
1. **Room Durable Object (`Room`):**
   - `POST /api/rooms` → allocate an unused 6-digit code (retry on collision; codes expire after 30 min idle).
   - The WS endpoint takes `role=host|controller`, with at most 1 host and 1 controller (a new controller replaces the old one, with notice).
   - It relays binary and text frames verbatim between the peers, and sends `peer` notifications.
   - Use the WebSocket Hibernation API.
   - It sends server-side keepalive pings (the lesson of the original's Nagle workaround) and measures and logs RTT.
2. **`@wwm/net` client lib:**
   - `HostConnection` / `ControllerConnection` with auto-reconnect (exponential backoff) and a typed event emitter.
   - Use `encodeInput` and `decodeInput` from `@wwm/schema`, plus a ping/pong RTT tracker (p50/p95).
3. **Tilt pipeline (controller side):**
   - `DeviceOrientationEvent.requestPermission()` on a user-gesture "Enable tilt" button (iOS), with graceful handling of denial.
   - Normalize for `screen.orientation.angle`. Portrait lock is faithful: ask the user to lock, and detect rotation.
   - Convert to radians, and apply calibration (hold flat → tap → store the zero quaternion). Use quaternions or rotation matrices rather than raw Euler subtraction to avoid gimbal issues.
   - Send at 60 Hz with `requestAnimationFrame` while visible.
4. **Host-side filtering:**
   - A **One Euro filter** on tilt (the modern successor to the original's EMA). Tunable, with the defaults documented.
   - Stale input (older than 250 ms) → neutral.
   - Loss of connection → emit `disconnected`, so Phase 08 pauses the game.
5. **Controller UI (`/c/:code`):**
   - Full-screen and portrait. A large **POWER** hold button (thumb zone), a **JUMP** button, and a **MENU** button (map).
   - A live tilt indicator and connection/RTT status. Show score, balls and time from the host's `state` messages.
   - `navigator.wakeLock` for the screen. Haptics through `navigator.vibrate` on `haptic` messages (where supported).
   - Calibration screen with a **10 s timeout**. On failure, offer "Play with keyboard on your computer" (faithful to the original fallback).
6. **`InputSource` abstraction** (in `@wwm/net`), used by Phase 08:
   ```ts
   interface InputSource { readonly kind: 'phone'|'keyboard'|'gamepad'|'touch'; sample(nowMs: number): InputSample; on(evt: 'menu'|'disconnected'|'connected', cb): Unsubscribe; dispose(): void }
   ```
   Implement all four:
   - **Phone:** filtered network input.
   - **Keyboard:** arrows or WASD mapped to a smoothed virtual tilt, Shift or auto-power, Space = jump, M = map. The original used arrows, space and M.
   - **Gamepad:** left stick = tilt, A = jump, RT = power, Start = map.
   - **Touch:** an on-screen virtual stick for single-device play.
7. **Pairing UI component** for the host, exported for Phase 08:
   - A QR code (a tiny QR lib) for `https://<host>/c/<code>`, the 6-digit code in big type, a copyable link, and live "controller connected" state.
   - A "Play with keyboard instead" option.
8. **Latency instrumentation:** a dev overlay showing RTT p50/p95, send rate, receive jitter, and filter lag. Log a session summary for the Phase 12 measurements.
9. **Input sandbox** `/dev/input`: pair a phone, visualize raw vs filtered tilt as graphs, the buttons, and RTT.

## Test device
The user has a **physical iPhone 17 Pro connected to this Mac by USB** (`xcrun devicectl list devices` → "Eric's iPhone"). Use it for real-device tests. You can open URLs and read logs from the Mac, but **tilting and tapping need the user**: write a short step list for the orchestrator to relay to them, and have the page log its results to the relay/console so you can verify them remotely. There's no Android device yet, so flag Android as pending.

## Acceptance criteria
- Unit tests: codec round-trip, the stale-input rule, the One Euro filter response, room code allocation and collision, and relay routing (DO tested with Miniflare/Vitest pool workers).
- On **physical iPhone (Safari) and Android (Chrome)**, both through `wrangler dev` exposed over HTTPS (e.g. `cloudflared` tunnel):
  - Permission, calibration and tilt stream work.
  - POWER, JUMP and MENU arrive.
  - Reconnect after locking and unlocking the phone works.

  Record videos or screenshots and the RTT numbers in the build log. If no physical device is available to the agent, write a precise manual test script (`docs/build-log/phase-06-device-test.md`) and flag it for the orchestrator or user.
- Keyboard, gamepad and touch sources all produce correct `InputSample`s (tests with synthetic events).
- A denied permission, a calibration timeout, and a host disconnect all show clear UI states matching `ux-flow.md`.

## Out of scope
Game rules, rendering, and WebRTC (only add it if Phase 12 measurements demand it).
