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

/** Web Share API where available (mobile), else copy the link. */
export async function shareLink(data: { url: string; title: string; text: string }): Promise<ShareOutcome> {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  if (nav?.share && (!nav.canShare || nav.canShare(data))) {
    try {
      await nav.share(data);
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await nav?.clipboard?.writeText(data.url);
    return nav?.clipboard ? 'copied' : 'failed';
  } catch {
    return 'failed';
  }
}
