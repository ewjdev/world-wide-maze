/** Presentational menu controls shared by the lightweight title and the mounted game. */
import type { QualitySetting } from '@wwm/engine';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type Lang, setLang } from '../i18n/index.ts';
import { GRAPHICS_SETTINGS } from './graphics-preference.ts';
import { Icon } from './parts.tsx';

interface MenuBarProps {
  muted: boolean;
  onMuted: (muted: boolean) => void;
  graphics: QualitySetting;
  onGraphics: (graphics: QualitySetting) => void;
  sensitivity: number;
  onSensitivity: (sensitivity: number) => void;
  pixelLook: boolean;
  onPixelLook: (pixelLook: boolean) => void;
  motionOptions?: (close: () => void) => ReactNode;
}

export function MenuBar({
  muted,
  onMuted,
  graphics,
  onGraphics,
  sensitivity,
  onSensitivity,
  pixelLook,
  onPixelLook,
  motionOptions,
}: MenuBarProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();
  const lang = (i18n.language === 'ja' ? 'ja' : 'en') as Lang;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!pop.current?.parentElement?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    addEventListener('pointerdown', onDown);
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('pointerdown', onDown);
      removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <nav className="wwm-topbar" aria-label={t('common.settings')}>
      <button
        type="button"
        className="wwm-chip"
        onClick={() => onMuted(!muted)}
        aria-pressed={!muted}
        aria-label={t('common.soundOn')}
        data-testid="sound-toggle"
      >
        <Icon name={muted ? 'mute' : 'sound'} size={18} />
        <span>{muted ? t('common.soundOff') : t('common.soundOn')}</span>
      </button>
      <fieldset className="wwm-seg">
        <legend className="wwm-sr">{t('common.language')}</legend>
        {(['en', 'ja'] as const).map((l) => (
          <button
            key={l}
            type="button"
            className={lang === l ? 'is-on' : ''}
            aria-pressed={lang === l}
            lang={l}
            onClick={() => setLang(i18n, l)}
            data-testid={`lang-${l}`}
          >
            {l === 'en' ? 'English' : '日本語'}
          </button>
        ))}
      </fieldset>
      <div className="wwm-popwrap">
        <button
          type="button"
          className="wwm-chip wwm-chip--icon"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          aria-label={t('common.settings')}
        >
          <Icon name="sliders" size={18} />
        </button>
        {open && (
          <div ref={pop} id={id} className="wwm-pop" role="dialog" aria-label={t('common.settings')}>
            <label className="wwm-field">
              <span>
                {t('settings.graphics')}
                <small>{t('settings.graphicsHint')}</small>
              </span>
              <select
                value={graphics}
                onChange={(e) => onGraphics(e.target.value as QualitySetting)}
                data-testid="graphics-setting"
              >
                {GRAPHICS_SETTINGS.map((setting) => (
                  <option key={setting} value={setting}>
                    {t(`settings.graphicsOptions.${setting}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="wwm-field">
              <span>{t('settings.sensitivity')}</span>
              <input
                type="range"
                min={0.5}
                max={1.5}
                step={0.05}
                value={sensitivity}
                onChange={(e) => onSensitivity(Number(e.target.value))}
              />
              <output>{Math.round(sensitivity * 100)}%</output>
            </label>
            <label className="wwm-field wwm-field--check">
              <input type="checkbox" checked={pixelLook} onChange={(e) => onPixelLook(e.target.checked)} />
              <span>
                {t('settings.pixel')}
                <small>{t('settings.pixelHint')}</small>
              </span>
            </label>
            <a href="/privacy/analytics">{t('analytics.title')}</a>
            {motionOptions?.(() => setOpen(false))}
          </div>
        )}
      </div>
    </nav>
  );
}
