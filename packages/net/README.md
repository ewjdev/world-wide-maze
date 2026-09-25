# @wwm/net

Controller transport for the phone ↔ desktop link (contracts §6): room WebSocket clients, the phone tilt
pipeline, One Euro filtering, latency stats, and the `InputSource` abstraction the game consumes.
Owned by Phase 06. Contract types come from `@wwm/schema`; nothing here redeclares them.

## API

**Rooms and connections** (`connection.ts`, `rooms-api.ts`)
- `createRoom(origin)` → `'123456'` (`POST /api/rooms`), `roomWsUrl(origin, code, role)`, `pairingUrl(origin, code)`, `isRoomCode(s)`.
- `HostConnection` / `ControllerConnection` (`{ url, createSocket?, now?, pingIntervalMs?, backoffInitialMs?, backoffMaxMs? }`):
  - `connect()`, `close()`, `reconnectNow()`, `reconnectIfSilent(ms)` (phone unlocked: replace a socket that looks open but went quiet).
  - Auto-reconnect with exponential backoff (250 ms doubling to 5 s, ±25 % jitter). Close 4404 (room not found), 4409 (replaced by a newer socket of the same role) and 4400 are fatal and emit `error`.
  - Events: `state`, `open`, `close`, `error`, `peer(role, connected)`, `message(ControlMessage)` (validated with the schema's zod), `rtt(ms)`, and on the host `input(frame, atMs)`.
  - Answers every `ping` with a `pong`; pings the peer every second and tracks end-to-end RTT in `conn.rtt` (p50/p95).
  - `ControllerConnection.sendInput({tiltX, tiltZ, power, jump, menu})` encodes the 12-byte frame (seq assigned, wraps) and skips frames while the socket is backed up.

**Input sources** (`input-source.ts`, `sources/*`). All implement:
```ts
interface InputSource {
  readonly kind: 'phone' | 'keyboard' | 'gamepad' | 'touch';
  sample(nowMs: number): InputSample;          // contracts §5; frameYaw from the `frameYaw` option
  on(evt: 'menu' | 'disconnected' | 'connected', cb: () => void): Unsubscribe;
  dispose(): void;
}
```
- `new PhoneInputSource(hostConn, { frameYaw?, filter?, staleMs? })`: a One Euro filter per axis, stepped at sample time. The stale rule applies (no frame for more than 250 ms gives neutral, with the filter reset). Out-of-order seq is dropped, JUMP is latched between samples, MENU fires on its rising edge, and `connected`/`disconnected` follow the controller. `debug(now)` gives raw/filtered/stale/lag values.
- `new KeyboardInputSource({ target?, frameYaw? })` (E): arrows set a target of ±25° ramped at 162°/s. Any arrow held means POWER, which stays on 100 ms after release. Space jumps, M opens the map. N: WASD, Esc = map, Shift = POWER. Blur releases all keys, and keys typed into inputs are ignored.
- `new GamepadInputSource({ getGamepads?, deadzone? })` (N): the left stick tilts ±25°, and deflection past the deadzone means POWER. RT also gives POWER, A jumps, Start opens the map.
- `new TouchInputSource()` (N): a virtual stick (`setStick`, `attachStick(el)`) plus `setJump` and `pressMenu`.

**Tilt pipeline** (`tilt.ts`, used on the phone)
- `orientationToTilt({alpha,beta,gamma}, screenAngle, zeroDevice)` → `{raw, clamped, gravity}`, via gravity from DeviceOrientation. Alpha is ignored, so turning your body never tilts the ball. The vector is then rotated by `screen.orientation.angle`. Tilt is the pitch about screen x, followed by the roll about y, that carries the zero pose onto the current one. It's solved in closed form (no Euler subtraction) and clamped to ±20° roll and ±45° pitch.
- `CalibrationDetector` (E: 15 s timeout, ≈2° tolerance): succeeds when the pose is held within 2° for 700 ms, inside 40° of the default neutral (45° toward the player). `force()` handles the "Use this position" button.
- `TooTiltedDetector` (E: 500 ms hysteresis). R: it fires beyond the clamp limit, which is half the indicator ring.

**Filtering and stats**
- `OneEuroFilter`, with defaults `ONE_EURO_TILT_DEFAULTS = { minCutoff: 1.0 Hz, beta: 0.8, dCutoff: 1.0 Hz }`. At rest τ ≈ 0.16 s, close to the 2013 EMA's τ ≈ 0.18 s. The cutoff rises with speed (a 1 rad/s swing gives 1.8 Hz). `lagMs` is the current time constant.
- `RttTracker` (p50/p95 over a window) and `StreamStats` (rate over the last second, inter-arrival p50/p95, jitter, seq loss, and "bursts", meaning intervals over 3× the median, which is how Nagle buffering shows up).

## Wiring it up in Phase 08
```ts
const { code, conn } = await openHostRoom(location.origin);        // apps/web/src/controller/useHostRoom.ts
const phone = new PhoneInputSource(conn, { frameYaw: () => camera.yaw });
phone.on('disconnected', pauseGame);   // auto-pause; resume after fresh input
const input = phone.sample(performance.now());   // each sim tick
conn.send({ t: 'state', phase, score, balls, timeLeft });   // phone HUD
conn.send({ t: 'haptic', pattern: 'item' });
conn.on('message', (m) => m.t === 'calibrated' && advanceTutorial());
```

## Run
- Tests: `pnpm vitest run --project @wwm/net`. The Room DO integration tests live in `apps/worker/test/room.test.ts`, and the browser e2e is `apps/web/test/controller.e2e.test.ts`.
- Typecheck: `pnpm --filter @wwm/net typecheck`.
