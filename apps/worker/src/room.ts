/**
 * Room Durable Object (Phase 06): one per 6-digit code, a WebSocket relay between the desktop host and the
 * phone controller (contracts §6).
 *
 * - `claim(code)` (RPC from `POST /api/rooms`) allocates the room; false if it's already live.
 * - `GET …/ws?role=host|controller` upgrades. At most one socket per role: a newcomer replaces the old one,
 *   which is closed with 4409 "replaced". Unknown/expired rooms close with 4404, bad roles with 4400.
 * - Binary and text frames are relayed verbatim to the other role. The relay also sends `peer` messages.
 * - Keepalive: every KEEPALIVE_MS (alarm) the relay pings each socket with a negative id and measures RTT
 *   from the pong. N: the 2013 relay had to send ~50 ms filler packets because iOS WebKit didn't set
 *   TCP_NODELAY (Nagle bursts). Modern browsers do, so a slow keepalive suffices; the host measures
 *   inter-arrival jitter and "bursts" to prove it (see @wwm/net StreamStats).
 * - Uses the WebSocket Hibernation API; codes expire after 30 min with no sockets and no activity.
 * - `GET …/stats`: live relay diagnostics (RTT per role, input rate, buttons seen, event log) for dev and
 *   remote device verification. Aggregates only, no text content.
 */

import { DurableObject } from 'cloudflare:workers';
import { RttTracker, StreamStats } from '@wwm/net';
import { decodeInput, type RoomRole } from '@wwm/schema';

export const ROOM_IDLE_EXPIRY_MS = 30 * 60 * 1000;
export const KEEPALIVE_MS = 5000;
const CLOSE_BAD_REQUEST = 4400;
const CLOSE_ROOM_NOT_FOUND = 4404;
const CLOSE_REPLACED = 4409;

interface Meta {
  code: string;
  createdAt: number;
  lastActive: number;
}
interface Attachment {
  role: RoomRole;
  connectedAt: number;
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
  #counts = { calibrated: 0, text: 0, state: 0, haptic: 0, connects: 0, replaced: 0 };
  #log: string[] = [];
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
    console.log(`[room ${code}] ${line}`);
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

  /** RPC: allocate this room for `code`. False if it's already allocated and not expired. */
  async claim(code: string): Promise<boolean> {
    const now = Date.now();
    const meta = await this.#meta();
    if (meta && !this.#expired(meta, now)) return false;
    await this.ctx.storage.put<Meta>('meta', { code, createdAt: now, lastActive: now });
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

    if (!isRole(role) || !meta || this.#expired(meta, now)) {
      // Accept then close with an app code so the browser learns *why* (an HTTP error hides it).
      server.accept();
      if (!isRole(role)) server.close(CLOSE_BAD_REQUEST, 'role must be host or controller');
      else server.close(CLOSE_ROOM_NOT_FOUND, 'room not found or expired');
      return new Response(null, { status: 101, webSocket: client });
    }

    const previous = this.#sockets(role);
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role, connectedAt: now } satisfies Attachment);
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
    this.#note(`${role} connected${previous.length ? ' (replaced previous)' : ''}`);

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
    this.#note(`${role} closed code=${code}${reason ? ` (${reason})` : ''} ${this.#rttLine()}`);
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
      log: this.#log.slice(-40),
    });
  }
}
