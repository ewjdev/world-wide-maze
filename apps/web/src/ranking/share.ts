/**
 * Share links (Phase 10). `/s/:stageId` is served by the Worker with an Open Graph card (apps/worker
 * src/routes/share.ts) and forwards to `/play/:stageId`, keeping `beat` and `by` so the game can show the challenge.
 */
export interface Challenge {
  beat: number;
  by: string | null;
}

export function shareUrl(origin: string, stageId: string, challenge?: Partial<Challenge>): string {
  const q = new URLSearchParams();
  if (challenge?.beat !== undefined && Number.isInteger(challenge.beat) && challenge.beat >= 0)
    q.set('beat', String(challenge.beat));
  if (challenge?.by && /^[a-z0-9_]{1,32}$/.test(challenge.by)) q.set('by', challenge.by);
  const qs = q.toString();
  return `${origin.replace(/\/$/, '')}/s/${encodeURIComponent(stageId)}${qs ? `?${qs}` : ''}`;
}

/** Read `?beat=&by=` from a play URL. `null` when there is no valid challenge. */
export function readChallenge(search: string | URLSearchParams): Challenge | null {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  const beat = Number(q.get('beat'));
  if (!q.has('beat') || !Number.isInteger(beat) || beat < 0 || beat >= 1e9) return null;
  const by = q.get('by');
  return { beat, by: by && /^[a-z0-9_]{1,32}$/.test(by) ? by : null };
}

/** Faithful share copy (E: `tweet.stage` "I just conquered a 3D maze of "__TITLE__" on World Wide Maze!"). */
export function shareText(title: string, score?: number): string {
  return score !== undefined
    ? `I scored ${score.toLocaleString('en-US')} in a 3D maze of “${title}” on World Wide Maze. Beat me?`
    : `I just conquered a 3D maze of “${title}” on World Wide Maze!`;
}

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

// ── Phase 18: score permalinks and share-card images ────────────────────────────────────────────────

/** A submitted stage score: its link preview is the score card, drawn from the server's row. */
export function scoreUrl(origin: string, stageId: string, scoreId: string): string {
  return `${origin.replace(/\/$/, '')}/s/${encodeURIComponent(stageId)}/r/${encodeURIComponent(scoreId)}`;
}

/** A run-board entry (the session total). */
export function runUrl(origin: string, scoreId: string): string {
  return `${origin.replace(/\/$/, '')}/r/${encodeURIComponent(scoreId)}`;
}

/** The card image the Worker renders for a link (same origin; `/api/cards/<kind>/<id>.png`). */
export function cardImage(kind: 'stage' | 'score' | 'run' | 'journey' | 'site', id: string): string {
  return `/api/cards/${kind}/${encodeURIComponent(id)}.png`;
}

/** The card as a file for the Web Share API (null when it can't be fetched, e.g. offline). */
export async function fetchCardFile(src: string, name = 'world-wide-maze.png'): Promise<File | null> {
  try {
    const res = await fetch(src);
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
    return new File([await res.blob()], name, { type: 'image/png' });
  } catch {
    return null;
  }
}

/** Phones and tablets get the share sheet; desktops copy the link (a share sheet there is rarely wanted). */
function prefersShareSheet(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
}

/**
 * Web Share on touch devices (with the card image attached when the browser can share files, the link in the
 * text so it survives apps that drop `url` next to a file), else copy the link.
 */
export async function shareLink(data: {
  url: string;
  title: string;
  text: string;
  file?: File | null;
}): Promise<ShareOutcome> {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  if (nav?.share && prefersShareSheet()) {
    const plain = { url: data.url, title: data.title, text: data.text };
    const withFile = data.file
      ? { files: [data.file], title: data.title, text: `${data.text}\n${data.url}` }
      : null;
    const payload = withFile && nav.canShare?.(withFile) ? withFile : plain;
    if (!nav.canShare || nav.canShare(payload)) {
      try {
        await nav.share(payload);
        return 'shared';
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      }
    }
  }
  try {
    await nav?.clipboard?.writeText(data.url);
    return nav?.clipboard ? 'copied' : 'failed';
  } catch {
    return 'failed';
  }
}
