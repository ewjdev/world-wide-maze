import { useTranslation } from 'react-i18next';
import { RACE_ENABLED } from './flags.ts';

export function ModeNav({ active }: { active: 'original' | 'education' | 'race' }) {
  const { t } = useTranslation();
  return (
    <nav className="wwm-mode-nav" aria-label="Game mode">
      <a href="/" aria-current={active === 'original' ? 'page' : undefined}>
        {t('race.original')}
      </a>
      <a href="/?learn=compare-groups" aria-current={active === 'education' ? 'page' : undefined}>
        {t('race.education')}
      </a>
      {RACE_ENABLED && (
        <a href="/race" aria-current={active === 'race' ? 'page' : undefined}>
          {t('race.race')}
        </a>
      )}
    </nav>
  );
}
