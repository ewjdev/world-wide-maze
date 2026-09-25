/**
 * Share cards (Phase 18): what each card shows, and its content-addressed cache key. Pure.
 *
 * A card is rendered from a `CardData` value only, so the R2 key `cards/<kind>/<sha256(renderer version +
 * data)>.png` identifies the picture exactly: same data → same key → rendered once. The share pages put the first
 * 16 hex digits in the image URL (`?v=`), which is then safe to cache as immutable.
 *
 * Trust: stage and score cards are built from server rows only (D1 + R2). `?beat=&by=` link parameters never
 * reach a card. Journey totals come from the share link itself, so they are bounded and labelled as the
 * player's own total, never as verified.
 */

/** Bump when the drawing changes: every card re-renders under a new key. */
export const RENDERER_VERSION = 'cards-1';

export const CARD_W = 1200;
export const CARD_H = 630;

/** Stage geometry the art needs (a subset of StageData, stage-local px). */
export interface StageArt {
  size: { width: number; height: number };
  islands: {
    level: number;
    contour: [number, number][];
    holes: [number, number][][];
    guardrails: [number, number][][];
  }[];
  bridges: { a: [number, number]; b: [number, number]; width: number; levelA: number; levelB: number }[];
  elevators: { a: [number, number]; b: [number, number]; width: number; levelLow: number }[];
  items: { kind: 'small' | 'large'; pos: [number, number]; level: number }[];
  start: { pos: [number, number]; level: number };
  goal: { pos: [number, number]; level: number };
}

/** Where the picture inside a stage/score card comes from (part of the key, so a new hero re-renders). */
export type ArtSource =
  | { kind: 'hero'; etag: string } // curated R2 hero shot `share/<stageId>.png` (real engine render)
  | { kind: 'islands'; texture: 'capture' | 'none' }; // the stage drawn from its geometry (+ the page screenshot)

export interface StageInfo {
  stageId: string;
  /** Page title, or '' when it can't be drawn with the card fonts (then the host is the headline). */
  title: string;
  host: string;
  slice: { index: number; count: number };
  difficulty: 'easy' | 'normal' | 'hard';
  /** Curated difficulty stars (0–5), null for stages that aren't curated. */
  stars: number | null;
  art: ArtSource;
}

export type CardData =
  | { kind: 'site' }
  | { kind: 'stage'; stage: StageInfo }
  | {
      kind: 'score';
      scoreId: string;
      stage: StageInfo;
      name: string;
      score: number;
      /** Current rank on the stage board (best entry per name, as the board shows it). */
      rank: number;
      /** 1 only when the server re-simulated the replay and it reproduced the score. */
      verified: boolean;
      /** Server-side breakdown from the verified replay; null when not verified. */
      detail: { small: number; large: number; timeBonus: number } | null;
      timeMs: number;
    }
  | {
      kind: 'run';
      scoreId: string;
      name: string;
      total: number;
      rank: number;
      /** Distinct sites (pages) and stages in the run. */
      sites: number;
      stages: number;
      hosts: string[];
    }
  | {
      kind: 'journey';
      hosts: string[];
      /** Stops beyond the ones drawn. */
      more: number;
      /** The player's own total from the link (bounded), or null. */
      total: number | null;
      name: string | null;
    };

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** R2 key and URL version of a card. `site` is the host printed on it (production and Previews differ). */
export async function cardKey(data: CardData, site: string): Promise<{ key: string; version: string }> {
  const hash = await sha256Hex(`${RENDERER_VERSION}\n${site}\n${JSON.stringify(data)}`);
  return { key: `cards/${data.kind}/${hash}.png`, version: hash.slice(0, 16) };
}

/** Difficulty as the game names it. */
export const DIFFICULTY_LABEL = { easy: 'Easy', normal: 'Normal', hard: 'Hard' } as const;
