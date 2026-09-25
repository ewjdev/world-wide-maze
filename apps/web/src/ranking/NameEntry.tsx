import { type FormEvent, useId, useState } from 'react';
import { isValidName, NAME_MAX, normalizeName, type SubmitResult } from './client.ts';
import './ranking.css';

export interface NameEntryProps {
  score: number;
  /** What the score is for, e.g. "Stage total" or "Session total". */
  label?: string;
  initialName?: string;
  /** Send the score. Resolve with the server's answer; the component shows errors and retries. */
  onSubmit(name: string): Promise<SubmitResult>;
  /** E: 2013 offered "skip" (the score is simply not submitted). */
  onSkip(): void;
  onSubmitted?(result: Extract<SubmitResult, { ok: true }>, name: string): void;
  tone?: 'light' | 'dark';
}

const MESSAGES: Record<Exclude<SubmitResult, { ok: true }>['error'], string> = {
  name: 'Use a–z, 0–9 and _ only.',
  profanity: 'That name isn’t allowed. Please pick another.',
  implausible: 'This score couldn’t be accepted.',
  'rate-limited': 'Too many submissions from this connection. Wait a few minutes and try again.',
  'not-found': 'This stage isn’t on the server, so it has no leaderboard.',
  network: 'No connection. Check it and try again.',
  server: 'The leaderboard is having trouble. Try again in a moment.',
};

/** The 2013 name entry, faithful in spirit: `[a-z0-9_]`, submit or skip. */
export function NameEntry({
  score,
  label = 'Your score',
  initialName = '',
  onSubmit,
  onSkip,
  onSubmitted,
  tone = 'light',
}: NameEntryProps) {
  const id = useId();
  const [name, setName] = useState(normalizeName(initialName));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<SubmitResult, { ok: true }> | null>(null);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!isValidName(name) || busy) return;
    setBusy(true);
    setError(null);
    const r = await onSubmit(name);
    setBusy(false);
    if (r.ok) {
      setDone(r);
      onSubmitted?.(r, name);
    } else
      setError(
        r.error === 'implausible' && r.message ? `${MESSAGES.implausible} ${r.message}.` : MESSAGES[r.error],
      );
  }

  if (done)
    return (
      <div className="rk rk-entry" data-tone={tone} role="status">
        <p className="rk-entry__score">#{done.rank}</p>
        <p className="rk-entry__lede" style={{ margin: 0 }}>
          <span className="rk-name">{name}</span> is on the board{done.verified ? ', replay verified' : ''}.
        </p>
      </div>
    );

  return (
    <form className="rk rk-entry" data-tone={tone} onSubmit={submit} noValidate>
      <p className="rk-entry__score">{score.toLocaleString('en-US')}</p>
      <p className="rk-entry__lede">{label}. Add your name to the ranking, or skip.</p>
      <label className="rk-label" htmlFor={id}>
        Name
      </label>
      <div className="rk-field" data-invalid={error !== null}>
        <input
          id={id}
          className="rk-input"
          value={name}
          onChange={(e) => {
            setName(normalizeName(e.target.value));
            setError(null);
          }}
          autoComplete="nickname"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={NAME_MAX}
          placeholder="your_name"
          aria-describedby={`${id}-hint`}
          aria-invalid={error !== null}
        />
        <span className="rk-count" aria-hidden="true">
          {name.length}/{NAME_MAX}
        </span>
      </div>
      <p className="rk-hint" id={`${id}-hint`} data-error={error !== null} aria-live="polite">
        {error ?? 'Lowercase letters, numbers and _ (as in 2013).'}
      </p>
      <div className="rk-actions">
        <button type="submit" className="rk-btn" disabled={!isValidName(name) || busy}>
          {busy ? 'Sending…' : 'Submit score'}
        </button>
        <button type="button" className="rk-link" onClick={onSkip}>
          Skip
        </button>
      </div>
    </form>
  );
}
