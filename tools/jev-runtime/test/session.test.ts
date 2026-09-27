import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { JevClient } from '../../../apps/web/src/jev/client.ts';
import { ReplaySession, Session } from '../../../apps/web/src/jev/session.ts';
import { digest } from '../../../packages/maze-agent/src/contracts.ts';
import { Archive } from '../src/archive.ts';
import { JevService } from '../src/service.ts';

afterEach(() => vi.unstubAllGlobals());
it('pause and single-step preserve exact inputs across render rates, and imported replay validates checkpoints', async () => {
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('sessionStorage', { setItem: () => {}, removeItem: () => {} });
  const dir = mkdtempSync(join(tmpdir(), 'jev-session-')),
    archive = new Archive(dir),
    service = new JevService(archive, undefined);
  const api = {
    request: async (path: string, data: unknown) => {
      if (path === 'runs') return service.create(data);
      const [, id, op] = path.split('/');
      return op === 'decide' ? service.decide(id, data) : service.command(id, data);
    },
  } as unknown as JevClient;
  const snapshots: { tick: number; digest: string }[] = [];
  try {
    for (const rates of [[1 / 30], [1 / 60], [0.008, 0.037, 0.019, 0.1]]) {
      const s = new Session(api, 'first-fork', 'baseline');
      await s.create();
      await s.resume();
      for (let n = 0; n < 12; n++) s.advance(rates[n % rates.length]);
      await s.pause();
      const frozen = s.pilot.tick;
      s.advance(5);
      expect(s.pilot.tick).toBe(frozen);
      expect(s.view.savedTick).toBe(frozen);
      await s.resume(true);
      for (let n = 0; n < 10000 && !s.view.paused; n++) {
        s.advance(rates[n % rates.length]);
        if (s.busyPromise) await s.busyPromise;
        if (s.working) await new Promise(setImmediate);
      }
      expect(s.view.status).toBe('paused');
      expect(s.view.decisions).toHaveLength(1);
      const stopped = s.pilot.tick;
      s.advance(1);
      expect(s.pilot.tick).toBe(stopped);
      await s.resume();
      for (let n = 0; n < 30000 && !s.closed; n++) {
        s.advance(rates[n % rates.length]);
        if (s.busyPromise) await s.busyPromise;
        if (s.working) await new Promise(setImmediate);
      }
      expect(s.view.status).toBe('finished');
      const expected = await digest(s.pilot.ball);
      snapshots.push({ tick: s.pilot.tick, digest: expected });
      const detail = archive.detail(s.view.runId!);
      const replay = await new ReplaySession(detail).init();
      await replay.seek(detail.summary.tick);
      expect(await digest(replay.ball)).toBe(expected);
      replay.dispose();
      const invalid = structuredClone(detail);
      const chunk = invalid.events.find((e) => e.type === 'chunk')!;
      (chunk.data.chunk as { from: number }).from++;
      expect(() => new ReplaySession(invalid)).toThrow('gap');
      await s.dispose();
    }
    expect(snapshots[1]).toEqual(snapshots[0]);
    expect(snapshots[2]).toEqual(snapshots[0]);
  } finally {
    archive.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

it('archives website gem scores and exactly replays their stage, pickups, and finish bonus', async () => {
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('sessionStorage', { setItem: () => {}, removeItem: () => {} });
  const { buildStage } = await import('../../../packages/stage-builder/src/index.ts');
  const { loadCapture } = await import('../../../packages/stage-builder/src/node/index.ts');
  const { mazeFromStage } = await import('../../../packages/maze-agent/src/score.ts');
  const { capture, image } = loadCapture('hn-front');
  const { stage } = buildStage({ capture, image, sliceIndex: 0, seed: 1, difficulty: 'normal' });
  const maze = mazeFromStage(stage);
  const dir = mkdtempSync(join(tmpdir(), 'jev-website-'));
  const archive = new Archive(dir);
  const service = new JevService(archive, undefined);
  const api = {
    request: async (path: string, data: unknown) => {
      if (path === 'runs') return service.create(data);
      const [, id, op] = path.split('/');
      return op === 'decide' ? service.decide(id, data) : service.command(id, data);
    },
  } as unknown as JevClient;
  const s = new Session(api, maze.id, 'baseline', 0, maze, true);
  try {
    await s.create();
    await s.resume();
    for (let n = 0; n < 40000 && !s.closed && !s.view.error; n++) {
      s.advance(0.1);
      if (s.busyPromise) await s.busyPromise;
      if (s.working) await new Promise(setImmediate);
    }
    expect(s.view.error).toBeNull();
    expect(s.view.status).toBe('finished');
    const d = archive.detail(s.view.runId!);
    expect(d.summary.score).toBe(s.pilot.score.score);
    expect(d.summary.gems).toBeGreaterThan(0);
    const replay = await new ReplaySession(d).init();
    await replay.seek(d.summary.tick);
    expect(replay.score).toEqual(s.pilot.score);
    expect(await digest(replay.ball)).toBe(await digest(s.pilot.ball));
    await replay.seek(0);
    expect(replay.score.gems).toBe(0);
    expect(replay.score.bonus).toBe(0);
    replay.dispose();
    expect(() =>
      service.create({
        fixture: 'arbitrary',
        maze: { stage },
        scoreMode: true,
        documentId: 'doc',
        orderSeed: 0,
        policy: 'baseline',
      }),
    ).toThrow('identity');
    const changed = structuredClone(d);
    (changed.events[0].data.maze as { stage: typeof stage }).stage.seed++;
    await expect(new ReplaySession(changed).init()).rejects.toThrow('Incompatible');
  } finally {
    await s.dispose();
    archive.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
