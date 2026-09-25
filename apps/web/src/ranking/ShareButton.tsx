import { useEffect, useState } from 'react';
import { type Challenge, type ShareOutcome, shareLink, shareText, shareUrl } from './share.ts';
import './ranking.css';

function ShareIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M8 10V2M5 4.8 8 2l3 2.8" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M4.5 7H3.5a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export interface ShareButtonProps {
  stageId: string;
  title: string;
  /** Adds "Beat my score" (`?beat=&by=`) to the link. */
  score?: number;
  name?: string | null;
  origin?: string;
  tone?: 'light' | 'dark';
  quiet?: boolean;
}

const FEEDBACK: Record<ShareOutcome, string> = {
  shared: 'Shared',
  copied: 'Link copied',
  cancelled: '',
  failed: 'Couldn’t share. Copy the address bar instead.',
};

/** Web Share on phones, copy-link elsewhere. The link opens `/s/:stageId`, which has the card image. */
export function ShareButton({
  stageId,
  title,
  score,
  name,
  origin,
  tone = 'light',
  quiet = false,
}: ShareButtonProps) {
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);
  useEffect(() => {
    if (!outcome) return;
    const t = setTimeout(() => setOutcome(null), 3000);
    return () => clearTimeout(t);
  }, [outcome]);
  const challenge: Partial<Challenge> = score !== undefined ? { beat: score, by: name ?? null } : {};
  const base = origin ?? (typeof location === 'undefined' ? '' : location.origin);
  return (
    <span
      className="rk"
      data-tone={tone}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.75rem' }}
    >
      <button
        type="button"
        className={quiet ? 'rk-btn rk-btn--quiet' : 'rk-btn'}
        onClick={async () =>
          setOutcome(
            await shareLink({
              url: shareUrl(base, stageId, challenge),
              title,
              text: shareText(title, score),
            }),
          )
        }
      >
        <ShareIcon />
        {score !== undefined ? 'Challenge a friend' : 'Share this maze'}
      </button>
      <span className="rk-status" role="status" aria-live="polite">
        {outcome ? FEEDBACK[outcome] : ''}
      </span>
    </span>
  );
}

/** Shown on /play when the link carried `?beat=` (from a friend's share). */
export function ChallengeBanner({
  challenge,
  tone = 'light',
}: {
  challenge: Challenge;
  tone?: 'light' | 'dark';
}) {
  return (
    <div className="rk rk-challenge" data-tone={tone} role="note">
      <span className="rk-challenge__score">{challenge.beat.toLocaleString('en-US')}</span>
      <span className="rk-challenge__text">
        {challenge.by ? <strong className="rk-name">{challenge.by}</strong> : 'A friend'} challenged you
        <span>Finish above this score to win.</span>
      </span>
    </div>
  );
}
