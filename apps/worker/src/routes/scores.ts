/**
 * Leaderboards (Phase 10, contracts §7 + CD-8). Mounted at `/api/scores` by the router.
 *   POST /api/scores                       {kind:'stage', …} | {kind:'run', …} → {rank}
 *   GET  /api/scores/stage/:stageId        per-stage board, top 50 (best entry per name)
 *   GET  /api/scores/run                   global run board of session totals, top 50 (E: 2013 had a top 10)
 *   GET  /api/scores/stage/:stageId/ghost  the #1 verified replay {name, score, physicsVersion, inputs} (ghosts)
 *
 * Reads are rate limited by the `/api/*` read limiter that `stagesRoutes` installs.
 * Abuse controls: name `[a-z0-9_]{1,32}` + profanity filter, 20 submissions / 10 min / IP (Limiter DO),
 * plausibility (score ≤ stage maximum, finish time ≥ physical minimum), and optional replay verification with
 * the headless @wwm/physics simulation when the replay's physicsVersion matches ours.
 */
import {
  parseStage,
  type ScoreEntry,
  type ScoresResponse,
  type StageData,
  SubmitScoreRequestSchema,
  type SubmitScoreResponse,
} from '@wwm/schema';
import { Hono } from 'hono';
import type { AppEnv } from '../app-env.ts';
import { errorResponse, ServiceError } from '../errors.ts';
import { BodyTooLargeError, readJsonCapped, tooLarge } from '../security.ts';
import {
  BOARD_SIZE,
  checkName,
  checkStageScore,
  hashIp,
  ipHashSecret,
  parseReplay,
  type ReplayEnvelope,
  type ReplayScore,
  replayMatches,
  SUBMIT_LIMIT,
  SUBMIT_WINDOW_MS,
  scoreReplayEvents,
  stageLimits,
} from './scores-rules.ts';

const HEX64 = /^[0-9a-f]{64}$/;
/** Largest request body we read (a 4-attempt replay is ≈ 10 MB of JSON; typical stage replays are < 3 MB). */
export const MAX_BODY_BYTES = 12 * 1024 * 1024;
/**
 * Replays longer than this are stored but not re-simulated in the request (CPU budget). Measured in workerd:
 * see docs/build-log/phase-10.md ("Replay verification cost").
 */
export const VERIFY_MAX_TICKS = 36_000;

const bad = (message: string, status = 400) => Response.json({ error: 'bad request', message }, { status });

async function loadStage(c: { get: (k: 'services') => AppEnv['Variables']['services'] }, stageId: string) {
  if (!HEX64.test(stageId)) return null;
  const obj = await c.get('services').store.getStage(stageId);
  if (!obj) return null;
  return parseStage(await obj.json());
}

export type VerifyOutcome =
  | { status: 'verified'; result: ReplayScore; ms: number }
  | { status: 'mismatch'; result: ReplayScore; ms: number }
  | { status: 'unverified'; reason: string };

/** Re-simulate `replay` on `stage` headlessly and compare it with the claimed score. */
export async function verifyReplay(
  stage: StageData,
  replay: ReplayEnvelope,
  claimed: number,
): Promise<VerifyOutcome> {
  if (replay.inputs.length === 0) return { status: 'unverified', reason: 'empty replay' };
  if (replay.inputs.length > VERIFY_MAX_TICKS)
    return { status: 'unverified', reason: `replay longer than ${VERIFY_MAX_TICKS} ticks` };
  // Loaded lazily: Rapier (WASM) is only paid for by requests that carry a replay.
  let physics: typeof import('@wwm/physics');
  try {
    physics = await (await import('./scores-wasm.ts')).loadPhysicsInWorkerd();
  } catch (e) {
    return { status: 'unverified', reason: `physics unavailable: ${String(e).slice(0, 200)}` };
  }
  if (replay.physicsVersion !== physics.PHYSICS_VERSION)
    return {
      status: 'unverified',
      reason: `physicsVersion ${replay.physicsVersion ?? 'missing'} ≠ server ${physics.PHYSICS_VERSION}`,
    };
  const t0 = performance.now();
  let r: Awaited<ReturnType<typeof physics.replay>>;
  try {
    r = await physics.replay(stage, replay.inputs, { stopAtGoal: true });
  } catch (e) {
    return { status: 'unverified', reason: `simulation failed: ${String(e).slice(0, 200)}` };
  }
  const result = scoreReplayEvents(
    r.events,
    replay.inputs,
    stage.timeLimitSec,
    r.goalTick,
    r.ticks,
    replay.timerStartTick,
  );
  const ms = performance.now() - t0;
  return replayMatches(claimed, result)
    ? { status: 'verified', result, ms }
    : { status: 'mismatch', result, ms };
}

export const scoresRoutes = new Hono<AppEnv>();

scoresRoutes.get('/stage/:stageId', async (c) => {
  const stageId = c.req.param('stageId');
  if (!HEX64.test(stageId)) return Response.json({ error: 'stage not found' }, { status: 404 });
  const { results } = await c.env.DB.prepare(
    `SELECT name, score, time_ms, created_at FROM (
       SELECT name, score, time_ms, created_at,
              ROW_NUMBER() OVER (PARTITION BY name ORDER BY score DESC, time_ms ASC, created_at ASC) AS rn
       FROM scores WHERE stage_id = ?1)
     WHERE rn = 1 ORDER BY score DESC, time_ms ASC, created_at ASC LIMIT ?2`,
  )
    .bind(stageId, BOARD_SIZE)
    .all<{ name: string; score: number; time_ms: number; created_at: string }>();
  const entries: ScoreEntry[] = results.map((r) => ({
    name: r.name,
    score: r.score,
    timeMs: r.time_ms,
    at: r.created_at,
  }));
  return c.json<ScoresResponse>({ entries }, 200, { 'cache-control': 'public, max-age=10' });
});

scoresRoutes.get('/run', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT name, total_score, time_ms, created_at FROM (
       SELECT name, total_score, time_ms, created_at,
              ROW_NUMBER() OVER (PARTITION BY name ORDER BY total_score DESC, created_at ASC) AS rn
       FROM run_scores)
     WHERE rn = 1 ORDER BY total_score DESC, created_at ASC LIMIT ?1`,
  )
    .bind(BOARD_SIZE)
    .all<{ name: string; total_score: number; time_ms: number; created_at: string }>();
  const entries: ScoreEntry[] = results.map((r) => ({
    name: r.name,
    score: r.total_score,
    timeMs: r.time_ms,
    at: r.created_at,
  }));
  return c.json<ScoresResponse>({ entries }, 200, { 'cache-control': 'public, max-age=10' });
});

scoresRoutes.get('/stage/:stageId/ghost', async (c) => {
  const stageId = c.req.param('stageId');
  if (!HEX64.test(stageId)) return Response.json({ error: 'stage not found' }, { status: 404 });
  const row = await c.env.DB.prepare(
    `SELECT name, score, time_ms, replay_key FROM scores
     WHERE stage_id = ?1 AND verified = 1 AND replay_key IS NOT NULL
     ORDER BY score DESC, time_ms ASC, created_at ASC LIMIT 1`,
  )
    .bind(stageId)
    .first<{ name: string; score: number; time_ms: number; replay_key: string }>();
  const obj = row ? await c.env.STAGES.get(row.replay_key) : null;
  // No ghost yet is a normal state, not an error: 204 keeps browsers from logging a failed request.
  if (!row || !obj)
    return new Response(null, { status: 204, headers: { 'cache-control': 'public, max-age=10' } });
  const replay = (await obj.json()) as { physicsVersion: string; inputs: unknown[] };
  return c.json({ name: row.name, score: row.score, timeMs: row.time_ms, ...replay }, 200, {
    'cache-control': 'public, max-age=60',
  });
});

scoresRoutes.post('/', async (c) => {
  const { log } = c.get('services');
  // Phase 12: the cap holds for chunked bodies too (no content-length), not just for honest clients.
  let raw: Record<string, unknown> | null;
  try {
    raw = (await readJsonCapped(c.req.raw, MAX_BODY_BYTES)) as Record<string, unknown> | null;
  } catch (e) {
    if (e instanceof BodyTooLargeError) return tooLarge(e);
    throw e;
  }
  if (!raw || typeof raw !== 'object') return bad('invalid JSON body');

  // Contract replay envelope handling (see parseReplay): validate it apart from the schema's bare array.
  let replay: ReplayEnvelope | null = null;
  try {
    replay = raw.kind === 'stage' ? parseReplay(raw.replay) : null;
  } catch (e) {
    return bad((e as Error).message);
  }
  const body = SubmitScoreRequestSchema.safeParse({ ...raw, replay: undefined });
  if (!body.success) return bad(body.error.issues[0]?.message ?? 'invalid body');
  const req = body.data;

  const nameCheck = checkName(req.name);
  if (!nameCheck.ok)
    return Response.json(
      {
        error: 'bad name',
        reason: nameCheck.reason,
        message:
          nameCheck.reason === 'format'
            ? 'names use a–z, 0–9 and _ only, 1 to 32 characters'
            : 'please choose a different name',
      },
      { status: 400 },
    );

  const limiter = c.env.LIMITER.get(c.env.LIMITER.idFromName(`score:${c.get('ip')}`));
  const rl = await limiter.hit(SUBMIT_LIMIT, SUBMIT_WINDOW_MS);
  if (!rl.ok)
    return errorResponse(new ServiceError('RATE_LIMITED', 'too many score submissions', rl.retryAfterSec));

  const secret = ipHashSecret(c.env as { IP_HASH_SALT?: string; WWM_ENV?: string }, log);
  if (!secret)
    return Response.json(
      { error: 'unavailable', message: 'score submission is temporarily unavailable' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  const ipHash = await hashIp(c.get('ip'), secret);
  const now = new Date().toISOString();

  if (req.kind === 'stage') {
    const stage = await loadStage(c, req.stageId);
    if (!stage) return Response.json({ error: 'stage not found' }, { status: 404 });
    const plaus = checkStageScore(stageLimits(stage), req.score, req.timeMs, true);
    if (!plaus.ok)
      return Response.json({ error: 'implausible score', message: plaus.reason }, { status: 422 });

    let verified = 0;
    let note: string | undefined;
    let replayKey: string | null = null;
    if (replay) {
      const v = await verifyReplay(stage, replay, req.score);
      log.info('replay verification', {
        stageId: req.stageId,
        ticks: replay.inputs.length,
        status: v.status,
        ...(v.status === 'unverified' ? { reason: v.reason } : { ms: Math.round(v.ms), sim: v.result }),
      });
      if (v.status === 'mismatch')
        return Response.json(
          {
            error: 'replay mismatch',
            message: `the replay reproduces ${v.result.score} points, not ${req.score}`,
          },
          { status: 422 },
        );
      verified = v.status === 'verified' ? 1 : 0;
      if (v.status === 'unverified') note = v.reason;
      replayKey = `replays/${req.stageId}/${crypto.randomUUID()}.json`;
      await c.env.STAGES.put(
        replayKey,
        JSON.stringify({ physicsVersion: replay.physicsVersion, inputs: replay.inputs }),
        { httpMetadata: { contentType: 'application/json' } },
      );
    }
    const timeMs = Math.round(req.timeMs);
    await c.env.DB.prepare(
      `INSERT INTO scores (stage_id, name, score, time_ms, replay_key, verified, created_at, ip_hash)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
      .bind(req.stageId, req.name, req.score, timeMs, replayKey, verified, now, ipHash)
      .run();
    const ahead = await c.env.DB.prepare(
      `SELECT COUNT(DISTINCT name) AS n FROM scores
       WHERE stage_id = ?1 AND name != ?2 AND (score > ?3 OR (score = ?3 AND time_ms < ?4))`,
    )
      .bind(req.stageId, req.name, req.score, timeMs)
      .first<{ n: number }>();
    // `verified`/`note` are additions to the contract's {rank}; clients may ignore them.
    return c.json<SubmitScoreResponse & { verified: boolean; note?: string }>(
      { rank: (ahead?.n ?? 0) + 1, verified: verified === 1, ...(note ? { note } : {}) },
      201,
    );
  }

  // kind === 'run': the global board of session totals.
  if (req.stages.length > 64) return bad('too many stages');
  const ids = new Set(req.stages.map((s) => s.stageId));
  if (ids.size !== req.stages.length) return bad('duplicate stage in run');
  const sum = req.stages.reduce((a, s) => a + s.score, 0);
  if (sum !== req.totalScore)
    return Response.json(
      { error: 'implausible score', message: 'totalScore must equal the sum of the stage scores' },
      { status: 422 },
    );
  const stages = await Promise.all(req.stages.map((s) => loadStage(c, s.stageId)));
  for (const [i, s] of req.stages.entries()) {
    const stage = stages[i];
    if (!stage) return Response.json({ error: 'stage not found', stageId: s.stageId }, { status: 404 });
    const last = i === req.stages.length - 1;
    // Every stage but the last was finished (the run only continues past a goal); the last one may be a game over.
    const plaus = checkStageScore(stageLimits(stage), s.score, s.timeMs, !last);
    if (!plaus.ok)
      return Response.json(
        { error: 'implausible score', message: `stage ${i + 1}: ${plaus.reason}` },
        { status: 422 },
      );
  }
  const timeMs = Math.round(req.stages.reduce((a, s) => a + s.timeMs, 0));
  await c.env.DB.prepare(
    `INSERT INTO run_scores (run_id, name, total_score, time_ms, stages_json, created_at, ip_hash)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(req.runId ?? null, req.name, req.totalScore, timeMs, JSON.stringify(req.stages), now, ipHash)
    .run();
  const ahead = await c.env.DB.prepare(
    'SELECT COUNT(DISTINCT name) AS n FROM run_scores WHERE name != ?1 AND total_score > ?2',
  )
    .bind(req.name, req.totalScore)
    .first<{ n: number }>();
  return c.json<SubmitScoreResponse>({ rank: (ahead?.n ?? 0) + 1 }, 201);
});
