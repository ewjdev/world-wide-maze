import { createHash } from 'node:crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AudioManager } from '../src/audio/audio.ts';
import { buildRoll, buildSfx, type PreparedAudio } from '../src/audio/synthesis.ts';

// Frozen before extraction: accepted #30 production synthesis prototype, all 18 cues.
const expected = {
  item: '49be468c30d205de63a24a8d9abe95bf723598e53b72859b193ed1927914daeb',
  large: '7cc582536da8dbc1881672ce396d5da015cbbd65c4fde8936b577e62faa0ca56',
  jump: 'c0345584fda97f18943c334df37279ce26308a7fe9080d2b5185690059b01483',
  land: '7fd000b8ecd9c8ba878dfec40d2ec655b12c3a8bf4f9be4a3dcb05129e31fa45',
  bump: '5f0bf72c250e1bfc35c155288866e0458353e0c9bd9e3ae63ac6107d237e5fdc',
  fall: '91e48d8143549ab16bf9034873b03340116a3a9d14cf9bc53808ca25ba29fa8d',
  splash: '0015d5c0d39423654f3c709dd3c5da3e972f7ef16ccdf84964e8fa8b5bae37c7',
  elevator: '1d26b5510fbd4c45531c8869b6590f082bac5e5b13dada010ac8c42d860764b7',
  getGoal: 'b1d408d3ea6617060f129e351b04bdaefd52edf6d25e50bedbba53fe120c98dc',
  goal: '06a97826f088fd7909a2a4c7749375e549b88b1097d9421085c959d0eba5b6d1',
  firework: '86982cc5b55d9766622a402c08c15c1d38483f500760eaafed672737214dd20e',
  caution: '560218ad844f32aa51867560fa9072eea842c7872024eedb116b99665b0387e9',
  click: '4216a19121c40818e3a51a19e6bc2463d30196007792326f2b02eb5d111e9604',
  point: '4c7a3309fe90bada03b6b4b6988c0c6366087acf23689649718856f272fdda8f',
  oneup: '886eb26a96dd1828b2ecf8968716e5e55762d7d8498063ed3d721eea23bc88ba',
  connected: '5a7c9793b92d22b79e95580c8553b21a9f8cef70091c8504d36f4ba149274cae',
  tick: 'ce39d9fdac9234571fee78b51a1cfe5a3ec92de47b3153bd17b6c1ae19daf508',
  go: '859c7871f5f10e2a10ac30253a45678c0a465cb3339de4ed313e53ec1a62bcbf',
};
const hash = (a: Float32Array) =>
  createHash('sha256')
    .update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength))
    .digest('hex');

class FakeWorker {
  onmessage: ((e: { data: PreparedAudio }) => void) | null = null;
  onerror: ((e: { preventDefault(): void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  send(data: PreparedAudio) {
    const transferred = structuredClone(data);
    this.onmessage?.({ data: transferred });
    return transferred;
  }
}
const param = () => ({
  value: 0,
  setValueAtTime: vi.fn(),
  setTargetAtTime: vi.fn(),
  linearRampToValueAtTime: vi.fn(),
  exponentialRampToValueAtTime: vi.fn(),
});
const node = () => ({
  connect: vi.fn(function (this: unknown) {
    return this;
  }),
  disconnect: vi.fn(),
  gain: param(),
  playbackRate: param(),
  frequency: param(),
  start: vi.fn(),
  stop: vi.fn(),
  onended: null as (() => void) | null,
  buffer: undefined as unknown,
  loop: false,
  type: '',
});
class FakeContext {
  static instances: FakeContext[] = [];
  state = 'running';
  currentTime = 1;
  destination = {};
  sources: ReturnType<typeof node>[] = [];
  oscillators: ReturnType<typeof node>[] = [];
  buffers: { copyToChannel: ReturnType<typeof vi.fn> }[] = [];
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  constructor() {
    FakeContext.instances.push(this);
  }
  createGain = node;
  createBiquadFilter = node;
  createBufferSource() {
    const n = node();
    this.sources.push(n);
    return n;
  }
  createOscillator() {
    const n = node();
    this.oscillators.push(n);
    return n;
  }
  createBuffer() {
    const b = { copyToChannel: vi.fn() };
    this.buffers.push(b);
    return b;
  }
}
const data: PreparedAudio = {
  sfx: Object.fromEntries(
    Object.keys(expected).map((k) => [k, new Float32Array([0.1, 0.2])]),
  ) as PreparedAudio['sfx'],
  roll: new Float32Array([0.3]),
};
function setup() {
  vi.useFakeTimers();
  vi.stubGlobal('AudioContext', FakeContext);
  FakeContext.instances = [];
  const worker = new FakeWorker();
  const createWorker = vi.fn(() => worker as unknown as Worker);
  const audio = new AudioManager({ muted: false, createWorker });
  return { audio, worker, createWorker };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('prepared audio', () => {
  test('all original PCM hashes and sample bytes remain exact', () => {
    const sfx = buildSfx();
    expect(Object.fromEntries(Object.entries(sfx).map(([k, v]) => [k, hash(v)]))).toEqual(expected);
    expect(Object.values(sfx).reduce((n, a) => n + a.byteLength, 0)).toBe(2273788);
    expect(buildRoll()).toHaveLength(44100);
    expect(hash(buildRoll())).toBe('4d3e35c2d17e49f72add68585bebb5ab376615d0c950476ed93eaa57d93175c4');
  });
  test('preparation is idempotent, creates no context and releases the worker', () => {
    const { audio, worker, createWorker } = setup();
    audio.prepare();
    audio.prepare();
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(FakeContext.instances).toHaveLength(0);
    const transferred = worker.send(data);
    expect(audio.preparation).toBe('ready');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    audio.unlock();
    const ctx = FakeContext.instances[0] as FakeContext;
    expect(ctx.buffers).toHaveLength(0); // no bulk allocation/copy on first input
    audio.play('jump');
    audio.play('jump');
    expect(ctx.buffers).toHaveLength(1);
    expect(ctx.buffers[0]?.copyToChannel).toHaveBeenCalledWith(data.sfx.jump, 0);
    expect(ctx.sources).toHaveLength(2);
    expect(transferred.sfx.jump).toBeUndefined();
    audio.setRoll(5, true);
    expect(transferred.roll).toBeNull();
    audio.dispose();
  });
  test('early cues receive immediate bounded feedback and never replay when samples arrive', () => {
    const { audio, worker } = setup();
    audio.unlock();
    const ctx = FakeContext.instances[0] as FakeContext;
    for (let i = 0; i < 20; i++) audio.play('jump');
    expect(ctx.oscillators).toHaveLength(8);
    for (const o of ctx.oscillators) {
      expect(o.start).toHaveBeenCalledOnce();
      expect(o.stop).toHaveBeenCalledWith(1.08);
      o.onended?.();
    }
    worker.send(data);
    expect(ctx.sources).toHaveLength(0);
    audio.play('jump');
    expect(ctx.sources).toHaveLength(1);
    audio.dispose();
  });
  test.each(['error', 'messageerror', 'timeout', 'constructor'] as const)(
    'worker %s degrades without a synchronous synthesis fallback',
    (kind) => {
      const { audio: original, worker } = setup();
      const audio =
        kind === 'constructor'
          ? new AudioManager({
              muted: false,
              createWorker: () => {
                throw new Error('blocked');
              },
            })
          : original;
      audio.prepare();
      if (kind === 'error') worker.onerror?.({ preventDefault: vi.fn() });
      if (kind === 'messageerror') worker.onmessageerror?.();
      if (kind === 'timeout') vi.advanceTimersByTime(15000);
      expect(audio.preparation).toBe('failed');
      audio.unlock();
      audio.play('jump');
      expect((FakeContext.instances[0] as FakeContext).oscillators).toHaveLength(1);
      expect((FakeContext.instances[0] as FakeContext).buffers).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      audio.dispose();
    },
  );
  test('pending resume has 8-cue bound, expiry, and no mute or rejection replay', async () => {
    const { audio, worker } = setup();
    worker.send(data);
    audio.unlock();
    const ctx = FakeContext.instances[0] as FakeContext;
    ctx.state = 'suspended';
    let resumed!: () => void;
    ctx.resume = vi.fn(
      () =>
        new Promise<void>((r) => {
          resumed = () => {
            ctx.state = 'running';
            r();
          };
        }),
    );
    audio.unlock();
    for (let i = 0; i < 20; i++) audio.play('click');
    resumed();
    await Promise.resolve();
    expect(ctx.oscillators).toHaveLength(8);
    for (const o of ctx.oscillators) o.onended?.();
    ctx.state = 'suspended';
    audio.unlock();
    audio.play('jump');
    vi.advanceTimersByTime(501);
    resumed();
    await Promise.resolve();
    expect(ctx.oscillators).toHaveLength(8);
    ctx.state = 'suspended';
    audio.unlock();
    audio.play('jump');
    audio.setMuted(true);
    resumed();
    await Promise.resolve();
    audio.setMuted(false);
    expect(ctx.oscillators).toHaveLength(8);
    ctx.state = 'suspended';
    ctx.resume = vi.fn(async () => {
      throw new Error('denied');
    });
    audio.unlock();
    audio.play('jump');
    await Promise.resolve();
    ctx.state = 'running';
    audio.unlock();
    expect(ctx.oscillators).toHaveLength(8);
    audio.dispose();
  });
  test('music waits for successful gesture resume instead of scheduling into a suspended context', async () => {
    const { audio } = setup();
    audio.unlock();
    const ctx = FakeContext.instances[0] as FakeContext;
    ctx.state = 'suspended';
    audio.setMusic('game');
    expect(ctx.oscillators).toHaveLength(0);
    audio.unlock();
    await Promise.resolve();
    expect(ctx.oscillators.length).toBeGreaterThan(0);
    audio.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  test('dispose cancels pending preparation/resume and cannot resurrect resources', async () => {
    const { audio, worker } = setup();
    audio.unlock();
    const ctx = FakeContext.instances[0] as FakeContext;
    ctx.state = 'suspended';
    let resumed!: () => void;
    ctx.resume = vi.fn(
      () =>
        new Promise<void>((r) => {
          resumed = () => {
            ctx.state = 'running';
            r();
          };
        }),
    );
    audio.unlock();
    audio.play('jump');
    audio.dispose();
    audio.dispose();
    worker.send(data);
    resumed();
    await Promise.resolve();
    audio.unlock();
    audio.play('jump');
    audio.prepare();
    expect(ctx.sources).toHaveLength(0);
    expect(ctx.oscillators).toHaveLength(0);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(audio.preparation).toBe('disposed');
    expect(vi.getTimerCount()).toBe(0);
  });
  test('mute prevents fallback and prepared cues and rolling PCM is never synthesized on input', () => {
    const { audio, worker } = setup();
    audio.unlock();
    const ctx = FakeContext.instances[0] as FakeContext;
    audio.setMuted(true);
    audio.play('jump');
    expect(ctx.oscillators).toHaveLength(0);
    audio.setRoll(5, true);
    expect(ctx.buffers).toHaveLength(0);
    worker.send(data);
    audio.play('jump');
    expect(ctx.sources).toHaveLength(0);
    audio.setRoll(5, true);
    expect(ctx.buffers[0]?.copyToChannel).toHaveBeenCalledWith(data.roll, 0);
    audio.dispose();
    expect(ctx.sources[0]?.stop).toHaveBeenCalledOnce();
  });
});
