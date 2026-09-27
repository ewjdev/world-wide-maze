import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Frame, LIMITS, MODEL } from '../../../packages/maze-agent/src/contracts.ts';
import { Exploration } from '../../../packages/maze-agent/src/exploration.ts';
import { fixture } from '../../../packages/maze-agent/src/fixtures.ts';
import { Archive } from '../src/archive.ts';
import { JevService } from '../src/service.ts';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0).reverse()) f();
  vi.restoreAllMocks();
});
function setup(fetcher?: typeof fetch, policy = 'jev', key: string | undefined = 'private-test-key') {
  const dir = mkdtempSync(join(tmpdir(), 'wwm-jev-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const archive = new Archive(dir);
  cleanup.push(() => archive.close());
  const service = new JevService(archive, key, fetcher);
  const run = service.create({ fixture: 'first-fork', policy, orderSeed: 0, documentId: 'document' });
  const auth = { owner: run.owner, documentId: 'document', epoch: 0 };
  const command = (type: string, data: unknown, epoch = 0) =>
    service.command(run.id, { ...auth, epoch, type, data });
  command('status', { status: 'running' });
  const x = new Exploration(fixture('first-fork'));
  const first = x.resolve(x.candidates()[0].id);
  x.arrive(first.target, first.edge);
  const frame: Frame = {
    id: 'decision-1',
    tick: 0,
    digest: 'a'.repeat(64),
    observation: x.observation(),
    candidates: x.candidates(),
  };
  command('frame', frame);
  const decide = (attemptId = 'attempt-1') =>
    service.decide(run.id, { ...auth, decisionId: frame.id, attemptId });
  return { archive, service, run, auth, frame, decide, command, dir };
}
function response(frame: Frame) {
  return {
    model: MODEL,
    answers: {
      move: {
        type: 'choice',
        choice: frame.candidates[0].id,
        confidence: 1,
        probabilities: Object.fromEntries(frame.candidates.map((c, i) => [c.id, i === 0 ? 1 : 0])),
      },
    },
    usage: { input_tokens: 120, output_tokens: 15 },
  };
}
describe('durable decision runtime', () => {
  it('reserves before dispatch, saves full response, deduplicates and survives restart', async () => {
    const s = setup();
    const fetcher = vi.fn(async () => {
      expect(s.archive.reservations).toHaveLength(1);
      return Response.json(response(s.frame));
    });
    const service = new JevService(s.archive, 'private-test-key', fetcher);
    service.owners = s.service.owners;
    const args = { ...s.auth, decisionId: s.frame.id, attemptId: 'attempt-1' };
    const first = await service.decide(s.run.id, args);
    expect(await service.decide(s.run.id, args)).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    s.archive.close();
    const recovered = new Archive(s.dir);
    cleanup.push(() => recovered.close());
    expect(recovered.summary(s.run.id).status).toBe('interrupted');
    expect(recovered.reservations).toHaveLength(1);
    expect(recovered.events(s.run.id).some((e) => e.type === 'provider-response')).toBe(true);
    expect(readFileSync(join(s.dir, 'runs', s.run.id, 'journal.ndjson'), 'utf8')).not.toContain(
      'private-test-key',
    );
    expect(JSON.stringify(recovered.detail(s.run.id))).not.toContain(s.run.owner);
  });
  it('persists delayed responses as discarded after pause; never authorizes movement', async () => {
    let release!: (value: Response) => void;
    const s = setup(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const pending = s.decide();
    await expect(s.decide('other')).rejects.toThrow('busy');
    s.command('status', { status: 'paused' }, 1);
    release(Response.json(response(s.frame)));
    expect((await pending).status).toBe('discarded');
    expect(() => s.command('action', { attemptId: 'attempt-1' }, 1)).toThrow('No current');
    expect(s.archive.reservations).toHaveLength(1);
  });
  it('records invalid provider values, retains attempts and requires an explicit retry', async () => {
    const s = setup(async () => Response.json({ model: 'wrong', answers: {} }));
    await expect(s.decide()).rejects.toThrow('Invalid provider');
    await expect(s.decide()).rejects.toThrow('new attempt');
    expect(s.archive.reservations).toHaveLength(1);
    expect(s.archive.events(s.run.id).filter((e) => e.type === 'attempt-error')).toHaveLength(1);
  });
  it('records missing credentials without spending budget', async () => {
    const s = setup(undefined, 'jev', '');
    await expect(s.decide()).rejects.toThrow('not configured');
    expect(s.archive.reservations).toHaveLength(0);
  });
  it('requires a goal sensor before completion and preserves history through more than 20 runs', () => {
    const s = setup();
    expect(() => s.command('status', { status: 'finished' })).toThrow('goal sensor');
    for (let i = 0; i < 24; i++)
      s.service.create({ fixture: 'first-fork', policy: 'baseline', orderSeed: 0, documentId: `doc${i}` });
    expect(s.archive.runs.size).toBe(25);
    s.archive.close();
    const recovered = new Archive(s.dir);
    cleanup.push(() => recovered.close());
    expect(recovered.runs.size).toBe(25);
  });
  it('history is read-only but a new document with the owner token interrupts a paused run', () => {
    const s = setup();
    s.command('status', { status: 'paused' });
    s.archive.detail(s.run.id);
    expect(s.archive.summary(s.run.id).status).toBe('paused');
    expect(() =>
      s.service.command(s.run.id, { ...s.auth, documentId: 'new-document', type: 'heartbeat', data: {} }),
    ).toThrow('interrupted');
    expect(s.archive.summary(s.run.id).status).toBe('interrupted');
  });
  it('expires disconnected active owners and blocks future decisions', async () => {
    const s = setup();
    s.service.owners.get(s.run.id)!.heartbeat = Date.now() - 31000;
    s.service.sweep();
    expect(s.archive.summary(s.run.id).status).toBe('interrupted');
    await expect(s.decide()).rejects.toThrow('ownership');
  });
  it('recovers a ledger reservation whose journal append was interrupted without redispatch', () => {
    const s = setup();
    const append = vi.spyOn(s.archive, 'append').mockImplementation(() => {
      throw new Error('injected');
    });
    expect(() => s.archive.reserve(s.run.id, 'crash', 'decision-1', 'hash')).toThrow('injected');
    append.mockRestore();
    s.archive.close();
    const recovered = new Archive(s.dir);
    cleanup.push(() => recovered.close());
    expect(recovered.reservations).toHaveLength(1);
    expect(recovered.events(s.run.id).find((e) => e.type === 'reservation')?.data.recovered).toBe(true);
    expect(() => recovered.reserve(s.run.id, 'crash', 'decision-1', 'hash')).toThrow('already reserved');
  });
  it('fails closed on a torn journal, retaining bytes for explicit recovery', () => {
    const s = setup();
    s.archive.close();
    const path = join(s.dir, 'runs', s.run.id, 'journal.ndjson');
    appendFileSync(path, '{"seq":');
    expect(() => new Archive(s.dir)).toThrow('Torn journal');
    expect(readFileSync(path, 'utf8')).toMatch(/\{"seq":$/);
  });
  it('does not reset exhausted budgets and permits closure at capacity', async () => {
    const s = setup(async () => {
      throw new Error('must not dispatch');
    });
    s.archive.reservations = Array.from({ length: LIMITS.attempts }, (_, i) => ({
      runId: s.run.id,
      attemptId: `old${i}`,
    }));
    await expect(s.decide()).rejects.toThrow('attempt limit');
    vi.spyOn(s.archive, 'bytes').mockReturnValue(LIMITS.pilotBytes - 1000);
    expect(() => s.command('status', { status: 'stopped', reason: 'Archive capacity' })).not.toThrow();
  });
});
