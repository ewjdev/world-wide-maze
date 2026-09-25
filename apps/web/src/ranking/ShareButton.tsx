import { useEffect, useState } from 'react';
import { type Challenge, fetchCardFile, type ShareOutcome, shareLink, shareText, shareUrl } from './share.ts';
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
  tone?: 'light' | 'dark' | 'game';
  quiet?: boolean;
  /**
   * Share this URL instead of `/s/:stageId`. For stages the server doesn't have (offline fixtures, the practice
   * stage), whose share page would 404: the game passes `/play/<ref>?beat=&by=`.
   */
  href?: string;
  /** Share text (default: `shareText(title, score)`). */
  text?: string;
  labels?: Partial<ShareLabels>;
  /** Extra class on the button (the game uses its own button styles). */
  buttonClassName?: string;
  /**
   * Phase 18: the link's card image (`cardImage(...)`). Fetched ahead of the tap, so the share sheet opens with the
   * picture attached while the tap still counts as a user gesture (iOS drops `share()` after a slow await).
   */
  image?: string;
  /** Accessible name when the label alone is ambiguous (e.g. one share button per stage row). */
  ariaLabel?: string;
  testId?: string;
}

export interface ShareLabels {
  challenge: string;
  share: string;
  feedback: Record<ShareOutcome, string>;
}

export const SHARE_LABELS: ShareLabels = {
  challenge: 'Challenge a friend',
  share: 'Share this maze',
  feedback: {
    shared: 'Shared',
    copied: 'Link copied',
    cancelled: '',
    failed: 'Couldn’t share. Copy the address bar instead.',
  },
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
  href,
  text,
  labels,
  buttonClassName,
  image,
  ariaLabel,
  testId,
}: ShareButtonProps) {
  const L = { ...SHARE_LABELS, ...labels };
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    setFile(null);
    if (!image || typeof navigator === 'undefined' || !navigator.canShare) return;
    let live = true;
    void fetchCardFile(image).then((f) => {
      if (live && f && navigator.canShare?.({ files: [f] })) setFile(f);
    });
    return () => {
      live = false;
    };
  }, [image]);
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
        className={buttonClassName ?? (quiet ? 'rk-btn rk-btn--quiet' : 'rk-btn')}
        aria-label={ariaLabel}
        data-testid={testId}
        onClick={async () =>
          setOutcome(
            await shareLink({
              url: href ?? shareUrl(base, stageId, challenge),
              title,
              text: text ?? shareText(title, score),
              file,
            }),
          )
        }
      >
        <ShareIcon />
        {score !== undefined ? L.challenge : L.share}
      </button>
      <span className="rk-status" role="status" aria-live="polite">
        {outcome ? L.feedback[outcome] : ''}
      </span>
    </span>
  );
}

/**
 * Phase 18: a small preview of the link's card (what a chat app or social network will unfurl). Hidden if the
 * image can't load (offline, a stage only this device has).
 */
export function CardPreview({ src, alt, className }: { src: string; alt: string; className?: string }) {
  // the load state belongs to one `src`; a new card starts as loading again
  const [loaded, setLoaded] = useState<{ src: string; state: 'ok' | 'error' } | null>(null);
  const state = loaded?.src === src ? loaded.state : 'loading';
  const setState = (s: 'ok' | 'error') => setLoaded({ src, state: s });
  if (state === 'error') return null;
  return (
    <figure
      className={`rk-card${className ? ` ${className}` : ''}`}
      data-state={state}
      data-testid="card-preview"
    >
      <img
        src={src}
        alt={alt}
        width={1200}
        height={630}
        loading="lazy"
        decoding="async"
        onLoad={() => setState('ok')}
        onError={() => setState('error')}
      />
    </figure>
  );
}

/** Shown on /play when the link carried `?beat=` (from a friend's share). */
export interface ChallengeLabels {
  /** "<by> challenged you" with the name already rendered; `null` = anonymous. */
  challenged: (by: string | null) => { before: string; after: string };
  aFriend: string;
  goal: string;
}

export const CHALLENGE_LABELS: ChallengeLabels = {
  challenged: () => ({ before: '', after: ' challenged you' }),
  aFriend: 'A friend',
  goal: 'Finish above this score to win.',
};

export function ChallengeBanner({
  challenge,
  tone = 'light',
  labels,
}: {
  challenge: Challenge;
  tone?: 'light' | 'dark' | 'game';
  labels?: Partial<ChallengeLabels>;
}) {
  const L = { ...CHALLENGE_LABELS, ...labels };
  const words = L.challenged(challenge.by);
  return (
    <div className="rk rk-challenge" data-tone={tone} role="note" data-testid="challenge-banner">
      <span className="rk-challenge__score">{challenge.beat.toLocaleString('en-US')}</span>
      <span className="rk-challenge__text">
        {words.before}
        {challenge.by ? <strong className="rk-name">{challenge.by}</strong> : L.aFriend}
        {words.after}
        <span>{L.goal}</span>
      </span>
    </div>
  );
}
