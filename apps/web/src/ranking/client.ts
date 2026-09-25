/**
 * Leaderboard client (Phase 10) for `/api/scores` (contracts §7, CD-8). Phase 08's Result and Ranking screens
 * take a `RankingClient`; `createMemoryRankingClient()` is a drop-in fake for tests, previews and offline play.
 */
import type {
  InputSample,
  ScoreEntry,
  ScoresResponse,
  SubmitRunScoreRequest,
  SubmitStageScoreRequest,
  VersionedReplay,
} from '@wwm/schema';

/** contracts §9 v0.2.5 (CCR-10-1): replays travel with the physics version they were recorded on. */
export type { VersionedReplay };

export type StageSubmission = Omit<SubmitStageScoreRequest, 'kind' | 'replay'> & { replay?: VersionedReplay };
export type RunSubmission = Omit<SubmitRunScoreRequest, 'kind'>;

export type SubmitError =
  | 'name' // not [a-z0-9_]{1,32}
  | 'profanity'
  | 'implausible' // plausibility check or replay mismatch
  | 'rate-limited'
  | 'not-found' // unknown stage
  | 'network'
  | 'server';

export type SubmitResult =
  | {
      ok: true;
      rank: number;
      verified: boolean;
      /** Why a replay was stored unverified (server `note`). */
      note?: string;
      /** Where it was saved: the shared server board, or this device (offline / stage unknown to the server). */
      stored?: 'server' | 'device';
    }
  | { ok: false; error: SubmitError; message: string; retryAfterSec?: number };

export interface GhostRun {
  name: string;
  score: number;
  timeMs: number;
  physicsVersion: string;
  inputs: InputSample[];
}

export interface RankingClient {
  submitStage(s: StageSubmission): Promise<SubmitResult>;
  submitRun(s: RunSubmission): Promise<SubmitResult>;
  stageBoard(stageId: string): Promise<ScoreEntry[]>;
  /** The global board of session totals (E: 2013's single ranking). */
  runBoard(): Promise<ScoreEntry[]>;
  /** The #1 verified replay on a stage, for "Race the #1 run". `null` when there is none yet. */
  ghost(stageId: string): Promise<GhostRun | null>;
}

// ── names ──────────────────────────────────────────────────────────────────────────────────────────

export const NAME_MAX = 32;
export const NAME_PATTERN = /^[a-z0-9_]{1,32}$/;

/** Map what someone types to the 2013 alphabet as they type: lowercase, spaces → `_`, drop the rest. */
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, NAME_MAX);
}

export const isValidName = (name: string) => NAME_PATTERN.test(name);

// ── HTTP client ────────────────────────────────────────────────────────────────────────────────────

export interface HttpRankingOptions {
  /** Origin + prefix, default '' (same origin; Vite proxies /api in dev). */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Abort requests after this long (ms); a timeout counts as a network error. Default: none. */
  timeoutMs?: number;
}

async function toResult(res: Response): Promise<SubmitResult> {
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON error page
  }
  const message = String(body.message ?? body.error ?? res.statusText ?? 'error');
  if (res.ok)
    return {
      ok: true,
      rank: Number(body.rank),
      verified: body.verified === true,
      stored: 'server',
      ...(typeof body.note === 'string' ? { note: body.note } : {}),
    };
  if (res.status === 429) {
    const retry = Number(res.headers.get('retry-after'));
    return {
      ok: false,
      error: 'rate-limited',
      message,
      ...(Number.isFinite(retry) && retry > 0 ? { retryAfterSec: retry } : {}),
    };
  }
  if (res.status === 404) return { ok: false, error: 'not-found', message };
  if (res.status === 422) return { ok: false, error: 'implausible', message };
  if (res.status === 400 && body.error === 'bad name')
    return { ok: false, error: body.reason === 'profanity' ? 'profanity' : 'name', message };
  if (res.status === 400) return { ok: false, error: 'implausible', message };
  return { ok: false, error: 'server', message };
}

export function createRankingClient(opts: HttpRankingOptions = {}): RankingClient {
  const base = opts.baseUrl ?? '';
  const raw = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const f: typeof fetch = (input, init) =>
    opts.timeoutMs ? raw(input, { ...init, signal: AbortSignal.timeout(opts.timeoutMs) }) : raw(input, init);
  const post = async (body: unknown): Promise<SubmitResult> => {
    try {
      return await toResult(
        await f(`${base}/api/scores`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
    } catch (e) {
      return { ok: false, error: 'network', message: e instanceof Error ? e.message : String(e) };
    }
  };
  const board = async (path: string): Promise<ScoreEntry[]> => {
    // Boards change with every submission; the Worker's `max-age=10` is for shared caches, so revalidate here
    // (a player must see their own name right after submitting).
    const res = await f(`${base}${path}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`leaderboard: HTTP ${res.status}`);
    return ((await res.json()) as ScoresResponse).entries;
  };
  return {
    submitStage: (s) => {
      if (!isValidName(s.name)) return Promise.resolve({ ok: false, error: 'name', message: 'invalid name' });
      return post({ kind: 'stage', ...s });
    },
    submitRun: (s) => {
      if (!isValidName(s.name)) return Promise.resolve({ ok: false, error: 'name', message: 'invalid name' });
      return post({ kind: 'run', ...s });
    },
    stageBoard: (id) => board(`/api/scores/stage/${encodeURIComponent(id)}`),
    runBoard: () => board('/api/scores/run'),
    ghost: async (id) => {
      const res = await f(`${base}/api/scores/stage/${encodeURIComponent(id)}/ghost`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`ghost: HTTP ${res.status}`);
      return (await res.json()) as GhostRun;
    },
  };
}

// ── in-memory fake ─────────────────────────────────────────────────────────────────────────────────

interface Row extends ScoreEntry {
  timeMs: number;
  replay?: VersionedReplay;
}

/** Best entry per name, ordered like the server (score desc, time asc, earliest first), top `n`. */
function bestPerName(rows: Row[], n = 50): Row[] {
  const best = new Map<string, Row>();
  const better = (a: Row, b: Row) => a.score > b.score || (a.score === b.score && a.timeMs < b.timeMs);
  for (const r of rows) {
    const cur = best.get(r.name);
    if (!cur || better(r, cur)) best.set(r.name, r);
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.timeMs - b.timeMs || a.at.localeCompare(b.at))
    .slice(0, n);
}

/** Same behaviour as the Worker minus plausibility and profanity checks. `seed` pre-fills boards. */
export function createMemoryRankingClient(
  seed: { stages?: Record<string, ScoreEntry[]>; runs?: ScoreEntry[] } = {},
): RankingClient {
  const stages = new Map<string, Row[]>(
    Object.entries(seed.stages ?? {}).map(([k, v]) => [k, v.map((e) => ({ ...e, timeMs: e.timeMs ?? 0 }))]),
  );
  const runs: Row[] = (seed.runs ?? []).map((e) => ({ ...e, timeMs: e.timeMs ?? 0 }));
  const rankOf = (rows: Row[], name: string, score: number, timeMs: number) =>
    1 +
    bestPerName(rows, 1e9).filter(
      (r) => r.name !== name && (r.score > score || (r.score === score && r.timeMs < timeMs)),
    ).length;
  const strip = ({ replay: _r, ...e }: Row): ScoreEntry => e;
  return {
    async submitStage(s) {
      if (!isValidName(s.name)) return { ok: false, error: 'name', message: 'invalid name' };
      const rows = stages.get(s.stageId) ?? [];
      const row: Row = { name: s.name, score: s.score, timeMs: s.timeMs, at: new Date().toISOString() };
      if (s.replay) row.replay = s.replay;
      rows.push(row);
      stages.set(s.stageId, rows);
      return { ok: true, rank: rankOf(rows, s.name, s.score, s.timeMs), verified: false };
    },
    async submitRun(s) {
      if (!isValidName(s.name)) return { ok: false, error: 'name', message: 'invalid name' };
      const timeMs = s.stages.reduce((a, x) => a + x.timeMs, 0);
      runs.push({ name: s.name, score: s.totalScore, timeMs, at: new Date().toISOString() });
      return { ok: true, rank: rankOf(runs, s.name, s.totalScore, 0), verified: false };
    },
    stageBoard: async (id) => bestPerName(stages.get(id) ?? []).map(strip),
    runBoard: async () => bestPerName(runs).map(strip),
    async ghost(id) {
      const top = bestPerName(stages.get(id) ?? []).find((r) => r.replay);
      return top?.replay ? { name: top.name, score: top.score, timeMs: top.timeMs, ...top.replay } : null;
    },
  };
}
