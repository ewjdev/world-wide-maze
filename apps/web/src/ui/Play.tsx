/**
 * In-stage overlays: intro caption, countdown, HUD (E layout: TIME + score top-left, LIFE top-right,
 * orientation indicator + MENU bottom-left, centred instruction text), map menu, the big signs and the
 * phone-disconnect hold.
 */

import { pairingUrl } from '@wwm/net';
import { NUM_BALLS } from '@wwm/schema';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCode, QrCode } from '../controller/index.ts';
import type { SignKind } from '../game/game.ts';
import { useGame, useView } from './GameApp.tsx';
import { BallIcon, GemIcon, Glyphs, Icon, TiltRing } from './parts.tsx';

const IN_STAGE = new Set([
  'intro',
  'countdown',
  'play',
  'paused',
  'falling',
  'restarting',
  'goal',
  'timeup',
  'gameover',
]);

export function PlayLayer() {
  const v = useView();
  if (!IN_STAGE.has(v.phase)) return null;
  const hudVisible = ['countdown', 'play', 'falling', 'restarting', 'timeup'].includes(v.phase);
  return (
    <div className="wwm-playlayer" data-phase={v.phase}>
      {v.phase === 'intro' && <IntroCaption />}
      {hudVisible && <Hud />}
      {v.countdown !== null && v.countdown >= 0 && <Countdown n={v.countdown} />}
      {v.phase === 'paused' && <MapMenu />}
      {v.sign && <Sign kind={v.sign} />}
      {v.hold && <DisconnectHold />}
    </div>
  );
}

function IntroCaption() {
  const g = useGame();
  const v = useView();
  const { t } = useTranslation();
  const host = v.run?.url ? v.run.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : '';
  return (
    <>
      <button
        type="button"
        className="wwm-skiparea"
        onClick={() => g.skipIntro()}
        aria-label={t('intro.skip')}
        data-testid="intro-skip"
      />
      <div className="wwm-intro">
        <p className="wwm-intro__title">{v.run?.title}</p>
        {host && !host.startsWith('wwm:') && <p className="wwm-intro__url">{host}</p>}
        {v.run && v.run.count > 1 && (
          <p className="wwm-intro__slice">
            {t('result.stageOf', { index: v.run.index + 1, count: v.run.count })}
          </p>
        )}
      </div>
      {v.introSkippable && <p className="wwm-intro__skip">{t('intro.skip')}</p>}
    </>
  );
}

function Countdown({ n }: { n: number }) {
  return (
    <div className="wwm-countdown" aria-live="assertive" key={n}>
      <span className={n === 0 ? 'is-go' : ''}>{n === 0 ? 'GO!' : n}</span>
    </div>
  );
}

function Hud() {
  const g = useGame();
  const v = useView();
  const { t } = useTranslation();
  const tut = v.tutorial;
  const variant = v.inputMode === 'phone' ? 'mobile' : 'pc';
  return (
    <div className="wwm-hud" data-testid="hud">
      <div className="wwm-hud__tl">
        <p className={`wwm-hud__time${v.last30 ? ' is-caution' : ''}`}>
          <span className="wwm-hud__label">{t('hud.time')}</span>
          <span className="wwm-hud__num" data-testid="hud-time">
            {v.timeInt}
          </span>
        </p>
        <p className="wwm-hud__score">
          <span className="wwm-hud__label">{t('hud.score')}</span>
          <span className="wwm-hud__num" data-testid="hud-score">
            {v.total}
          </span>
        </p>
        {v.largeTotal > 0 && (
          <p
            className="wwm-hud__gems"
            role="img"
            aria-label={`${t('hud.large')} ${v.large} / ${v.largeTotal}`}
          >
            {Array.from({ length: v.largeTotal }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed slots
              <GemIcon key={i} dim={i >= v.large} />
            ))}
            <span className="wwm-hud__gemcount" data-testid="hud-large">
              {v.large}/{v.largeTotal}
            </span>
          </p>
        )}
      </div>
      <div className="wwm-hud__tr" role="img" aria-label={`${t('hud.life')} ${Math.max(0, v.spares)}`}>
        <span className="wwm-hud__label">{t('hud.life')}</span>
        <span className="wwm-hud__lives" data-testid="hud-lives" data-spares={v.spares}>
          {Array.from({ length: NUM_BALLS }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed slots
            <BallIcon key={i} lost={i >= v.spares} />
          ))}
        </span>
        {v.oneUpAt > 0 && (
          <span key={v.oneUpAt} className="wwm-hud__oneup">
            1UP
          </span>
        )}
      </div>
      <div className="wwm-hud__bl">
        <TiltRing game={g} size={104} />
        <TooTilted />
        <button type="button" className="wwm-hud__menu" onClick={() => g.menu()} data-testid="hud-menu">
          <Icon name="map" size={18} /> {t('hud.menu')}
        </button>
        {v.inputMode === 'phone' && v.room.rttMs !== null && (
          <span className="wwm-hud__rtt" title={t('hud.phoneLink')}>
            <span className={`wwm-dot${v.room.rttMs > 120 ? ' is-warn' : ' is-on'}`} aria-hidden="true" />
            {t('hud.rtt', { ms: v.room.rttMs })}
          </span>
        )}
      </div>
      {tut !== null && (
        <p className="wwm-hud__inst" aria-live="polite" key={tut} data-testid="tutorial">
          <Glyphs text={t(`tutorial.${variant}.step${tut}`)} />
        </p>
      )}
      {v.resumedFlash > 0 && tut === null && (
        <p key={v.resumedFlash} className="wwm-hud__inst wwm-hud__inst--ok wwm-flash">
          {t('disconnect.resumed')}
        </p>
      )}
    </div>
  );
}

/** "Too tilted!" with the E 500 ms hysteresis, polled per frame. */
function TooTilted() {
  const g = useGame();
  const { t } = useTranslation();
  const el = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    let raf = 0;
    let hideAt = 0;
    const tick = (now: number) => {
      const on = g.tilt().tooTilted;
      if (on) hideAt = now + 500;
      if (el.current) el.current.hidden = !(on || now < hideAt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [g]);
  return (
    <p ref={el} className="wwm-hud__tilted" hidden>
      {t('hud.tooTilted')}
    </p>
  );
}

function MapMenu() {
  const g = useGame();
  const v = useView();
  const { t } = useTranslation();
  const first = useRef<HTMLButtonElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus when the confirm view swaps in
  useEffect(() => first.current?.focus(), [v.confirm]);
  return (
    <aside className="wwm-map" aria-labelledby="map-h" data-testid="map-menu">
      <div className="wwm-map__panel">
        {!v.confirm ? (
          <>
            <h2 id="map-h" className="wwm-h2">
              <Icon name="map" /> {t('map.title')}
            </h2>
            <p className="wwm-map__site">{v.run?.title}</p>
            <div className="wwm-map__actions">
              <button
                ref={first}
                type="button"
                className="wwm-btn wwm-btn--primary"
                onClick={() => g.resume()}
                data-testid="map-back"
              >
                <Icon name="play" /> {t('map.back')}
              </button>
              <button type="button" className="wwm-btn wwm-btn--ghost" onClick={() => g.retryStage()}>
                <Icon name="retry" /> {t('map.retry')}
              </button>
              <button type="button" className="wwm-btn wwm-btn--ghost" onClick={() => g.askConfirm('search')}>
                <Icon name="search" /> {t('map.search')}
              </button>
              <button
                type="button"
                className="wwm-btn wwm-btn--ghost"
                onClick={() => g.askConfirm('quit')}
                data-testid="map-quit"
              >
                <Icon name="exit" /> {t('map.quit')}
              </button>
            </div>
          </>
        ) : (
          <div role="alertdialog" aria-labelledby="confirm-h" className="wwm-confirm">
            <h2 id="confirm-h" className="wwm-h2">
              {t('map.confirm')}
            </h2>
            <div className="wwm-row">
              <button
                ref={first}
                type="button"
                className="wwm-btn wwm-btn--ghost"
                onClick={() => g.confirm(false)}
              >
                {t('common.no')}
              </button>
              <button
                type="button"
                className="wwm-btn wwm-btn--danger"
                onClick={() => g.confirm(true)}
                data-testid="confirm-yes"
              >
                {t('common.yes')}
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

const SIGN_TEXT: Record<SignKind, string> = { goal: 'GOAL', timeup: 'TIME IS UP', gameover: 'GAME OVER' };
const TILE_COLORS = ['#c2e1bf', '#8ac487', '#a5ccb0', '#acc4d0', '#cabcc3', '#dcaeb0', '#edc9b4', '#f7e29c'];

/** E: the tile "curtain" then the big sign (GOAL / TIME IS UP / GAME OVER are not localized in 2013). */
function Sign({ kind }: { kind: SignKind }) {
  const text = SIGN_TEXT[kind];
  const cols = 16;
  const rows = 9;
  return (
    <div
      className={`wwm-sign wwm-sign--${kind}`}
      role="status"
      aria-label={text}
      data-testid={`sign-${kind}`}
    >
      <div className="wwm-curtain" aria-hidden="true">
        {Array.from({ length: cols * rows }, (_, i) => {
          const c = i % cols;
          const r = Math.floor(i / cols);
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed grid
              key={i}
              style={{
                background: `linear-gradient(${(c + r) % 2 ? 45 : 135}deg, ${TILE_COLORS[(c * 3 + r * 5) % TILE_COLORS.length]} 50%, ${TILE_COLORS[(c * 5 + r * 3 + 2) % TILE_COLORS.length]} 50%)`,
                animationDelay: `${(c + r) * 22}ms`,
              }}
            />
          );
        })}
      </div>
      <p className="wwm-sign__word" aria-hidden="true">
        {text.split(' ').map((word, w) => (
          <span key={word} className="wwm-sign__wordgroup">
            {[...word].map((ch, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: static letters
                key={i}
                className="wwm-sign__ch"
                style={{ animationDelay: `${260 + (w * 5 + i) * 55}ms` }}
              >
                {ch}
              </span>
            ))}
          </span>
        ))}
      </p>
    </div>
  );
}

function DisconnectHold() {
  const g = useGame();
  const v = useView();
  const { t } = useTranslation();
  const code = v.room.code;
  const link = code ? pairingUrl(location.origin, code) : null;
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => btn.current?.focus(), []);
  return (
    <div className="wwm-hold" role="alertdialog" aria-labelledby="hold-h" data-testid="disconnect-overlay">
      <div className="wwm-panel wwm-hold__panel">
        <div>
          <h2 id="hold-h" className="wwm-h2">
            <Icon name="phone" /> {t('disconnect.title')}
          </h2>
          <p>{t('disconnect.body')}</p>
          {code && (
            <p className="wwm-connect__code wwm-connect__code--sm" data-testid="hold-code">
              {formatCode(code)}
            </p>
          )}
          <button
            ref={btn}
            type="button"
            className="wwm-btn wwm-btn--secondary"
            onClick={() => g.playKeyboard()}
          >
            <Icon name="keyboard" /> {t('disconnect.keyboard')}
          </button>
        </div>
        {link && (
          <div className="wwm-qrtile">
            <QrCode text={link} size={148} label={t('connect.scan')} />
          </div>
        )}
      </div>
    </div>
  );
}
