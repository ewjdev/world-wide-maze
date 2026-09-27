import { readFileSync } from 'node:fs';
import { createSimulation } from '@wwm/physics';
import type { RaceAttempt, RaceCourse } from '@wwm/race';
import type { StageData } from '@wwm/schema';
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
        x = 0;
      },
      dispose() {},
      setLock() {},
      getBallState: ball,
      step: () => {
        x += 0.01;
        return { ball: ball(), events: [], elevators: [] };
      },
    };
  },
}));
vi.mock('@wwm/net', () => {
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
