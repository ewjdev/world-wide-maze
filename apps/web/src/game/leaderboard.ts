/**
 * Leaderboards for the game (Phase 08b): Phase 10's HTTP client (`/api/scores`, contracts §7) with a fallback to
 * this device's storage.
 *
 * - A stage has a **server** board when it came from the Worker (built by the capture service, or a deep link to
 *   a service stage id). Stages built in the browser (the practice stage, the offline fixture captures,
 *   preservation mode) and anything while offline use the **device** board. The game doesn't probe the Worker
 *   for other stages: every 404 would be a console error (G2 asks for none).
 * - A run (E: 2013's single ranking of session totals) goes to the server run board only when every stage of
 *   the session is on the server, because the Worker checks each stage's plausibility; otherwise it's kept on
 *   the device.
 * - A submission that can't reach the server (network, 5xx, unknown stage) is saved on the device instead, so a
 *   finished game never loses its score. Name, profanity, plausibility and rate-limit errors go back to the
 *   player (the name entry shows them).
 */
import type { ScoreEntry } from '@wwm/schema';
import {
  createRankingClient,
  type GhostRun,
  isValidName,
  type RankingClient,
  type RunSubmission,
  type StageSubmission,
  type SubmitResult,
} from '../ranking/client.ts';

export type BoardSource = 'server' | 'device';

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function memoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

const RUN_KEY = 'wwm.scores.run';
const STAGE_KEY = (id: string) => `wwm.scores.stage.${id}`;
const KEEP = 100;
const BOARD = 50;
const HEX64 = /^[0-9a-f]{64}$/;

type Row = ScoreEntry & { timeMs: number };

/** Best entry per name, ordered like the Worker (score desc, time asc, earliest first). */
export function rankRows(rows: readonly ScoreEntry[], n = BOARD): ScoreEntry[] {
  const best = new Map<string, Row>();
  const t = (e: ScoreEntry) => e.timeMs ?? 0;
  for (const r of rows) {
    const cur = best.get(r.name);
    if (!cur || r.score > cur.score || (r.score === cur.score && t(r) < t(cur)))
      best.set(r.name, { ...r, timeMs: t(r) });
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.timeMs - b.timeMs || a.at.localeCompare(b.at))
    .slice(0, n);
}

/** Rank a score would get on `rows` (1-based; ties with a better time rank ahead). */
export function rankOf(rows: readonly ScoreEntry[], name: string, score: number, timeMs = 0): number {
  return (
    1 +
    rankRows(rows, 1e9).filter(
      (r) => r.name !== name && (r.score > score || (r.score === score && (r.timeMs ?? 0) < timeMs)),
    ).length
  );
}

/** The device board: the same `RankingClient` API, kept in localStorage (this browser only). */
export class LocalRankingClient implements RankingClient {
  readonly #store: KeyValueStore;
  readonly #now: () => Date;

  constructor(store?: KeyValueStore, now: () => Date = () => new Date()) {
    this.#store = store ?? (typeof localStorage === 'undefined' ? memoryStore() : localStorage);
    this.#now = now;
  }

  #read(key: string): ScoreEntry[] {
    try {
      const v = JSON.parse(this.#store.getItem(key) ?? '[]') as unknown;
      return Array.isArray(v) ? (v as ScoreEntry[]) : [];
    } catch {
      return [];
    }
  }

  #add(key: string, e: ScoreEntry): number {
    const list = this.#read(key);
    list.push(e);
    const rank = rankOf(list, e.name, e.score, e.timeMs ?? 0);
    try {
      this.#store.setItem(key, JSON.stringify(rankRows(list, KEEP)));
    } catch {
      // storage full or blocked: the rank is still meaningful for this session
    }
    return rank;
  }

  async submitStage(s: StageSubmission): Promise<SubmitResult> {
    if (!isValidName(s.name)) return { ok: false, error: 'name', message: 'invalid name' };
    const at = this.#now().toISOString();
    const rank = this.#add(STAGE_KEY(s.stageId), { name: s.name, score: s.score, timeMs: s.timeMs, at });
    return { ok: true, rank, verified: false, stored: 'device' };
  }

  async submitRun(s: RunSubmission): Promise<SubmitResult> {
    if (!isValidName(s.name)) return { ok: false, error: 'name', message: 'invalid name' };
    const at = this.#now().toISOString();
    const timeMs = s.stages.reduce((a, x) => a + x.timeMs, 0);
    const rank = this.#add(RUN_KEY, { name: s.name, score: s.totalScore, timeMs, at });
    return { ok: true, rank, verified: false, stored: 'device' };
  }

  async stageBoard(stageId: string): Promise<ScoreEntry[]> {
    return rankRows(this.#read(STAGE_KEY(stageId)));
  }

  async runBoard(): Promise<ScoreEntry[]> {
    return rankRows(this.#read(RUN_KEY));
  }

  /** Replays aren't kept on the device (hundreds of kB each), so there is no offline ghost. */
  async ghost(): Promise<GhostRun | null> {
    return null;
  }
}

export interface GameBoardsOptions {
  /** API origin ('' = same origin; Vite proxies /api in dev). */
  origin?: string;
  fetch?: typeof fetch;
  store?: KeyValueStore;
  /** Per-request timeout (ms). */
  timeoutMs?: number;
  /** After a network failure, skip the server for this long (ms). */
  offlineCoolMs?: number;
  now?: () => Date;
}

/** Fell back to the device because the server couldn't take it (as opposed to a player-facing error). */
const FALLBACK: ReadonlySet<string> = new Set(['network', 'server', 'not-found']);

export class GameBoards {
  readonly device: LocalRankingClient;
  readonly server: RankingClient;
  readonly #fetch: typeof fetch;
  readonly #origin: string;
  readonly #timeout: number;
  readonly #cool: number;
  #offlineUntil = 0;

  constructor(opts: GameBoardsOptions = {}) {
    this.#origin = opts.origin ?? '';
    this.#fetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.#timeout = opts.timeoutMs ?? 6000;
    this.#cool = opts.offlineCoolMs ?? 30_000;
    this.device = new LocalRankingClient(opts.store, opts.now);
    this.server = createRankingClient({
      baseUrl: this.#origin,
      fetch: this.#fetch,
      timeoutMs: this.#timeout,
    });
  }

  /** True while the server is presumed unreachable (browser offline, or a recent network failure). */
  get offline(): boolean {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    return Date.now() < this.#offlineUntil;
  }

  #wentOffline(): void {
    this.#offlineUntil = Date.now() + this.#cool;
  }

  client(source: BoardSource): RankingClient {
    return source === 'server' ? this.server : this.device;
  }

  /** Where a stage's board lives: the server for stages that came from it (while online), else this device. */
  whereStage(stageId: string, fromServer: boolean): BoardSource {
    return fromServer && HEX64.test(stageId) && !this.offline ? 'server' : 'device';
  }

  /** A session goes to the server run board only if every one of its stages is on the server. */
  whereRun(stages: readonly { stageId: string; fromServer: boolean }[]): BoardSource {
    if (stages.length === 0) return 'device';
    return stages.every((s) => this.whereStage(s.stageId, s.fromServer) === 'server') ? 'server' : 'device';
  }

  async #submit(
    source: BoardSource,
    toServer: () => Promise<SubmitResult>,
    toDevice: () => Promise<SubmitResult>,
  ): Promise<SubmitResult> {
    if (source === 'device' || this.offline) return toDevice();
    const r = await toServer();
    if (r.ok || !FALLBACK.has(r.error)) return r;
    if (r.error === 'network') this.#wentOffline();
    console.info(`[wwm] score kept on this device (${r.error}: ${r.message})`);
    return toDevice();
  }

  submitStage(s: StageSubmission, source: BoardSource): Promise<SubmitResult> {
    return this.#submit(
      source,
      async () => {
        const r = await this.server.submitStage(s);
        // The Worker rejects a replay that doesn't reproduce the claimed score (422). Our recording can
        // legitimately disagree (e.g. the timer start rule, see docs/build-log/phase-08.md "Phase 08b"), and an
        // unverified entry is still accepted, so resend once without the replay rather than lose the score.
        if (!r.ok && r.error === 'implausible' && s.replay && /replay/i.test(r.message)) {
          console.info(`[wwm] replay not accepted (${r.message}); submitting unverified`);
          const { replay: _r, ...plain } = s;
          const again = await this.server.submitStage(plain);
          return again.ok ? { ...again, note: r.message } : again;
        }
        return r;
      },
      () => this.device.submitStage(s),
    );
  }

  submitRun(s: RunSubmission, source: BoardSource): Promise<SubmitResult> {
    return this.#submit(
      source,
      () => this.server.submitRun(s),
      () => this.device.submitRun(s),
    );
  }

  /** The rank a session total would get before it's submitted (E: "??" then 1st/2nd…). */
  async rankFor(total: number, source: BoardSource): Promise<number | null> {
    try {
      return rankOf(await this.client(source).runBoard(), '', total, Number.POSITIVE_INFINITY);
    } catch {
      return null;
    }
  }

  /**
   * The #1 verified run on a server stage, or null (offline, none yet, or an error). Asks for the ghost only when
   * the stage's board has entries: the ghost endpoint answers "none yet" with a 404, which browsers log as a
   * console error.
   */
  async ghost(stageId: string): Promise<GhostRun | null> {
    if (this.offline || !HEX64.test(stageId)) return null;
    try {
      if ((await this.server.stageBoard(stageId)).length === 0) return null;
      return await this.server.ghost(stageId);
    } catch {
      return null;
    }
  }
}
