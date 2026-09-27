/**
 * Phase 22 M3 (N): every call the lesson makes into the physics and the engine for runtime locks goes through a
 * `LockPort` (contracts §10.4, CCR-GAME-01; plan §5), so the lesson logic is testable with a fake.
 *
 * - Physics: `SimDriver.setLock(id, open)` (loading with locks is `driver.load(stage, { locks })` in game.ts).
 * - Engine: `setLocks(visuals)` (after `loadStage`; replaces the set), `setLockState(id, state)`, `pulseLock(id)`,
 *   `setBeacon(pagePos | null)`.
 *
 * The real port looks the driver and engine up on every call: the driver is created lazily (on the first stage).
 */
import type { Engine, LockVisual, LockVisualState } from '@wwm/engine';
import type { Vec2 } from '@wwm/schema';
import type { SimDriver } from '../game/sim-driver.ts';

export type { LockVisual };
export type LockState = LockVisualState;

export interface LockPort {
  /** The physics honours locks (a closed lock blocks the ball). */
  readonly physics: boolean;
  /** The engine draws locks. */
  readonly engine: boolean;
  /** After the stage and the sim are loaded: draw these locks, all closed (replaces the set). */
  show(visuals: readonly LockVisual[]): void;
  /** Open (or close) a lock in the physics. */
  setLock(id: number, open: boolean): void;
  /** The engine look: closed → opening (bars drop) → open (gone). */
  setLockState(id: number, state: LockState): void;
  /** The ball touched a closed lock (the engine also pulses on the `locked` event it is handed). */
  pulse(id: number): void;
  /** A light beam over a stage point (the gate or post that opens the lock), or none. */
  beacon(pagePos: Vec2 | null): void;
}

/** The port over the game's current driver and engine. */
export function createLockPort(driver: () => SimDriver | null, engine: () => Engine | null): LockPort {
  return {
    get physics() {
      return driver() !== null;
    },
    get engine() {
      return engine() !== null;
    },
    show(visuals) {
      engine()?.setLocks(visuals);
    },
    setLock(id, open) {
      driver()?.setLock(id, open);
    },
    setLockState(id, state) {
      engine()?.setLockState(id, state);
    },
    pulse(id) {
      engine()?.pulseLock(id);
    },
    beacon(pagePos) {
      engine()?.setBeacon(pagePos ? [pagePos[0], pagePos[1]] : null);
    },
  };
}

export type LockCall =
  | { call: 'show'; visuals: LockVisual[] }
  | { call: 'setLock'; id: number; open: boolean }
  | { call: 'setLockState'; id: number; state: LockState }
  | { call: 'pulse'; id: number }
  | { call: 'beacon'; pos: Vec2 | null };

/** Tests: records every call and the resulting lock states. */
export class FakeLockPort implements LockPort {
  readonly calls: LockCall[] = [];
  readonly open = new Map<number, boolean>();
  readonly state = new Map<number, LockState>();
  beam: Vec2 | null = null;
  constructor(
    readonly physics = true,
    readonly engine = true,
  ) {}
  show(visuals: readonly LockVisual[]): void {
    this.calls.push({ call: 'show', visuals: [...visuals] });
    for (const v of visuals) this.state.set(v.lock.id, 'closed');
  }
  setLock(id: number, open: boolean): void {
    this.calls.push({ call: 'setLock', id, open });
    this.open.set(id, open);
  }
  setLockState(id: number, state: LockState): void {
    this.calls.push({ call: 'setLockState', id, state });
    this.state.set(id, state);
  }
  pulse(id: number): void {
    this.calls.push({ call: 'pulse', id });
  }
  beacon(pos: Vec2 | null): void {
    this.calls.push({ call: 'beacon', pos });
    this.beam = pos;
  }
}

/** A port that does nothing (no game attached). */
export const NO_LOCKS: LockPort = {
  physics: false,
  engine: false,
  show() {},
  setLock() {},
  setLockState() {},
  pulse() {},
  beacon() {},
};
