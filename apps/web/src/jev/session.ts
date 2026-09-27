import {
  type Chunk,
  ChunkSchema,
  digest,
  type Frame,
  FrameSchema,
  fixture,
  LIMITS,
  type MazeFixture,
  MazePilot,
  mazeFromStage,
  PHYSICS_VERSION,
  type Policy,
  type Receipt,
  ReceiptSchema,
  type RunDetail,
  scoreAt,
  type TickedEvent,
  VERSION,
} from '@wwm/maze-agent';
import { createSimulation, type RapierSimulation } from '@wwm/physics';
import { type BallState, type InputSample, SIM_HZ, type SimEvent, StageDataSchema } from '@wwm/schema';
import type { JevClient } from './client.ts';
export interface SessionView {
  phase: string;
  tick: number;
  decisions: Frame[];
  receipts: Receipt[];
  current: Frame | null;
  active: Receipt | null;
  error: string | null;
  runId: string | null;
  paused: boolean;
  savedTick: number;
  lastOutcome: string | null;
  waitMs: number;
  status: string;
}
export class Session {
  view: SessionView = {
    phase: 'ready',
    tick: 0,
    decisions: [],
    receipts: [],
    current: null,
    active: null,
    error: null,
    runId: null,
    paused: true,
    savedTick: 0,
    lastOutcome: null,
    waitMs: 0,
    status: 'ready',
  };
  pilot: MazePilot;
  owner = '';
  documentId = crypto.randomUUID();
  epoch = 0;
  frameCount = 0;
  attempt = 0;
  chunkSequence = 0;
  inputs: InputSample[] = [];
  events: TickedEvent[] = [];
  acc = 0;
  working = false;
  flushing = false;
  stepOnly = false;
  closed = false;
  heartbeat = 0;
  busyPromise: Promise<void> | null = null;
  flushPromise: Promise<void> | null = null;
  onChange = () => {};
  onBall = (
    _ball: BallState,
    _events: SimEvent[],
    _input: InputSample | null,
    _elevators: { id: number; y: number }[] = [],
  ) => {};
  constructor(
    readonly api: JevClient,
    readonly fixtureId: string,
    readonly policy: Policy,
    readonly seed = 0,
    readonly maze: MazeFixture = fixture(fixtureId),
    readonly scoreMode = false,
  ) {
    this.pilot = new MazePilot(maze, seed, scoreMode);
  }
  emit() {
    this.onChange();
  }
  async create(parentRunId: string | null = null) {
    const run = await this.api.request<{ id: string; owner: string }>('runs', {
      fixture: this.fixtureId,
      policy: this.policy,
      orderSeed: this.seed,
      documentId: this.documentId,
      parentRunId,
      scoreMode: this.scoreMode,
      ...(this.scoreMode
        ? { maze: { stage: this.maze.stage, textureDataUrl: this.maze.textureDataUrl } }
        : {}),
    });
    this.view.runId = run.id;
    this.owner = run.owner;
    sessionStorage.setItem(`${this.api.ownerPrefix}${run.id}`, this.owner);
    await this.pilot.init();
    this.onBall(this.pilot.ball, [], null);
    this.heartbeat = window.setInterval(() => {
      if (!this.closed) void this.command('heartbeat', {}).catch((e) => this.fail(e));
    }, 5000);
    this.emit();
  }
  command(type: string, data: unknown) {
    return this.api.request(`runs/${this.view.runId}/command`, {
      owner: this.owner,
      documentId: this.documentId,
      epoch: this.epoch,
      type,
      data,
    });
  }
  fail(e: unknown) {
    this.view.error = e instanceof Error ? e.message : String(e);
    this.view.phase = 'error';
    this.view.paused = true;
    this.acc = 0;
    void this.command('status', { status: 'paused', reason: this.view.error.slice(0, 250) }).catch(() => {});
    this.emit();
  }
  async resume(step = false) {
    if (this.closed || this.flushing || this.working) return;
    this.stepOnly = step;
    this.view.error = null;
    this.view.paused = false;
    this.acc = 0;
    try {
      await this.command('status', { status: 'running' });
      this.view.status = 'running';
      if (this.pilot.route && this.view.active) {
        this.view.phase = 'executing';
        this.emit();
      } else await this.boundary();
    } catch (e) {
      this.fail(e);
    }
  }
  async pause() {
    if (this.closed) return;
    this.epoch++;
    this.view.paused = true;
    this.acc = 0;
    try {
      await this.flush();
      await this.command('status', { status: 'paused' });
      this.view.status = 'paused';
      this.view.phase = 'paused';
      this.emit();
    } catch (e) {
      this.fail(e);
    }
  }
  async boundary() {
    if (this.closed || this.view.paused || this.working) return;
    this.working = true;
    const epoch = this.epoch;
    try {
      this.view.phase = 'deciding';
      this.emit();
      let frame = this.view.current;
      if (!frame) {
        const candidates = this.pilot.exploration.candidates();
        frame = {
          id: `decision-${++this.frameCount}`,
          tick: this.pilot.tick,
          observation: this.pilot.exploration.observation(),
          candidates,
          digest: await digest(this.pilot.ball),
        };
        await this.command('frame', frame);
        this.view.current = frame;
        this.view.decisions.push(frame);
        this.emit();
      }
      const receipt = await this.api.request<Receipt>(`runs/${this.view.runId}/decide`, {
        owner: this.owner,
        documentId: this.documentId,
        epoch,
        decisionId: frame.id,
        attemptId: `attempt-${++this.attempt}`,
      });
      this.view.receipts.push(receipt);
      this.view.waitMs += receipt.latencyMs;
      if (epoch !== this.epoch || this.closed || this.view.paused || receipt.status === 'discarded') {
        void this.command('discard', {
          attemptId: receipt.attemptId,
          reason: 'Obsolete document state',
        }).catch(() => {});
        this.emit();
        return;
      }
      await this.command('action', { attemptId: receipt.attemptId });
      if (epoch !== this.epoch || this.closed || this.view.paused) return;
      this.pilot.choose(receipt.choice);
      this.view.active = receipt;
      this.view.phase = 'executing';
      this.acc = 0;
      this.emit();
    } catch (e) {
      if (epoch === this.epoch && !this.closed) this.fail(e);
    } finally {
      this.working = false;
      this.emit();
    }
  }
  advance(dt: number) {
    if (this.closed || this.view.paused || this.flushing || this.view.phase !== 'executing') return;
    this.acc = Math.min(0.15, this.acc + dt);
    while (this.acc >= 1 / SIM_HZ && !this.flushing && !this.view.paused) {
      const r = this.pilot.step();
      this.acc -= 1 / SIM_HZ;
      this.inputs.push(r.input);
      this.events.push(...r.result.events.map((event) => ({ tick: this.pilot.tick, event })));
      this.view.tick = this.pilot.tick;
      this.onBall(r.result.ball, r.result.events, r.input, r.result.elevators);
      if (r.outcome || this.inputs.length >= SIM_HZ) {
        this.flushing = true;
        const outcome = r.outcome;
        this.busyPromise = this.completeChunk(outcome);
        break;
      }
    }
    this.emit();
  }
  async flush() {
    if (this.flushPromise) return this.flushPromise;
    if (!this.inputs.length) return;
    this.flushPromise = this.persistChunk();
    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }
  private async persistChunk() {
    const inputs = this.inputs;
    const events = this.events;
    const chunk: Chunk = {
      sequence: this.chunkSequence,
      from: this.view.savedTick,
      to: this.pilot.tick,
      inputs,
      events,
      ball: structuredClone(this.pilot.ball),
      digest: await digest(this.pilot.ball),
    };
    await this.command('chunk', chunk);
    this.chunkSequence++;
    this.view.savedTick = chunk.to;
    this.inputs = [];
    this.events = [];
  }
  private async completeChunk(outcome: string | null) {
    try {
      await this.flush();
      if (outcome) {
        await this.command('outcome', {
          attemptId: this.view.active!.attemptId,
          outcome,
          tick: this.pilot.tick,
        });
        this.view.lastOutcome = outcome;
        this.view.active = null;
        this.pilot.route = null;
        this.view.current = null;
        if (outcome !== 'arrived') {
          await this.end(outcome === 'goal' ? 'finished' : 'failed', outcome);
          return;
        }
        if (this.stepOnly || this.view.paused) {
          this.view.paused = true;
          await this.command('status', { status: 'paused' });
          this.view.status = 'paused';
          this.view.phase = 'paused';
        } else this.view.phase = 'observing';
      }
    } catch (e) {
      this.fail(e);
    } finally {
      this.flushing = false;
      this.acc = 0;
      this.emit();
      if (!this.closed && !this.view.paused && this.view.phase === 'observing') void this.boundary();
    }
  }
  async end(status = 'stopped', reason = 'Stopped by viewer') {
    this.epoch++;
    this.view.paused = true;
    // A manual stop must let any acknowledged movement outcome settle first.
    if (status === 'stopped' && this.flushing && this.busyPromise) await this.busyPromise;
    if (this.closed) return;
    await this.flush();
    await this.command('status', { status, reason });
    this.view.status = status;
    this.view.phase = status;
    this.closed = true;
    sessionStorage.removeItem(`${this.api.ownerPrefix}${this.view.runId}`);
    window.clearInterval(this.heartbeat);
    this.emit();
  }
  async dispose() {
    try {
      if (!this.closed) {
        if (this.busyPromise) await this.busyPromise;
        await this.end();
      }
    } finally {
      this.closed = true;
      window.clearInterval(this.heartbeat);
      this.pilot.dispose();
    }
  }
}
export class ReplaySession {
  maze!: MazeFixture;
  get score() {
    const events = this.events.filter((e) => e.tick <= this.tick).map((e) => e.event);
    return scoreAt(
      this.maze.stage,
      new Set(events.flatMap((e) => (e.type === 'item' ? [e.itemId] : []))),
      this.tick,
      events.some((e) => e.type === 'goal'),
    );
  }
  speed = 1;
  sim!: RapierSimulation;
  inputs: InputSample[] = [];
  events: TickedEvent[] = [];
  frames: Frame[] = [];
  checkpoints = new Map<number, string>();
  tick = 0;
  ball!: BallState;
  paused = true;
  error: string | null = null;
  acc = 0;
  checking = false;
  onBall = (
    _ball: BallState,
    _events: SimEvent[],
    _input: InputSample | null,
    _elevators: { id: number; y: number }[] = [],
  ) => {};
  onChange = () => {};
  constructor(readonly detail: RunDetail) {
    if (
      !detail ||
      !Array.isArray(detail.events) ||
      !detail.summary ||
      detail.events.length > 10000 ||
      JSON.stringify(detail).length > LIMITS.runBytes
    )
      throw new Error('Invalid or oversized recording');
    const snapshot = detail.events[0]?.data.maze as { stage: unknown; textureDataUrl?: string } | undefined;
    if (
      snapshot?.textureDataUrl &&
      (!/^data:image\/(?:webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(snapshot.textureDataUrl) ||
        snapshot.textureDataUrl.length > 3 * 1024 * 1024)
    )
      throw new Error('Invalid recording texture');
    this.maze = snapshot
      ? mazeFromStage(StageDataSchema.parse(snapshot.stage), snapshot.textureDataUrl)
      : fixture(detail.summary.fixture);
    let sequence = 0;
    let recordingBytes = 0;
    for (const [index, e] of detail.events.entries()) {
      if (e.seq !== index + 1) throw new Error('Invalid journal sequence');
      if (e.type === 'receipt') ReceiptSchema.parse(e.data.receipt);
      if (e.type === 'chunk') {
        const c = ChunkSchema.parse(e.data.chunk);
        recordingBytes += JSON.stringify(c).length;
        if (recordingBytes > LIMITS.recording || c.sequence !== sequence++)
          throw new Error('Recording size or sequence mismatch');
        if (c.from !== this.inputs.length || c.to !== c.from + c.inputs.length)
          throw new Error('Recording has a gap');
        this.inputs.push(...c.inputs);
        this.events.push(...c.events);
        this.checkpoints.set(c.to, c.digest);
      }
      if (e.type === 'frame') {
        const f = FrameSchema.parse(e.data.frame);
        this.frames.push(f);
        this.checkpoints.set(f.tick, f.digest);
      }
    }
    if (this.inputs.length > LIMITS.ticks) throw new Error('Recording exceeds supported length');
  }
  async init() {
    if (
      this.detail.events[0]?.data.version !== VERSION ||
      this.detail.events[0]?.data.physics !== PHYSICS_VERSION ||
      (await digest(this.maze.stage)) !== this.detail.summary.fixtureHash
    )
      throw new Error('Incompatible recording version or fixture');
    this.sim = await createSimulation();
    await this.sim.load(this.maze.stage);
    this.ball = this.sim.getBallState();
    if (this.checkpoints.has(0) && (await digest(this.ball)) !== this.checkpoints.get(0))
      throw new Error('Replay mismatch at tick 0');
    this.onBall(this.ball, [], null);
    return this;
  }
  onReset = async () => {};
  async seek(target: number) {
    this.paused = true;
    await this.sim.load(this.maze.stage);
    this.tick = 0;
    this.ball = this.sim.getBallState();
    this.error = null;
    await this.onReset();
    let elevators: { id: number; y: number }[] = [];
    const events: TickedEvent[] = [];
    while (this.tick < Math.min(target, this.inputs.length)) {
      const r = this.sim.step(this.inputs[this.tick]);
      this.tick++;
      this.ball = r.ball;
      elevators = r.elevators;
      events.push(...r.events.map((event) => ({ tick: this.tick, event })));
      if (this.checkpoints.has(this.tick) && (await digest(this.ball)) !== this.checkpoints.get(this.tick))
        throw new Error(`Replay mismatch at tick ${this.tick}`);
    }
    if (JSON.stringify(events) !== JSON.stringify(this.events.filter((e) => e.tick <= this.tick)))
      throw new Error('Replay event mismatch');
    this.onBall(
      this.ball,
      events.map((e) => e.event),
      null,
      elevators,
    );
    this.onChange();
  }
  advance(dt: number) {
    if (this.paused || this.checking || this.error) return;
    this.acc = Math.min(0.15, this.acc + dt * this.speed);
    while (this.acc >= 1 / SIM_HZ && this.tick < this.inputs.length && !this.checking) {
      const input = this.inputs[this.tick];
      const r = this.sim.step(input);
      this.tick++;
      this.ball = r.ball;
      this.acc -= 1 / SIM_HZ;
      this.onBall(r.ball, r.events, input, r.elevators);
      if (
        JSON.stringify(r.events) !==
        JSON.stringify(this.events.filter((e) => e.tick === this.tick).map((e) => e.event))
      ) {
        this.error = 'Replay event mismatch';
        this.paused = true;
        break;
      }
      if (this.checkpoints.has(this.tick)) {
        this.checking = true;
        const tick = this.tick;
        void digest(this.ball).then((d) => {
          if (d !== this.checkpoints.get(tick)) {
            this.error = `Replay mismatch at tick ${tick}`;
            this.paused = true;
          }
          this.checking = false;
          this.onChange();
        });
      }
    }
    if (this.tick === this.inputs.length) this.paused = true;
    this.onChange();
  }
  dispose() {
    this.sim?.dispose();
  }
}
