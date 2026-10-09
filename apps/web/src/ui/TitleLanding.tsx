/** The same title markup before and after the game runtime loads. */
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ModeNav } from '../race/ModeNav.tsx';
import { Icon, Logo } from './parts.tsx';

export function TitleLanding({
  onStart,
  disabled = false,
  preparing = false,
  error = false,
  onRetry,
}: {
  onStart: () => void;
  disabled?: boolean;
  preparing?: boolean;
  error?: boolean;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const start = useRef<HTMLButtonElement>(null);
  useEffect(() => start.current?.focus(), []);
  return (
    <div className="wwm-title">
      <div className="wwm-title__block">
        <Logo />
        <p className="wwm-title__caption">{t('title.caption')}</p>
        <ModeNav active={new URLSearchParams(location.search).has('learn') ? 'education' : 'original'} />
        <div className="wwm-title__actions">
          <button
            ref={start}
            type="button"
            className="wwm-btn wwm-btn--hero"
            onClick={error ? onRetry : onStart}
            disabled={disabled}
            data-testid="start"
          >
            <span>{t(error ? 'title.reload' : 'title.start')}</span>
            <Icon name="arrow" size={26} />
          </button>
        </div>
      </div>
      {preparing && (
        <p className="wwm-home-status" role="status" data-testid="home-preparing">
          {t('title.preparing')}
        </p>
      )}
      {error && (
        <div className="wwm-home-status" role="alert">
          <p>{t('title.loadError')}</p>
        </div>
      )}
      <footer className="wwm-title__foot">
        <p>{t('app.tribute')}</p>
        <a href="/about">{t('title.about')}</a>
        <a href="/privacy/analytics">{t('analytics.title')}</a>
      </footer>
    </div>
  );
}
