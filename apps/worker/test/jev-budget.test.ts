import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, test, vi } from 'vitest';
import { type Frame, MODEL } from '../../../packages/maze-agent/src/contracts.ts';
import { Exploration } from '../../../packages/maze-agent/src/exploration.ts';
import { fixture } from '../../../packages/maze-agent/src/fixtures.ts';
import { JevService } from '../../../tools/jev-runtime/src/service.ts';
import { CloudJevArchive } from '../src/jev/archive.ts';
import { JevBudget, type JevSql, RESERVATION_MICROS } from '../src/jev/budget.ts';

const dbs: DatabaseSync[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  vi.restoreAllMocks();
});
function setup() {
  const db = new DatabaseSync(':memory:');
  dbs.push(db);
  const sql = {
    exec(query: string, ...params: (string | number)[]) {
      if (query.includes(';')) {
        db.exec(query);
        return { toArray: () => [] };
      }
      const rows = db.prepare(query).all(...params);
      return {
        toArray: () => rows,
        one: () => {
          if (rows.length !== 1) throw new Error('Expected one row');
          return rows[0];
        },
      };
    },
  } as JevSql;
  let depth = 0;
  const transaction = <T>(fn: () => T): T => {
    if (depth) return fn();
    db.exec('BEGIN');
    depth++;
    try {
      const value = fn();
      db.exec('COMMIT');
      return value;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      depth--;
    }
  };
  let now = new Date('2026-09-27T23:59:00Z');
  const budget = new JevBudget(sql, transaction, () => now);
  const archive = new CloudJevArchive(sql, transaction, budget);
  return {
    db,
    sql,
    transaction,
    budget,
    archive,
    advance: () => {
      now = new Date('2026-09-28T00:01:00Z');
    },
  };
}
test('defaults off, validates cents, never resets spend on a switch or limit change', () => {
  const s = setup();
  expect(s.budget.snapshot()).toMatchObject({ enabled: false, dailyLimitMicros: 0 });
  expect(() => s.budget.reserve('r', 'a')).toThrow('disabled');
  expect(() => s.budget.configure({ enabled: true, dailyLimitCents: 0 }, 'admin')).toThrow('positive');
  expect(() => s.budget.configure({ enabled: true, dailyLimitCents: 0.5 }, 'admin')).toThrow('whole cents');
  s.budget.configure({ enabled: true, dailyLimitCents: 1 }, 'admin');
  s.budget.reserve('r', 'a');
  s.budget.configure({ enabled: false, dailyLimitCents: 0 }, 'admin');
  expect(s.budget.snapshot()).toMatchObject({ remainingMicros: 0, reservedMicros: RESERVATION_MICROS });
  s.budget.configure({ enabled: true, dailyLimitCents: 1 }, 'admin');
  expect(s.budget.snapshot().reservedMicros).toBe(RESERVATION_MICROS);
  expect(s.db.prepare('SELECT actor FROM jev_settings_audit').all()).toHaveLength(3);
});
test('concurrent reservations cannot exceed the cap, and unknown calls stay charged across reconstruction', async () => {
  const s = setup();
  s.budget.configure({ enabled: true, dailyLimitCents: 1 }, 'admin');
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, (_, i) => Promise.resolve().then(() => s.budget.reserve('run', String(i)))),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
  const recovered = new JevBudget(s.sql, s.transaction, () => new Date('2026-09-27T23:59:50Z'));
  expect(recovered.snapshot()).toMatchObject({ reservedMicros: 8064, remainingMicros: 1936 });
  expect(() => recovered.reserve('run', '0')).toThrow('already reserved');
  expect(() => recovered.settle('run', '0', 64001)).toThrow('contract');
  recovered.settle('run', '0', 1000);
  recovered.settle('run', '0', 0);
  expect(recovered.snapshot()).toMatchObject({ spentMicros: 42, reservedMicros: 5376 });
});
test('UTC rollover allows a fresh day without moving a late settlement into it', () => {
  const s = setup();
  s.budget.configure({ enabled: true, dailyLimitCents: 1 }, 'admin');
  s.budget.reserve('r', 'old');
  s.advance();
  s.budget.reserve('r', 'new');
  s.budget.settle('r', 'old', 1000);
  expect(s.budget.snapshot()).toMatchObject({ day: '2026-09-28', spentMicros: 0, reservedMicros: 2688 });
  expect(s.db.prepare('SELECT amount FROM jev_spend WHERE day=?').get('2026-09-27')).toMatchObject({
    amount: 42,
  });
});
test('journal reservation is atomic with budget, and large Unicode events survive reconstruction', () => {
  const s = setup();
  s.budget.configure({ enabled: true, dailyLimitCents: 1 }, 'admin');
  const id = s.archive.create('first-fork', 'jev', 0, null, MODEL);
  const append = vi.spyOn(s.archive, 'append').mockImplementation(() => {
    throw new Error('disk failed');
  });
  expect(() => s.archive.reserve(id, 'attempt', 'decision', 'hash')).toThrow('disk failed');
  expect(s.budget.snapshot().reservedMicros).toBe(0);
  append.mockRestore();
  const text = '🧩'.repeat(80000);
  s.archive.append(id, 'unicode', { text });
  const recovered = new CloudJevArchive(s.sql, s.transaction, s.budget);
  expect(recovered.detail(id).events[1].data.text).toBe(text);
  expect(recovered.summary(id).id).toBe(id);
});
test('shared runtime reserves before fetch, settles validated usage, retains failures and blocks disabled calls', async () => {
  const s = setup();
  const x = new Exploration(fixture('first-fork'));
  const target = x.resolve(x.candidates()[0].id);
  x.arrive(target.target, target.edge);
  const frame: Frame = {
    id: 'decision',
    tick: 0,
    digest: 'a'.repeat(64),
    observation: x.observation(),
    candidates: x.candidates(),
  };
  const fetcher = vi.fn(async () => {
    expect(s.budget.snapshot().reservedMicros).toBeGreaterThanOrEqual(2688);
    return Response.json({
      model: MODEL,
      answers: {
        move: {
          type: 'choice',
          choice: frame.candidates[0].id,
          confidence: 1,
          probabilities: Object.fromEntries(frame.candidates.map((c, i) => [c.id, i === 0 ? 1 : 0])),
        },
      },
      usage: { input_tokens: 120, output_tokens: 0 },
    });
  });
  const service = new JevService(s.archive, 'test-key', fetcher, (id, r) =>
    s.budget.settle(id, r.attemptId, r.usage!.input_tokens),
  );
  const run = service.create({ fixture: 'first-fork', policy: 'jev', documentId: 'doc', orderSeed: 0 });
  const auth = { owner: run.owner, documentId: 'doc', epoch: 0 };
  service.command(run.id, { ...auth, type: 'status', data: { status: 'running' } });
  service.command(run.id, { ...auth, type: 'frame', data: frame });
  const decide = (attemptId: string) => service.decide(run.id, { ...auth, decisionId: frame.id, attemptId });
  await expect(decide('disabled')).rejects.toThrow('disabled');
  expect(fetcher).not.toHaveBeenCalled();
  s.budget.configure({ enabled: true, dailyLimitCents: 1 }, 'admin');
  expect((await decide('good')).status).toBe('accepted');
  await decide('good');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(s.budget.snapshot()).toMatchObject({ spentMicros: 6, reservedMicros: 0 });
  fetcher.mockRejectedValueOnce(new Error('timeout'));
  await expect(decide('timeout')).rejects.toThrow('timeout');
  expect(s.budget.snapshot()).toMatchObject({ spentMicros: 6, reservedMicros: 2688 });
  s.budget.configure({ enabled: false, dailyLimitCents: 1 }, 'admin');
  await expect(decide('off')).rejects.toThrow('disabled');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
