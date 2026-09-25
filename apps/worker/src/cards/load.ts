/**
 * Share cards (Phase 18): build `CardData` from server state (D1 rows, R2 objects), plus a lazy loader for the
 * picture, which only runs when a card has to be rendered (cache miss).
 *
 * Nothing here reads request parameters other than ids; every number on a card comes from D1.
 */
import { parseStage, type StageData } from '@wwm/schema';
import { SHARE_ID_RE } from '../routes/scores.ts';
import { stageArt } from './art.ts';
import type { CardData, StageInfo } from './data.ts';
import { decodeTrail, drawnHosts } from './journey.ts';
import { encodePng, pngCropThumb, pngSize, toBase64 } from './png.ts';
import type { CardArt } from './svg.ts';
import { cardTitle, hostOf } from './text.ts';

const HEX64 = /^[0-9a-f]{64}$/;
/** Curated hero shot of a stage (content/README.md, Phase 10). */
export const heroKey = (stageId: string) => `share/${stageId}.png`;
const shotKey = (captureId: string) => `captures/${captureId}/screenshot.png`;
/** Largest screenshot we stream through for a thumbnail (a 1280 px wide page of ~40 000 px). */
const MAX_SHOT_BYTES = 24 * 1024 * 1024;
/** Width of the page picture inside a card (px); the island tops are drawn smaller than this. */
const THUMB_W = 560;

export interface CardSource {
  data: CardData;
  /** Human-readable facts for the share page's meta tags (same values as the card). */
  meta: Record<string, string | number | boolean | null>;
  art: () => Promise<CardArt>;
}

const noArt = async (): Promise<CardArt> => ({});

type Db = Pick<Env, 'DB' | 'STAGES'>;

async function loadStage(env: Db, stageId: string): Promise<StageData | null> {
  if (!HEX64.test(stageId)) return null;
  const obj = await env.STAGES.get(`stages/${stageId}.json`);
  return obj ? parseStage(await obj.json()) : null;
}

async function stageInfo(env: Db, stage: StageData): Promise<StageInfo> {
  const host = hostOf(stage.source.url);
  const [hero, shot, curated] = await Promise.all([
    env.STAGES.head(heroKey(stage.stageId)),
    env.STAGES.head(shotKey(stage.source.captureId)),
    env.DB.prepare(
      'SELECT c.stars AS stars FROM stages s JOIN curated c ON c.run_id = s.run_id WHERE s.stage_id = ?1',
    )
      .bind(stage.stageId)
      .first<{ stars: number }>()
      .catch(() => null),
  ]);
  return {
    stageId: stage.stageId,
    title: cardTitle(stage.source.title, host),
    host,
    slice: { index: stage.source.slice.index, count: stage.source.slice.count },
    difficulty: stage.difficulty,
    stars: curated ? Math.max(0, Math.min(5, Math.round(Number(curated.stars) || 0))) : null,
    art: hero
      ? { kind: 'hero', etag: hero.httpEtag }
      : { kind: 'islands', texture: shot && shot.size <= MAX_SHOT_BYTES ? 'capture' : 'none' },
  };
}

/** The picture for a stage card: the curated hero, else the islands with the page screenshot on top. */
function stageArtLoader(env: Db, stage: StageData, info: StageInfo): () => Promise<CardArt> {
  return async () => {
    if (info.art.kind === 'hero') {
      const obj = await env.STAGES.get(heroKey(stage.stageId));
      if (obj) return { hero: `data:image/png;base64,${toBase64(new Uint8Array(await obj.arrayBuffer()))}` };
    }
    const art: CardArt = { stage: stageArt(stage) };
    if (info.art.kind === 'islands' && info.art.texture === 'capture') {
      const obj = await env.STAGES.get(shotKey(stage.source.captureId));
      if (obj && obj.size <= MAX_SHOT_BYTES) {
        const bytes = new Uint8Array(await obj.arrayBuffer());
        const size = pngSize(bytes);
        if (size) {
          const scale = size.width / Math.max(1, stage.source.pageWidth);
          const { y, height } = stage.source.slice;
          const k = Math.max(1, Math.round(size.width / THUMB_W));
          try {
            const thumb = await pngCropThumb(bytes, y * scale, (y + height) * scale, k);
            art.texture = {
              href: `data:image/png;base64,${toBase64(await encodePng(thumb))}`,
              width: thumb.width,
              height: thumb.height,
            };
          } catch {
            // an unexpected PNG flavour: draw plain islands
          }
        }
      }
    }
    return art;
  };
}

export async function loadStageCard(env: Db, stageId: string): Promise<CardSource | null> {
  const stage = await loadStage(env, stageId);
  if (!stage) return null;
  const info = await stageInfo(env, stage);
  return {
    data: { kind: 'stage', stage: info },
    meta: {
      title: info.title || info.host,
      host: info.host,
      slice: info.slice.count > 1 ? `${info.slice.index + 1}/${info.slice.count}` : null,
    },
    art: stageArtLoader(env, stage, info),
  };
}

export async function loadScoreCard(env: Db, scoreId: string, stageId?: string): Promise<CardSource | null> {
  if (!SHARE_ID_RE.test(scoreId)) return null;
  const row = await env.DB.prepare(
    'SELECT stage_id, name, score, time_ms, verified, detail_json FROM scores WHERE share_id = ?1',
  )
    .bind(scoreId)
    .first<{
      stage_id: string;
      name: string;
      score: number;
      time_ms: number;
      verified: number;
      detail_json: string | null;
    }>();
  if (!row || (stageId !== undefined && row.stage_id !== stageId)) return null;
  const stage = await loadStage(env, row.stage_id);
  if (!stage) return null;
  const [info, ahead] = await Promise.all([
    stageInfo(env, stage),
    env.DB.prepare(
      `SELECT COUNT(DISTINCT name) AS n FROM scores
       WHERE stage_id = ?1 AND name != ?2 AND (score > ?3 OR (score = ?3 AND time_ms < ?4))`,
    )
      .bind(row.stage_id, row.name, row.score, row.time_ms)
      .first<{ n: number }>(),
  ]);
  const verified = row.verified === 1;
  let detail: { small: number; large: number; timeBonus: number } | null = null;
  if (verified && row.detail_json) {
    try {
      const d = JSON.parse(row.detail_json) as Record<string, unknown>;
      const int = (v: unknown) =>
        typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e6 ? v : null;
      const small = int(d.small);
      const large = int(d.large);
      const timeBonus = int(d.timeBonus);
      if (small !== null && large !== null && timeBonus !== null) detail = { small, large, timeBonus };
    } catch {
      detail = null;
    }
  }
  const rank = (ahead?.n ?? 0) + 1;
  return {
    data: {
      kind: 'score',
      scoreId,
      stage: info,
      name: row.name,
      score: row.score,
      rank,
      verified,
      detail,
      timeMs: row.time_ms,
    },
    meta: {
      name: row.name,
      score: row.score,
      rank,
      verified,
      title: info.title || info.host,
      host: info.host,
      stageId: row.stage_id,
    },
    art: stageArtLoader(env, stage, info),
  };
}

export async function loadRunCard(env: Db, scoreId: string): Promise<CardSource | null> {
  if (!SHARE_ID_RE.test(scoreId)) return null;
  const row = await env.DB.prepare(
    'SELECT name, total_score, stages_json FROM run_scores WHERE share_id = ?1',
  )
    .bind(scoreId)
    .first<{ name: string; total_score: number; stages_json: string }>();
  if (!row) return null;
  let ids: string[] = [];
  let stagesCount = 1;
  try {
    const stages = JSON.parse(row.stages_json) as { stageId?: unknown }[];
    stagesCount = Math.max(1, stages.length);
    ids = stages.map((s) => String(s.stageId)).filter((s) => HEX64.test(s));
  } catch {
    ids = [];
  }
  ids = ids.slice(0, 64);
  const urls = new Map<string, string>();
  if (ids.length) {
    const { results } = await env.DB.prepare(
      `SELECT stage_id, url FROM stages WHERE stage_id IN (${ids.map((_, i) => `?${i + 1}`).join(',')})`,
    )
      .bind(...ids)
      .all<{ stage_id: string; url: string }>();
    for (const r of results) urls.set(r.stage_id, r.url);
  }
  const pages: string[] = [];
  const hosts: string[] = [];
  for (const id of ids) {
    const url = urls.get(id);
    if (!url) continue;
    if (!pages.includes(url)) pages.push(url);
    const h = hostOf(url);
    if (h && !hosts.includes(h)) hosts.push(h);
  }
  const ahead = await env.DB.prepare(
    'SELECT COUNT(DISTINCT name) AS n FROM run_scores WHERE name != ?1 AND total_score > ?2',
  )
    .bind(row.name, row.total_score)
    .first<{ n: number }>();
  const rank = (ahead?.n ?? 0) + 1;
  return {
    data: {
      kind: 'run',
      scoreId,
      name: row.name,
      total: row.total_score,
      rank,
      sites: pages.length,
      stages: stagesCount,
      hosts: hosts.slice(0, 4),
    },
    meta: { name: row.name, total: row.total_score, rank, sites: pages.length, stages: stagesCount },
    art: noArt,
  };
}

export async function loadJourneyCard(env: Db, trail: string): Promise<CardSource | null> {
  const t = decodeTrail(trail);
  if (!t) return null;
  // Stops that were server stages: use the stage's real host, not the one in the link.
  const ids = [...new Set(t.stops.map((s) => s.stageId).filter((s): s is string => s !== null))];
  if (ids.length) {
    const { results } = await env.DB.prepare(
      `SELECT stage_id, url FROM stages WHERE stage_id IN (${ids.map((_, i) => `?${i + 1}`).join(',')})`,
    )
      .bind(...ids)
      .all<{ stage_id: string; url: string }>();
    const real = new Map(results.map((r) => [r.stage_id, hostOf(r.url)]));
    for (const s of t.stops) {
      const h = s.stageId ? real.get(s.stageId) : undefined;
      if (h) s.host = h;
    }
  }
  const all = t.stops.map((s) => s.host);
  const { hosts, more } = drawnHosts(all);
  return {
    data: { kind: 'journey', hosts, more, total: t.total, name: t.name },
    meta: { chain: all.join(' → '), stops: all.length, total: t.total, name: t.name },
    art: noArt,
  };
}

export function siteCard(): CardSource {
  return { data: { kind: 'site' }, meta: {}, art: siteArt };
}

/** The practice stage (our own handmade fixture) drawn on the default card. */
async function siteArt(): Promise<CardArt> {
  const { PRACTICE_STAGE, PRACTICE_TEXTURE } = await import('./practice.ts');
  const art: CardArt = { stage: stageArt(PRACTICE_STAGE) };
  const size = pngSize(PRACTICE_TEXTURE);
  if (size) {
    const k = Math.max(1, Math.round(size.width / THUMB_W));
    const thumb = await pngCropThumb(PRACTICE_TEXTURE, 0, size.height, k);
    art.texture = {
      href: `data:image/png;base64,${toBase64(await encodePng(thumb))}`,
      width: thumb.width,
      height: thumb.height,
    };
  }
  return art;
}
