import type {
  AdminAttemptsResponse,
  AdminCaptureAttempt,
  AdminCatalogItem,
  AdminCatalogResponse,
  AdminModerationEvent,
  AdminPolicyRule,
  AdminRunDetail,
  ModerationStatus,
} from '@wwm/schema';
import { domainChain, normalizeTargetUrl } from './policy/url-policy.ts';

export class CatalogInputError extends Error {}

type Bindings = Pick<Env, 'DB' | 'STAGES' | 'CACHE'>;
interface CaseRow {
  run_id: string;
  url: string;
  submitted_url: string | null;
  host: string;
  title: string;
  status: ModerationStatus;
  reason: string;
  created_at: string;
  updated_at: string;
  artifacts_available: number;
  curated: number;
  refresh_requested: number;
  provider: string;
  policy_version: string;
  capture_id: string;
  cache_key: string | null;
}
const CASE_SELECT = `SELECT m.*,r.title,r.created_at,EXISTS(SELECT 1 FROM curated c WHERE c.run_id=m.run_id) AS curated
  FROM moderation_cases m JOIN runs r ON r.run_id=m.run_id`;
const hostOf = (url: string) => new URL(url).hostname.toLowerCase().replace(/\.$/, '');
const item = (r: CaseRow): AdminCatalogItem => ({
  runId: r.run_id,
  url: r.url,
  host: r.host,
  title: r.title,
  status: r.status,
  reason: r.reason,
  createdAt: r.created_at,
  artifactsAvailable: !!r.artifacts_available,
  curated: !!r.curated,
  refreshRequested: !!r.refresh_requested,
});

function pageCursor(updatedAt: string, id: string): string {
  return btoa(JSON.stringify([updatedAt, id]))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}
function parseCursor(cursor: string): [string, string] {
  try {
    if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const value: unknown = JSON.parse(atob(cursor.replaceAll('-', '+').replaceAll('_', '/')));
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      typeof value[0] !== 'string' ||
      value[0].length > 40 ||
      !/^\d{4}-\d{2}-\d{2}/.test(value[0]) ||
      !Number.isFinite(Date.parse(value[0])) ||
      typeof value[1] !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(value[1])
    )
      throw new Error();
    return [value[0], value[1]];
  } catch {
    throw new CatalogInputError('Invalid pagination cursor');
  }
}
function pageLimit(limit: number | undefined): number {
  return Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit ?? 30))) : 30;
}

/** Policy reads use the D1 primary directly, never a KV allow decision. */
export class Catalog {
  constructor(private readonly env: Bindings) {}

  async isUrlBlocked(input: string): Promise<boolean> {
    let url: string;
    try {
      url = normalizeTargetUrl(input);
    } catch {
      return true;
    }
    const exact = await this.env.DB.prepare(
      "SELECT 1 FROM policy_rules WHERE scope='url' AND target=? AND blocked=1",
    )
      .bind(url)
      .first();
    return !!exact || (await this.isHostBlocked(hostOf(url)));
  }

  async isHostBlocked(host: string): Promise<boolean> {
    host = host.toLowerCase().replace(/\.$/, '');
    const domains = [...new Set([host, ...domainChain(host)])];
    const rule = await this.env.DB.prepare(
      `SELECT 1 FROM policy_rules WHERE scope='domain' AND blocked=1 AND target IN (${domains.map(() => '?').join(',')}) LIMIT 1`,
    )
      .bind(...domains)
      .first();
    if (rule) return true;
    const legacy = await Promise.all(domains.map((d) => this.env.CACHE.get(`optout:${d}`)));
    return legacy.some((v) => v !== null);
  }

  async canServeRun(runId: string): Promise<boolean> {
    const row =
      await this.env.DB.prepare(`SELECT m.url,m.submitted_url,m.status,m.artifacts_available FROM moderation_cases m
      JOIN runs r ON r.run_id=m.run_id WHERE m.run_id=? AND r.status IN ('complete','partial')`)
        .bind(runId)
        .first<{ url: string; submitted_url: string | null; status: string; artifacts_available: number }>();
    if (row?.status !== 'approved' || !row.artifacts_available) return false;
    return (
      !(await this.isUrlBlocked(row.url)) &&
      !(row.submitted_url && (await this.isUrlBlocked(row.submitted_url)))
    );
  }

  async canServeStage(stageId: string): Promise<boolean> {
    const row = await this.env.DB.prepare('SELECT run_id FROM stages WHERE stage_id=?')
      .bind(stageId)
      .first<{ run_id: string }>();
    return !!row && this.canServeRun(row.run_id);
  }

  async resolveVariant(
    cacheKey: string,
    legacy?: { url: string; difficulty: string; seed: number; builderVersion: string },
  ): Promise<string | null> {
    let row = await this.env.DB.prepare('SELECT run_id FROM url_variants WHERE cache_key=?')
      .bind(cacheKey)
      .first<{ run_id: string }>();
    if (!row && legacy) {
      row =
        await this.env.DB.prepare(`SELECT r.run_id FROM runs r JOIN moderation_cases m ON m.run_id=r.run_id
        WHERE r.url=? AND r.difficulty=? AND r.seed=? AND r.builder_version=? AND m.status='approved'
        AND m.artifacts_available=1 ORDER BY r.created_at DESC LIMIT 1`)
          .bind(normalizeTargetUrl(legacy.url), legacy.difficulty, legacy.seed, legacy.builderVersion)
          .first<{ run_id: string }>();
    }
    if (!row || !(await this.canServeRun(row.run_id))) return null;
    const { results } = await this.env.DB.prepare(
      'SELECT stage_id,texture_key FROM stages WHERE run_id=? ORDER BY slice_index',
    )
      .bind(row.run_id)
      .all<{ stage_id: string; texture_key: string }>();
    if (!results.length) return null;
    const objects = await Promise.all(
      results.flatMap((s) => [
        this.env.STAGES.head(`stages/${s.stage_id}.json`),
        this.env.STAGES.head(s.texture_key),
      ]),
    );
    if (!objects.every(Boolean)) return null;
    await this.env.DB.prepare('INSERT INTO url_variants VALUES (?,?,?) ON CONFLICT(cache_key) DO NOTHING')
      .bind(cacheKey, row.run_id, new Date().toISOString())
      .run();
    await this.env.DB.prepare('UPDATE moderation_cases SET cache_key=? WHERE run_id=? AND cache_key IS NULL')
      .bind(cacheKey, row.run_id)
      .run();
    return row.run_id;
  }

  async pendingVariant(cacheKey: string): Promise<string | null> {
    const row =
      await this.env.DB.prepare(`SELECT m.run_id FROM moderation_cases m JOIN runs r ON r.run_id=m.run_id WHERE m.cache_key=? AND m.status='pending_review'
      AND m.artifacts_available=1 AND r.status IN ('complete','partial') AND EXISTS(SELECT 1 FROM stages s WHERE s.run_id=m.run_id) ORDER BY m.updated_at DESC LIMIT 1`)
        .bind(cacheKey)
        .first<{ run_id: string }>();
    return row?.run_id ?? null;
  }

  async claimBuild(cacheKey: string, jobId: string, leaseMs = 300_000): Promise<string> {
    const now = Date.now();
    await this.env.DB.prepare(`INSERT INTO build_claims(cache_key,job_id,expires_at) VALUES (?,?,?)
      ON CONFLICT(cache_key) DO UPDATE SET job_id=excluded.job_id,expires_at=excluded.expires_at WHERE build_claims.expires_at<=?`)
      .bind(cacheKey, jobId, now + leaseMs, now)
      .run();
    const row = await this.env.DB.prepare('SELECT job_id FROM build_claims WHERE cache_key=?')
      .bind(cacheKey)
      .first<{ job_id: string }>();
    if (!row) throw new Error('Missing build claim');
    return row.job_id;
  }
  async clearBuildClaim(cacheKey: string, jobId: string): Promise<void> {
    await this.env.DB.prepare('DELETE FROM build_claims WHERE cache_key=? AND job_id=?')
      .bind(cacheKey, jobId)
      .run();
  }

  async recordRun(input: {
    runId: string;
    url: string;
    submittedUrl?: string;
    cacheKey: string | null;
    status: ModerationStatus;
    reason: string;
    provider: string;
    policyVersion: string;
    captureId: string;
  }): Promise<void> {
    const url = normalizeTargetUrl(input.url),
      host = hostOf(url),
      now = new Date().toISOString();
    const submittedUrl = normalizeTargetUrl(input.submittedUrl ?? url);
    const blocked = (await this.isUrlBlocked(url)) || (await this.isUrlBlocked(submittedUrl));
    const status = blocked ? 'blocked' : input.status;
    const existing = await this.env.DB.prepare('SELECT status FROM moderation_cases WHERE run_id=?')
      .bind(input.runId)
      .first<{ status: ModerationStatus }>();
    // Content-addressed repeated builds cannot undo a prior human decision.
    const effectiveStatus = blocked ? 'blocked' : (existing?.status ?? status);
    const statements = [
      this.env.DB.prepare(
        `INSERT INTO url_catalog(url,host,created_at,updated_at) VALUES (?,?,?,?) ON CONFLICT(url) DO UPDATE SET updated_at=excluded.updated_at`,
      ).bind(url, host, now, now),
      this.env.DB.prepare(`INSERT INTO moderation_cases(run_id,url,submitted_url,submitted_host,host,capture_id,cache_key,status,reason,provider,policy_version,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET artifacts_available=CASE WHEN moderation_cases.deletion_pending=1 THEN 0 ELSE 1 END,updated_at=excluded.updated_at,
        status=CASE WHEN excluded.status='blocked' THEN 'blocked' ELSE moderation_cases.status END`).bind(
        input.runId,
        url,
        submittedUrl,
        hostOf(submittedUrl),
        host,
        input.captureId,
        input.cacheKey,
        effectiveStatus,
        blocked ? 'URL policy blocked' : input.reason,
        input.provider,
        input.policyVersion,
        now,
      ),
      this.event(input.runId, url, 'system', `verdict:${effectiveStatus}`, input.reason),
    ];
    await this.env.DB.batch(statements);
    if (input.cacheKey && effectiveStatus === 'approved')
      await this.publishVariant(input.cacheKey, input.runId);
  }

  /** Publish only after persistence. Failed/pending captures never replace an approved variant. */
  async publishVariant(cacheKey: string, runId: string): Promise<boolean> {
    if (!(await this.canServeRun(runId))) return false;
    const { results } = await this.env.DB.prepare('SELECT stage_id,texture_key FROM stages WHERE run_id=?')
      .bind(runId)
      .all<{ stage_id: string; texture_key: string }>();
    if (
      !results.length ||
      !(
        await Promise.all(
          results.flatMap((s) => [
            this.env.STAGES.head(`stages/${s.stage_id}.json`),
            this.env.STAGES.head(s.texture_key),
          ]),
        )
      ).every(Boolean)
    )
      return false;
    await this.env.DB.prepare(
      `INSERT INTO url_variants VALUES (?,?,?) ON CONFLICT(cache_key) DO UPDATE SET run_id=excluded.run_id,updated_at=excluded.updated_at`,
    )
      .bind(cacheKey, runId, new Date().toISOString())
      .run();
    return true;
  }

  async recordAttempt(input: {
    jobId: string;
    url: string;
    status: string;
    reason?: string;
    runId?: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    const url = normalizeTargetUrl(input.url);
    await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT INTO url_catalog VALUES (?,?,?,?) ON CONFLICT(url) DO UPDATE SET updated_at=excluded.updated_at`,
      ).bind(url, hostOf(url), now, now),
      this.env.DB.prepare(
        `INSERT INTO capture_attempts VALUES (?,?,?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET status=excluded.status,reason=excluded.reason,run_id=excluded.run_id,updated_at=excluded.updated_at`,
      ).bind(input.jobId, url, input.status, input.reason ?? null, input.runId ?? null, now),
    ]);
    if (['approved', 'pending_review', 'blocked', 'failed'].includes(input.status)) {
      await this.env.DB.prepare(
        'UPDATE moderation_cases SET refresh_requested=0 WHERE url=? OR submitted_url=?',
      )
        .bind(url, url)
        .run();
    }
  }

  private event(
    runId: string | null,
    url: string | null,
    actor: string,
    action: string,
    reason: string,
  ): D1PreparedStatement {
    return this.env.DB.prepare('INSERT INTO moderation_events VALUES (?,?,?,?,?,?,?)').bind(
      crypto.randomUUID(),
      runId,
      url,
      actor,
      action,
      reason,
      new Date().toISOString(),
    );
  }

  async list(
    opts: { q?: string; status?: string; cursor?: string; limit?: number } = {},
  ): Promise<AdminCatalogResponse> {
    const where = ['1=1'];
    const args: (string | number)[] = [];
    if (opts.q) {
      where.push('(m.url=? OR m.host=? OR m.submitted_url=? OR m.submitted_host=?)');
      args.push(opts.q, opts.q.toLowerCase(), opts.q, opts.q.toLowerCase());
    }
    if (opts.status) {
      where.push('m.status=?');
      args.push(opts.status);
    }
    if (opts.cursor) {
      const [at, id] = parseCursor(opts.cursor);
      where.push('(m.updated_at<? OR (m.updated_at=? AND m.run_id<?))');
      args.push(at, at, id);
    }
    const limit = pageLimit(opts.limit);
    const { results } = await this.env.DB.prepare(
      `${CASE_SELECT} WHERE ${where.join(' AND ')} ORDER BY m.updated_at DESC,m.run_id DESC LIMIT ?`,
    )
      .bind(...args, limit + 1)
      .all<CaseRow>();
    const last = results[limit - 1];
    return {
      items: results.slice(0, limit).map(item),
      nextCursor: results.length > limit && last ? pageCursor(last.updated_at, last.run_id) : null,
    };
  }

  async attempts(opts: { q?: string; cursor?: string; limit?: number } = {}): Promise<AdminAttemptsResponse> {
    const conditions = ['1=1'];
    const args: (string | number)[] = [];
    if (opts.q) {
      conditions.push('url=?');
      args.push(normalizeTargetUrl(opts.q));
    }
    if (opts.cursor) {
      const [at, id] = parseCursor(opts.cursor);
      conditions.push('(updated_at<? OR (updated_at=? AND job_id<?))');
      args.push(at, at, id);
    }
    const limit = pageLimit(opts.limit);
    const { results } =
      await this.env.DB.prepare(`SELECT job_id AS jobId,url,status,reason,run_id AS runId,updated_at AS updatedAt
      FROM capture_attempts WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC,job_id DESC LIMIT ?`)
        .bind(...args, limit + 1)
        .all<AdminCaptureAttempt>();
    const last = results[limit - 1];
    return {
      items: results.slice(0, limit),
      nextCursor: results.length > limit && last ? pageCursor(last.updatedAt, last.jobId) : null,
    };
  }

  async detail(runId: string): Promise<AdminRunDetail | null> {
    const row = await this.env.DB.prepare(`${CASE_SELECT} WHERE m.run_id=?`).bind(runId).first<CaseRow>();
    if (!row) return null;
    const { results: stages } = await this.env.DB.prepare(
      'SELECT stage_id FROM stages WHERE run_id=? ORDER BY slice_index',
    )
      .bind(runId)
      .all<{ stage_id: string }>();
    const urls = [row.url, row.submitted_url ?? row.url];
    const hosts = [...new Set(urls.flatMap((url) => [hostOf(url), ...domainChain(hostOf(url))]))];
    const { results: events } =
      await this.env.DB.prepare(`SELECT id,actor,action,reason,created_at AS createdAt FROM moderation_events WHERE run_id=? OR
      (run_id IS NULL AND url IN (${[...urls, ...hosts].map(() => '?').join(',')})) ORDER BY created_at DESC LIMIT 100`)
        .bind(runId, ...urls, ...hosts)
        .all<AdminModerationEvent>();
    const textures: { slice: number; evidenceUrl: string }[] = [];
    if (row.artifacts_available) {
      let cursor: string | undefined;
      do {
        const page = await this.env.STAGES.list({ prefix: `textures/${row.capture_id}/`, cursor });
        for (const object of page.objects) {
          const match = /\/(\d+)\.webp$/.exec(object.key);
          if (match)
            textures.push({
              slice: Number(match[1]),
              evidenceUrl: `/api/admin/runs/${runId}/evidence/texture-${match[1]}`,
            });
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    }
    textures.sort((a, b) => a.slice - b.slice);

    const { results: ruleRows } =
      await this.env.DB.prepare(`SELECT scope,target,blocked,reason,updated_at AS updatedAt FROM policy_rules WHERE
      (scope='url' AND target IN (?,?)) OR (scope='domain' AND target IN (${hosts.map(() => '?').join(',')}))`)
        .bind(...urls, ...hosts)
        .all<Omit<AdminPolicyRule, 'blocked'> & { blocked: number }>();
    const rules = ruleRows.map((r) => ({ ...r, blocked: !!r.blocked }));
    return {
      ...item(row),
      submittedUrl: row.submitted_url ?? row.url,
      provider: row.provider,
      policyVersion: row.policy_version,
      captureId: row.capture_id,
      screenshotUrl: `/api/admin/runs/${runId}/evidence/screenshot`,
      stages: stages.map((s) => ({
        stageId: s.stage_id,
        evidenceUrl: `/api/admin/runs/${runId}/evidence/${s.stage_id}`,
      })),
      textures,
      events,
      rules,
    };
  }

  async decide(runId: string, status: ModerationStatus, reason: string, actor: string): Promise<void> {
    const row = await this.env.DB.prepare('SELECT * FROM moderation_cases WHERE run_id=?')
      .bind(runId)
      .first<CaseRow>();
    if (!row) throw new CatalogInputError('Run not found');
    if (status === 'approved') {
      if (!row.artifacts_available) throw new CatalogInputError('Artifacts removed; recapture required');
      const run = await this.env.DB.prepare('SELECT status FROM runs WHERE run_id=?')
        .bind(runId)
        .first<{ status: string }>();
      if (!run || !['complete', 'partial'].includes(run.status))
        throw new CatalogInputError('Build is not ready for approval');
      if ((await this.isUrlBlocked(row.url)) || (await this.isUrlBlocked(row.submitted_url ?? row.url)))
        throw new CatalogInputError('Clear URL/domain block before approving');
      const { results } = await this.env.DB.prepare('SELECT stage_id,texture_key FROM stages WHERE run_id=?')
        .bind(runId)
        .all<{ stage_id: string; texture_key: string }>();
      if (
        !results.length ||
        !(
          await Promise.all(
            results.flatMap((s) => [
              this.env.STAGES.head(`stages/${s.stage_id}.json`),
              this.env.STAGES.head(s.texture_key),
            ]),
          )
        ).every(Boolean)
      )
        throw new CatalogInputError('Artifacts incomplete; recapture required');
    }
    const statements = [
      this.env.DB.prepare('UPDATE moderation_cases SET status=?,reason=?,updated_at=? WHERE run_id=?').bind(
        status,
        reason,
        new Date().toISOString(),
        runId,
      ),
      this.event(runId, row.url, actor, `decision:${status}`, reason),
    ];
    if (status === 'approved' && row.cache_key)
      statements.push(
        this.env.DB.prepare(
          `INSERT INTO url_variants VALUES (?,?,?) ON CONFLICT(cache_key) DO UPDATE SET run_id=excluded.run_id,updated_at=excluded.updated_at`,
        ).bind(row.cache_key, runId, new Date().toISOString()),
      );
    if (status !== 'approved')
      statements.push(this.env.DB.prepare('DELETE FROM curated WHERE run_id=?').bind(runId));
    await this.env.DB.batch(statements);
    if (row.cache_key) await this.env.CACHE.delete(row.cache_key);
  }

  async rules(): Promise<AdminPolicyRule[]> {
    const { results } = await this.env.DB.prepare(
      'SELECT scope,target,blocked,reason,updated_at AS updatedAt FROM policy_rules ORDER BY updated_at DESC LIMIT 500',
    ).all<Omit<AdminPolicyRule, 'blocked'> & { blocked: number }>();
    return results.map((r) => ({ ...r, blocked: !!r.blocked }));
  }

  async setRule(
    scope: 'url' | 'domain',
    target: string,
    blocked: boolean,
    reason: string,
    actor: string,
  ): Promise<void> {
    target = scope === 'url' ? normalizeTargetUrl(target) : hostOf(`https://${target}`);
    const now = new Date().toISOString();
    const statements = [
      this.env.DB.prepare(
        `INSERT INTO policy_rules VALUES (?,?,?,?,?) ON CONFLICT(scope,target) DO UPDATE SET blocked=excluded.blocked,reason=excluded.reason,updated_at=excluded.updated_at`,
      ).bind(scope, target, blocked ? 1 : 0, reason, now),
      this.event(null, target, actor, `${scope}:${blocked ? 'block' : 'unblock'}`, reason),
    ];
    // Serving gates enforce parent-domain rules even while any stale KV pointers remain.
    if (blocked)
      statements.push(
        this.env.DB.prepare(
          scope === 'url'
            ? 'DELETE FROM curated WHERE run_id IN (SELECT run_id FROM moderation_cases WHERE url=? OR submitted_url=?)'
            : "DELETE FROM curated WHERE run_id IN (SELECT run_id FROM moderation_cases WHERE host=? OR substr(host,-length(?)-1)='.'||? OR submitted_host=? OR substr(submitted_host,-length(?)-1)='.'||?)",
        ).bind(...(scope === 'url' ? [target, target] : [target, target, target, target, target, target])),
      );
    await this.env.DB.batch(statements);
  }

  async expireArtifacts(runId: string): Promise<void> {
    await this.removeArtifacts(runId, 'Retention period expired', 'retention', true);
  }

  async removeArtifacts(runId: string, reason: string, actor: string, expiry = false): Promise<void> {
    const row = await this.env.DB.prepare('SELECT * FROM moderation_cases WHERE run_id=?')
      .bind(runId)
      .first<CaseRow>();
    if (!row) throw new CatalogInputError('Run not found');
    // Revoke before touching R2. An interrupted deletion remains unavailable and retryable.
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE moderation_cases SET status=CASE WHEN ?=1 THEN status ELSE 'blocked' END,artifacts_available=0,deletion_pending=1,reason=?,updated_at=? WHERE run_id=?",
      ).bind(expiry ? 1 : 0, reason, new Date().toISOString(), runId),
      this.env.DB.prepare('DELETE FROM curated WHERE run_id=?').bind(runId),
      this.event(runId, row.url, actor, expiry ? 'expire-artifacts' : 'remove-artifacts', reason),
    ]);
    if (row.cache_key) await this.env.CACHE.delete(row.cache_key);
    const { results } = await this.env.DB.prepare('SELECT stage_id FROM stages WHERE run_id=?')
      .bind(runId)
      .all<{ stage_id: string }>();
    for (const s of results) {
      await this.env.STAGES.delete([`stages/${s.stage_id}.json`, `share/${s.stage_id}.png`]);
      await this.deletePrefix(`replays/${s.stage_id}/`);
    }
    const shared = await this.env.DB.prepare(
      'SELECT 1 FROM moderation_cases WHERE capture_id=? AND run_id!=? AND artifacts_available=1 LIMIT 1',
    )
      .bind(row.capture_id, runId)
      .first();
    if (!shared)
      for (const prefix of [`captures/${row.capture_id}/`, `textures/${row.capture_id}/`])
        await this.deletePrefix(prefix);
    await this.env.DB.prepare('UPDATE moderation_cases SET deletion_pending=0 WHERE run_id=?')
      .bind(runId)
      .run();
  }

  private async deletePrefix(prefix: string): Promise<void> {
    let cursor: string | undefined;
    do {
      const page = await this.env.STAGES.list({ prefix, cursor });
      if (page.objects.length) await this.env.STAGES.delete(page.objects.map((o) => o.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }

  async requestRefresh(runId: string, reason: string, actor: string): Promise<void> {
    const row = await this.env.DB.prepare('SELECT url FROM moderation_cases WHERE run_id=?')
      .bind(runId)
      .first<{ url: string }>();
    if (!row) throw new CatalogInputError('Run not found');
    await this.env.DB.batch([
      this.env.DB.prepare('UPDATE moderation_cases SET refresh_requested=1 WHERE run_id=?').bind(runId),
      this.event(runId, row.url, actor, 'request-refresh', reason),
    ]);
  }
}
