/**
 * Stage result (E `stageresult`: title/URL, count-up of seconds × 5 at 10 ms per second (≤ 3 s) with a
 * "point" tick, large × 100, small × 1, stage score, total, "1UP" pop, share, Next / Finish) and the
 * ranking (E: rank "??" then 1st/2nd…, name entry, new game / back to top, share).
 *
 * 08b: Phase 10's ranking pieces mounted here. The result shows this stage's board (N, CD-8) and, on a
 * challenge link, whether the friend's score was beaten; the ranking takes the name with `<NameEntry>`, shows the
 * global board of session totals (E) plus each cleared stage's board, and shares with `<ShareButton>`.
 */
import { LARGE_SCORE, ONEUP_SCORE, SMALL_SCORE, TIME_SCORE } from '@wwm/schema';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NameEntry } from '../ranking/NameEntry.tsx';
import { ChallengeBanner, ShareButton } from '../ranking/ShareButton.tsx';
import { shareUrl } from '../ranking/share.ts';
import {
  GameBoard,
  useChallengeLabels,
  useNameEntryLabels,
  useRankFormat,
  useShareLabels,
} from './Boards.tsx';
import { useGame, useView } from './GameApp.tsx';
import { JourneySection } from './Journey.tsx';
import { Facets, GemIcon, Icon, SmallItemIcon, useSiteTitle } from './parts.tsx';

/** `/s/:stageId` (server share page with the card) or `/play/<ref>` for stages only this device has. */
function shareHref(
  source: 'server' | 'device' | null,
  stageId: string,
  ref: string,
  challenge?: { beat: number; by: string | null },
): string {
  if (source === 'server') return shareUrl(location.origin, stageId, challenge);
  const q = new URLSearchParams();
  if (challenge) {
    q.set('beat', String(challenge.beat));
    if (challenge.by) q.set('by', challenge.by);
  }
  const qs = q.toString();
  return `${location.origin}/play/${encodeURIComponent(ref)}${qs ? `?${qs}` : ''}`;
}

export function ResultScreen() {
  const g = useGame();
  const v = useView();
  const { t } = useTranslation();
  const r = v.result;
  const siteTitle = useSiteTitle();
  const shareLabels = useShareLabels();
  const [secs, setSecs] = useState(0);
  const [stage, setStage] = useState(0); // 0 counting time, 1 large, 2 small, 3 totals
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
  const title = siteTitle(r.title);
  const ch = v.challenge && v.challenge.stageId === r.stageId ? v.challenge : null;
  const chBy = ch?.by ?? t('challenge.friend');
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the tally also skips with any button focus/Enter
    <section
      className="wwm-panel wwm-result"
      aria-labelledby="res-h"
      data-testid="result"
      onClick={stage < 3 ? skip : undefined}
    >
      <Facets seed={3} className="wwm-result__band" />
      <div className="wwm-result__main">
        <header className="wwm-result__head">
          <h2 id="res-h" className="wwm-h1 wwm-result__title">
            {title}
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
        <JourneySection />
        {ch && stage >= 3 && (
          <p
            className={`wwm-verdict${r.stageScore > ch.beat ? ' is-won' : ''}`}
            data-testid="challenge-verdict"
            role="status"
          >
            {r.stageScore > ch.beat
              ? t('challenge.won', { by: chBy, beat: ch.beat.toLocaleString('en-US') })
              : t('challenge.lost', {
                  by: chBy,
                  beat: ch.beat.toLocaleString('en-US'),
                  diff: (ch.beat - r.stageScore + 1).toLocaleString('en-US'),
                })}
          </p>
        )}
      </div>
      <aside className="wwm-result__board" aria-label={t('boards.stage')} data-testid="res-board">
        <GameBoard
          id="res-board"
          source={v.stageSource}
          board={{ kind: 'stage', stageId: r.stageId }}
          title={t('boards.stage')}
          subtitle={v.stageSource === 'device' ? t('boards.deviceSub') : undefined}
          showTime
          limit={8}
          emptyText={t('boards.stageEmpty')}
        />
      </aside>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stops the tally-skip click from bubbling */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: same */}
      <div
        className={`wwm-result__actions${stage >= 3 ? ' is-on' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <ShareButton
          tone="game"
          stageId={r.stageId}
          title={title}
          score={r.stageScore}
          href={shareHref(v.stageSource, r.stageId, r.ref, { beat: r.stageScore, by: null })}
          text={t('result.challengeText', { title, score: r.stageScore.toLocaleString('en-US') })}
          labels={shareLabels}
          buttonClassName="wwm-btn wwm-btn--ghost"
        />
        <span className="wwm-spacer" />
        <button
          type="button"
          className="wwm-btn wwm-btn--secondary"
          onClick={() => g.finish()}
          data-testid="res-finish"
        >
          {t('result.finish')}
        </button>
        <button
          ref={next}
          type="button"
          className="wwm-btn wwm-btn--primary"
          onClick={() => g.next()}
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
  const fmt = useRankFormat();
  const siteTitle = useSiteTitle();
  const entryLabels = useNameEntryLabels();
  const shareLabels = useShareLabels();
  const r = v.ranking;
  const [tab, setTab] = useState<string>('run');
  const [version, setVersion] = useState(0);
  const submitted = r?.submitted ?? false;
  useEffect(() => {
    if (submitted) setVersion((n) => n + 1);
  }, [submitted]);
  if (!r) return null;
  const rankText = r.rank === null ? t('ranking.pending') : fmt(r.rank);
  const done = r.submitted || r.skipped;
  const stageTabs = r.stages.slice(-3);
  const current = stageTabs.find((s) => `stage:${s.resultIndex}` === tab) ?? null;
  const tabTitle = (s: (typeof stageTabs)[number]) =>
    s.sliceCount > 1 ? `${siteTitle(s.title)} ${s.sliceIndex + 1}/${s.sliceCount}` : siteTitle(s.title);
  const note =
    r.source === 'device' ? (g.boards.offline ? t('boards.offline') : t('boards.deviceStage')) : null;
  return (
    <section className="wwm-panel wwm-ranking" aria-labelledby="rank-h" data-testid="ranking">
      <div className="wwm-ranking__you">
        <h2 id="rank-h" className="wwm-h2">
          <Icon name="trophy" /> {t('ranking.title')}
        </h2>
        <p className="wwm-ranking__label">{t('ranking.yourRank')}</p>
        <p className="wwm-ranking__rank" data-testid="rank-value" data-source={r.stored ?? r.source ?? ''}>
          {rankText}
        </p>
        <p className="wwm-ranking__label">{t('ranking.points')}</p>
        <p className="wwm-ranking__total" data-testid="rank-total">
          {r.total}
        </p>
        {!done && r.source !== null && (
          <NameEntry
            tone="game"
            score={r.total}
            onSubmit={(name) => g.submitName(name)}
            onSkip={() => g.skipRanking()}
            labels={entryLabels}
            hideScore
            hideDone
            autoFocus
          />
        )}
        {r.submitted && (
          <div className="wwm-ranking__ok" role="status" data-testid="rank-ok">
            <p>
              {t('ranking.submitted')}
              {r.stored === 'device' && <> {t('ranking.savedDevice')}</>}
            </p>
            {r.stages.length > 0 && (
              <ul className="wwm-stagerank" aria-label={t('ranking.stagesHeading')}>
                {r.stages.map((s) => (
                  <li key={s.resultIndex} data-testid={`stage-rank-${s.resultIndex}`}>
                    <span className="wwm-stagerank__site">{tabTitle(s)}</span>
                    <span className="wwm-stagerank__rank">
                      {s.rank !== null ? t('ranking.stageRank', { rank: fmt(s.rank) }) : '—'}
                    </span>
                    {s.verified && (
                      <span className="wwm-stagerank__ok" data-testid="stage-verified">
                        {t('ranking.verified')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {r.skipped && <p className="wwm-muted">{t('ranking.skipped')}</p>}
        <JourneySection variant="ranking" name={r.name} />
        <div className="wwm-row wwm-ranking__actions">
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
            <ShareButton
              tone="game"
              stageId=""
              title={t('app.name')}
              href={location.origin}
              text={t('ranking.shareText', { rank: rankText })}
              labels={{ ...shareLabels, share: t('ranking.share') }}
              buttonClassName="wwm-btn wwm-btn--ghost"
            />
          )}
        </div>
      </div>
      <div className="wwm-ranking__board">
        {stageTabs.length > 0 && (
          <div className="wwm-seg wwm-boardtabs" role="tablist" aria-label={t('boards.tabs')}>
            <button
              type="button"
              role="tab"
              aria-selected={current === null}
              className={current === null ? 'is-on' : ''}
              onClick={() => setTab('run')}
              data-testid="tab-run"
            >
              {t('boards.runs')}
            </button>
            {stageTabs.map((s) => (
              <button
                key={s.resultIndex}
                type="button"
                role="tab"
                aria-selected={current === s}
                className={current === s ? 'is-on' : ''}
                onClick={() => setTab(`stage:${s.resultIndex}`)}
                data-testid={`tab-stage-${s.resultIndex}`}
                title={tabTitle(s)}
              >
                <span>{tabTitle(s)}</span>
              </button>
            ))}
          </div>
        )}
        <div role="tabpanel" data-testid="rank-board">
          {current === null ? (
            <GameBoard
              key="run"
              id="rank-board-run"
              source={r.source}
              board={{ kind: 'run' }}
              title={t('boards.runs')}
              subtitle={r.source === 'device' ? t('boards.deviceSub') : t('boards.runsSub')}
              you={r.name}
              limit={10}
              emptyText={t('ranking.empty')}
              version={version}
            />
          ) : (
            <GameBoard
              key={`stage:${current.resultIndex}`}
              id="rank-board-stage"
              source={current.stored ?? current.source}
              board={{ kind: 'stage', stageId: current.stageId }}
              title={tabTitle(current)}
              subtitle={(current.stored ?? current.source) === 'device' ? t('boards.deviceSub') : undefined}
              you={r.name}
              showTime
              limit={10}
              emptyText={t('boards.stageEmpty')}
              version={version}
            />
          )}
        </div>
        {note && <p className="wwm-muted wwm-ranking__note">{note}</p>}
      </div>
    </section>
  );
}

/** Shown during the intro and countdown when the play link carried `?beat=`. */
export function ChallengeCard() {
  const v = useView();
  const labels = useChallengeLabels();
  const ch = v.challenge;
  if (!ch || !v.run?.stageId || ch.stageId !== v.run.stageId) return null;
  return (
    <div className="wwm-challenge">
      <ChallengeBanner tone="game" challenge={ch} labels={labels} />
    </div>
  );
}
