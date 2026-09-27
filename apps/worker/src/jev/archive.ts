import type { StageData } from '@wwm/schema';
import {
  type JournalEvent,
  LIMITS,
  PHYSICS_VERSION,
  type Policy,
  type RunDetail,
  type RunSummary,
  VERSION,
} from '../../../../packages/maze-agent/src/contracts.ts';
import { fixture } from '../../../../packages/maze-agent/src/fixtures.ts';
import { mazeFromStage } from '../../../../packages/maze-agent/src/score.ts';
import { hash } from '../../../../tools/jev-runtime/src/hash.ts';
import type { JevArchive } from '../../../../tools/jev-runtime/src/service.ts';
import { summarize } from '../../../../tools/jev-runtime/src/summary.ts';
import type { JevBudget, JevSql } from './budget.ts';

/** One shared SQLite-backed DO: journals and budget reservations commit before provider dispatch. */
export class CloudJevArchive implements JevArchive {
  constructor(
    readonly sql: JevSql,
    readonly transaction: <T>(fn: () => T) => T,
    readonly budget: JevBudget,
  ) {
    sql.exec(`CREATE TABLE IF NOT EXISTS jev_runs(id TEXT PRIMARY KEY,summary TEXT NOT NULL,bytes INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS jev_events(run_id TEXT NOT NULL,seq INTEGER NOT NULL,part INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(run_id,seq,part));
      CREATE TABLE IF NOT EXISTS jev_owners(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);`);
  }
  get reservations(): Record<string, unknown>[] {
    return this.sql
      .exec<{ run_id: string; attempt_id: string }>('SELECT run_id,attempt_id FROM jev_spend')
      .toArray()
      .map((r) => ({ runId: r.run_id, attemptId: r.attempt_id }));
  }
  bytes() {
    return this.sql.exec<{ n: number }>('SELECT COALESCE(SUM(bytes),0) n FROM jev_runs').one().n;
  }
  capacity(id?: string, reserve = 1024 * 1024) {
    if (this.bytes() + reserve > LIMITS.pilotBytes)
      throw new Error('Jev archive is full; export and increase capacity before new runs');
    if (
      id &&
      this.sql.exec<{ bytes: number }>('SELECT bytes FROM jev_runs WHERE id=?', id).one().bytes + reserve >
        LIMITS.runBytes
    )
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
    const f = maze ? mazeFromStage(maze.stage, maze.textureDataUrl) : fixture(fixtureId);
    if (maze && (!scoreMode || f.id !== fixtureId))
      throw new Error('Website maze requires score mode and matching identity');
    this.capacity(undefined, JSON.stringify(maze ?? {}).length + 1024 * 1024);
    const id = crypto.randomUUID();
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
    this.transaction(() => {
      this.sql.exec('INSERT INTO jev_runs(id,summary) VALUES(?,?)', id, JSON.stringify(summary));
      this.append(id, 'created', {
        summary,
        version: VERSION,
        physics: PHYSICS_VERSION,
        controller: scoreMode ? 'score-steering/1' : 'local-steering/1',
        observation: scoreMode ? 'visible-score-targets/1' : 'island-local/1',
        limits: LIMITS,
        ...(maze ? { maze } : {}),
      });
    });
    return id;
  }
  events(id: string): JournalEvent[] {
    this.summary(id);
    const rows = this.sql
      .exec<{ seq: number; body: string }>(
        'SELECT seq,body FROM jev_events WHERE run_id=? ORDER BY seq,part',
        id,
      )
      .toArray();
    const merged = new Map<number, string>();
    for (const r of rows) merged.set(r.seq, (merged.get(r.seq) ?? '') + r.body);
    return [...merged.values()].map((s) => JSON.parse(s));
  }
  append(id: string, type: string, data: Record<string, unknown>) {
    return this.transaction(() => {
      const events = this.events(id);
      const event = { seq: events.length + 1, at: new Date().toISOString(), type, data };
      const body = JSON.stringify(event);
      this.capacity(id, new TextEncoder().encode(body).length);
      // Keep individual SQL values safely below the DO row-size limit, including stage textures.
      for (let offset = 0, part = 0; offset < body.length; part++) {
        let end = Math.min(body.length, offset + 64 * 1024);
        const last = body.charCodeAt(end - 1);
        if (last >= 0xd800 && last <= 0xdbff) end--;
        this.sql.exec('INSERT INTO jev_events VALUES(?,?,?,?)', id, event.seq, part, body.slice(offset, end));
        offset = end;
      }
      events.push(event);
      this.sql.exec(
        'UPDATE jev_runs SET summary=?,bytes=bytes+? WHERE id=?',
        JSON.stringify(summarize(events)),
        new TextEncoder().encode(body).length,
        id,
      );
      return event;
    });
  }
  reserve(id: string, attemptId: string, decisionId: string, payloadHash: string) {
    this.capacity(id);
    if (this.summary(id).attempts >= LIMITS.attempts)
      throw new Error('Per-run provider attempt limit reached');
    this.transaction(() => {
      this.budget.reserve(id, attemptId);
      this.append(id, 'reservation', {
        runId: id,
        attemptId,
        decisionId,
        payloadHash,
        at: new Date().toISOString(),
      });
    });
  }
  summary(id: string): RunSummary {
    const r = this.sql.exec<{ summary: string }>('SELECT summary FROM jev_runs WHERE id=?', id).toArray()[0];
    if (!r) throw new Error('Unknown run');
    return JSON.parse(r.summary);
  }
  list() {
    return this.sql
      .exec<{ summary: string }>('SELECT summary FROM jev_runs ORDER BY rowid DESC')
      .toArray()
      .map((r) => JSON.parse(r.summary) as RunSummary);
  }
  detail(id: string): RunDetail {
    return { summary: this.summary(id), events: this.events(id), artifacts: {} };
  }
}
