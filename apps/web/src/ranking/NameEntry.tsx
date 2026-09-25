import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { isValidName, NAME_MAX, normalizeName, type SubmitResult } from './client.ts';
import './ranking.css';

type SubmitErrorCode = Exclude<SubmitResult, { ok: true }>['error'];
type Submitted = Extract<SubmitResult, { ok: true }>;

/** Visible strings (the game passes its i18n table; the defaults are English). */
export interface NameEntryLabels {
  /** Under the score: what it is for, then the ask. */
  lede: (label: string) => string;
  name: string;
  placeholder: string;
  hint: string;
  submit: string;
  sending: string;
  skip: string;
  errors: Record<SubmitErrorCode, string>;
  /** Shown after a successful submission. */
  done: (r: Submitted, name: string) => string;
}

export const NAME_ENTRY_LABELS: NameEntryLabels = {
  lede: (label) => `${label}. Add your name to the ranking, or skip.`,
  name: 'Name',
  placeholder: 'your_name',
  hint: 'Lowercase letters, numbers and _ (as in 2013).',
  submit: 'Submit score',
  sending: 'Sending…',
  skip: 'Skip',
  errors: {
    name: 'Use a–z, 0–9 and _ only.',
    profanity: 'That name isn’t allowed. Please pick another.',
    implausible: 'This score couldn’t be accepted.',
    'rate-limited': 'Too many submissions from this connection. Wait a few minutes and try again.',
    'not-found': 'This stage isn’t on the server, so it has no leaderboard.',
    network: 'No connection. Check it and try again.',
    server: 'The leaderboard is having trouble. Try again in a moment.',
  },
  done: (r, name) => `${name} is on the board${r.verified ? ', replay verified' : ''}.`,
};

export interface NameEntryProps {
  score: number;
  /** What the score is for, e.g. "Stage total" or "Session total". */
  label?: string;
  initialName?: string;
  /** Send the score. Resolve with the server's answer; the component shows errors and retries. */
  onSubmit(name: string): Promise<SubmitResult>;
  /** E: 2013 offered "skip" (the score is simply not submitted). */
  onSkip(): void;
  onSubmitted?(result: Submitted, name: string): void;
  tone?: 'light' | 'dark' | 'game';
  labels?: Partial<NameEntryLabels>;
  /** The host already shows the score big (the game's ranking screen): leave it out here. */
  hideScore?: boolean;
  /** Hide the "#rank" confirmation (the host shows the rank itself). */
  hideDone?: boolean;
  autoFocus?: boolean;
}

/** The 2013 name entry, faithful in spirit: `[a-z0-9_]`, submit or skip. */
export function NameEntry({
  score,
  label = 'Your score',
  initialName = '',
  onSubmit,
  onSkip,
  onSubmitted,
  tone = 'light',
  labels,
  hideScore = false,
  hideDone = false,
  autoFocus = false,
}: NameEntryProps) {
  const L = { ...NAME_ENTRY_LABELS, ...labels, errors: { ...NAME_ENTRY_LABELS.errors, ...labels?.errors } };
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(normalizeName(initialName));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Submitted | null>(null);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

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
        r.error === 'implausible' && r.message ? `${L.errors.implausible} ${r.message}.` : L.errors[r.error],
      );
  }

  if (done)
    return hideDone ? null : (
      <div className="rk rk-entry" data-tone={tone} role="status">
        <p className="rk-entry__score">#{done.rank}</p>
        <p className="rk-entry__lede" style={{ margin: 0 }}>
          {L.done(done, name)}
        </p>
      </div>
    );

  return (
    <form className="rk rk-entry" data-tone={tone} onSubmit={submit} noValidate data-testid="name-entry">
      {hideScore ? null : <p className="rk-entry__score">{score.toLocaleString('en-US')}</p>}
      <p className="rk-entry__lede">{L.lede(label)}</p>
      <label className="rk-label" htmlFor={id}>
        {L.name}
      </label>
      <div className="rk-field" data-invalid={error !== null}>
        <input
          ref={input}
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
          placeholder={L.placeholder}
          aria-describedby={`${id}-hint`}
          aria-invalid={error !== null}
          data-testid="name-input"
        />
        <span className="rk-count" aria-hidden="true">
          {name.length}/{NAME_MAX}
        </span>
      </div>
      <p className="rk-hint" id={`${id}-hint`} data-error={error !== null} aria-live="polite">
        {error ?? L.hint}
      </p>
      <div className="rk-actions">
        <button
          type="submit"
          className="rk-btn"
          disabled={!isValidName(name) || busy}
          data-testid="name-submit"
        >
          {busy ? L.sending : L.submit}
        </button>
        <button type="button" className="rk-link" onClick={onSkip} data-testid="name-skip">
          {L.skip}
        </button>
      </div>
    </form>
  );
}
