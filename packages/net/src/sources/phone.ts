/**
 * Phone input on the host: filtered network tilt from a `HostConnection`.
 *
 * - Tilt goes through a One Euro filter per axis, stepped at `sample()` time.
 * - Stale rule (contracts §6): no frame for > 250 ms → neutral (tilt 0, power off) and the filter resets.
 * - Out-of-order frames (by wrapping u16 seq) are dropped; seq tracking resets when the controller reconnects.
 * - JUMP is latched: a press that starts and ends between two samples still yields one `jump: true`.
 * - MENU fires the `menu` event on its rising edge.
 * - `connected` / `disconnected` follow the controller peer (and the host socket itself), so Phase 08 can
 *   auto-pause on `disconnected` (N: 2013 only offered a reload).
 */
import { type ControllerInputFrame, type InputSample, isSeqNewer } from '@wwm/schema';
import type { HostConnection } from '../connection.ts';
import { Emitter, type Unsubscribe } from '../emitter.ts';
import type { InputSource, InputSourceEvent, InputSourceOptions } from '../input-source.ts';
import { neutralSample } from '../input-source.ts';
import { OneEuroFilter, type OneEuroParams } from '../one-euro.ts';

export const STALE_INPUT_MS = 250;

export interface PhoneInputSourceOptions extends InputSourceOptions {
  filter?: Partial<OneEuroParams>;
  staleMs?: number;
}

export interface PhoneDebug {
  raw: { tiltX: number; tiltZ: number } | null;
  filtered: { tiltX: number; tiltZ: number } | null;
  stale: boolean;
  lastFrameAgeMs: number | null;
  droppedOutOfOrder: number;
  filterLagMs: number;
}

export class PhoneInputSource implements InputSource {
  readonly kind = 'phone' as const;
  readonly #events = new Emitter<Record<InputSourceEvent, () => void>>();
  readonly #fx: OneEuroFilter;
  readonly #fz: OneEuroFilter;
  readonly #staleMs: number;
  readonly #frameYaw: () => number;
  readonly #unsubs: Unsubscribe[] = [];
  #last: ControllerInputFrame | null = null;
  #lastAt = Number.NEGATIVE_INFINITY;
  #jumpLatched = false;
  #menuHeld = false;
  #connected = false;
  #wasStale = true;
  #filtered: { tiltX: number; tiltZ: number } | null = null;
  droppedOutOfOrder = 0;

  constructor(conn: HostConnection, opts: PhoneInputSourceOptions = {}) {
    this.#fx = new OneEuroFilter(opts.filter);
    this.#fz = new OneEuroFilter(opts.filter);
    this.#staleMs = opts.staleMs ?? STALE_INPUT_MS;
    this.#frameYaw = opts.frameYaw ?? (() => 0);
    this.#connected = conn.peerConnected;
    this.#unsubs.push(
      conn.on('input', (f, at) => this.#onFrame(f, at)),
      conn.on('peer', (role, connected) => {
        if (role === 'controller') this.#setConnected(connected);
      }),
      conn.on('close', () => this.#setConnected(false)),
    );
  }

  get connected(): boolean {
    return this.#connected;
  }

  #setConnected(c: boolean): void {
    if (c === this.#connected) return;
    this.#connected = c;
    this.#last = null;
    this.#lastAt = Number.NEGATIVE_INFINITY;
    this.#menuHeld = false;
    this.#jumpLatched = false;
    this.#events.emit(c ? 'connected' : 'disconnected');
  }

  #onFrame(f: ControllerInputFrame, at: number): void {
    const fresh = at - this.#lastAt <= this.#staleMs;
    if (this.#last && fresh && !isSeqNewer(f.seq, this.#last.seq)) {
      this.droppedOutOfOrder++;
      return;
    }
    if (f.jump && !this.#last?.jump) this.#jumpLatched = true;
    if (f.menu && !this.#menuHeld) this.#events.emit('menu');
    this.#menuHeld = f.menu;
    this.#last = f;
    this.#lastAt = at;
    // A frame proves the controller is there even if we missed its peer message.
    if (!this.#connected) {
      this.#connected = true;
      this.#events.emit('connected');
    }
  }

  sample(nowMs: number): InputSample {
    const f = this.#last;
    const yaw = this.#frameYaw();
    if (!f || nowMs - this.#lastAt > this.#staleMs) {
      if (!this.#wasStale) {
        this.#fx.reset();
        this.#fz.reset();
        this.#filtered = null;
      }
      this.#wasStale = true;
      this.#jumpLatched = false;
      return neutralSample(yaw);
    }
    this.#wasStale = false;
    const tiltX = this.#fx.filter(f.tiltX, nowMs);
    const tiltZ = this.#fz.filter(f.tiltZ, nowMs);
    this.#filtered = { tiltX, tiltZ };
    const jump = f.jump || this.#jumpLatched;
    this.#jumpLatched = false;
    return { tiltX, tiltZ, frameYaw: yaw, power: f.power, jump };
  }

  debug(nowMs: number): PhoneDebug {
    const age = this.#last ? nowMs - this.#lastAt : null;
    return {
      raw: this.#last ? { tiltX: this.#last.tiltX, tiltZ: this.#last.tiltZ } : null,
      filtered: this.#filtered,
      stale: age === null || age > this.#staleMs,
      lastFrameAgeMs: age,
      droppedOutOfOrder: this.droppedOutOfOrder,
      filterLagMs: Math.max(this.#fx.lagMs, this.#fz.lagMs),
    };
  }

  /** Latest raw frame (e.g. for the host's "Too tilted!" check or an input visualizer). */
  get lastFrame(): ControllerInputFrame | null {
    return this.#last;
  }

  on(evt: InputSourceEvent, cb: () => void): Unsubscribe {
    return this.#events.on(evt, cb);
  }

  dispose(): void {
    for (const u of this.#unsubs) u();
    this.#unsubs.length = 0;
    this.#events.clear();
  }
}
