import { afterEach, describe, expect, test, vi } from 'vitest';
import { fixture } from './helpers/catalog-fixture.ts';

const fixtures: ReturnType<typeof fixture>[] = [];
const setup = (before?: Parameters<typeof fixture>[0]) => {
  const f = fixture(before);
  fixtures.push(f);
  return f;
};
afterEach(() => {
  for (const f of fixtures.splice(0)) f.close();
});

describe('durable catalog and authoritative policy', () => {
  test('D1 resolves approved complete artifacts after KV loss; missing texture refuses reuse', async () => {
    const f = setup();
    f.run('a');
    await f.record('a');
    expect(await f.cat.resolveVariant('key')).toBe('a');
    f.objects.delete('textures/capture-a/0.webp');
    expect(await f.cat.resolveVariant('key')).toBeNull();
  });
  test('pending refresh preserves approved pointer and pending duplicates are discoverable', async () => {
    const f = setup();
    f.run('a');
    await f.record('a');
    f.run('b');
    await f.record('b', 'pending_review');
    expect(await f.cat.resolveVariant('key')).toBe('a');
    expect(await f.cat.pendingVariant('key')).toBe('b');
    expect(await f.cat.canServeRun('b')).toBe(false);
    expect(await f.cat.canServeStage('stage-b')).toBe(false);
    await f.cat.decide('b', 'approved', 'Reviewed all evidence', 'operator@example.com');
    expect(await f.cat.resolveVariant('key')).toBe('b');
  });
  test('exact URL and parent-domain block override warm pointers without suffix overblocking', async () => {
    const f = setup();
    f.run('a', 'https://sub.example.com/page');
    await f.record('a', 'approved', 'https://sub.example.com/page');
    await f.cat.setRule('domain', 'example.com', true, 'Explicit content', 'operator');
    expect(await f.cat.canServeStage('stage-a')).toBe(false);
    expect(await f.cat.resolveVariant('key')).toBeNull();
    expect(await f.cat.isUrlBlocked('https://notexample.com/')).toBe(false);
    await f.cat.setRule('domain', 'example.com', false, 'Appeal accepted', 'operator');
    expect(await f.cat.canServeRun('a')).toBe(true);
    await f.cat.setRule('url', 'https://sub.example.com/page', true, 'Page block', 'operator');
    expect(await f.cat.canServeRun('a')).toBe(false);
    expect(await f.cat.isUrlBlocked('https://sub.example.com/other')).toBe(false);
  });
  test('submitted and final URL are both checked including a block during capture', async () => {
    const f = setup();
    f.run('a', 'https://destination.com/');
    await f.cat.setRule('domain', 'source.com', true, 'Block before publication', 'operator');
    await f.record('a', 'approved', 'https://destination.com/', 'key', 'capture-a', 'https://source.com/');
    expect(await f.cat.canServeRun('a')).toBe(false);
    expect((await f.cat.detail('a'))?.status).toBe('blocked');
    await expect(f.cat.decide('a', 'approved', 'Override', 'operator')).rejects.toThrow('Clear URL/domain');
  });
  test('legacy optout blocks direct IDs and cannot be cleared by moderation rule', async () => {
    const f = setup();
    f.run('a');
    await f.record('a');
    f.cache.set('optout:example.com', '1');
    await f.cat.setRule('domain', 'example.com', false, 'Content appeal', 'operator');
    expect(await f.cat.canServeRun('a')).toBe(false);
  });
  test('unknown historic IDs and incomplete builds fail closed', async () => {
    const f = setup();
    f.run('a');
    expect(await f.cat.canServeRun('a')).toBe(false);
    await f.record('a');
    f.sqlite.prepare("UPDATE runs SET status='building' WHERE run_id='a'").run();
    expect(await f.cat.canServeRun('a')).toBe(false);
    expect(await f.cat.canServeRun('missing')).toBe(false);
  });
  test('repeat content IDs cannot undo human block', async () => {
    const f = setup();
    f.run('a');
    await f.record('a');
    await f.cat.decide('a', 'blocked', 'Human rejected', 'operator');
    await f.record('a');
    expect(await f.cat.canServeRun('a')).toBe(false);
  });
  test('build claims are atomic and only the owner can clear them', async () => {
    const f = setup();
    const owners = await Promise.all([f.cat.claimBuild('key', 'job-a'), f.cat.claimBuild('key', 'job-b')]);
    expect(owners).toEqual(['job-a', 'job-a']);
    await f.cat.clearBuildClaim('key', 'job-b');
    expect(await f.cat.claimBuild('key', 'job-c')).toBe('job-a');
    await f.cat.clearBuildClaim('key', 'job-a');
    expect(await f.cat.claimBuild('key', 'job-c')).toBe('job-c');
    f.sqlite.prepare('UPDATE build_claims SET expires_at=0').run();
    expect(await f.cat.claimBuild('key', 'job-d')).toBe('job-d');
  });
  test('remove revokes first, preserves history, paginates R2, and protects shared capture objects', async () => {
    const f = setup();
    f.run('a', 'https://example.com/', 'shared');
    f.run('b', 'https://example.com/', 'shared');
    await f.record('a', 'approved', 'https://example.com/', 'a', 'shared');
    await f.record('b', 'approved', 'https://example.com/', 'b', 'shared');
    for (let i = 0; i < 6; i++) f.objects.set(`textures/shared/${i}.webp`, 't');
    await f.cat.removeArtifacts('a', 'Requested removal', 'operator');
    expect(f.objects.has('textures/shared/0.webp')).toBe(true);
    expect(await f.cat.canServeRun('a')).toBe(false);
    expect(await f.cat.canServeRun('b')).toBe(true);
    expect((await f.cat.detail('a'))?.events.some((e) => e.action === 'remove-artifacts')).toBe(true);
    await f.cat.removeArtifacts('b', 'Requested removal', 'operator');
    expect([...f.objects.keys()]).toEqual([]);
    expect((await f.cat.detail('b'))?.artifactsAvailable).toBe(false);
    await expect(f.cat.decide('a', 'approved', 'Appeal', 'operator')).rejects.toThrow('Artifacts removed');
  });
  test('retention expiry preserves verdict and metadata', async () => {
    const f = setup();
    f.run('a');
    await f.record('a');
    await f.cat.expireArtifacts('a');
    expect(await f.cat.detail('a')).toMatchObject({ status: 'approved', artifactsAvailable: false });
    expect(await f.cat.resolveVariant('key')).toBeNull();
  });
  test('admin queue pagination, decisions and attempts persist with attributable events', async () => {
    const f = setup();
    f.run('a');
    f.run('b');
    await f.record('a', 'pending_review');
    await f.record('b', 'pending_review');
    const first = await f.cat.list({ status: 'pending_review', limit: 1 });
    expect(first.items.map((x) => x.runId)).toEqual(['b']);
    expect(
      (await f.cat.list({ cursor: first.nextCursor ?? undefined, limit: 1 })).items.map((x) => x.runId),
    ).toEqual(['a']);
    await f.cat.decide('a', 'approved', 'Reviewed screenshot and texture', 'operator@example.com');
    expect((await f.cat.detail('a'))?.events).toContainEqual(
      expect.objectContaining({ actor: 'operator@example.com', action: 'decision:approved' }),
    );
    await f.cat.recordAttempt({
      jobId: 'job',
      url: 'https://failed.com/',
      status: 'failed',
      reason: 'Provider timeout',
    });
    expect(f.sqlite.prepare('SELECT * FROM url_catalog WHERE host=?').get('failed.com')).toBeTruthy();
    expect(f.sqlite.prepare('SELECT status FROM capture_attempts WHERE job_id=?').get('job')).toMatchObject({
      status: 'failed',
    });
  });
  test('approval refuses capture-only evidence without any built stage', async () => {
    const f = setup();
    f.run('a');
    await f.record('a', 'blocked');
    f.sqlite.prepare('DELETE FROM stages').run();
    await expect(f.cat.decide('a', 'approved', 'Review', 'operator')).rejects.toThrow('Artifacts incomplete');
  });
  test('migration backfill preserves curated approval and requires review for unknown history', async () => {
    const f = setup((db) => {
      for (const id of ['curated', 'unreviewed'])
        db.prepare(
          `INSERT INTO runs(run_id,url,title,capture_id,slice_count,difficulty,seed,builder_version,status,created_at) VALUES (?,'https://example.com/','title',?,1,'normal',42,'v1','complete','2026-09-25')`,
        ).run(id, id);
      db.prepare("INSERT INTO curated VALUES ('curated','title','https://example.com/','thumb',1,1)").run();
    });
    expect(await f.cat.canServeRun('curated')).toBe(true);
    expect(await f.cat.canServeRun('unreviewed')).toBe(false);
    expect((await f.cat.detail('unreviewed'))?.status).toBe('pending_review');
  });
  test('failed refresh cannot replace the approved pointer and unfinished pending is retryable', async () => {
    const f = setup();
    f.run('a');
    await f.record('a');
    f.run('b');
    f.sqlite.prepare("UPDATE runs SET status='building' WHERE run_id='b'").run();
    await f.record('b', 'approved');
    expect(await f.cat.resolveVariant('key')).toBe('a');
    expect(await f.cat.publishVariant('key', 'b')).toBe(false);
    f.sqlite.prepare("UPDATE moderation_cases SET status='pending_review' WHERE run_id='b'").run();
    expect(await f.cat.pendingVariant('key')).toBeNull();
    await expect(f.cat.decide('b', 'approved', 'Review', 'operator')).rejects.toThrow('not ready');
  });
  test('exact root URL rule does not become a domain-wide optout', async () => {
    const f = setup();
    await f.cat.setRule('url', 'https://example.com/', true, 'Root only', 'operator');
    expect(await f.cat.isUrlBlocked('https://example.com/')).toBe(true);
    expect(await f.cat.isHostBlocked('example.com')).toBe(false);
    expect(await f.cat.isUrlBlocked('https://example.com/other')).toBe(false);
  });
  test('interrupted removal remains revoked and marked for an idempotent retry', async () => {
    const f = setup();
    f.run('a');
    await f.record('a');
    f.objects.set('share/stage-a.png', 'hero');
    f.objects.set('replays/stage-a/test.json', 'replay');
    const deletion = vi.spyOn(f.env.STAGES, 'delete').mockRejectedValueOnce(new Error('R2 unavailable'));
    await expect(f.cat.removeArtifacts('a', 'Remove', 'operator')).rejects.toThrow('R2 unavailable');
    expect(await f.cat.canServeRun('a')).toBe(false);
    expect(f.sqlite.prepare('SELECT deletion_pending FROM moderation_cases').get()).toMatchObject({
      deletion_pending: 1,
    });
    deletion.mockRestore();
    await f.cat.expireArtifacts('a');
    expect(f.objects.size).toBe(0);
    expect(f.sqlite.prepare('SELECT deletion_pending FROM moderation_cases').get()).toMatchObject({
      deletion_pending: 0,
    });
  });
  test('recent attempts use timestamp ordering and deterministic cursor ties', async () => {
    const f = setup();
    for (const jobId of ['z-old', 'b-new', 'a-new'])
      await f.cat.recordAttempt({ jobId, url: 'https://example.com/', status: 'failed' });
    f.sqlite.exec("UPDATE capture_attempts SET updated_at='2026-09-25T10:00:00.000Z' WHERE job_id='z-old'");
    f.sqlite.exec("UPDATE capture_attempts SET updated_at='2026-09-26T10:00:00.000Z' WHERE job_id!='z-old'");
    const first = await f.cat.attempts({ limit: 1 });
    expect(first.items.map((a) => a.jobId)).toEqual(['b-new']);
    const second = await f.cat.attempts({ limit: 1, cursor: first.nextCursor ?? undefined });
    expect(second.items.map((a) => a.jobId)).toEqual(['a-new']);
    const third = await f.cat.attempts({ limit: 1, cursor: second.nextCursor ?? undefined });
    expect(third.items.map((a) => a.jobId)).toEqual(['z-old']);
    expect(third.nextCursor).toBeNull();
    await expect(f.cat.attempts({ cursor: 'not-a-valid-cursor' })).rejects.toThrow(
      'Invalid pagination cursor',
    );
    await expect(f.cat.list({ cursor: btoa(JSON.stringify(['not-a-date', 'a'])) })).rejects.toThrow(
      'Invalid pagination cursor',
    );
  });
  test('legacy approved variants bind a new hashed key only when all variant fields match', async () => {
    const f = setup();
    f.run('a');
    await f.record('a', 'approved', 'https://example.com/', null);
    expect(
      await f.cat.resolveVariant('hash', {
        url: 'https://example.com/',
        difficulty: 'normal',
        seed: 43,
        builderVersion: 'v1',
      }),
    ).toBeNull();
    expect(
      await f.cat.resolveVariant('hash', {
        url: 'https://example.com/',
        difficulty: 'normal',
        seed: 42,
        builderVersion: 'v1',
      }),
    ).toBe('a');
    expect(await f.cat.resolveVariant('hash')).toBe('a');
  });
});
