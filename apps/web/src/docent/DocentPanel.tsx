/**
 * `<DocentPanel/>` (Phase 15): "Ask the docent" on /about and /log. Answers stream from `POST /api/docent`
 * (contracts §10.3) with numbered citations; markers `[n]` in the text link to source n below the answer.
 * Lives inside a `ShowcaseFrame` (uses the showcase tokens). Keyboard: Enter asks, Shift+Enter adds a line,
 * Escape stops an answer. Screen readers get one polite announcement per finished answer, not every word.
 */
import type { DocentCitation } from '@wwm/schema';
import { DOCENT_QUESTION_MAX } from '@wwm/schema';
import {
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { detectLang, type Lang } from '../i18n/index.ts';
import { DOCENT_STRINGS, type DocentStrings } from './strings.ts';
import { type Turn, useDocent } from './useDocent.ts';
import './docent.css';

const REPO_URL = ((import.meta.env.VITE_REPO_URL as string | undefined) || '').replace(/\/$/, '') || null;

/** Where a citation points: a page of this site, the file on GitHub (when public), or just its path. */
export function citationHref(
  c: DocentCitation,
  repo: string | null = REPO_URL,
): { href: string; site: boolean } | null {
  if (c.url) return { href: c.url, site: c.url.startsWith('/') };
  if (repo) return { href: `${repo}/blob/main/${c.path}${c.anchor ? `#${c.anchor}` : ''}`, site: false };
  return null;
}

/** Splits answer text into paragraphs, turning `[n]` into links to the numbered sources. */
/** Pieces of `s` split by `re` (with a capture group), each keyed by its character offset (stable while streaming). */
function pieces(s: string, re: RegExp): { at: number; text: string }[] {
  let at = 0;
  return s.split(re).map((text) => {
    const piece = { at, text };
    at += text.length;
    return piece;
  });
}

function AnswerText({ text, idBase, t }: { text: string; idBase: string; t: DocentStrings }) {
  return (
    <>
      {pieces(text, /(\n{2,})/)
        .filter((p) => p.text.trim())
        .map((p) => (
          <p key={p.at}>
            {pieces(p.text, /(\[\d+\])/).map((part) => {
              const m = /^\[(\d+)\]$/.exec(part.text);
              if (!m) return <Fragment key={part.at}>{part.text}</Fragment>;
              const n = Number(m[1]);
              return (
                <sup key={part.at} className="dc-ref">
                  <a href={`#${idBase}-src-${n}`} aria-label={t.sourceLabel(n)}>
                    {n}
                  </a>
                </sup>
              );
            })}
          </p>
        ))}
    </>
  );
}

function SourceLink({ c, children }: { c: DocentCitation; children: ReactNode }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const target = citationHref(c);
  if (!target) return <span>{children}</span>;
  if (!target.site)
    return (
      <a href={target.href} rel="noreferrer" target="_blank">
        {children}
      </a>
    );
  const [path, hash] = target.href.split('#');
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // same page: react-router won't scroll to a hash, so do it here
    if (path === loc.pathname && hash) {
      e.preventDefault();
      navigate({ hash: `#${hash}` }, { replace: false });
      document.getElementById(decodeURIComponent(hash))?.scrollIntoView({ block: 'start' });
    }
  };
  return (
    <Link to={target.href} onClick={onClick}>
      {children}
    </Link>
  );
}

function Sources({ turn, idBase, t }: { turn: Turn; idBase: string; t: DocentStrings }) {
  if (!turn.citations.length) return null;
  return (
    <div className="dc-sources">
      <h4 className="dc-sources__h">{t.sources}</h4>
      <ol>
        {turn.citations.map((c, i) => {
          const where = citationHref(c);
          return (
            <li key={`${c.path}#${c.anchor ?? ''}`} id={`${idBase}-src-${i + 1}`}>
              <span className="dc-sources__n sc-mono" aria-hidden="true">
                {i + 1}
              </span>
              <span>
                <SourceLink c={c}>{c.title}</SourceLink>
                <span className="dc-sources__path sc-mono">
                  {c.path}
                  {c.anchor ? `#${c.anchor}` : ''}
                  {where && !where.site ? ` ${t.onGitHub}` : ''}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TurnView({
  turn,
  t,
  idBase,
  onRetry,
}: {
  turn: Turn;
  t: DocentStrings;
  idBase: string;
  onRetry: () => void;
}) {
  const dontKnow = turn.status === 'done' && !turn.citations.length && !!turn.text;
  return (
    <li className="dc-turn" data-status={turn.status}>
      <p className="dc-q">
        <span className="dc-who">{t.you}</span>
        <span className="dc-q__text">{turn.shown}</span>
      </p>
      <div className="dc-a" aria-busy={turn.status === 'streaming'}>
        {turn.text ? <AnswerText text={turn.text} idBase={idBase} t={t} /> : null}
        {turn.status === 'streaming' ? (
          <p className="dc-thinking">
            <span className="dc-track" aria-hidden="true">
              <span className="dc-ball" />
            </span>
            {turn.text ? null : t.thinking}
          </p>
        ) : null}
        {dontKnow ? <p className="dc-aside">{t.dontKnowNote}</p> : null}
        {turn.status === 'stopped' ? <p className="dc-aside">{t.stopped}</p> : null}
        {turn.status === 'error' ? (
          <div className="dc-error" role="alert">
            <p>
              {turn.error?.code === 'NETWORK' || !turn.error?.message ? t.networkError : turn.error.message}
            </p>
            {turn.error?.code === 'QUESTION_REJECTED' ? null : turn.error?.code === 'NETWORK' ? (
              <button type="button" className="dc-link-btn" onClick={onRetry}>
                {t.retry}
              </button>
            ) : (
              <p className="dc-aside">
                {t.seeAlso} <Link to="/about">{t.historyPage}</Link> · <Link to="/log">{t.logPage}</Link>
              </p>
            )}
          </div>
        ) : null}
        <Sources turn={turn} idBase={idBase} t={t} />
      </div>
    </li>
  );
}

export interface DocentPanelProps {
  lang?: Lang;
  /** `section`: a full showcase section (heading beside the desk); `compact`: stacked, for the /log header. */
  variant?: 'section' | 'compact';
  /** Test hook. */
  fetch?: typeof fetch;
  className?: string;
}

export function DocentPanel({ lang, variant = 'section', fetch: fetchImpl, className }: DocentPanelProps) {
  const t = DOCENT_STRINGS[lang ?? detectLang()];
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const idBase = `docent-${uid}`;
  const { turns, busy, ask, stop, reset } = useDocent(fetchImpl ? { fetch: fetchImpl } : {});
  const [q, setQ] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState('');

  const last = turns.at(-1);
  // One announcement per finished answer (the streaming text itself is aria-busy).
  useEffect(() => {
    if (!last) return setStatus('');
    if (last.status === 'streaming') return setStatus(t.thinking);
    if (last.status === 'done')
      setStatus(`${t.answerReady(last.citations.length)} ${last.text.replace(/\[\d+\]/g, '')}`);
    else if (last.status === 'stopped') setStatus(t.stopped);
    else setStatus('');
  }, [last, t]);

  const submit = (text = q, shown?: string) => {
    if (!text.trim() || busy) return;
    ask(text.slice(0, DOCENT_QUESTION_MAX), shown);
    setQ('');
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape' && busy) {
      e.preventDefault();
      stop();
    }
  };

  return (
    <section
      className={`dc sc-section ${variant === 'section' ? 'sc-split' : 'dc--compact'} ${className ?? ''}`}
      aria-labelledby={`${idBase}-h`}
      id="ask"
      data-variant={variant}
    >
      <div className="dc-head">
        <h2 className="sc-h2" id={`${idBase}-h`}>
          {t.title}
        </h2>
        <p className="sc-note">{t.intro}</p>
        <details className="dc-how">
          <summary>{t.howTitle}</summary>
          <ol>
            {t.how.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ol>
        </details>
      </div>

      <div className="dc-desk">
        {turns.length ? (
          <ol className="dc-turns" aria-label={t.title}>
            {turns.map((turn) => (
              <TurnView
                key={turn.id}
                turn={turn}
                t={t}
                idBase={`${idBase}-${turn.id}`}
                onRetry={() => submit(turn.asked, turn.shown)}
              />
            ))}
          </ol>
        ) : null}
        {turns.length === 0 || last?.error?.code === 'QUESTION_REJECTED' ? (
          <div className="dc-suggest">
            <p className="dc-label" id={`${idBase}-sugg`}>
              {t.suggestedLabel}
            </p>
            <ul aria-labelledby={`${idBase}-sugg`}>
              {t.suggestions.map((s) => (
                <li key={s.label}>
                  <button type="button" onClick={() => submit(s.ask, s.label)}>
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <form
          className="dc-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="dc-label" htmlFor={`${idBase}-q`}>
            {t.label}
          </label>
          <div className="dc-field">
            <textarea
              ref={input}
              id={`${idBase}-q`}
              rows={2}
              value={q}
              maxLength={DOCENT_QUESTION_MAX}
              placeholder={t.placeholder}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKey}
              aria-describedby={`${idBase}-count`}
            />
            {busy ? (
              <button type="button" className="dc-btn dc-btn--stop" onClick={stop}>
                {t.stop}
              </button>
            ) : (
              <button type="submit" className="dc-btn" disabled={!q.trim()}>
                {t.ask}
              </button>
            )}
          </div>
          <p className="dc-meta">
            <span id={`${idBase}-count`} className="sc-mono" data-near={q.length > DOCENT_QUESTION_MAX * 0.8}>
              {t.counter(q.length, DOCENT_QUESTION_MAX)}
            </span>
            {turns.length ? (
              <button
                type="button"
                className="dc-link-btn"
                onClick={() => {
                  reset();
                  input.current?.focus();
                }}
              >
                {t.startOver}
              </button>
            ) : null}
          </p>
        </form>
        <p className="dc-sr" role="status" aria-live="polite">
          {status}
        </p>
      </div>
    </section>
  );
}

export default DocentPanel;
