/**
 * Stage result (E `stageresult`: title/URL, count-up of seconds × 5 at 10 ms per second (≤ 3 s) with a
 * "point" tick, large × 100, small × 1, stage score, total, "1UP" pop, share, Next / Finish) and the
 * ranking (E: rank "??" then 1st/2nd…, name entry, new game / back to top, share).
 */
import { LARGE_SCORE, ONEUP_SCORE, SMALL_SCORE, TIME_SCORE } from '@wwm/schema';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ordinal } from '../game/rules.ts';
import { useGame, useView } from './GameApp.tsx';
import { Facets, GemIcon, Icon, SmallItemIcon } from './parts.tsx';

async function share(text: string, url: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (navigator.share) {
      await navigator.share({ text, url });
      return 'shared';
    }
    await navigator.clipboard.writeText(`${text} ${url}`);
    return 'copied';
  } catch {
    return 'failed';
  }
}

export function ResultScreen() {
  const g = useGame();
  const v = useView();
  const { t } = useTranslation();
  const r = v.result;
  const [secs, setSecs] = useState(0);
  const [stage, setStage] = useState(0); // 0 counting time, 1 large, 2 small, 3 totals
  const [shared, setShared] = useState(false);
  const next = useRef<HTMLButtonElement>(null);
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (!r) return;
    if (reduced) {
      setSecs(r.timeInt);
      setStage(3);
      return;
    }
    const per = Math.min(10, 3000 / Math.max(1, r.timeInt)); // E: 10 ms per second, max 3 s
    const t0 = performance.now() + 450;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      const n = Math.max(0, Math.min(r.timeInt, Math.floor((now - t0) / per)));
      if (n !== last) {
        if (Math.floor(n / 4) !== Math.floor(last / 4)) g.audio.play('point', { gain: 0.5 });
        last = n;
        setSecs(n);
      }
      if (n < r.timeInt) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [r, g, reduced]);

  useEffect(() => {
    if (!r || stage >= 3) return;
    if (stage === 0 && secs < r.timeInt) return;
    const t = setTimeout(() => setStage((x) => Math.min(3, x + 1)), stage === 0 ? 250 : 300);
    return () => clearTimeout(t);
  }, [r, secs, stage]);

  useEffect(() => {
    if (stage === 3) next.current?.focus();
  }, [stage]);

  if (!r) return null;
  const skip = () => {
    setSecs(r.timeInt);
    setStage(3);
  };
  const bonus = secs * TIME_SCORE;
  const runningTotal = r.totalBefore + bonus;
  const oneUpShown =
    r.oneUps > 0 && Math.floor(runningTotal / ONEUP_SCORE) > Math.floor(r.totalBefore / ONEUP_SCORE);
  const more = r.sliceIndex + 1 < r.sliceCount;
  const host = r.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the tally also skips with any button focus/Enter
    <section
      className="wwm-panel wwm-result"
      aria-labelledby="res-h"
      data-testid="result"
      onClick={stage < 3 ? skip : undefined}
    >
      <Facets seed={3} className="wwm-result__band" />
      <header className="wwm-result__head">
        <h2 id="res-h" className="wwm-h1 wwm-result__title">
          {r.title}
        </h2>
        <p className="wwm-result__url">
          {host && !host.startsWith('wwm:') ? `${host} · ` : ''}
          {t('result.cleared')}
          {r.sliceCount > 1 && (
            <> · {t('result.stageOf', { index: r.sliceIndex + 1, count: r.sliceCount })}</>
          )}
        </p>
      </header>
      <dl className="wwm-tally">
        <div className="wwm-tally__row is-on">
          <dt>
            <Icon name="retry" size={18} /> {t('result.timeLeft')}
          </dt>
          <dd className="wwm-tally__calc">
            {t('result.seconds', { count: secs })} × {TIME_SCORE}
          </dd>
          <dd className="wwm-tally__pts" data-testid="res-time">
            {bonus}
          </dd>
        </div>
        <div className={`wwm-tally__row${stage >= 1 ? ' is-on' : ''}`}>
          <dt>
            <GemIcon size={18} /> {t('result.large')}
          </dt>
          <dd className="wwm-tally__calc">
            {r.large} × {LARGE_SCORE}
          </dd>
          <dd className="wwm-tally__pts" data-testid="res-large">
            {r.large * LARGE_SCORE}
          </dd>
        </div>
        <div className={`wwm-tally__row${stage >= 2 ? ' is-on' : ''}`}>
          <dt>
            <SmallItemIcon size={16} /> {t('result.small')}
          </dt>
          <dd className="wwm-tally__calc">
            {r.small} × {SMALL_SCORE}
          </dd>
          <dd className="wwm-tally__pts" data-testid="res-small">
            {r.small * SMALL_SCORE}
          </dd>
        </div>
        <div className={`wwm-tally__row wwm-tally__row--stage${stage >= 3 ? ' is-on' : ''}`}>
          <dt>{t('result.stageScore')}</dt>
          <dd className="wwm-tally__pts" data-testid="res-stage">
            {stage >= 3 ? r.stageScore : ''}
          </dd>
        </div>
        <div className="wwm-tally__row wwm-tally__row--total is-on">
          <dt>{t('result.total')}</dt>
          <dd className="wwm-tally__pts" data-testid="res-total" data-final={stage >= 3 ? r.total : ''}>
            {stage >= 3 ? r.total : runningTotal}
          </dd>
          {oneUpShown && <dd className="wwm-oneup">{t('result.oneUp')}</dd>}
        </div>
      </dl>
      <div className={`wwm-result__actions${stage >= 3 ? ' is-on' : ''}`}>
        <button
          type="button"
          className="wwm-btn wwm-btn--ghost"
          onClick={async (e) => {
            e.stopPropagation();
            const res = await share(t('result.shareText', { title: r.title }), g.shareUrl());
            setShared(res !== 'failed');
          }}
        >
          <Icon name="share" /> {shared ? t('result.shared') : t('result.share')}
        </button>
        <span className="wwm-spacer" />
        <button
          type="button"
          className="wwm-btn wwm-btn--secondary"
          onClick={(e) => {
            e.stopPropagation();
            g.finish();
          }}
          data-testid="res-finish"
        >
          {t('result.finish')}
        </button>
        <button
          ref={next}
          type="button"
          className="wwm-btn wwm-btn--primary"
          onClick={(e) => {
            e.stopPropagation();
            g.next();
          }}
          data-testid="res-next"
        >
          {more ? t('result.next') : t('result.another')} <Icon name="arrow" />
        </button>
      </div>
    </section>
  );
}

export function RankingScreen() {
  const g = useGame();
  const v = useView();
  const { t } = useTranslation();
  const r = v.ranking;
  const [name, setName] = useState('');
  const [skipped, setSkipped] = useState(false);
  const [shared, setShared] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  if (!r) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void g.submitName(name);
  };
  const rankText = r.rank === null ? t('ranking.pending') : ordinal(r.rank);
  const done = r.submitted || skipped;
  return (
    <section className="wwm-panel wwm-ranking" aria-labelledby="rank-h" data-testid="ranking">
      <div className="wwm-ranking__you">
        <h2 id="rank-h" className="wwm-h2">
          <Icon name="trophy" /> {t('ranking.title')}
        </h2>
        <p className="wwm-ranking__label">{t('ranking.yourRank')}</p>
        <p className="wwm-ranking__rank" data-testid="rank-value">
          {rankText}
        </p>
        <p className="wwm-ranking__label">{t('ranking.points')}</p>
        <p className="wwm-ranking__total" data-testid="rank-total">
          {r.total}
        </p>
        {!done ? (
          <form className="wwm-namebar" onSubmit={submit}>
            <label htmlFor="wwm-name" className="wwm-sr">
              {t('ranking.placeholder')}
            </label>
            <input
              ref={input}
              id="wwm-name"
              value={name}
              maxLength={16}
              autoComplete="nickname"
              spellCheck={false}
              placeholder={t('ranking.placeholder')}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '-'))}
              data-testid="name-input"
            />
            <button
              type="submit"
              className="wwm-btn wwm-btn--primary"
              disabled={!name}
              data-testid="name-submit"
            >
              {t('ranking.submit')}
            </button>
            <button type="button" className="wwm-btn wwm-btn--ghost" onClick={() => setSkipped(true)}>
              {t('ranking.skip')}
            </button>
          </form>
        ) : (
          r.submitted && <p className="wwm-ranking__ok">{t('ranking.submitted')}</p>
        )}
        <div className="wwm-row">
          <button
            type="button"
            className="wwm-btn wwm-btn--primary"
            onClick={() => g.newGame()}
            data-testid="new-game"
          >
            <Icon name="play" /> {t('ranking.newGame')}
          </button>
          <button type="button" className="wwm-btn wwm-btn--ghost" onClick={() => g.toTitle()}>
            {t('ranking.top')}
          </button>
          {r.rank !== null && (
            <button
              type="button"
              className="wwm-btn wwm-btn--ghost"
              onClick={async () => {
                const res = await share(t('ranking.shareText', { rank: rankText }), location.origin);
                setShared(res !== 'failed');
              }}
            >
              <Icon name="share" /> {shared ? t('result.shared') : t('ranking.share')}
            </button>
          )}
        </div>
      </div>
      <div className="wwm-ranking__board">
        {r.top.length === 0 ? (
          <p className="wwm-muted">{t('ranking.empty')}</p>
        ) : (
          <table className="wwm-board">
            <thead>
              <tr>
                <th scope="col">{t('ranking.rankCol')}</th>
                <th scope="col">{t('ranking.nameCol')}</th>
                <th scope="col">{t('ranking.scoreCol')}</th>
              </tr>
            </thead>
            <tbody>
              {r.top.map((e, i) => (
                <tr key={`${e.at}-${e.name}`}>
                  <td>{ordinal(i + 1)}</td>
                  <td>{e.name}</td>
                  <td>{e.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {r.local && <p className="wwm-muted wwm-ranking__note">{t('ranking.local')}</p>}
      </div>
    </section>
  );
}
