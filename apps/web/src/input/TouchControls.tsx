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
  /** Controls stay visible but inert (countdown shows them; nothing accumulates for "Go"). */
  live?: boolean;
  /** Swap thumbs (persisted preference, M3). */
  leftHanded?: boolean;
}

export function TouchControls({
  source,
  onPause,
  turbo,
  live = true,
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
    if (!live) source.reset();
  }, [live, source]);
  useEffect(() => () => source.reset(), [source]);

  return (
    <div
      ref={root}
      className="wwm-touch"
      data-testid="touch-controls"
      data-live={live}
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
            <span>{t('touch.turbo')}</span>
            <b aria-hidden="true">×{turbo.count}</b>
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
          {t('touch.jump')}
        </button>
      </div>
    </div>
  );
}
