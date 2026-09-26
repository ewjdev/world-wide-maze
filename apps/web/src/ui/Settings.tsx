/** Top-right controls on menu screens: sound, language (E: English / 日本語 switch), settings popover. */
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type Lang, setLang } from '../i18n/index.ts';
import { useGame, useView } from './GameApp.tsx';
import { Icon } from './parts.tsx';

export function TopBar() {
  const g = useGame();
  const v = useView();
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
        onClick={() => g.setMuted(!v.muted)}
        aria-pressed={!v.muted}
        aria-label={t('common.soundOn')}
        data-testid="sound-toggle"
      >
        <Icon name={v.muted ? 'mute' : 'sound'} size={18} />
        <span>{v.muted ? t('common.soundOff') : t('common.soundOn')}</span>
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
              <span>{t('settings.sensitivity')}</span>
              <input
                type="range"
                min={0.5}
                max={1.5}
                step={0.05}
                value={v.sensitivity}
                onChange={(e) => g.setSensitivity(Number(e.target.value))}
              />
              <output>{Math.round(v.sensitivity * 100)}%</output>
            </label>
            <label className="wwm-field wwm-field--check">
              <input
                type="checkbox"
                checked={v.pixelLook}
                onChange={(e) => g.setPixelLook(e.target.checked)}
              />
              <span>
                {t('settings.pixel')}
                <small>{t('settings.pixelHint')}</small>
              </span>
            </label>
            <a href="/privacy/analytics">{t('analytics.title')}</a>
          </div>
        )}
      </div>
    </nav>
  );
}
