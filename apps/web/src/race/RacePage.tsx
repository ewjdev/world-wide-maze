/*
 * THESIS: the course leads; Race gives familiar ball handling a repeatable personal challenge.
 * OWN-WORLD: inherit WWM's fog white, green bridges, blue islands, Unbounded and Figtree.
 * STORY: choose a readable route, learn it, meet your own shadow on the next attempt.
 * FIRST VIEWPORT: named course list alongside a real map; in play, the world fills the screen.
 * FORM: precise extension of the approved Race flow and existing game shell; no new visual world.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
 */
import '@fontsource-variable/unbounded';
import '@fontsource-variable/figtree';
import { isEligible, type RaceCourse } from '@wwm/race';
import { PX_PER_METER } from '@wwm/schema';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { QrCode } from '../controller/QrCode.tsx';
import { createI18n } from '../i18n/index.ts';
import { Icon } from '../ui/parts.tsx';
import '../ui/game.css';
import { loadRaceCourse, RACE_COURSES } from './courses.ts';
import { RACE_ENABLED } from './flags.ts';
import { ModeNav } from './ModeNav.tsx';
import { RaceSession, type RaceTestHooks } from './session.ts';
import './race.css';

declare global {
  interface Window {
    __wwmRace?: RaceSession;
    __WWM_RACE_TEST__?: RaceTestHooks;
  }
}

export function raceTime(ticks: number, hz = 120) {
  const ms = Math.floor((ticks * 1000) / hz);
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
function delta(ticks: number) {
  return `${ticks < 0 ? '−' : '+'}${(Math.abs(ticks) / 120).toFixed(3)}`;
}

export default function RacePage() {
  const [i18n] = useState(() => createI18n());
  const { courseId } = useParams();
  useEffect(() => {
    document.body.classList.add('wwm-body');
    return () => document.body.classList.remove('wwm-body');
  }, []);
  return (
    <I18nextProvider i18n={i18n}>
      <RaceRoute courseId={courseId} />
    </I18nextProvider>
  );
}
function RaceRoute({ courseId }: { courseId?: string }) {
  const { t } = useTranslation();
  const conflict = new URLSearchParams(location.search).has('learn');
  if (!RACE_ENABLED || conflict)
    return (
      <main className="race-unavailable">
        <h1>{t('race.race')}</h1>
        <p>{t(conflict ? 'race.conflict' : 'race.unavailable')}</p>
        <a href="/">{t('race.original')}</a>
      </main>
    );
  return courseId ? <Course key={courseId} courseId={courseId} /> : <Catalog />;
}
function CourseMap({ course }: { course: RaceCourse }) {
  const { t } = useTranslation();
  return (
    <svg
      viewBox={`0 0 ${course.stage.size.width} ${course.stage.size.height}`}
      role="img"
      aria-label={t('race.layout')}
      className="race-course-map"
    >
      {course.stage.bridges.map((bridge) => (
        <line
          key={`b${bridge.id}`}
          x1={bridge.a[0]}
          y1={bridge.a[1]}
          x2={bridge.b[0]}
          y2={bridge.b[1]}
          stroke="#3f9a4c"
          strokeWidth={bridge.width}
        />
      ))}
      {course.stage.islands.map((island, i) => (
        <polygon
          key={island.id}
          points={island.contour.map((p) => p.join(',')).join(' ')}
          fill={['#e8f0e1', '#dbe9f3', '#f5e8bd'][i % 3]}
          stroke="#4b555f"
          strokeWidth="2"
        />
      ))}
      {course.stunts?.launchPads.flatMap((pad) =>
        pad.landingIslandIds.map((id) => {
          const island = course.stage.islands.find((item) => item.id === id);
          if (!island) return null;
          const x = island.contour.reduce((sum, point) => sum + point[0], 0) / island.contour.length;
          const y = island.contour.reduce((sum, point) => sum + point[1], 0) / island.contour.length;
          return (
            <line
              key={`${pad.id}-${id}`}
              x1={pad.gate.center[0] * PX_PER_METER}
              y1={pad.gate.center[2] * PX_PER_METER}
              x2={x}
              y2={y}
              stroke="#a76616"
              strokeWidth="7"
              strokeDasharray="14 10"
            />
          );
        }),
      )}
      <circle cx={course.stage.start.pos[0]} cy={course.stage.start.pos[1]} r="12" fill="#20262d" />
      <circle cx={course.stage.goal.pos[0]} cy={course.stage.goal.pos[1]} r="13" fill="#2e7a3a" />
    </svg>
  );
}
function Catalog() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(RACE_COURSES[0]?.slug ?? 'flow-sprint');
  const [course, setCourse] = useState<RaceCourse | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setCourse(null);
    setError(false);
    void loadRaceCourse(selected, abort.signal)
      .then(setCourse)
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      });
    return () => abort.abort();
  }, [selected]);
  return (
    <main className="race-catalog">
      <header className="race-catalog-header">
        <a href="/" className="race-wordmark">
          World Wide Maze
        </a>
        <ModeNav active="race" />
      </header>
      <div className="race-catalog-body">
        <section className="race-catalog-copy">
          <h1>{t('race.title')}</h1>
          <p className="race-lead">{t('race.intro')}</p>
          <h2>{t('race.choose')}</h2>
          <div className="race-course-list">
            {RACE_COURSES.map((entry) => (
              <button
                type="button"
                key={entry.slug}
                onClick={() => setSelected(entry.slug)}
                aria-pressed={selected === entry.slug}
              >
                <span>
                  <strong>{entry.title}</strong>
                  <small>{entry.description}</small>
                </span>
                <Icon name="arrow" size={22} />
              </button>
            ))}
          </div>
          <Link className="wwm-btn wwm-btn--primary race-catalog-start" to={`/race/${selected}`}>
            {t('race.raceCourse')}
            <Icon name="arrow" />
          </Link>
          <p className="race-footnote">{t('race.saved')}</p>
        </section>
        <figure className="race-map-panel">
          {course ? (
            <CourseMap course={course} />
          ) : (
            <p role="status">{t(error ? 'race.error' : 'race.loading')}</p>
          )}
          <figcaption>
            <strong>{course?.title}</strong>
            <span>
              {course?.stage.islands.length} {t('race.islands')} · {t('race.source')}
            </span>
          </figcaption>
        </figure>
      </div>
    </main>
  );
}
function Course({ courseId }: { courseId: string }) {
  const [course, setCourse] = useState<RaceCourse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();
  useEffect(() => {
    const abort = new AbortController();
    void loadRaceCourse(courseId, abort.signal)
      .then(setCourse)
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [courseId]);
  if (!course)
    return (
      <main className="race-unavailable">
        <h1>{t(error ? 'race.error' : 'race.loading')}</h1>
        {error && <p>{error}</p>}
        <Link to="/race">{t('race.back')}</Link>
      </main>
    );
  return <RaceGame course={course} />;
}
function RaceGame({ course }: { course: RaceCourse }) {
  const host = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<RaceSession | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const game = new RaceSession(course, import.meta.env.DEV ? window.__WWM_RACE_TEST__ : undefined);
    setSession(game);
    window.__wwmRace = game;
    void game.mount(host.current);
    return () => {
      game.dispose();
      if (window.__wwmRace === game) delete window.__wwmRace;
    };
  }, [course]);
  return (
    <div className={`wwm-root race-root ${course.stunts ? 'race-root--stunts' : ''}`}>
      <div ref={host} className="wwm-stage-host" />
      {session && <RaceScreens session={session} />}
    </div>
  );
}
function RaceScreens({ session }: { session: RaceSession }) {
  const v = useSyncExternalStore(session.subscribe, session.getView);
  const { t } = useTranslation();
  const [pairing, setPairing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const action = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (['ready', 'paused', 'finished', 'error'].includes(v.phase)) action.current?.focus();
  }, [v.phase]);
  const racing = v.phase === 'racing';
  const sectors = session.course.gates.filter((gate) => gate.kind === 'sector').length;
  const eligible = v.result && isEligible(v.result);
  const resultTitle = !eligible ? 'race.practiceFinish' : v.newBest ? 'race.newBest' : 'race.finish';
  const controls = useMemo(
    () => t(session.course.stunts ? 'race.stuntControls' : 'race.controls'),
    [t, session.course.stunts],
  );
  return (
    <>
      <header className="race-game-header">
        <Link to="/race" className="race-back">
          <Icon name="back" size={18} />
          {t('race.courses')}
        </Link>
        <strong>{session.course.title}</strong>
        <button
          type="button"
          className="race-icon-button"
          onClick={() => session.toggleSound()}
          aria-label={t(v.muted ? 'race.soundOff' : 'race.soundOn')}
        >
          <Icon name={v.muted ? 'mute' : 'sound'} />
        </button>
      </header>
      {(racing || v.phase === 'countdown') && (
        <>
          <div className="race-hud">
            <div>
              <span>{t('race.elapsed')}</span>
              <strong data-testid="race-time">{raceTime(v.progress.tick)}</strong>
            </div>
            <div className="race-gates">
              <span>{t('race.sector')}</span>
              <strong>
                {v.progress.sectorTicks.length}
                <small> / {sectors}</small>
              </strong>
            </div>
          </div>
          <div className="race-run-status" aria-live="polite">
            {v.progress.reasons.length > 0 ? t('race.practice') : t('race.nextGate')}
            {v.split !== null && (
              <span className={v.split <= 0 ? 'race-ahead' : ''}>
                {t('race.split')} {delta(v.split)}
              </span>
            )}
            {v.progress.reasons.includes('recording-limit') && <span>{t('race.recordingLimit')}</span>}
          </div>
          {v.mechanics?.enabled && (
            <div className="race-boost" data-testid="race-boost">
              <button
                type="button"
                className="race-boost-button"
                data-testid="race-turbo"
                disabled={!racing || !v.mechanics.ready}
                onClick={() => session.turbo()}
              >
                <span>
                  {t(
                    v.mechanics.turboTicks > 0
                      ? 'race.turboActive'
                      : v.mechanics.ready
                        ? 'race.turboReady'
                        : 'race.turbo',
                  )}
                </span>
                <kbd>T</kbd>
              </button>
              <progress
                aria-label={t('race.turboCharging')}
                max={v.mechanics.chargeRequired}
                value={v.mechanics.ready ? v.mechanics.chargeRequired : v.mechanics.chargeTicks}
              />
              <small role="status" data-testid="race-stunt-event">
                {t(
                  v.stuntEvent === 'landing'
                    ? 'race.cleanLanding'
                    : v.stuntEvent === 'launch'
                      ? 'race.launched'
                      : v.mechanics.turboTicks > 0
                        ? 'race.turboActive'
                        : v.mechanics.ready
                          ? 'race.turboReady'
                          : 'race.turboCharging',
                )}
              </small>
            </div>
          )}
          <div className="race-play-bottom">
            <p>{controls}</p>
            <button type="button" className="wwm-btn wwm-btn--small" onClick={() => session.pause()}>
              {t('race.pause')}
            </button>
          </div>
          {v.ghostCount > 0 && (
            <div className="race-ghost-key">
              <span className="race-ghost-dot" />
              {t('race.bestGhost')}
              {v.ghostCount > 1 && (
                <>
                  <span className="race-ghost-dot secondary" />
                  {t('race.lastGhost')}
                </>
              )}
            </div>
          )}
        </>
      )}
      {v.phase === 'countdown' && (
        <div className="race-countdown" role="status">
          {v.countdown || t('race.go')}
        </div>
      )}
      {!racing && v.phase !== 'countdown' && (
        <main className="race-overlay" data-testid={`race-${v.phase}`}>
          <section className={`race-panel ${v.phase === 'finished' ? 'race-panel-result' : ''}`}>
            {v.phase === 'loading' && <h1 role="status">{t('race.loading')}</h1>}
            {v.phase === 'error' && (
              <>
                <h1>{t('race.error')}</h1>
                <p role="alert">{v.error}</p>
                <button
                  ref={action}
                  type="button"
                  className="wwm-btn wwm-btn--primary"
                  onClick={() => location.reload()}
                >
                  {t('race.reload')}
                </button>
              </>
            )}
            {v.phase === 'ready' && (
              <>
                <h1>{t(session.course.stunts ? 'race.stuntReady' : 'race.ready')}</h1>
                <p>{t(session.course.stunts ? 'race.stuntHint' : 'race.readyHint')}</p>
                <p className="race-best-line">
                  {v.best ? (
                    <>
                      {t('race.best')} <strong>{raceTime(v.best.progress.finishTick ?? 0)}</strong>
                    </>
                  ) : (
                    t('race.noBest')
                  )}
                </p>
                <GhostChoice session={session} />
                <button
                  type="button"
                  ref={action}
                  className="wwm-btn wwm-btn--primary"
                  data-testid="race-start"
                  onClick={() => void session.start()}
                >
                  {t('race.start')}
                  <Icon name="arrow" />
                </button>
                <button
                  type="button"
                  className="wwm-btn wwm-btn--ghost"
                  onClick={() => {
                    setPairing(!pairing);
                    void session.pair();
                  }}
                >
                  {t('race.phone')}
                </button>
                <p className="race-controls">{controls}</p>
              </>
            )}
            {v.phase === 'paused' && (
              <>
                <h1>{t('race.paused')}</h1>
                <p>{t('race.pausedHint')}</p>
                <strong className="race-result-time">{raceTime(v.progress.tick)}</strong>
                <div className="race-actions">
                  <button
                    ref={action}
                    type="button"
                    className="wwm-btn wwm-btn--primary"
                    onClick={() => session.resume()}
                  >
                    {t('race.resume')}
                  </button>
                  <button type="button" className="wwm-btn" onClick={() => void session.start()}>
                    {t('race.retry')}
                  </button>
                </div>
                <button
                  type="button"
                  className="wwm-btn wwm-btn--ghost"
                  onClick={() => session.setInput('keyboard')}
                >
                  {t('race.keyboard')}
                </button>
              </>
            )}
            {v.phase === 'finished' && (
              <>
                <h1>{t(resultTitle)}</h1>
                <strong className="race-result-time" data-testid="race-result-time">
                  {raceTime(v.progress.finishTick ?? v.progress.tick)}
                </strong>
                <p>{t(eligible ? 'race.resultHint' : 'race.practiceHint')}</p>
                {v.mechanics?.enabled && (
                  <p className="race-stunt-result">
                    {t('race.launchCount')}: {v.mechanics.launches} · {t('race.landingCount')}:{' '}
                    {v.mechanics.landings}
                  </p>
                )}
                <ol className="race-splits">
                  {v.progress.sectorTicks.map((tick, i) => (
                    <li key={session.course.gates[i]?.id}>
                      <span>
                        {t('race.sector')} {i + 1}
                      </span>
                      <strong>{raceTime(tick)}</strong>
                      {v.comparisonBest?.progress.sectorTicks[i] !== undefined && (
                        <small>{delta(tick - (v.comparisonBest.progress.sectorTicks[i] ?? tick))}</small>
                      )}
                    </li>
                  ))}
                </ol>
                <GhostChoice session={session} />
                <button
                  type="button"
                  ref={action}
                  className="wwm-btn wwm-btn--primary"
                  data-testid="race-retry"
                  onClick={() => void session.start()}
                >
                  {t('race.retry')}
                  <Icon name="retry" />
                </button>
                <Link className="wwm-btn wwm-btn--ghost" to="/race">
                  {t('race.back')}
                </Link>
              </>
            )}
            {(v.phase === 'ready' || v.phase === 'paused') && pairing && (
              <div className="race-pairing">
                <h2>{t('race.pair')}</h2>
                {v.phone ? (
                  <>
                    <QrCode text={v.phone.pairingUrl} size={152} label={t('race.pair')} />
                    <strong className="race-pair-code">{v.phone.code}</strong>
                    <p>
                      {t(
                        v.phone.raceSupport === 'unsupported'
                          ? 'race.oldPhone'
                          : !v.phone.controllerConnected
                            ? 'race.pendingPhone'
                            : !v.phone.calibrated
                              ? 'race.calibratePhone'
                              : 'race.phoneReady',
                      )}
                    </p>
                    {v.phone.raceSupport === 'supported' && v.phone.calibrated && (
                      <button
                        type="button"
                        className="wwm-btn"
                        onClick={() => {
                          session.setInput('phone');
                          setPairing(false);
                        }}
                      >
                        {t('race.phoneReady')}
                      </button>
                    )}
                  </>
                ) : (
                  <p role="status">{v.error ?? t('race.pendingPhone')}</p>
                )}
                <p>{t('race.pairHint')}</p>
              </div>
            )}
            {(v.phase === 'ready' || v.phase === 'finished') &&
              v.error &&
              !(v.phase === 'ready' && pairing && !v.phone) && <p role="alert">{v.error}</p>}
            {v.ghostError && <p role="status">{t('race.ghostUnavailable')}</p>}
            {!v.persistent && (
              <p className="race-storage-note" role="status">
                {t('race.saveUnavailable')}
              </p>
            )}
            {(v.phase === 'ready' || v.phase === 'finished') && v.recent.length > 0 && (
              <details className="race-history">
                <summary>
                  {t('race.history')} ({v.recent.length})
                </summary>
                <ul>
                  {v.recent.slice(0, 5).map((run) => (
                    <li key={run.id}>
                      <span>
                        {t(
                          isEligible(run)
                            ? 'race.clean'
                            : run.outcome === 'finished'
                              ? 'race.practice'
                              : 'race.incomplete',
                        )}
                      </span>
                      <strong>{raceTime(run.progress.finishTick ?? run.progress.tick)}</strong>
                    </li>
                  ))}
                </ul>
                {clearing ? (
                  <div>
                    <p>{t('race.confirmClear')}</p>
                    <button
                      type="button"
                      className="wwm-btn wwm-btn--small"
                      onClick={() => {
                        void session.clearHistory();
                        setClearing(false);
                      }}
                    >
                      {t('race.delete')}
                    </button>
                    <button
                      type="button"
                      className="wwm-btn wwm-btn--ghost"
                      onClick={() => setClearing(false)}
                    >
                      {t('race.cancel')}
                    </button>
                  </div>
                ) : (
                  <button type="button" className="race-text-button" onClick={() => setClearing(true)}>
                    {t('race.clear')}
                  </button>
                )}
              </details>
            )}
          </section>
        </main>
      )}
    </>
  );
}
function GhostChoice({ session }: { session: RaceSession }) {
  const v = useSyncExternalStore(session.subscribe, session.getView);
  const { t } = useTranslation();
  return (
    <fieldset className="race-ghost-choice">
      <legend>{t('race.ghost')}</legend>
      {(['off', 'best', 'both'] as const).map((value) => (
        <label key={value}>
          <input
            type="radio"
            name="ghosts"
            value={value}
            checked={v.ghosts === value}
            onChange={() => session.setGhosts(value)}
          />
          {t(value === 'off' ? 'race.ghostOff' : value === 'best' ? 'race.ghostBest' : 'race.ghostBoth')}
        </label>
      ))}
      <p>{t(v.recent.length ? 'race.ghostHint' : 'race.noGhost')}</p>
    </fieldset>
  );
}
