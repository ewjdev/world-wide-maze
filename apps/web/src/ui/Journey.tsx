/**
 * Phase 13 UI (N): the link-portal prompt, the travel transition, the journey trail (HUD, building screen,
 * result, ranking) and the "Share my web journey" link. The portal's colour (from its host, as in the engine)
 * carries through all of them, so a site keeps one colour from the gate to the share card.
 */
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import type { PortalPrompt } from '../game/game.ts';
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
