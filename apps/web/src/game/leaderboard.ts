/**
 * Ranking behind an interface. Phase 10 implements `POST /api/scores` / `GET /api/scores/*` (contracts §7)
 * and swaps `HttpLeaderboard` in; until then the game uses `LocalLeaderboard` (this browser only).
 * E: 2013 had one global top-10 of session totals; CD-8 adds per-stage boards (N).
 */
import type {
  ScoreEntry,
  ScoresResponse,
  SubmitRunScoreRequest,
  SubmitScoreResponse,
  SubmitStageScoreRequest,
} from '@wwm/schema';

export interface Leaderboard {
  readonly kind: 'local' | 'http';
  /** Global run board, best first. */
  topRuns(limit?: number): Promise<ScoreEntry[]>;
  topStage(stageId: string, limit?: number): Promise<ScoreEntry[]>;
  /** Rank this total would get without submitting it (E: "??" then 1st/2nd/…). */
  rankFor(totalScore: number): Promise<number>;
  submitRun(req: SubmitRunScoreRequest): Promise<SubmitScoreResponse>;
  submitStage(req: SubmitStageScoreRequest): Promise<SubmitScoreResponse>;
}

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

function rankOf(entries: ScoreEntry[], score: number): number {
  return entries.filter((e) => e.score > score).length + 1;
}

export class LocalLeaderboard implements Leaderboard {
  readonly kind = 'local' as const;
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
    const rank = rankOf(list, e.score);
    list.push(e);
    list.sort((a, b) => b.score - a.score || a.at.localeCompare(b.at));
    try {
      this.#store.setItem(key, JSON.stringify(list.slice(0, KEEP)));
    } catch {
      // storage full or blocked: the rank is still meaningful for this session
    }
    return rank;
  }

  async topRuns(limit = 10): Promise<ScoreEntry[]> {
    return this.#read(RUN_KEY).slice(0, limit);
  }

  async topStage(stageId: string, limit = 10): Promise<ScoreEntry[]> {
    return this.#read(STAGE_KEY(stageId)).slice(0, limit);
  }

  async rankFor(totalScore: number): Promise<number> {
    return rankOf(this.#read(RUN_KEY), totalScore);
  }

  async submitRun(req: SubmitRunScoreRequest): Promise<SubmitScoreResponse> {
    const at = this.#now().toISOString();
    return { rank: this.#add(RUN_KEY, { name: req.name, score: req.totalScore, at }) };
  }

  async submitStage(req: SubmitStageScoreRequest): Promise<SubmitScoreResponse> {
    const at = this.#now().toISOString();
    return {
      rank: this.#add(STAGE_KEY(req.stageId), { name: req.name, score: req.score, timeMs: req.timeMs, at }),
    };
  }
}

/** Contract §7 client, for Phase 10. Not used until the scores API exists. */
export class HttpLeaderboard implements Leaderboard {
  readonly kind = 'http' as const;
  constructor(private readonly origin = '') {}

  async #get(path: string): Promise<ScoreEntry[]> {
    const r = await fetch(`${this.origin}${path}`);
    if (!r.ok) throw new Error(`scores ${r.status}`);
    return ((await r.json()) as ScoresResponse).entries;
  }

  async #post(body: unknown): Promise<SubmitScoreResponse> {
    const r = await fetch(`${this.origin}/api/scores`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`scores ${r.status}`);
    return (await r.json()) as SubmitScoreResponse;
  }

  async topRuns(limit = 10) {
    return (await this.#get('/api/scores/run')).slice(0, limit);
  }
  async topStage(stageId: string, limit = 10) {
    return (await this.#get(`/api/scores/stage/${encodeURIComponent(stageId)}`)).slice(0, limit);
  }
  async rankFor(totalScore: number) {
    return rankOf(await this.#get('/api/scores/run'), totalScore);
  }
  submitRun(req: SubmitRunScoreRequest) {
    return this.#post(req);
  }
  submitStage(req: SubmitStageScoreRequest) {
    return this.#post(req);
  }
}
