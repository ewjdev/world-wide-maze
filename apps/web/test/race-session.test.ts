import { readFileSync } from 'node:fs';
import { createSimulation } from '@wwm/physics';
import type { RaceAttempt, RaceCourse } from '@wwm/race';
import type { SimEvent, StageData } from '@wwm/schema';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  durable: [] as RaceAttempt[],
  saveWait: null as Promise<void> | null,
  spawnWait: null as Promise<void> | null,
  phoneReady: true,
  prepare: vi.fn(),
  frame: null as FrameRequestCallback | null,
  engineDispose: vi.fn(),
  clearFails: false,
  events: [] as SimEvent[],
  resetCount: 0,
  stepped: [] as { jump: boolean; power: boolean; tiltX: number }[],
}));
vi.mock('@wwm/engine', () => ({
  createEngine: async () => ({
    resize() {},
    skipIntro() {},
    setBall() {},
    setView() {},
    cameraYaw: () => 0,
    loadStage: async () => {},
    spawnBall: async () => {
      await state.spawnWait;
    },
    frame() {},
    setControl() {},
    handleEvent() {},
    stats: () => ({}),
    debug: () => ({ camera: { position: { toArray: () => [] } } }),
    dispose: state.engineDispose,
  }),
}));
vi.mock('@wwm/physics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wwm/physics')>()),
  createSimulation: async () => {
    let x = 0;
    const ball = () => ({ pos: [x, 0, 0], quat: [0, 0, 0, 1], vel: [1, 0, 0], grounded: true });
    return {
      load: async () => {
        x = 0;
      },
      reset: () => {
        state.resetCount++;
        x = 0;
      },
      dispose() {},
      setLock() {},
      getBallState: ball,
      step: (input?: { jump?: boolean; power?: boolean; tiltX?: number }) => {
        state.stepped.push({
          jump: !!input?.jump,
          power: !!input?.power,
          tiltX: input?.tiltX ?? 0,
        });
        x += 0.01;
        return { ball: ball(), events: state.events.splice(0), elevators: [] };
      },
    };
  },
}));
vi.mock('@wwm/net', async (importOriginal) => {
  const { TouchInputSource } = await importOriginal<typeof import('@wwm/net')>();
  class Input {
    sample() {
      return { tiltX: 0, tiltZ: 0, frameYaw: 0, power: false, jump: false };
    }
    on() {
      return () => {};
    }
    dispose() {}
  }
  return {
    KeyboardInputSource: Input,
    GamepadInputSource: Input,
    TouchInputSource,
    neutralSample: (frameYaw: number) => ({ tiltX: 0, tiltZ: 0, frameYaw, power: false, jump: false }),
  };
});
vi.mock('../src/audio/audio.ts', () => ({
  AudioManager: class {
    muted = false;
    unlock() {}
    setRoll() {}
    impact() {}
    play() {}
    dispose() {}
    setMuted(value: boolean) {
      this.muted = value;
    }
  },
}));
vi.mock('../src/controller/race-host.ts', () => ({
  RaceControllerHost: {
    create: async () => ({
      get canStart() {
        return state.phoneReady;
      },
      discardTurboRequest: () => {},
      takeTurboRequest: () => false,
      getView: () => ({ raceSupport: state.phoneReady ? 'supported' : 'unsupported' }),
      sample: () => ({ tiltX: 0, tiltZ: 0, frameYaw: 0, power: false, jump: false }),
      subscribe: () => () => {},
      sendState() {},
      dispose() {},
    }),
  },
}));
vi.mock('../src/race/visuals.ts', () => ({
  courseMarkers: () => ({ update() {}, dispose() {} }),
  raceGhost: () => ({ update() {}, dispose() {} }),
}));
vi.mock('../src/race/ghost-client.ts', () => ({
  GhostClient: class {
    async prepare(_course: RaceCourse, attempt: RaceAttempt) {
      state.prepare(attempt.id);
      return {};
    }
    cancel() {}
    dispose() {}
  },
}));
vi.mock('../src/race/storage.ts', () => ({
  RaceHistory: class {
    async list() {
      return {
        best: state.durable.find((a) => a.outcome === 'finished') ?? null,
        recent: [...state.durable].reverse(),
        persistent: true,
      };
    }
    async save(attempt: RaceAttempt) {
      await state.saveWait;
      state.durable.push(attempt);
      return { persistent: true };
    }
    async clear() {
      if (state.clearFails) throw new Error('Clear failed');
      state.durable = [];
    }
  },
}));

import { RaceSession } from '../src/race/session.ts';

let session: RaceSession | null = null;
let now = 0;
let course: RaceCourse;
beforeEach(async () => {
  state.durable = [];
  state.saveWait = null;
  state.spawnWait = null;
  state.phoneReady = true;
  state.clearFails = false;
  state.events = [];
  state.resetCount = 0;
  state.stepped = [];
  state.prepare.mockClear();
  state.engineDispose.mockClear();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'document',
    Object.assign(new EventTarget(), { hidden: false, createElement: () => ({ className: '' }) }),
  );
  vi.stubGlobal('location', { origin: 'http://localhost', search: '' });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('fetch', async () => ({ ok: true, blob: async () => new Blob() }));
  vi.stubGlobal('createImageBitmap', async () => ({ close() {} }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    state.frame = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const stage: StageData = JSON.parse(
    readFileSync(new URL('../../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
  );
  const sim = await createSimulation();
  await sim.load(stage);
  const [x, y, z] = sim.getBallState().pos;
  sim.dispose();
  course = {
    schema: 'wwm.race-course/1',
    courseId: 'course',
    title: 'Test',
    description: '',
    stage,
    textureUrl: '/texture.png',
    generatorVersion: 'test',
    seed: 1,
    gates: [
      { id: 'finish', kind: 'finish', center: [x + 0.35, y, z], normal: [1, 0], halfWidth: 2, halfHeight: 2 },
    ],
  };
  now = performance.now();
});
afterEach(() => {
  session?.dispose();
  session = null;
  vi.unstubAllGlobals();
});
async function mounted(noAutoPause = true) {
  session = new RaceSession(course, {
    countdownSec: 0,
    noAutoPause,
    inputs: Array.from({ length: 1000 }, () => ({
      tiltX: 0.3,
      tiltZ: 0,
      frameYaw: 0,
      power: true,
      jump: false,
    })),
  });
  await session.mount({
    append() {},
    replaceChildren() {},
    clientWidth: 1000,
    clientHeight: 800,
  } as unknown as HTMLElement);
  return session;
}
function frame() {
  now += 100;
  state.frame?.(now);
}
function finish(game: RaceSession) {
  for (let i = 0; i < 100 && game.getView().phase !== 'finished'; i++) frame();
  expect(game.getView().phase).toBe('finished');
}

test('immediate retry waits for previous durable save before choosing its ghost; frame stats reset', async () => {
  const game = await mounted();
  await game.start();
  let release!: () => void;
  state.saveWait = new Promise<void>((resolve) => {
    release = resolve;
  });
  finish(game);
  const completed = game.getView().result;
  expect(game.debugState().frameTimes.length).toBeGreaterThan(0);
  const retry = game.start();
  await Promise.resolve();
  await Promise.resolve();
  expect(game.getView().phase).toBe('loading');
  expect(state.prepare).not.toHaveBeenCalled();
  release();
  await retry;
  expect(game.getView().phase).toBe('countdown');
  expect(state.prepare).toHaveBeenCalledWith(completed?.id);
  expect(game.debugState().frameTimes).toEqual([]);
  expect(game.debugState().tick).toBe(0);
});
test('phone disconnected during asynchronous setup pauses before GO', async () => {
  const game = await mounted();
  await game.pair();
  game.setInput('phone');
  let release!: () => void;
  state.spawnWait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const starting = game.start();
  await Promise.resolve();
  await Promise.resolve();
  state.phoneReady = false;
  release();
  await starting;
  expect(game.getView().phase).toBe('paused');
  expect(game.getView().progress.reasons).toContain('controller-disconnect');
  frame();
  expect(game.debugState().tick).toBe(0);
});
test('dispose during retry preparation does not publish a later countdown or spawn ghosts', async () => {
  const game = await mounted();
  let release!: () => void;
  state.spawnWait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const starting = game.start();
  await Promise.resolve();
  await Promise.resolve();
  game.dispose();
  session = null;
  const view = game.getView();
  release();
  await starting;
  expect(game.getView()).toBe(view);
  expect(state.prepare).not.toHaveBeenCalled();
  expect(state.engineDispose).toHaveBeenCalledOnce();
});
test('clear-history failures resolve for UI callers and expose an actionable error', async () => {
  const game = await mounted();
  state.clearFails = true;
  await expect(game.clearHistory()).resolves.toBeUndefined();
  expect(game.getView().error).toBe('Clear failed');
});

test.each(['blur', 'hidden'])('focus latch blocks GO after %s during asynchronous loading', async (event) => {
  const game = await mounted(false);
  let release!: () => void;
  state.spawnWait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const starting = game.start();
  await Promise.resolve();
  await Promise.resolve();
  if (event === 'hidden') {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  } else window.dispatchEvent(new Event('blur'));
  release();
  await starting;
  expect(game.getView().phase).toBe('paused');
  expect(game.getView().progress.reasons).toContain('focus-loss');
  game.resume();
  frame();
  expect(game.debugState().tick).toBe(0);
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  window.dispatchEvent(new Event('focus'));
  game.resume();
  // an interrupted countdown resumes as a countdown; the next frame finishes it and the one after steps
  expect(game.getView().phase).toBe('countdown');
  frame();
  frame();
  expect(game.debugState().tick).toBeGreaterThan(0);
});

test('returning focus before asynchronous setup finishes clears the latch', async () => {
  const game = await mounted(false);
  let release!: () => void;
  state.spawnWait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const starting = game.start();
  await Promise.resolve();
  await Promise.resolve();
  window.dispatchEvent(new Event('blur'));
  window.dispatchEvent(new Event('focus'));
  release();
  await starting;
  expect(game.getView().phase).toBe('countdown');
  expect(game.getView().progress.reasons).toEqual([]);
});

test('third fall ends the attempt immediately; recovery cannot double-charge or continue an exhausted race', async () => {
  course.gates[0].center[0] = 1000;
  const game = await mounted();
  await game.start();
  frame();
  expect(game.getView().mechanics?.lives).toBe(3);
  for (let lives = 2; lives >= 0; lives--) {
    state.events.push({ type: 'fell', restartAt: course.stage.start.pos });
    frame();
    expect(game.debugState().mechanics?.lives).toBe(lives);
    if (lives > 0) {
      game.recover(); // An in-progress fall cannot request another penalty.
      state.events.push({ type: 'lost' });
      frame();
      frame();
      expect(game.debugState().mechanics?.lives).toBe(lives);
      expect(game.getView().phase).toBe('racing');
    }
  }
  expect(game.getView().phase).toBe('exhausted');
  expect(state.resetCount).toBe(2);
  const tick = game.debugState().tick;
  game.recover();
  game.resume();
  frame();
  expect(game.debugState().tick).toBe(tick);
  await Promise.resolve();
  await Promise.resolve();
  expect(state.durable.at(-1)?.outcome).toBe('abandoned');
  expect(state.durable.at(-1)?.progress.reasons).toContain('fall');
  await game.start();
  expect(game.getView().phase).toBe('countdown');
  expect(game.getView().mechanics).toMatchObject({ lives: 3, turboCharges: 0, exhausted: false });
  expect(game.debugState().tick).toBe(0);
});

test('manual recovery costs one life, debounces pending requests, and stops before resetting the last life', async () => {
  course.gates[0].center[0] = 1000;
  const game = await mounted();
  await game.start();
  frame();
  for (let lives = 2; lives >= 0; lives--) {
    game.recover();
    game.recover();
    frame();
    expect(game.getView().mechanics?.lives).toBe(lives);
  }
  expect(game.getView().phase).toBe('exhausted');
  expect(state.resetCount).toBe(2);
  expect(game.getView().progress.reasons).toContain('recovery');
});

// ── same-device touch: presentation reads never consume a press; only a fixed tick does ───────────────

async function touching() {
  session = new RaceSession(course, { countdownSec: 0, noAutoPause: true });
  await session.mount({
    append() {},
    replaceChildren() {},
    clientWidth: 1000,
    clientHeight: 800,
  } as unknown as HTMLElement);
  session.setInput('touch');
  await session.start();
  frame(); // countdown → racing (no tick yet)
  expect(session.getView().phase).toBe('racing');
  expect(state.stepped).toHaveLength(0);
  return session;
}
function frameAt(ms: number) {
  now += ms;
  state.frame?.(now);
}

test('a quick tap survives render frames that run no simulation tick, then fires exactly once', async () => {
  const game = await touching();
  const touch = game.touch;
  if (!touch) throw new Error('touch source missing');
  touch.setJump(true);
  touch.setJump(false); // finger already lifted before any tick
  frameAt(3); // 3 ms < one 120 Hz tick: zero-step frame
  frameAt(3);
  expect(state.stepped).toHaveLength(0);
  expect(touch.peek(0).jump).toBe(true); // still pending; rendering never acknowledged it
  frameAt(9); // now at least one tick
  expect(state.stepped.length).toBeGreaterThan(0);
  expect(state.stepped[0]?.jump).toBe(true);
  frameAt(40); // catch-up ticks after the acknowledgement see no new press
  expect(state.stepped.slice(1).every((s) => !s.jump)).toBe(true);
});

test('a held Jump is true on every tick without new edges; release ends it; catch-up ticks share held state', async () => {
  const game = await touching();
  const touch = game.touch;
  if (!touch) throw new Error('touch source missing');
  touch.setStick(1, 0);
  touch.setJump(true);
  frameAt(50); // ~6 catch-up ticks in one render frame
  expect(state.stepped.length).toBeGreaterThan(3);
  expect(state.stepped.every((s) => s.jump && s.power && s.tiltX !== 0)).toBe(true);
  touch.setJump(false);
  const before = state.stepped.length;
  frameAt(50);
  expect(state.stepped.slice(before).every((s) => !s.jump && s.power)).toBe(true);
});

test.each([30, 60, 120, 144])(
  'a single tap fires exactly one Jump tick at a %i Hz render rate',
  async (hz) => {
    const game = await touching();
    const touch = game.touch;
    if (!touch) throw new Error('touch source missing');
    const dt = 1000 / hz;
    for (let i = 0; i < 3; i++) frameAt(dt);
    touch.setJump(true);
    touch.setJump(false); // a tap that begins and ends between two render frames
    for (let i = 0; i < hz; i++) frameAt(dt);
    expect(state.stepped.filter((s) => s.jump)).toHaveLength(1);
  },
);

test('a press held into the countdown cannot fire at Go; pause releases every contact', async () => {
  session = new RaceSession(course, { countdownSec: 1, noAutoPause: true });
  await session.mount({
    append() {},
    replaceChildren() {},
    clientWidth: 1000,
    clientHeight: 800,
  } as unknown as HTMLElement);
  session.setInput('touch');
  await session.start();
  const touch = session.touch;
  if (!touch) throw new Error('touch source missing');
  touch.setJump(true); // finger down during the countdown
  for (let i = 0; i < 12; i++) frameAt(100); // countdown → racing (a frame is capped at 100 ms)
  frameAt(50);
  expect(session.getView().phase).toBe('racing');
  expect(state.stepped.length).toBeGreaterThan(0);
  expect(state.stepped.some((s) => s.jump)).toBe(false);
  touch.setStick(1, 0);
  session.pause();
  expect(touch.peek(0)).toMatchObject({ power: false, jump: false });
  expect(session.getView().progress.reasons).toContain('pause');
});

test('pausing a countdown resumes the countdown, keeps the practice mark, and a retry restores eligibility', async () => {
  session = new RaceSession(course, { countdownSec: 2, noAutoPause: true });
  await session.mount({
    append() {},
    replaceChildren() {},
    clientWidth: 1000,
    clientHeight: 800,
  } as unknown as HTMLElement);
  session.setInput('touch');
  await session.start();
  frameAt(500);
  session.pause();
  expect(session.getView().phase).toBe('paused');
  frameAt(5000); // time passes while paused: the countdown must not advance
  session.resume();
  expect(session.getView().phase).toBe('countdown');
  expect(session.getView().countdown).toBeGreaterThan(0);
  expect(session.getView().progress.reasons).toContain('pause');
  session.pause();
  await session.start(); // retry from the pause menu: a fresh, eligible attempt
  expect(session.getView().phase).toBe('countdown');
  expect(session.getView().progress.reasons).toEqual([]);
});
