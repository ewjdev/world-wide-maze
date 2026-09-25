/**
 * Room Durable Object (Phase 06): one per 6-digit code, a WebSocket relay between the desktop host and the
 * phone controller (contracts §6).
 *
 * - `claim(code, tokens)` (RPC from `POST /api/rooms`) allocates the room; false if it's already live. It stores
 *   only the SHA-256 digests of the room's `hostToken` and `pairToken` (contracts v0.2.7, CCR-12-2).
 * - `GET …/ws?role=host|controller&token=…` upgrades. At most one socket per role: a newcomer replaces the old
 *   one, which is closed with 4409 "replaced". Unknown/expired rooms close with 4404, bad roles with 4400.
 * - Pairing secret (v0.2.7): the host must present `hostToken`. A controller with the `pairToken` (from the QR
 *   code / link fragment) is always admitted and may replace a live controller. A controller **without** a token
 *   (the typed 6-digit code, as in 2013) is admitted only while no *live* controller is connected. A wrong token,
 *   or a missing one where it's required, closes with 4401. "Live" = an open socket heard from within
 *   CONTROLLER_LIVE_MS (controllers send ≥ 4 Hz keepalive frames; the host already treats 1.5 s of silence as
 *   disconnected), so a phone whose old socket went silent (locked, lost network) can rejoin by code.
 * - Binary and text frames are relayed verbatim to the other role. The relay also sends `peer` messages.
 * - Keepalive: every KEEPALIVE_MS (alarm) the relay pings each socket with a negative id and measures RTT
 *   from the pong. N: the 2013 relay had to send ~50 ms filler packets because iOS WebKit didn't set
 *   TCP_NODELAY (Nagle bursts). Modern browsers do, so a slow keepalive suffices; the host measures
 *   inter-arrival jitter and "bursts" to prove it (see @wwm/net StreamStats).
 * - Uses the WebSocket Hibernation API; codes expire after 30 min with no sockets and no activity.
 * - `GET …/stats`: live relay diagnostics (RTT per role, input rate, buttons seen, event log) for dev and
 *   remote device verification. Aggregates only, no text content. Phase 12: the route only forwards it
 *   when `ROOM_STATS=1` (dev/test), see routes/rooms.ts.
 * - Phase 12 abuse caps: binary frames ≤ MAX_BINARY_BYTES and text frames ≤ MAX_TEXT_CHARS (bigger ones
 *   close the socket with 1009); each socket has a token bucket of RATE_BURST messages refilled at
 *   RATE_PER_SEC. Messages over budget are dropped (counted in stats); a socket that keeps flooding
 *   (RATE_KICK_DROPS drops) is closed with 1008.
 */

import { DurableObject } from 'cloudflare:workers';
import { RttTracker, StreamStats } from '@wwm/net';
import { decodeInput, ROOM_CLOSE_CODES, type RoomRole } from '@wwm/schema';
import { hashRoomToken, roomTokenMatches } from './room-tokens.ts';

export const ROOM_IDLE_EXPIRY_MS = 30 * 60 * 1000;
export const KEEPALIVE_MS = 5000;
const CLOSE_BAD_REQUEST = ROOM_CLOSE_CODES.badRequest;
const CLOSE_UNAUTHORIZED = ROOM_CLOSE_CODES.unauthorized;
const CLOSE_ROOM_NOT_FOUND = ROOM_CLOSE_CODES.notFound;
const CLOSE_REPLACED = ROOM_CLOSE_CODES.replaced;
/** A controller socket counts as live (not replaceable by a typed code) if heard from within this window. */
export const CONTROLLER_LIVE_MS = 3000;
const CLOSE_POLICY = 1008;
const CLOSE_TOO_BIG = 1009;

/** INPUT frames are 12 bytes (contracts §6); leave room for a future frame type, nothing more. */
export const MAX_BINARY_BYTES = 64;
/** The largest legitimate text frame is `{t:'text', field:'url', value}` with a ≤ 2048-char URL. */
export const MAX_TEXT_CHARS = 4096;
/** Token bucket per socket: 60 Hz input + ≤ 10 Hz pos + state/haptic/ping traffic, with headroom. */
export const RATE_PER_SEC = 150;
export const RATE_BURST = 300;
/** Dropped messages before a flooding socket is closed. */
export const RATE_KICK_DROPS = 600;

interface Bucket {
  tokens: number;
  at: number;
  dropped: number;
}

/** Strip control characters from client-supplied text before it reaches logs (security review #13). */
const clean = (s: string, max = 64) => s.replace(/[^\x20-\x7e]/g, '?').slice(0, max);

interface Meta {
  code: string;
  createdAt: number;
  lastActive: number;
  /** SHA-256 (base64url) of the tokens issued by `POST /api/rooms` (v0.2.7). */
  hostHash?: string;
  pairHash?: string;
}

export interface RoomTokens {
  hostToken: string;
  pairToken: string;
}
interface Attachment {
  role: RoomRole;
  connectedAt: number;
  /** How the socket was admitted (diagnostics): with a token, or a typed code (controller only). */
  auth?: 'token' | 'code';
}

/** Optional plain-text overrides (tests only; unset in wrangler.jsonc so production uses the defaults). */
interface Tunables {
  ROOM_IDLE_EXPIRY_MS?: string;
  ROOM_KEEPALIVE_MS?: string;
}

const other = (r: RoomRole): RoomRole => (r === 'host' ? 'controller' : 'host');
const isRole = (r: string | null): r is RoomRole => r === 'host' || r === 'controller';

export class Room extends DurableObject<Env> {
  // In-memory diagnostics (reset if the object hibernates; that only happens when nothing is streaming).
  #rtt: Record<RoomRole, RttTracker> = { host: new RttTracker(60), controller: new RttTracker(60) };
  #input = new StreamStats();
  #lastInput: { seq: number; tiltX: number; tiltZ: number; buttons: number; at: number } | null = null;
  #buttons = { power: 0, jump: 0, menu: 0 };
  #prevButtons = 0;
  #counts = { calibrated: 0, text: 0, state: 0, haptic: 0, connects: 0, replaced: 0, unauthorized: 0 };
  /** Last time each socket was heard from (in memory; empty after hibernation, which implies silence). */
  #lastSeen = new WeakMap<WebSocket, number>();
  #log: string[] = [];
  #buckets = new WeakMap<WebSocket, Bucket>();
  #keepalives = 0;
  #dropped = { rate: 0, oversize: 0 };
  #lastActive = 0;
  readonly #idleMs: number;
  readonly #keepaliveMs: number;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const t = env as unknown as Tunables;
    this.#idleMs = Number(t.ROOM_IDLE_EXPIRY_MS) || ROOM_IDLE_EXPIRY_MS;
    this.#keepaliveMs = Number(t.ROOM_KEEPALIVE_MS) || KEEPALIVE_MS;
  }

  #note(line: string): void {
    const code = this.#code ?? '??????';
    const entry = `${new Date().toISOString()} ${line}`;
    this.#log.push(entry);
    if (this.#log.length > 100) this.#log.shift();
    // Phase 12: one structured line (Workers Logs indexes `svc`, `room`, `msg`).
    console.log(JSON.stringify({ level: 'info', svc: 'wwm-room', room: code, msg: line }));
  }

  #code: string | null = null;

  async #meta(): Promise<Meta | undefined> {
    const m = await this.ctx.storage.get<Meta>('meta');
    if (m) this.#code = m.code;
    return m;
  }

  #sockets(role?: RoomRole): WebSocket[] {
    return this.ctx.getWebSockets(role).filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  #expired(meta: Meta, now: number): boolean {
    return this.ctx.getWebSockets().length === 0 && now - meta.lastActive >= this.#idleMs;
  }

  /** RPC: allocate this room for `code` with its tokens. False if it's already allocated and not expired. */
  async claim(code: string, tokens: RoomTokens): Promise<boolean> {
    const now = Date.now();
    const meta = await this.#meta();
    if (meta && !this.#expired(meta, now)) return false;
    const [hostHash, pairHash] = await Promise.all([
      hashRoomToken(tokens.hostToken),
      hashRoomToken(tokens.pairToken),
    ]);
    await this.ctx.storage.put<Meta>('meta', { code, createdAt: now, lastActive: now, hostHash, pairHash });
    await this.ctx.storage.setAlarm(now + this.#idleMs);
    this.#code = code;
    this.#note('claimed');
    return true;
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/stats')) return this.#stats();
    if (!url.pathname.endsWith('/ws')) return Response.json({ error: 'not found' }, { status: 404 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }
    const role = url.searchParams.get('role');
    const now = Date.now();
    const meta = await this.#meta();
    const { 0: client, 1: server } = new WebSocketPair();

    // Accept then close with an app code so the browser learns *why* (an HTTP error hides it).
    const refuse = (code: number, reason: string) => {
      server.accept();
      server.close(code, reason);
      return new Response(null, { status: 101, webSocket: client });
    };
    if (!isRole(role)) return refuse(CLOSE_BAD_REQUEST, 'role must be host or controller');
    // Rooms claimed before v0.2.7 have no token digests: treat them as gone.
    if (!meta || this.#expired(meta, now) || !meta.hostHash || !meta.pairHash)
      return refuse(CLOSE_ROOM_NOT_FOUND, 'room not found or expired');

    const auth = await this.#authorize(role, url.searchParams.get('token'), meta, now);
    if (typeof auth !== 'string') {
      this.#counts.unauthorized++;
      this.#note(`${role} refused (${auth.why})`);
      return refuse(CLOSE_UNAUTHORIZED, auth.reason);
    }

    const previous = this.#sockets(role);
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role, connectedAt: now, auth } satisfies Attachment);
    this.#lastSeen.set(server, now);
    this.#counts.connects++;
    for (const old of previous) {
      this.#counts.replaced++;
      try {
        old.close(CLOSE_REPLACED, `replaced by a newer ${role}`);
      } catch {
        // already closing
      }
    }
    if (role === 'controller') {
      this.#input.resetSeq();
      this.#prevButtons = 0;
    }
    this.#note(`${role} connected by ${auth}${previous.length ? ' (replaced previous)' : ''}`);

    // Tell the newcomer whether its peer is here, and tell the peer about the newcomer.
    const peerHere = this.#sockets(other(role)).length > 0;
    server.send(JSON.stringify({ t: 'peer', role: other(role), connected: peerHere }));
    this.#broadcast(other(role), JSON.stringify({ t: 'peer', role, connected: true }));

    await this.#touch(now);
    // Start keepalive pings soon.
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > now + this.#keepaliveMs)
      await this.ctx.storage.setAlarm(now + this.#keepaliveMs);
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * v0.2.7 pairing secret. Host: `hostToken` required. Controller: a valid `pairToken` always passes; no token
   * passes only while no live controller is connected (typed code); a wrong token never passes.
   */
  async #authorize(
    role: RoomRole,
    token: string | null,
    meta: Meta,
    now: number,
  ): Promise<'token' | 'code' | { why: string; reason: string }> {
    const expected = role === 'host' ? meta.hostHash : meta.pairHash;
    if (token !== null && token !== '') {
      if (expected && (await roomTokenMatches(token, expected))) return 'token';
      return { why: 'invalid token', reason: 'invalid room token' };
    }
    if (role === 'host') return { why: 'missing host token', reason: 'host token required' };
    if (this.#liveController(now))
      return {
        why: 'code only, a controller is connected',
        reason: 'a controller is already connected; scan the QR code to switch phones',
      };
    return 'code';
  }

  #liveController(now: number): boolean {
    return this.#sockets('controller').some(
      (ws) => now - (this.#lastSeen.get(ws) ?? -Infinity) < CONTROLLER_LIVE_MS,
    );
  }

  #broadcast(role: RoomRole, data: string | ArrayBuffer): void {
    for (const ws of this.#sockets(role)) {
      try {
        ws.send(data);
      } catch {
        // peer vanished mid-send; its close handler will clean up
      }
    }
  }

  async #touch(now: number): Promise<void> {
    this.#lastActive = now;
    const meta = await this.#meta();
    if (meta) await this.ctx.storage.put<Meta>('meta', { ...meta, lastActive: now });
  }

  #roleOf(ws: WebSocket): RoomRole | null {
    const a = ws.deserializeAttachment() as Attachment | null;
    return a?.role ?? null;
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const role = this.#roleOf(ws);
    if (!role) return;
    const now = Date.now();
    this.#lastActive = now;
    this.#lastSeen.set(ws, now);
    if (!this.#admit(ws, role, message, now)) return;
    if (typeof message === 'string') {
      // Only the relay's own keepalive pongs (negative id) are consumed; everything else is relayed verbatim.
      if (message.length < 256 && message.includes('"pong"')) {
        try {
          const m = JSON.parse(message) as { t?: string; id?: number; ts?: number };
          if (m.t === 'pong' && typeof m.id === 'number' && m.id < 0 && typeof m.ts === 'number') {
            this.#rtt[role].add(now - m.ts);
            return;
          }
        } catch {
          // not JSON: relay as-is
        }
      }
      this.#countText(message);
      this.#broadcast(other(role), message);
      return;
    }
    if (role === 'controller') {
      const f = decodeInput(message);
      if (f) {
        const buttons = (f.power ? 1 : 0) | (f.jump ? 2 : 0) | (f.menu ? 4 : 0);
        const rising = buttons & ~this.#prevButtons;
        if (rising & 1) this.#buttons.power++;
        if (rising & 2) this.#buttons.jump++;
        if (rising & 4) this.#buttons.menu++;
        this.#prevButtons = buttons;
        this.#input.add(now, f.seq);
        this.#lastInput = { seq: f.seq, tiltX: f.tiltX, tiltZ: f.tiltZ, buttons, at: now };
      }
    }
    this.#broadcast(other(role), message);
  }

  /** Phase 12: size and rate caps. False = drop this message (the socket may have been closed). */
  #admit(ws: WebSocket, role: RoomRole, message: string | ArrayBuffer, now: number): boolean {
    const size = typeof message === 'string' ? message.length : message.byteLength;
    if (size > (typeof message === 'string' ? MAX_TEXT_CHARS : MAX_BINARY_BYTES)) {
      this.#dropped.oversize++;
      this.#note(
        `${role} sent an oversized ${typeof message === 'string' ? 'text' : 'binary'} frame (${size})`,
      );
      try {
        ws.close(CLOSE_TOO_BIG, 'message too big');
      } catch {
        // already closing
      }
      return false;
    }
    let b = this.#buckets.get(ws);
    if (!b) {
      b = { tokens: RATE_BURST, at: now, dropped: 0 };
      this.#buckets.set(ws, b);
    }
    b.tokens = Math.min(RATE_BURST, b.tokens + ((now - b.at) / 1000) * RATE_PER_SEC);
    b.at = now;
    if (b.tokens >= RATE_BURST) b.dropped = 0; // a full bucket forgives past overruns (only sustained floods kick)
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return true;
    }
    b.dropped++;
    this.#dropped.rate++;
    if (b.dropped === 1 || b.dropped % 100 === 0)
      this.#note(`${role} over the rate cap (${b.dropped} dropped)`);
    if (b.dropped >= RATE_KICK_DROPS) {
      try {
        ws.close(CLOSE_POLICY, 'rate limit');
      } catch {
        // already closing
      }
    }
    return false;
  }

  #countText(message: string): void {
    const t = /^\{\s*"t"\s*:\s*"(\w+)"/.exec(message)?.[1];
    if (t === 'calibrated') {
      this.#counts.calibrated++;
      this.#note('controller calibrated');
    } else if (t === 'text' || t === 'state' || t === 'haptic') this.#counts[t]++;
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const role = this.#roleOf(ws);
    try {
      ws.close(code, reason); // complete the close handshake (no-op when the runtime auto-replies)
    } catch {
      // already closed
    }
    if (!role) return;
    const stillHere = this.#sockets(role).some((s) => s !== ws);
    this.#note(`${role} closed code=${code}${reason ? ` (${clean(reason)})` : ''} ${this.#rttLine()}`);
    if (!stillHere) this.#broadcast(other(role), JSON.stringify({ t: 'peer', role, connected: false }));
    await this.#touch(Date.now());
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + this.#keepaliveMs);
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws, 1011, 'error');
  }

  #rttLine(): string {
    const f = (r: RoomRole) => {
      const s = this.#rtt[r].summary();
      return s.count ? `${r} rtt p50=${s.p50}ms p95=${s.p95}ms` : `${r} rtt n/a`;
    };
    return `${f('host')}; ${f('controller')}`;
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    const meta = await this.#meta();
    if (!meta) return;
    const sockets = this.ctx.getWebSockets();
    if (sockets.length > 0) {
      const ping = JSON.stringify({ t: 'ping', id: -((now % 2_000_000_000) + 1), ts: now });
      for (const ws of sockets) {
        try {
          ws.send(ping);
        } catch {
          // closing
        }
      }
      const s = this.#input.summary(now);
      // Phase 12: log the relay health once a minute per live room, not on every keepalive (log volume).
      if (this.#keepalives++ % Math.max(1, Math.round(60_000 / this.#keepaliveMs)) === 0)
        this.#note(`keepalive ${this.#rttLine()}; input ${s.ratePerSec}/s lost=${s.lost} bursts=${s.bursts}`);
      await this.ctx.storage.put<Meta>('meta', { ...meta, lastActive: Math.max(meta.lastActive, now) });
      await this.ctx.storage.setAlarm(now + this.#keepaliveMs);
      return;
    }
    const lastActive = Math.max(meta.lastActive, this.#lastActive);
    if (now - lastActive >= this.#idleMs) {
      this.#note('expired');
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.ctx.storage.setAlarm(lastActive + this.#idleMs);
  }

  async #stats(): Promise<Response> {
    const now = Date.now();
    const meta = await this.#meta();
    if (!meta) return Response.json({ error: 'room not found' }, { status: 404 });
    return Response.json({
      code: meta.code,
      createdAt: new Date(meta.createdAt).toISOString(),
      host: this.#sockets('host').length > 0,
      controller: this.#sockets('controller').length > 0,
      rtt: { host: this.#rtt.host.summary(), controller: this.#rtt.controller.summary() },
      input: {
        ...this.#input.summary(now),
        last: this.#lastInput ? { ...this.#lastInput, ageMs: now - this.#lastInput.at } : null,
        buttonPresses: this.#buttons,
      },
      counts: this.#counts,
      dropped: this.#dropped,
      log: this.#log.slice(-40),
    });
  }
}
