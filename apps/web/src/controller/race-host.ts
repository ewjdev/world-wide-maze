import {
  type ConnectionState,
  type HostConnection,
  neutralSample,
  PhoneInputSource,
  pairingUrl,
} from '@wwm/net';
import type { GamePhase, InputSample, RaceState, StateMessage } from '@wwm/schema';
import { openHostRoom } from './useHostRoom.ts';

export interface RaceControllerView {
  code: string;
  pairingUrl: string;
  connection: ConnectionState;
  controllerConnected: boolean;
  raceSupport: 'pending' | 'supported' | 'unsupported';
  calibrated: boolean;
  error: string | null;
}

export interface RaceControllerOptions {
  origin: string;
  frameYaw?: () => number;
  requiresStunts?: boolean;
  onMenu?: () => void;
  onDisconnect?: () => void;
}

const LEGACY_PHASE: Record<RaceState['phase'], GamePhase> = {
  loading: 'building',
  ready: 'intro',
  countdown: 'countdown',
  racing: 'play',
  paused: 'paused',
  finished: 'result',
  exhausted: 'result',
};

/** Version negotiation happens before input can start a Race. The relay stays protocol agnostic. */
export class RaceControllerHost {
  readonly #conn: HostConnection;
  readonly #source: PhoneInputSource;
  readonly #opts: RaceControllerOptions;
  readonly #listeners = new Set<() => void>();
  readonly #cleanup: (() => void)[] = [];
  #view: RaceControllerView;
  #race: RaceState | null = null;
  #capabilityTimer: ReturnType<typeof setTimeout> | null = null;
  #stateTimer: ReturnType<typeof setInterval>;
  #disposed = false;
  #stuntSupported = false;
  #turboRequested = false;

  static async create(opts: RaceControllerOptions): Promise<RaceControllerHost> {
    const room = await openHostRoom(opts.origin);
    return new RaceControllerHost(room, opts);
  }

  /** Injection point for tests; create() owns opening the actual room. */
  constructor(
    room: { code: string; pairToken: string | null; conn: HostConnection },
    opts: RaceControllerOptions,
  ) {
    this.#conn = room.conn;
    this.#opts = opts;
    this.#source = new PhoneInputSource(room.conn, opts.frameYaw ? { frameYaw: opts.frameYaw } : {});
    this.#view = {
      code: room.code,
      pairingUrl: pairingUrl(opts.origin, room.code, room.pairToken),
      connection: room.conn.state,
      controllerConnected: room.conn.peerConnected,
      raceSupport: 'pending',
      calibrated: false,
      error: null,
    };
    this.#cleanup.push(
      room.conn.on('state', (connection) => this.#patch({ connection })),
      room.conn.on('error', (error) => this.#patch({ error })),
      room.conn.on('message', (m) => {
        if (m.t === 'capabilities' && m.raceVersion === 1 && this.#view.controllerConnected) {
          this.#clearCapabilityTimer();
          this.#stuntSupported = m.stuntVersion === 1;
          const supported = !opts.requiresStunts || this.#stuntSupported;
          this.#patch({
            raceSupport: supported ? 'supported' : 'unsupported',
            error: supported
              ? null
              : 'Refresh the phone controller to enable jump-course turbo, or use desktop controls.',
          });
        } else if (m.t === 'race-turbo') {
          if (
            this.canStart &&
            this.#stuntSupported &&
            this.#race?.phase === 'racing' &&
            this.#race.boost?.ready &&
            !this.#turboRequested
          ) {
            this.#turboRequested = true;
          }
        } else if (m.t === 'calibrated' && this.#view.controllerConnected) {
          this.#patch({ calibrated: true });
        }
      }),
      this.#source.on('connected', () => {
        this.#patch({ controllerConnected: true, calibrated: false, error: null });
        this.#negotiate();
      }),
      this.#source.on('disconnected', () => {
        this.#clearCapabilityTimer();
        this.#stuntSupported = false;
        this.#clearTurbo();
        this.#patch({ controllerConnected: false, calibrated: false, raceSupport: 'pending' });
        opts.onDisconnect?.();
      }),
      this.#source.on('menu', () => {
        if (this.canStart) opts.onMenu?.();
      }),
    );
    this.#stateTimer = setInterval(() => this.#flushState(), 250);
    if (room.conn.peerConnected) this.#negotiate();
  }

  get canStart(): boolean {
    return (
      !this.#disposed &&
      this.#view.connection === 'open' &&
      this.#view.controllerConnected &&
      this.#view.raceSupport === 'supported' &&
      this.#view.calibrated
    );
  }

  getView = (): RaceControllerView => this.#view;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** Call every render frame (also while paused) to detect a backgrounded or locked phone. */
  sample(nowMs: number): InputSample {
    const input = this.#source.sample(nowMs);
    return this.canStart ? input : neutralSample(this.#opts.frameYaw?.() ?? 0);
  }

  /** Coalesce host updates: never send more than four STATE messages per second. */
  sendState(race: RaceState): void {
    this.#race = race;
    if (race.phase !== 'racing' || !race.boost?.ready) this.#clearTurbo();
  }

  /** Consume once at the physics input boundary, never while polling render frames. */
  takeTurboRequest(): boolean {
    const requested = this.#turboRequested && this.canStart && this.#race?.phase === 'racing';
    this.#turboRequested = false;
    return requested;
  }

  /** Discard queued control on input-source changes or recovery. */
  discardTurboRequest(): void {
    this.#clearTurbo();
  }

  #clearTurbo(): void {
    this.#turboRequested = false;
  }

  #flushState(): void {
    if (!this.#view.controllerConnected || this.#disposed) return;
    const race = this.#race;
    const phase = !this.#view.calibrated ? 'calibrate' : race ? LEGACY_PHASE[race.phase] : 'intro';
    const message: StateMessage = { t: 'state', phase, score: 0, balls: 0, timeLeft: 0 };
    if (race && this.#view.raceSupport === 'supported') message.race = race;
    this.#conn.send(message);
  }

  #negotiate(): void {
    this.#clearCapabilityTimer();
    this.#stuntSupported = false;
    this.#clearTurbo();
    this.#patch({ raceSupport: 'pending' });
    this.#conn.send({ t: 'capabilities-request' });
    // A synchronous test transport can answer during send().
    if (this.#view.raceSupport !== 'pending') return;
    this.#capabilityTimer = setTimeout(() => {
      this.#capabilityTimer = null;
      this.#patch({
        raceSupport: 'unsupported',
        error: 'Refresh the phone controller to enable Race, or use desktop controls.',
      });
    }, 5000);
  }

  #clearCapabilityTimer(): void {
    if (this.#capabilityTimer !== null) clearTimeout(this.#capabilityTimer);
    this.#capabilityTimer = null;
  }

  #patch(patch: Partial<RaceControllerView>): void {
    if (this.#disposed) return;
    this.#view = { ...this.#view, ...patch };
    for (const listener of this.#listeners) listener();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    clearInterval(this.#stateTimer);
    this.#clearCapabilityTimer();
    for (const cleanup of this.#cleanup) cleanup();
    this.#source.dispose();
    this.#conn.close();
    this.#listeners.clear();
  }
}
