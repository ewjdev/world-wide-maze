/**
 * Room WebSocket clients (contracts §6): `HostConnection` (desktop game) and `ControllerConnection` (phone).
 *
 * - Auto-reconnect with exponential backoff + jitter. `reconnectNow()` skips the wait (phone unlocked).
 * - Answers every `ping` with a `pong` (the relay's keepalive pings use negative ids; peer pings positive).
 * - Pings the peer once a second while it's connected and tracks end-to-end RTT (p50/p95).
 * - Close code 4404 = room not found, 4409 = replaced by a newer connection of the same role: no reconnect.
 */
import {
  type ControllerInputFrame,
  type ControlMessage,
  decodeInput,
  encodeInput,
  INPUT_FRAME_BYTES,
  type RoomRole,
} from '@wwm/schema';
import { ControlMessageSchema } from '@wwm/schema/zod';
import { Emitter, type Unsubscribe } from './emitter.ts';
import { RttTracker } from './rtt.ts';

export const CLOSE_ROOM_NOT_FOUND = 4404;
export const CLOSE_REPLACED = 4409;
export const CLOSE_BAD_REQUEST = 4400;

/** The subset of the browser WebSocket API we use (so tests can pass a fake). */
export interface WebSocketLike {
  readonly readyState: number;
  readonly bufferedAmount: number;
  binaryType: string;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  send(data: string | ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}
export type WebSocketFactory = (url: string) => WebSocketLike;

const OPEN = 1;

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';
export type ConnectionError = 'room-not-found' | 'replaced' | 'bad-request';

export interface ConnectionOptions {
  /** Full ws(s) URL, e.g. from `roomWsUrl()`. */
  url: string;
  /** Defaults to `new WebSocket(url)`. */
  createSocket?: WebSocketFactory;
  /** Monotonic ms clock (default `performance.now`). */
  now?: () => number;
  /** Peer ping interval (default 1000 ms). 0 disables. */
  pingIntervalMs?: number;
  backoffInitialMs?: number;
  backoffMaxMs?: number;
  /** Deterministic jitter source for tests (default Math.random). */
  random?: () => number;
  /** Give up after this many consecutive failed attempts (default Infinity). */
  maxAttempts?: number;
}

export type ConnectionEvents = {
  state: (s: ConnectionState) => void;
  open: () => void;
  close: (info: { code: number; reason: string; willReconnect: boolean }) => void;
  error: (e: ConnectionError) => void;
  peer: (role: RoomRole, connected: boolean) => void;
  message: (msg: ControlMessage) => void;
  rtt: (ms: number) => void;
  /** Host only: a decoded INPUT frame and its local arrival time (the connection's `now()`). */
  input: (frame: ControllerInputFrame, atMs: number) => void;
};

function defaultSocket(url: string): WebSocketLike {
  return new WebSocket(url) as unknown as WebSocketLike;
}

export abstract class RoomConnection {
  readonly role: RoomRole;
  readonly rtt = new RttTracker();
  protected readonly events = new Emitter<ConnectionEvents>();
  protected readonly now: () => number;
  #url: string;
  #createSocket: WebSocketFactory;
  #ws: WebSocketLike | null = null;
  #state: ConnectionState = 'idle';
  #attempt = 0;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #pingTimer: ReturnType<typeof setInterval> | null = null;
  #pingId = 0;
  #peerConnected = false;
  #stopped = false;
  #lastRxAt = Number.NEGATIVE_INFINITY;
  #opts: Required<
    Pick<ConnectionOptions, 'pingIntervalMs' | 'backoffInitialMs' | 'backoffMaxMs' | 'maxAttempts'>
  > & {
    random: () => number;
  };

  constructor(role: RoomRole, opts: ConnectionOptions) {
    this.role = role;
    this.#url = opts.url;
    this.#createSocket = opts.createSocket ?? defaultSocket;
    this.now = opts.now ?? (() => performance.now());
    this.#opts = {
      pingIntervalMs: opts.pingIntervalMs ?? 1000,
      backoffInitialMs: opts.backoffInitialMs ?? 250,
      backoffMaxMs: opts.backoffMaxMs ?? 5000,
      maxAttempts: opts.maxAttempts ?? Number.POSITIVE_INFINITY,
      random: opts.random ?? Math.random,
    };
  }

  on<K extends keyof ConnectionEvents>(event: K, cb: ConnectionEvents[K]): Unsubscribe {
    return this.events.on(event, cb);
  }

  get state(): ConnectionState {
    return this.#state;
  }

  get peerConnected(): boolean {
    return this.#peerConnected;
  }

  get isOpen(): boolean {
    return this.#ws?.readyState === OPEN;
  }

  /** Bytes queued in the socket (the controller skips input frames while this is high). */
  get bufferedAmount(): number {
    return this.#ws?.bufferedAmount ?? 0;
  }

  connect(): void {
    this.#stopped = false;
    if (this.#ws) return;
    this.#open();
  }

  /** Skip any pending backoff and reconnect right away (e.g. the page became visible again). */
  reconnectNow(): void {
    if (this.#stopped) return;
    if (this.#ws && this.#ws.readyState <= OPEN) return;
    this.#clearRetry();
    this.#attempt = 0;
    this.#ws = null;
    this.#open();
  }

  /**
   * After the page was suspended (phone locked) a socket can look open but be dead. The relay pings every
   * few seconds, so if nothing arrived for `maxSilenceMs`, drop the socket and reconnect right away.
   * Returns true if a reconnect was started.
   */
  reconnectIfSilent(maxSilenceMs: number): boolean {
    if (this.#stopped) return false;
    const ws = this.#ws;
    if (ws && ws.readyState === OPEN && this.now() - this.#lastRxAt <= maxSilenceMs) return false;
    if (ws && ws.readyState === 0) return false;
    if (ws) {
      ws.onclose = null;
      try {
        ws.close(4000, 'silent');
      } catch {
        // ignore
      }
      this.#ws = null;
      this.#stopPing();
      this.#setPeer(false);
    }
    this.#clearRetry();
    this.#attempt = 0;
    this.#open();
    return true;
  }

  /** Close for good (no reconnect). */
  close(): void {
    this.#stopped = true;
    this.#clearRetry();
    this.#stopPing();
    const ws = this.#ws;
    this.#ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close(1000, 'bye');
    }
    this.#setPeer(false);
    this.#setState('closed');
  }

  send(msg: ControlMessage): boolean {
    return this.sendRaw(JSON.stringify(msg));
  }

  protected sendRaw(data: string | ArrayBuffer): boolean {
    const ws = this.#ws;
    if (!ws || ws.readyState !== OPEN) return false;
    ws.send(data);
    return true;
  }

  /** Subclasses handle binary frames. */
  protected abstract onBinary(data: ArrayBuffer): void;

  #setState(s: ConnectionState): void {
    if (this.#state === s) return;
    this.#state = s;
    this.events.emit('state', s);
  }

  #setPeer(connected: boolean): void {
    const other: RoomRole = this.role === 'host' ? 'controller' : 'host';
    if (this.#peerConnected === connected) return;
    this.#peerConnected = connected;
    this.events.emit('peer', other, connected);
  }

  #open(): void {
    this.#setState(this.#attempt === 0 ? 'connecting' : 'reconnecting');
    let ws: WebSocketLike;
    try {
      ws = this.#createSocket(this.#url);
    } catch {
      this.#scheduleRetry();
      return;
    }
    this.#ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      if (this.#ws !== ws) return;
      this.#attempt = 0;
      this.#lastRxAt = this.now();
      this.#setState('open');
      this.events.emit('open');
      this.#startPing();
    };
    ws.onmessage = (ev) => {
      if (this.#ws !== ws) return;
      this.#lastRxAt = this.now();
      this.#onMessage(ev.data);
    };
    ws.onerror = () => {
      // A close event always follows; reconnect logic lives there.
    };
    ws.onclose = (ev) => {
      if (this.#ws !== ws) return;
      this.#ws = null;
      this.#stopPing();
      this.#setPeer(false);
      const fatal: ConnectionError | null =
        ev.code === CLOSE_ROOM_NOT_FOUND
          ? 'room-not-found'
          : ev.code === CLOSE_REPLACED
            ? 'replaced'
            : ev.code === CLOSE_BAD_REQUEST
              ? 'bad-request'
              : null;
      const willReconnect = !fatal && !this.#stopped && this.#attempt + 1 < this.#opts.maxAttempts;
      this.events.emit('close', { code: ev.code, reason: ev.reason, willReconnect });
      if (fatal) {
        this.#stopped = true;
        this.#setState('closed');
        this.events.emit('error', fatal);
        return;
      }
      if (willReconnect) this.#scheduleRetry();
      else this.#setState('closed');
    };
  }

  #scheduleRetry(): void {
    this.#clearRetry();
    const base = Math.min(this.#opts.backoffMaxMs, this.#opts.backoffInitialMs * 2 ** this.#attempt);
    const delay = base * (0.75 + 0.5 * this.#opts.random());
    this.#attempt++;
    this.#setState('reconnecting');
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      if (!this.#stopped) this.#open();
    }, delay);
  }

  #clearRetry(): void {
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
  }

  #startPing(): void {
    this.#stopPing();
    if (this.#opts.pingIntervalMs <= 0) return;
    this.#pingTimer = setInterval(() => this.pingPeer(), this.#opts.pingIntervalMs);
  }

  #stopPing(): void {
    if (this.#pingTimer) clearInterval(this.#pingTimer);
    this.#pingTimer = null;
  }

  /** Send one ping to the peer (no-op when the peer isn't connected). */
  pingPeer(): void {
    if (!this.#peerConnected) return;
    this.send({ t: 'ping', id: ++this.#pingId, ts: this.now() });
  }

  #onMessage(data: unknown): void {
    if (typeof data !== 'string') {
      if (data instanceof ArrayBuffer) this.onBinary(data);
      else if (ArrayBuffer.isView(data)) {
        const v = data as ArrayBufferView;
        this.onBinary(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer);
      }
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const parsed = ControlMessageSchema.safeParse(json);
    if (!parsed.success) return;
    const msg = parsed.data as ControlMessage;
    switch (msg.t) {
      case 'ping':
        this.send({ t: 'pong', id: msg.id, ts: msg.ts });
        return;
      case 'pong':
        if (msg.id > 0) {
          const rtt = this.now() - msg.ts;
          this.rtt.add(rtt);
          this.events.emit('rtt', rtt);
        }
        return;
      case 'peer':
        if (msg.role !== this.role) this.#setPeer(msg.connected);
        break;
    }
    this.events.emit('message', msg);
  }
}

// ── Host ────────────────────────────────────────────────────────────────────────────────────────────

export class HostConnection extends RoomConnection {
  constructor(opts: ConnectionOptions) {
    super('host', opts);
  }

  protected onBinary(data: ArrayBuffer): void {
    const frame = decodeInput(data);
    if (frame) this.events.emit('input', frame, this.now());
  }
}

// ── Controller ──────────────────────────────────────────────────────────────────────────────────────

/** Skip input frames while more than this many bytes are queued (fresh input beats a backlog). */
export const MAX_BUFFERED_BYTES = 4 * INPUT_FRAME_BYTES * 8;

export class ControllerConnection extends RoomConnection {
  #seq = 0;
  #buf = new ArrayBuffer(INPUT_FRAME_BYTES);
  /** Frames sent / skipped because of backpressure (for the latency overlay). */
  sent = 0;
  skipped = 0;

  constructor(opts: ConnectionOptions) {
    super('controller', opts);
  }

  /** Encode and send one INPUT frame (seq is assigned here). Returns false if not sent. */
  sendInput(input: { tiltX: number; tiltZ: number; power: boolean; jump: boolean; menu: boolean }): boolean {
    if (!this.isOpen) return false;
    if (this.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.skipped++;
      return false;
    }
    this.#seq = (this.#seq + 1) & 0xffff;
    encodeInput({ ...input, seq: this.#seq }, this.#buf);
    // Send a copy: some WebSocket implementations hold the buffer until flushed.
    const ok = this.sendRaw(this.#buf.slice(0));
    if (ok) this.sent++;
    return ok;
  }

  protected onBinary(_data: ArrayBuffer): void {
    // Host → controller traffic is JSON only (contracts §6).
  }
}
