import { useEffect, useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { createI18n } from '../../i18n/index.ts';
import {
  type AnalyticsPreference,
  PREFERENCE_EVENT,
  preference,
  privacySignalsSet,
  setPreference,
} from '../../telemetry/preferences.ts';
import { ShowcaseFrame } from '../about/ShowcaseFrame.tsx';
import './analytics-privacy.css';

function Preferences() {
  const { t } = useTranslation();
  const [value, setValue] = useState(() => preference(window));
  const blocked = privacySignalsSet(navigator);
  useEffect(() => {
    const update = () => setValue(preference(window));
    window.addEventListener('storage', update);
    window.addEventListener(PREFERENCE_EVENT, update);
    return () => {
      window.removeEventListener('storage', update);
      window.removeEventListener(PREFERENCE_EVENT, update);
    };
  }, []);
  return (
    <ShowcaseFrame>
      <article className="analytics-privacy">
        <p className="analytics-privacy__eyebrow">World Wide Maze</p>
        <h1>{t('analytics.title')}</h1>
        <p>{t('analytics.intro')}</p>
        <fieldset>
          <legend>{t('analytics.choice')}</legend>
          {(['off', 'visit', 'browser'] as const).map((mode) => (
            <label key={mode}>
              <input
                type="radio"
                name="analytics"
                value={mode}
                checked={value === mode}
                disabled={blocked}
                onChange={() => {
                  setPreference(mode as AnalyticsPreference);
                  setValue(mode);
                }}
              />
              <span>
                <strong>{t(`analytics.${mode}`)}</strong>
                <small>{t(`analytics.${mode}Hint`)}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <p role="status">{blocked ? t('analytics.blocked') : t('analytics.saved')}</p>
        <h2>{t('analytics.collectTitle')}</h2>
        <p>{t('analytics.collect')}</p>
        <h2>{t('analytics.excludeTitle')}</h2>
        <p>{t('analytics.exclude')}</p>
        <h2>{t('analytics.storageTitle')}</h2>
        <p>{t('analytics.storage')}</p>
        <p>{t('analytics.withdraw')}</p>
        <p>
          <a href="https://posthog.com/privacy">PostHog privacy policy</a> ·{' '}
          <a href="mailto:ewjdev@gmail.com">{t('analytics.contact')}</a>
        </p>
      </article>
    </ShowcaseFrame>
  );
}
export default function AnalyticsPrivacy() {
  const [i18n] = useState(() => createI18n());
  return (
    <I18nextProvider i18n={i18n}>
      <Preferences />
    </I18nextProvider>
  );
}
