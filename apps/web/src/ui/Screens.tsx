/**
 * Menu screens (title → how-to → connect → calibrate → select → building / error) and the phase switch.
 * In-stage overlays live in Play.tsx, the result and ranking in Result.tsx.
 */

import { pairingUrl } from '@wwm/net';
import { type FormEvent, type ReactElement, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCode, QrCode } from '../controller/index.ts';
import { type CatalogEntry, FIXTURES, PRACTICE } from '../game/catalog.ts';
import { Game } from '../game/game.ts';
import { normalizeInputUrl } from '../game/stages.ts';
import { SelectHint } from '../local-capture/SelectHint.tsx';
import { useGame, useView } from './GameApp.tsx';
import { JourneyTrail } from './Journey.tsx';
import { useJourneyT } from './journey-strings.ts';
import { PlayLayer } from './Play.tsx';
import { Facets, Icon, Logo, Stars, TiltRing, useSiteTitle } from './parts.tsx';
import { RankingScreen, ResultScreen } from './Result.tsx';
import { TopBar } from './Settings.tsx';

export function Screens() {
  const v = useView();
  const { t } = useTranslation();
  if (v.unsupported) return <Unsupported />;
  let screen: ReactElement | null = null;
  switch (v.phase) {
    case 'title':
      screen = <Title />;
      break;
    case 'howto':
      screen = <HowTo />;
      break;
    case 'pairing':
      screen = <Pairing />;
      break;
    case 'calibrate':
      screen = <Calibrate />;
      break;
    case 'select':
      screen = <Select />;
      break;
    case 'building':
      screen = <Building />;
      break;
    case 'error':
      screen = <ErrorScreen />;
      break;
    case 'result':
      screen = <ResultScreen />;
      break;
    case 'ranking':
      screen = <RankingScreen />;
      break;
    default:
      screen = null;
  }
  const menuPhase = ![
    'intro',
    'countdown',
    'play',
    'paused',
    'falling',
    'restarting',
    'goal',
    'timeup',
    'gameover',
  ].includes(v.phase);
  return (
    <>
      {menuPhase && v.phase !== 'title' && <div className="wwm-veil" aria-hidden="true" />}
      <PlayLayer />
      {screen && (
        <main className={`wwm-screen wwm-screen--${v.phase}`} data-screen={v.phase} key={v.phase}>
          {screen}
        </main>
      )}
      {menuPhase && <TopBar />}
      {!v.engineReady && v.phase === 'title' && (
        <p className="wwm-sr" role="status">
          {t('building.step.world')}
        </p>
      )}
    </>
  );
}

// ── title ─────────────────────────────────────────────────────────────────────────────────────────────

function Title() {
  const g = useGame();
  const v = useView();
  const { t } = useTranslation();
  const start = useRef<HTMLButtonElement>(null);
  useEffect(() => start.current?.focus(), []);
  return (
    <div className="wwm-title">
      <div className="wwm-title__block">
        <Logo />
        <p className="wwm-title__caption">{t('title.caption')}</p>
        <div className="wwm-title__actions">
          <button
            ref={start}
            type="button"
            className="wwm-btn wwm-btn--hero"
            onClick={() => g.start()}
            disabled={!v.engineReady}
            data-testid="start"
          >
            <span>{t('title.start')}</span>
            <Icon name="arrow" size={26} />
          </button>
        </div>
      </div>
      <footer className="wwm-title__foot">
        <p>{t('app.tribute')}</p>
        <a href="/about">{t('title.about')}</a>
        <a href="/privacy/analytics">{t('analytics.title')}</a>
      </footer>
    </div>
  );
}

// ── how to ───────────────────────────────────────────────────────────────────────────────────────────

function HowTo() {
  const g = useGame();
  const { t } = useTranslation();
  const go = useRef<HTMLButtonElement>(null);
  useEffect(() => go.current?.focus(), []);
  const steps = [t('howto.step1'), t('howto.step2'), t('howto.step3'), t('howto.step4')];
  return (
    <section className="wwm-panel wwm-howto" aria-labelledby="howto-h">
      <h2 id="howto-h" className="wwm-h2">
        {t('howto.heading')}
      </h2>
      <ol className="wwm-howto__steps">
        {steps.map((s, i) => (
          <li key={s} className="wwm-howto__step">
            <HowToArt n={i + 1} />
            <span className="wwm-howto__n" aria-hidden="true">
              {i + 1}
            </span>
            <p>{s}</p>
          </li>
        ))}
      </ol>
      <div className="wwm-row wwm-row--end">
        <button type="button" className="wwm-btn wwm-btn--ghost" onClick={() => g.howtoDone()}>
          {t('common.skip')}
        </button>
        <button
          ref={go}
          type="button"
          className="wwm-btn wwm-btn--primary"
          onClick={() => g.howtoDone()}
          data-testid="howto-go"
        >
          {t('howto.go')} <Icon name="arrow" />
        </button>
      </div>
    </section>
  );
}

/** Small authored illustrations for the four how-to steps. */
function HowToArt({ n }: { n: number }) {
  const stroke = {
    fill: 'none',
    stroke: '#20262d',
    strokeWidth: 2.2,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
  };
  return (
    <svg className="wwm-howto__art" viewBox="0 0 120 80" aria-hidden="true">
      {n === 1 && (
        <>
          <rect x="10" y="16" width="58" height="38" rx="3" {...stroke} />
          <path d="M28 62h22M39 54v8" {...stroke} />
          <rect x="84" y="20" width="22" height="40" rx="4" {...stroke} />
          <path
            d="M70 36c5-6 9-6 13 0"
            fill="none"
            stroke="#4f9fd6"
            strokeWidth="2.6"
            strokeDasharray="3 4"
          />
        </>
      )}
      {n === 2 && (
        <>
          <rect x="22" y="8" width="76" height="62" rx="3" {...stroke} />
          <path d="M22 20h76" {...stroke} />
          <rect x="30" y="28" width="26" height="16" fill="#acc4d0" />
          <rect x="62" y="28" width="28" height="5" fill="#cabcc3" />
          <rect x="62" y="37" width="20" height="5" fill="#cabcc3" />
          <rect x="30" y="50" width="60" height="5" fill="#edc9b4" />
          <rect x="30" y="59" width="44" height="5" fill="#edc9b4" />
        </>
      )}
      {n === 3 && (
        <>
          <path
            d="M14 58l30-14 30 14-30 14z"
            fill="#acc4d0"
            stroke="#20262d"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M14 58v-6l30-14 30 14v6"
            fill="none"
            stroke="#4f9fd6"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path
            d="M62 34l24-11 24 11-24 11z"
            fill="#edc9b4"
            stroke="#20262d"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M62 34v-7l24-11 24 11v7"
            fill="none"
            stroke="#4f9fd6"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path d="M60 51l14-8" stroke="#3f9a4c" strokeWidth="6" strokeLinecap="round" />
        </>
      )}
      {n === 4 && (
        <>
          <rect x="18" y="14" width="26" height="48" rx="5" transform="rotate(-14 31 38)" {...stroke} />
          <circle cx="84" cy="46" r="13" fill="#d9dde1" stroke="#20262d" strokeWidth="2" />
          <path d="M72 50c6 4 18 4 24 0" fill="none" stroke="#5aa8e8" strokeWidth="2.4" />
          <path
            d="M100 18l8 8-8 8M108 26H94"
            fill="none"
            stroke="#e0524f"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  );
}

// ── connect ──────────────────────────────────────────────────────────────────────────────────────────

function Pairing() {
  const g = useGame();
  const v = useView();
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const code = v.room.code;
  const link = code ? pairingUrl(location.origin, code, v.room.pairToken) : null;
  return (
    <section
      className="wwm-panel wwm-connect"
      aria-labelledby="connect-h"
      data-testid="pairing-panel"
      data-code={code ?? ''}
      data-connected={v.room.controllerConnected}
    >
      <div className="wwm-connect__main">
        <h2 id="connect-h" className="wwm-h2">
          {t('connect.title')}
        </h2>
        {v.room.status === 'creating' || v.room.status === 'idle' ? (
          <p className="wwm-muted">{t('connect.creating')}</p>
        ) : v.room.status === 'error' || !code || !link ? (
          <div className="wwm-connect__offline" role="alert">
            <p>{t('connect.offline')}</p>
            <button type="button" className="wwm-btn wwm-btn--ghost" onClick={() => g.retryRoom()}>
              <Icon name="retry" /> {t('common.retry')}
            </button>
          </div>
        ) : (
          <>
            <p className="wwm-connect__label">{t('connect.code')}</p>
            <p className="wwm-connect__code" data-testid="pair-code">
              {formatCode(code)}
            </p>
            <p className="wwm-muted">{t('connect.orOpen')}</p>
            <div className="wwm-connect__link">
              <code data-testid="pair-link">{link.replace(/^https?:\/\//, '')}</code>
              <button
                type="button"
                className="wwm-btn wwm-btn--small"
                onClick={() => {
                  void navigator.clipboard?.writeText(link).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
              >
                <Icon name="link" size={16} /> {copied ? t('connect.copied') : t('connect.copy')}
              </button>
            </div>
            <p
              className={`wwm-connect__status${v.room.controllerConnected ? ' is-on' : ''}`}
              data-testid="pair-status"
              aria-live="polite"
            >
              <span className="wwm-dot" aria-hidden="true" />
              {v.room.controllerConnected || v.justConnected ? t('connect.connected') : t('connect.waiting')}
            </p>
          </>
        )}
      </div>
      {link && v.room.status === 'ready' && (
        <figure className="wwm-connect__qr">
          <div className="wwm-qrtile">
            <QrCode text={link} size={196} label={t('connect.scan')} />
          </div>
          <figcaption>{t('connect.scan')}</figcaption>
          <p className="wwm-connect__lock">
            <Icon name="phone" size={16} /> {t('connect.devicelock')}
          </p>
        </figure>
      )}
      <div className="wwm-connect__foot">
        <button type="button" className="wwm-btn wwm-btn--ghost" onClick={() => g.back()}>
          <Icon name="back" /> {t('common.back')}
        </button>
        <button
          type="button"
          className="wwm-btn wwm-btn--secondary"
          onClick={() => g.playKeyboard()}
          data-testid="play-keyboard"
        >
          <Icon name="keyboard" /> {t('connect.playPc')}
        </button>
      </div>
    </section>
  );
}

function Calibrate() {
  const g = useGame();
  const v = useView();
  const { t } = useTranslation();
  return (
    <section className="wwm-panel wwm-calibrate" aria-labelledby="cal-h" data-testid="calibrate">
      <TiltRing game={g} size={220} big />
      <div className="wwm-calibrate__text">
        <h2 id="cal-h" className="wwm-h2">
          {t('calibrate.title')}
        </h2>
        {!v.calibrateTimedOut ? (
          <>
            <p>{t('calibrate.hint')}</p>
            <p className="wwm-calibrate__secs" aria-live="off">
              {t('calibrate.seconds', { count: v.calibrateLeft })}
            </p>
          </>
        ) : (
          <p role="alert">{t('calibrate.timeout')}</p>
        )}
        <div className="wwm-row">
          {v.calibrateTimedOut && (
            <button type="button" className="wwm-btn wwm-btn--ghost" onClick={() => g.retryCalibrate()}>
              <Icon name="retry" /> {t('common.retry')}
            </button>
          )}
          <button type="button" className="wwm-btn wwm-btn--secondary" onClick={() => g.playKeyboard()}>
            <Icon name="keyboard" /> {t('calibrate.useKeyboard')}
          </button>
        </div>
      </div>
    </section>
  );
}

// ── select ───────────────────────────────────────────────────────────────────────────────────────────

function Select() {
  const g = useGame();
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [bad, setBad] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = normalizeInputUrl(url);
    if (!n) {
      setBad(true);
      return;
    }
    g.chooseUrl(n);
  };
  return (
    <section className="wwm-select" aria-labelledby="select-h">
      <header className="wwm-select__head">
        <button type="button" className="wwm-btn wwm-btn--ghost wwm-btn--small" onClick={() => g.toTitle()}>
          <Icon name="back" size={16} /> {t('common.back')}
        </button>
        <h2 id="select-h" className="wwm-h1">
          {t('select.title')}
        </h2>
        <form className="wwm-urlbar" onSubmit={submit} noValidate>
          <label htmlFor="wwm-url" className="wwm-sr">
            {t('select.placeholder')}
          </label>
          <Icon name="globe" size={22} />
          <input
            ref={input}
            id="wwm-url"
            type="url"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder={t('select.placeholder')}
            value={url}
            aria-invalid={bad}
            aria-describedby="wwm-url-tip"
            onChange={(e) => {
              setUrl(e.target.value);
              setBad(false);
            }}
            data-testid="url-input"
          />
          <button type="submit" className="wwm-btn wwm-btn--primary" data-testid="url-go">
            {t('select.build')} <Icon name="arrow" />
          </button>
        </form>
        <p
          id="wwm-url-tip"
          className={bad ? 'wwm-select__tip is-bad' : 'wwm-select__tip'}
          role={bad ? 'alert' : undefined}
        >
          {bad ? t('select.invalidUrl') : t('select.tip')}
        </p>
        <SelectHint /> {/* Phase 14: bookmarklet + /mazify */}
      </header>
      <div className="wwm-select__body">
        <SiteCard entry={PRACTICE} featured />
        <div className="wwm-select__popular">
          <h3 className="wwm-h3">
            {t('select.popular')} <span className="wwm-muted">· {t('select.saved')}</span>
          </h3>
          <ul className="wwm-grid">
            {FIXTURES.map((e) => (
              <li key={e.id}>
                <SiteCard entry={e} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function SiteCard({ entry, featured = false }: { entry: CatalogEntry; featured?: boolean }) {
  const g = useGame();
  const { t } = useTranslation();
  const slices = Math.max(1, Math.ceil(entry.pageHeight / 1700));
  return (
    <button
      type="button"
      className={`wwm-site${featured ? ' wwm-site--featured' : ''}`}
      onClick={() => g.chooseEntry(entry)}
      data-testid={`site-${entry.id}`}
    >
      <span className="wwm-site__thumb">
        <img src={entry.thumb} alt="" loading="lazy" width={480} height={300} />
      </span>
      <span className="wwm-site__meta">
        {featured && <span className="wwm-site__tag">{t('select.practice')}</span>}
        <span className="wwm-site__title">{featured ? t('select.practiceTitle') : entry.title}</span>
        <span className="wwm-site__row">
          <span className="wwm-site__host">{featured ? entry.host : entry.host}</span>
          <Stars n={entry.stars} label={t('common.stars', { count: entry.stars })} />
          <span className="wwm-site__slices">{t('select.stages', { count: slices })}</span>
        </span>
      </span>
    </button>
  );
}

// ── building / error ─────────────────────────────────────────────────────────────────────────────────

const BUILD_STEPS = [
  'queued',
  'capturing',
  'extracting',
  'building',
  'validating',
  'storing',
  'texture',
  'world',
];

function Building() {
  const g = useGame();
  const v = useView();
  const { t } = useTranslation();
  const b = v.build;
  const pct = Math.round(b?.pct ?? 0);
  const step = b?.step && BUILD_STEPS.includes(b.step) ? b.step : 'building';
  const siteTitle = useSiteTitle();
  const label = siteTitle(v.run?.title) || b?.label || '';
  const { t: tj } = useJourneyT();
  const travel = v.travel;
  return (
    <section
      className="wwm-panel wwm-building"
      aria-labelledby="build-h"
      aria-busy="true"
      data-testid="building"
    >
      <h2 id="build-h" className="wwm-h1 wwm-building__title">
        {travel ? tj('journey.travel.building', { host: travel.host }) : t('building.title')}
      </h2>
      {travel ? (
        <>
          <p className="wwm-building__site">{travel.label}</p>
          <JourneyTrail stops={v.journey} className="wwm-building__trail" />
        </>
      ) : (
        label && <p className="wwm-building__site">{label}</p>
      )}
      {v.run && v.run.count > 1 && (
        <p className="wwm-muted">{t('result.stageOf', { index: v.run.index + 1, count: v.run.count })}</p>
      )}
      <div
        className="wwm-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={t(`building.step.${step}`)}
      >
        <Facets seed={7} className="wwm-progress__fill" />
        <span className="wwm-progress__mask" style={{ transform: `scaleX(${1 - pct / 100})` }} />
      </div>
      <p className="wwm-building__step" aria-live="polite">
        {t(`building.step.${step}`)}
      </p>
      <p className="wwm-building__body">{travel ? tj('journey.travel.body') : t('building.body')}</p>
      <button type="button" className="wwm-btn wwm-btn--ghost wwm-btn--small" onClick={() => g.cancelBuild()}>
        {t('building.cancel')}
      </button>
    </section>
  );
}

function ErrorScreen() {
  const g = useGame();
  const v = useView();
  const { t } = useTranslation();
  const code = v.error?.code ?? 'BUILD_FAILED';
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <section className="wwm-panel wwm-error" aria-labelledby="err-h" data-testid="error" data-code={code}>
      <h2 id="err-h" className="wwm-h1">
        {t('error.title')}
      </h2>
      <p className="wwm-error__msg" role="alert">
        {t(`error.${code}`)}
        {v.error?.url && <span className="wwm-error__url">{v.error.url}</span>}
      </p>
      <h3 className="wwm-h3">{t('error.alternatives')}</h3>
      <ul className="wwm-grid wwm-grid--compact">
        {Game.alternatives().map((e, i) => (
          <li key={e.id}>
            <AltCard entry={e} btnRef={i === 0 ? first : undefined} />
          </li>
        ))}
      </ul>
      <div className="wwm-row">
        <button
          type="button"
          className="wwm-btn wwm-btn--secondary"
          onClick={() => g.errorBack()}
          data-testid="error-back"
        >
          <Icon name="search" /> {t('error.another')}
        </button>
        <button type="button" className="wwm-btn wwm-btn--ghost" onClick={() => g.toTitle()}>
          {t('error.toTitle')}
        </button>
      </div>
    </section>
  );
}

function AltCard({ entry, btnRef }: { entry: CatalogEntry; btnRef?: React.Ref<HTMLButtonElement> }) {
  const g = useGame();
  const { t } = useTranslation();
  return (
    <button
      ref={btnRef}
      type="button"
      className="wwm-site wwm-site--compact"
      onClick={() => g.chooseEntry(entry)}
      data-testid={`alt-${entry.id}`}
    >
      <span className="wwm-site__thumb">
        <img src={entry.thumb} alt="" width={480} height={300} />
      </span>
      <span className="wwm-site__meta">
        <span className="wwm-site__title">{entry === PRACTICE ? t('select.practice') : entry.title}</span>
        <Stars n={entry.stars} label={t('common.stars', { count: entry.stars })} />
      </span>
    </button>
  );
}

function Unsupported() {
  const { t } = useTranslation();
  return (
    <main className="wwm-screen">
      <section className="wwm-panel wwm-error" role="alert">
        <Logo size="sm" />
        <h2 className="wwm-h1">{t('unsupported.title')}</h2>
        <p>{t('unsupported.body')}</p>
      </section>
    </main>
  );
}
