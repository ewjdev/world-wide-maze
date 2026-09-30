/**
 * Same-device touch controls, shared by Original and Race (plans/mobile-browser-game-execution.md M2).
 * Left thumb: a visible analog stick with a generous activation region; right thumb: a labelled Jump (and a
 * contextual Turbo in Race). Steering is Power: stick deflection past the dead zone engages it, so there is no
 * separate Power button. Pause sits at the top, out of the thumb zones. The pointer plumbing lives in
 * `TouchInputSource` (`@wwm/net`); this file only binds elements and draws them.
 */
import type { StickVisual, TouchInputSource } from '@wwm/net';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import './touch.css';

export interface TurboControl {
  /** The course provides Turbo at all. */
  available: boolean;
  /** A charge is stored and the race is live. */
  ready: boolean;
  count: number;
  onTurbo: () => void;
}

export interface TouchControlsProps {
  source: TouchInputSource;
  onPause: () => void;
  turbo?: TurboControl;
  /**
   * `live`: takes input. `ready`: shown dimmed and inert (the countdown lets the player see the controls before
   * "Go", and nothing accumulates for it). `off`: hidden (pause, results, panels).
   */
  mode?: 'live' | 'ready' | 'off';
  /** Swap thumbs (persisted preference, M3). */
  leftHanded?: boolean;
}

export function TouchControls({
  source,
  onPause,
  turbo,
  mode = 'live',
  leftHanded = false,
}: TouchControlsProps) {
  const { t } = useTranslation();
  const zone = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  const jump = useRef<HTMLButtonElement>(null);
  const turboBtn = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const zoneEl = zone.current;
    const baseEl = base.current;
    const thumbEl = thumb.current;
    if (!zoneEl || !baseEl || !thumbEl) return;
    // The visual thumb updates at most once per animation frame, outside React state.
    let raf = 0;
    let latest: StickVisual | null = null;
    const paint = () => {
      raf = 0;
      if (!latest) return;
      const v = latest;
      baseEl.style.transform = `translate(${v.originX}px, ${v.originY}px)`;
      thumbEl.style.transform = `translate(${v.originX + v.thumbX}px, ${v.originY + v.thumbY}px)`;
      zoneEl.dataset.active = v.active ? 'true' : 'false';
    };
    const detachStick = source.attachStick(zoneEl, {
      radius: () => baseEl.getBoundingClientRect().width / 2 || 56,
      onChange: (v) => {
        latest = v;
        if (!raf) raf = requestAnimationFrame(paint);
      },
    });
    return () => {
      detachStick();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [source]);

  useEffect(() => {
    const el = jump.current;
    if (!el) return;
    return source.attachButton(el, {
      onChange: (pressed) => {
        el.dataset.pressed = pressed ? 'true' : 'false';
      },
    });
  }, [source]);

  // Turbo is an explicit action routed through the session's own request path (one tick-consumed press).
  const onTurbo = turbo?.onTurbo;
  useEffect(() => {
    const el = turboBtn.current;
    if (!el || !onTurbo) return;
    const press = (e: Event) => {
      e.preventDefault();
      onTurbo();
    };
    el.addEventListener('pointerdown', press);
    return () => el.removeEventListener('pointerdown', press);
  }, [onTurbo]);

  // Anything that changes what the contacts mean cancels them: they must lift and land again.
  useEffect(() => {
    if (mode !== 'live') source.reset();
  }, [mode, source]);
  useEffect(() => () => source.reset(), [source]);

  return (
    <div
      ref={root}
      className="wwm-touch"
      data-testid="touch-controls"
      data-mode={mode}
      data-hand={leftHanded ? 'left' : 'right'}
    >
      <div className="wwm-touch__deck" aria-hidden="true" />
      <button type="button" className="wwm-touch__pause" onClick={onPause} data-testid="touch-pause">
        {t('touch.pause')}
      </button>
      <div ref={zone} className="wwm-touch__zone" data-testid="touch-stick" data-active="false">
        <div className="wwm-touch__stick" role="presentation">
          <div ref={base} className="wwm-touch__base" />
          <div ref={thumb} className="wwm-touch__thumb" />
          <span className="wwm-touch__label">{t('touch.steer')}</span>
        </div>
      </div>
      <div className="wwm-touch__actions">
        {turbo?.available && (
          <button
            ref={turboBtn}
            type="button"
            className="wwm-touch__action wwm-touch__action--turbo"
            data-testid="touch-turbo"
            data-ready={turbo.ready}
            disabled={!turbo.ready}
            aria-label={`${t('touch.turbo')} ×${turbo.count}`}
          >
            <span className="wwm-touch__row">
              <BoltIcon />
              <span>{t('touch.turbo')}</span>
              <b aria-hidden="true">×{turbo.count}</b>
            </span>
            <i aria-hidden="true">{turbo.ready ? t('touch.turboReady') : t('touch.turboCharging')}</i>
          </button>
        )}
        <button
          ref={jump}
          type="button"
          className="wwm-touch__action wwm-touch__action--jump"
          data-testid="touch-jump"
          data-pressed="false"
        >
          <ChevronIcon />
          {t('touch.jump')}
        </button>
      </div>
    </div>
  );
}

const icon = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** Drawn to match the shell's icon stroke (ui/parts.tsx). */
function ChevronIcon() {
  return (
    <svg {...icon} aria-hidden="true">
      <path d="M5 15l7-7 7 7" />
      <path d="M5 21l7-7 7 7" opacity="0.4" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg {...icon} width={16} height={16} aria-hidden="true">
      <path d="M13 3L5 13.5h6L10 21l8-10.5h-6z" fill="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
