import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { StageData } from '@wwm/schema';
import type {
  JournalEvent,
  Policy,
  RunDetail,
  RunSummary,
} from '../../../packages/maze-agent/src/contracts.ts';
import { LIMITS, PHYSICS_VERSION, VERSION } from '../../../packages/maze-agent/src/contracts.ts';
import { fixture } from '../../../packages/maze-agent/src/fixtures.ts';
import { mazeFromStage } from '../../../packages/maze-agent/src/score.ts';
import { hash } from './hash.ts';
import { summarize } from './summary.ts';

export { hash } from './hash.ts';
export class Archive {
  runs = new Map<string, JournalEvent[]>();
  reservations: Record<string, unknown>[] = [];
  private lock: number;
  private released = false;
  private fault: Error | null = null;
  constructor(readonly dir: string) {
    mkdirSync(join(dir, 'runs'), { recursive: true });
    try {
      this.lock = openSync(join(dir, 'process.lock'), 'wx', 0o600);
    } catch {
      throw new Error('Archive is already locked. Check the owning process before explicit lock recovery.');
    }
    try {
      const bytes = Buffer.from(JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
      let offset = 0;
      while (offset < bytes.length) {
        const written = writeSync(this.lock, bytes, offset, bytes.length - offset);
        if (written <= 0) throw new Error('Incomplete lock write');
        offset += written;
      }
      fsyncSync(this.lock);
    } catch (e) {
      this.close();
      throw new Error('Could not persist archive ownership', { cause: e });
    }
    try {
      this.reservations = this.read(join(dir, 'attempts.ndjson')) as Record<string, unknown>[];
      for (const id of readdirSync(join(dir, 'runs'))) {
        if (!/^[a-f0-9-]{36}$/.test(id)) continue;
        const events = this.read(join(dir, 'runs', id, 'journal.ndjson')) as JournalEvent[];
        if (events.some((e, i) => e.seq !== i + 1)) throw new Error('Corrupt run sequence');
        this.runs.set(id, events);
      }
      for (const [id] of this.runs) {
        const s = this.summary(id);
        if (['running', 'ready', 'paused'].includes(s.status))
          this.append(id, 'status', {
            status: 'interrupted',
            reason: 'Server restarted; saved evidence retained',
          });
      }
      for (const r of this.reservations) {
        const id = String(r.runId);
        if (
          this.runs.has(id) &&
          !this.events(id).some((e) => e.type === 'reservation' && e.data.attemptId === r.attemptId)
        )
          this.append(id, 'reservation', { ...r, recovered: true, outcome: 'unknown' });
      }
    } catch (e) {
      this.close();
      throw e;
    }
  }
  private read(file: string): unknown[] {
    if (!existsSync(file)) return [];
    const text = readFileSync(file, 'utf8');
    if (text && !text.endsWith('\n')) throw new Error(`Torn journal: explicit recovery required (${file})`);
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  private write(file: string, value: unknown) {
    if (this.fault) throw this.fault;
    const isNew = !existsSync(file);
    const fd = openSync(file, 'a', 0o600);
    try {
      const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
      let offset = 0;
      while (offset < bytes.length) {
        const written = writeSync(fd, bytes, offset, bytes.length - offset);
        if (written <= 0) throw new Error('Incomplete archive write');
        offset += written;
      }
      fsyncSync(fd);
      if (isNew) {
        const parent = openSync(dirname(file), 'r');
        try {
          fsyncSync(parent);
        } finally {
          closeSync(parent);
        }
      }
    } catch (e) {
      this.fault = new Error('Archive write failed; restart and explicitly recover before further mutation', {
        cause: e,
      });
      throw this.fault;
    } finally {
      closeSync(fd);
    }
  }
  bytes() {
    let n = existsSync(join(this.dir, 'attempts.ndjson'))
      ? statSync(join(this.dir, 'attempts.ndjson')).size
      : 0;
    for (const id of this.runs.keys()) n += statSync(join(this.dir, 'runs', id, 'journal.ndjson')).size;
    return n;
  }
  capacity(id?: string, reserve = 1024 * 1024) {
    if (this.fault) throw this.fault;
    if (this.bytes() + reserve > LIMITS.pilotBytes)
      throw new Error('Archive limit reached; export history or explicitly raise capacity');
    if (id && statSync(join(this.dir, 'runs', id, 'journal.ndjson')).size + reserve > LIMITS.runBytes)
      throw new Error('Run archive limit reached');
  }
  create(
    fixtureId: string,
    policy: Policy,
    orderSeed: number,
    parentRunId: string | null,
    model: string | null,
    maze?: { stage: StageData; textureDataUrl?: string },
    scoreMode = false,
  ) {
    this.capacity();
    const f = maze ? mazeFromStage(maze.stage, maze.textureDataUrl) : fixture(fixtureId);
    if (maze && (!scoreMode || f.id !== fixtureId))
      throw new Error('Website maze requires score mode and matching identity');
    this.capacity(undefined, JSON.stringify(maze ?? {}).length + 1024 * 1024);
    const id = randomUUID();
    const pending = join(this.dir, 'runs', `.creating-${id}`);
    mkdirSync(pending);
    const summary: RunSummary = {
      id,
      fixture: fixtureId,
      fixtureHash: hash(f.stage),
      policy,
      model,
      orderSeed,
      parentRunId,
      createdAt: new Date().toISOString(),
      endedAt: null,
      status: 'ready',
      reason: null,
      tick: 0,
      decisions: 0,
      attempts: 0,
      actions: 0,
      saved: true,
      title: f.title,
      url: f.stage.source.url,
      scoreMode,
      score: 0,
      gems: 0,
    };
    const data = {
      summary,
      version: VERSION,
      physics: PHYSICS_VERSION,
      controller: scoreMode ? 'score-steering/1' : 'local-steering/1',
      observation: scoreMode ? 'visible-score-targets/1' : 'island-local/1',
      ...(maze ? { maze } : {}),
      limits: LIMITS,
    };
    const first = { seq: 1, at: new Date().toISOString(), type: 'created', data };
    this.write(join(pending, 'journal.ndjson'), first);
    renameSync(pending, join(this.dir, 'runs', id));
    this.runs.set(id, [first]);
    for (const path of [join(this.dir, 'runs', id), join(this.dir, 'runs'), this.dir]) {
      const fd = openSync(path, 'r');
      fsyncSync(fd);
      closeSync(fd);
    }
    return id;
  }
  events(id: string) {
    const e = this.runs.get(id);
    if (!e) throw new Error('Unknown run');
    return e;
  }
  append(id: string, type: string, data: Record<string, unknown>) {
    const events = this.events(id);
    const event = { seq: events.length + 1, at: new Date().toISOString(), type, data };
    this.write(join(this.dir, 'runs', id, 'journal.ndjson'), event);
    events.push(event);
    return event;
  }
  reserve(id: string, attemptId: string, decisionId: string, payloadHash: string) {
    this.capacity(id);
    if (
      this.reservations.length >= LIMITS.pilotAttempts ||
      this.reservations.filter((r) => r.runId === id).length >= LIMITS.attempts
    )
      throw new Error('Provider attempt limit reached');
    if (this.reservations.some((r) => r.runId === id && r.attemptId === attemptId))
      throw new Error('Attempt already reserved; outcome may be unknown');
    const r = { runId: id, attemptId, decisionId, payloadHash, at: new Date().toISOString() };
    this.write(join(this.dir, 'attempts.ndjson'), r);
    this.reservations.push(r);
    this.append(id, 'reservation', r);
  }
  summary(id: string): RunSummary {
    return summarize(this.events(id));
  }
  detail(id: string): RunDetail {
    return { summary: this.summary(id), events: this.events(id), artifacts: {} };
  }
  close() {
    if (this.released) return;
    this.released = true;
    closeSync(this.lock);
    unlinkSync(join(this.dir, 'process.lock'));
  }
}
