/**
 * Phase 13 UI (N): the link-portal prompt, the travel transition, the journey trail (HUD, building screen,
 * result, ranking) and the "Share my web journey" link. The portal's colour (from its host, as in the engine)
 * carries through all of them, so a site keeps one colour from the gate to the share card.
 */
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ArrivalView, PortalPrompt, TravelView } from '../game/game.ts';
import { encodeJourney, hostColor, isJourney, type JourneyStop } from '../game/journey.ts';
import { CardPreview } from '../ranking/ShareButton.tsx';
import { cardImage, fetchCardFile, shareLink } from '../ranking/share.ts';
import { useGame, useView } from './GameApp.tsx';
import { journeyEn, useJourneyT } from './journey-strings.ts';
import { Mono } from './Mono.tsx';
import { Glyphs, Icon } from './parts.tsx';

export { Mono };

import './journey.css';

type Style = CSSProperties & Record<`--${string}`, string>;

// ── the prompt ────────────────────────────────────────────────────────────────────────────────────────

export function PortalPromptCard({ prompt }: { prompt: PortalPrompt }) {
  const g = useGame();
  const v = useView();
  const { t } = useJourneyT();
  const first = useRef<HTMLButtonElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus when a (different) prompt opens
  useEffect(() => first.current?.focus(), [prompt.id, prompt.offline]);
  const phone = v.inputMode === 'phone';
  const style = { '--pc': hostColor(prompt.host) } as Style;
  if (prompt.offline)
    return (
      <div className="wwm-portal wwm-portal--offline" style={style}>
        <section
          className="wwm-portal__card"
          role="alertdialog"
          aria-labelledby="portal-h"
          data-testid="portal-offline"
        >
          <div className="wwm-portal__gate" aria-hidden="true">
            <Mono host={prompt.host} size="lg" />
          </div>
          <div className="wwm-portal__body">
            <h2 id="portal-h" className="wwm-portal__title">
              {t('journey.prompt.offlineTitle')}
            </h2>
            <p className="wwm-portal__text">{t('journey.prompt.offlineBody', { host: prompt.host })}</p>
            <div className="wwm-portal__actions">
              <button
                ref={first}
                type="button"
                className="wwm-btn wwm-btn--secondary"
                onClick={() => g.stayHere()}
                data-testid="portal-stay"
              >
                <Icon name="play" /> {t('journey.prompt.keepPlaying')}
              </button>
              <p className="wwm-portal__keys">
                <Glyphs text={t('journey.prompt.keysOffline')} />
              </p>
            </div>
          </div>
        </section>
      </div>
    );
  return (
    <div className="wwm-portal" style={style}>
      <section
        className="wwm-portal__card"
        role="alertdialog"
        aria-labelledby="portal-h"
        data-testid="portal-prompt"
      >
        <div className="wwm-portal__gate" aria-hidden="true">
          <span className="wwm-portal__swirl" />
          <Mono host={prompt.host} size="lg" />
        </div>
        <div className="wwm-portal__body">
          <h2 id="portal-h" className="wwm-portal__title">
            {t('journey.prompt.title', { label: prompt.label })}
          </h2>
          <p className="wwm-portal__host">
            <span>({prompt.host})</span>
          </p>
          <p className="wwm-portal__text">
            {v.total > 0
              ? t('journey.prompt.carry', {
                  score: v.total.toLocaleString('en-US'),
                  balls: Math.max(0, v.spares),
                })
              : t('journey.prompt.carryNone')}{' '}
            <span className="wwm-portal__forfeit">{t('journey.prompt.forfeit')}</span>
          </p>
          <div className="wwm-portal__actions">
            <button
              ref={first}
              type="button"
              className="wwm-btn wwm-portal__go"
              onClick={() => g.travelPortal()}
              data-testid="portal-travel"
            >
              {t('journey.prompt.travel')}
              <span className="wwm-portal__arrow" aria-hidden="true">
                <Icon name="arrow" size={18} />
              </span>
            </button>
            <button
              type="button"
              className="wwm-btn wwm-btn--ghost"
              onClick={() => g.stayHere()}
              data-testid="portal-stay"
            >
              {t('journey.prompt.stay')}
            </button>
            <p className="wwm-portal__keys">
              <Glyphs text={t(phone ? 'journey.prompt.keysPhone' : 'journey.prompt.keysPc')} />
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

// ── the travel transition ─────────────────────────────────────────────────────────────────────────────

/** While the ball spirals into the gate: an iris in the portal's colour closes over the world, then the build. */
export function TravelIris({ host }: { host: string }) {
  const { t } = useJourneyT();
  return (
    <div
      className="wwm-iris"
      style={{ '--pc': hostColor(host) } as Style}
      data-testid="travel-iris"
      aria-live="polite"
    >
      <span className="wwm-iris__disc" aria-hidden="true" />
      <p className="wwm-iris__text">
        <Mono host={host} size="md" /> {t('journey.travel.rolling', { host })}
      </p>
    </div>
  );
}

// ── portal windows: the travel window ────────────────────────────────────────────────────────────────

/** The scene's fog colour (engine FOG_COLOR): what surrounds the upright page at intro t = 0. */
const FOG = '#f8f8f8';
const GROW_MS = 600;
const DEVELOP_MS = 400;
const CUT_MS = 350;
const OUT_MS = 250;
/** Still "opening" (no build started) this long after the window covered: say so, and offer a way out. */
const STUCK_MS = 8000;

type Box = { x: number; y: number; width: number; height: number };
type Stage = 'grow' | 'covered' | 'develop' | 'cut' | 'out';

/**
 * Portal windows (N; plans/portal-windows-execution.md §6.3). Travel: from the gate's disc on screen (the engine's
 * handoff), a ragged, glowing window onto the destination grows to full screen; the build happens inside it. The
 * game loads the next world only once it covers the screen (`travelWindowCovered`). Arrival: the loaded page
 * develops in (from the postcard) or replaces the preview, shrinks onto where the intro's upright page will be,
 * and the whole window fades into the intro (`travelWindowDone`). Mounted from `Screens`, so it survives
 * play → building → intro; decorative (`aria-hidden`): the building panel carries the status.
 */
export function TravelWindow({
  travel,
  arrival,
}: {
  travel: TravelView | null;
  arrival: ArrivalView | null;
}) {
  const g = useGame();
  const v = useView();
  const root = useRef<HTMLDivElement>(null);
  const shot = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState<Stage>('grow');
  const [grown, setGrown] = useState(false);
  const [view, setView] = useState({ w: 1, h: 1 });
  const reduced = useReducedMotion();
  const { t } = useJourneyT();
  // the window is up but the build hasn't started (phase still play): say what's happening, never a blank screen
  const opening = !!travel && v.phase === 'play';
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    setStuck(false);
    if (!opening) return;
    const timer = setTimeout(() => setStuck(true), STUCK_MS);
    return () => clearTimeout(timer);
  }, [opening]);
  // what the window keeps showing after `travel` clears at the intro
  const kept = useRef<{ host: string; src: string | null; from: Box | 'full' }>(null);
  if (travel?.handoff)
    kept.current = { host: travel.host, src: travel.preview?.src ?? null, from: travel.handoff };
  const k = kept.current;
  const open = !!k;

  // the box the canvas fills (rects are canvas-relative), measured once the window opens and on every resize
  useLayoutEffect(() => {
    const el = open ? root.current?.parentElement : null;
    if (!el) return;
    const measure = () => setView({ w: el.clientWidth || 1, h: el.clientHeight || 1 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  // grow: one frame at the gate's size, then transition to full
  useEffect(() => {
    if (!open) return;
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setGrown(true));
    });
    return () => cancelAnimationFrame(id);
  }, [open]);
  useEffect(() => {
    if (!grown || stage !== 'grow') return;
    const t = setTimeout(
      () => {
        setStage('covered');
        g.travelWindowCovered();
      },
      reduced ? 300 : GROW_MS,
    );
    return () => clearTimeout(t);
  }, [grown, stage, g, reduced]);

  // arrival: draw the loaded texture (exactly what the engine shows), develop, then cut onto the page
  useEffect(() => {
    if (!arrival || !shot.current) return;
    const c = shot.current;
    const img = arrival.image as CanvasImageSource & { width: number; height: number };
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')?.drawImage(img, 0, 0);
    setStage('develop');
    const t = setTimeout(() => setStage('cut'), reduced ? 0 : arrival.hadPreview ? 200 : DEVELOP_MS);
    return () => clearTimeout(t);
  }, [arrival, reduced]);

  // the intro has started: fade into it, then hand back (its own effect, so changing stage can't cancel it)
  useEffect(() => {
    if (arrival && v.phase === 'intro' && stage !== 'out') setStage('out');
  }, [arrival, v.phase, stage]);
  useEffect(() => {
    if (stage !== 'out') return;
    const t = setTimeout(() => g.travelWindowDone(), OUT_MS);
    return () => clearTimeout(t);
  }, [stage, g]);

  if (!k || (!travel && !arrival)) return null;

  const { w, h } = view;
  const from = k.from === 'full' ? null : k.from;
  const cx = from ? from.x + from.width / 2 : w / 2;
  const cy = from ? from.y + from.height / 2 : h / 2;
  const rFull = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) + 40;
  const r0 = from ? from.width / 2 : reduced ? rFull : rFull * 0.15;
  const r = grown || reduced ? rFull : r0;
  const growStyle = reduced ? 'none' : `clip-path ${GROW_MS}ms cubic-bezier(0.55, 0, 0.3, 1)`;

  // the arrival picture: first the top of the page across the view, then the intro's upright page
  let shotBox: Box = {
    x: 0,
    y: 0,
    width: w,
    height: arrival ? (w * arrival.image.height) / arrival.image.width : h,
  };
  const cut = arrival?.cut;
  const cutUsable = !!cut && cut.width > 0 && cut.x > -cut.width && cut.x < w && cut.y < h;
  if ((stage === 'cut' || stage === 'out') && cut && cutUsable) shotBox = cut;

  return (
    <div
      ref={root}
      className={`wwm-twin wwm-twin--${stage}`}
      data-testid="travel-window"
      data-from={from ? 'gate' : 'full'}
      data-stage={stage}
      data-motion={reduced ? 'reduced' : 'full'}
      style={{ '--pc': hostColor(k.host), '--fog': FOG, '--out': `${OUT_MS}ms` } as Style}
    >
      <div
        aria-hidden="true"
        className="wwm-twin__mask"
        style={{
          clipPath: `circle(${r}px at ${cx}px ${cy}px)`,
          transition: reduced ? 'opacity 300ms' : growStyle,
          opacity: reduced && !grown ? 0 : 1,
        }}
      >
        <div className={`wwm-twin__dest${arrival ? ' wwm-twin__dest--gone' : ''}`}>
          {k.src ? (
            <div className="wwm-twin__pic" style={{ backgroundImage: `url("${k.src}")` }} />
          ) : (
            <div className="wwm-twin__card">
              <Mono host={k.host} size="xl" />
              <span className="wwm-twin__host">{k.host}</span>
            </div>
          )}
        </div>
        <canvas
          ref={shot}
          className={`wwm-twin__shot ${!arrival ? 'wwm-twin__shot--idle' : arrival.hadPreview ? 'wwm-twin__shot--swap' : 'wwm-twin__shot--develop'}`}
          style={{
            left: shotBox.x,
            top: shotBox.y,
            width: shotBox.width,
            height: shotBox.height,
            transition: reduced
              ? 'none'
              : `left ${CUT_MS}ms ease, top ${CUT_MS}ms ease, width ${CUT_MS}ms ease, height ${CUT_MS}ms ease`,
          }}
        />
      </div>
      {opening && (stage === 'covered' || grown) && (
        <div className="wwm-twin__status" role="status" aria-live="polite" data-testid="travel-status">
          {stuck ? (
            <>
              <p>{t('journey.travel.stuck')}</p>
              <button
                type="button"
                className="wwm-btn wwm-btn--small"
                onClick={() => g.leaveTravel()}
                data-testid="travel-leave"
              >
                {t('journey.travel.leave')}
              </button>
            </>
          ) : (
            <p>{t('journey.travel.opening', { host: k.host })}</p>
          )}
        </div>
      )}
      {!reduced && (
        <span
          aria-hidden="true"
          className="wwm-twin__ring"
          style={{
            left: cx - r,
            top: cy - r,
            width: 2 * r,
            height: 2 * r,
            transition: `all ${GROW_MS}ms cubic-bezier(0.55, 0, 0.3, 1)`,
          }}
        />
      )}
    </div>
  );
}

function useReducedMotion(): boolean {
  const [reduced] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  return reduced;
}

// ── the trail ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The journey as a breadcrumb: monogram + host per stop, joined by a dotted line in the colour of the site the
 * link led to. `compact` (HUD) shows monograms only, with the current host spelled out.
 */
export function JourneyTrail({
  stops,
  compact = false,
  max = compact ? 6 : 7,
  className = '',
}: {
  stops: readonly JourneyStop[];
  compact?: boolean;
  max?: number;
  className?: string;
}) {
  const { t } = useJourneyT();
  const hidden = Math.max(0, stops.length - max);
  const shown = stops.slice(hidden);
  return (
    <ol
      className={`wwm-trail${compact ? ' wwm-trail--compact' : ''} ${className}`}
      aria-label={t('journey.trail.label')}
      data-testid={compact ? 'journey-hud' : 'journey-trail'}
    >
      {hidden > 0 && <li className="wwm-trail__more">{t('journey.trail.more', { count: hidden })}</li>}
      {shown.map((s, i) => {
        const last = i === shown.length - 1;
        const viaKey = s.via === 'portal' ? 'portal' : s.via === 'select' ? 'select' : null;
        return (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: stops are append-only
            key={hidden + i}
            className={`wwm-trail__stop${last ? ' is-here' : ''} is-${s.via}`}
            style={{ '--pc': hostColor(s.host) } as Style}
            aria-current={last ? 'location' : undefined}
          >
            {(i > 0 || hidden > 0) && (
              <span className="wwm-trail__hop" title={viaKey ? t(`journey.trail.via.${viaKey}`) : undefined}>
                <span className="wwm-sr">{viaKey ? t(`journey.trail.via.${viaKey}`) : ''}</span>
              </span>
            )}
            <Mono host={s.host} size={compact ? 'sm' : 'md'} />
            {(!compact || last) && (
              <span className="wwm-trail__host">
                {s.host}
                {!compact && last && <span className="wwm-sr"> ({t('journey.trail.here')})</span>}
              </span>
            )}
            {compact && !last && <span className="wwm-sr">{s.host}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** HUD: the trail, once a portal was taken. */
export function JourneyHud() {
  const v = useView();
  if (!isJourney(v.journey)) return null;
  return (
    <div className="wwm-journeyhud">
      <JourneyTrail stops={v.journey} compact />
    </div>
  );
}

// ── result / ranking ──────────────────────────────────────────────────────────────────────────────────

export function JourneySection({
  name,
  variant = 'result',
}: {
  name?: string | null;
  variant?: 'result' | 'ranking';
}) {
  const v = useView();
  const { t } = useJourneyT();
  const [copied, setCopied] = useState(false);
  const journey = isJourney(v.journey);
  const trail = journey ? encodeJourney(v.journey, { total: v.total, ...(name ? { name } : {}) }) : '';
  const image = trail ? cardImage('journey', trail) : '';
  // Phase 18: the card as a file for the share sheet, fetched before the tap (see ShareButton).
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    setFile(null);
    if (!image || typeof navigator === 'undefined' || !navigator.canShare) return;
    let live = true;
    void fetchCardFile(image, 'web-journey.png').then((f) => {
      if (live && f && navigator.canShare?.({ files: [f] })) setFile(f);
    });
    return () => {
      live = false;
    };
  }, [image]);
  if (!journey) return null;
  const href = `${location.origin}/j/${trail}`;
  const text = t('journey.share.text', {
    count: v.journey.length,
    trail: v.journey.map((s) => s.host).join(' → '),
  });
  const share = async () => {
    const out = await shareLink({ url: href, title: journeyEn.share.heading, text, file });
    if (out === 'copied') {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };
  return (
    <section
      className={`wwm-journey wwm-journey--${variant}`}
      aria-labelledby="journey-h"
      data-testid="journey-section"
    >
      <header className="wwm-journey__head">
        <h3 id="journey-h" className="wwm-h3">
          {t('journey.share.heading')}
        </h3>
        <p className="wwm-muted">{t('journey.share.summary', { count: v.journey.length })}</p>
      </header>
      <JourneyTrail stops={v.journey} />
      {variant === 'ranking' && (
        <CardPreview className="wwm-journey__card" src={image} alt={t('journey.share.cardAlt')} />
      )}
      <div className="wwm-journey__share">
        <button
          type="button"
          className="wwm-btn wwm-btn--secondary wwm-btn--small"
          onClick={share}
          data-testid="journey-share"
        >
          <Icon name="share" size={16} /> {copied ? t('journey.share.copied') : t('journey.share.link')}
        </button>
        <a className="wwm-journey__link" href={href} data-testid="journey-link">
          {href.replace(/^https?:\/\//, '').slice(0, 42)}…
        </a>
      </div>
    </section>
  );
}
