/**
 * `/j/:trail` (Phase 13, N): a shared web journey. The card shows the chain of sites a player rolled through
 * (each reached by a link portal on the page before), the run's score, and deep links to play any stop. It is a
 * light page: no renderer, no physics (the game chunk loads only when a stop is opened).
 */
import '@fontsource-variable/unbounded';
import '@fontsource-variable/figtree';
import './game.css';
import './journey.css';
import type { i18n } from 'i18next';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { useParams } from 'react-router';
import { decodeJourney, hostColor } from '../game/journey.ts';
import { createI18n } from '../i18n/index.ts';
import { registerJourneyStrings, useJourneyT } from './journey-strings.ts';
import { Mono } from './Mono.tsx';
import { Facets, Icon, Logo } from './parts.tsx';

type Style = CSSProperties & Record<`--${string}`, string>;

export function JourneyPage() {
  const [inst] = useState<i18n>(() => {
    const i = createI18n();
    registerJourneyStrings(i);
    return i;
  });
  useEffect(() => {
    document.body.classList.add('wwm-body', 'wwm-body--scroll');
    document.documentElement.lang = inst.language;
    return () => document.body.classList.remove('wwm-body', 'wwm-body--scroll');
  }, [inst]);
  return (
    <I18nextProvider i18n={inst}>
      <JourneyCard />
    </I18nextProvider>
  );
}

function JourneyCard() {
  const { trail = '' } = useParams();
  const { t } = useJourneyT();
  const j = useMemo(() => decodeJourney(trail), [trail]);
  useEffect(() => {
    if (!j) return;
    const title = j.name ? t('journey.page.titleBy', { name: j.name }) : t('journey.page.title');
    document.title = `${title}: ${j.stops.map((s) => s.host).join(' → ')} · World Wide Maze`;
  }, [j, t]);
  if (!j)
    return (
      <main className="wwm-jpage">
        <section className="wwm-jcard" role="alert" data-testid="journey-invalid">
          <Logo size="sm" />
          <p className="wwm-jcard__lede">{t('journey.page.invalid')}</p>
          <a className="wwm-btn wwm-btn--secondary" href="/">
            {t('journey.page.play')} <Icon name="arrow" />
          </a>
        </section>
      </main>
    );
  const first = j.stops.find((s) => s.ref);
  return (
    <main className="wwm-jpage" data-testid="journey-page">
      <section className="wwm-jcard" aria-labelledby="jcard-h">
        <Facets seed={11} className="wwm-jcard__band" />
        <header className="wwm-jcard__head">
          <a href="/" className="wwm-jcard__logo" aria-label="World Wide Maze">
            <Logo size="sm" />
          </a>
          <h1 id="jcard-h" className="wwm-jcard__title">
            {j.name ? t('journey.page.titleBy', { name: j.name }) : t('journey.page.title')}
          </h1>
          <p className="wwm-jcard__stats">
            <span>{t('journey.page.sites', { count: j.stops.length })}</span>
            {j.total !== null && (
              <span>{t('journey.page.points', { score: j.total.toLocaleString('en-US') })}</span>
            )}
          </p>
          <p className="wwm-jcard__lede">{t('journey.page.lede')}</p>
        </header>
        <ol className="wwm-jpath">
          {j.stops.map((s, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
              key={i}
              className="wwm-jpath__stop"
              style={{ '--pc': hostColor(s.host) } as Style}
            >
              <Mono host={s.host} size={i === 0 || i === j.stops.length - 1 ? 'lg' : 'md'} />
              <div className="wwm-jpath__text">
                <p className="wwm-jpath__title">{s.title || s.host}</p>
                <p className="wwm-jpath__host">{s.host}</p>
              </div>
              {s.ref ? (
                <a
                  className="wwm-btn wwm-btn--ghost wwm-btn--small"
                  href={`/play/${encodeURIComponent(s.ref)}`}
                >
                  {t('journey.page.playStop')}
                </a>
              ) : (
                <span className="wwm-jpath__live">{t('journey.page.noRef')}</span>
              )}
            </li>
          ))}
        </ol>
        <footer className="wwm-jcard__foot">
          {first?.ref && (
            <a
              className="wwm-btn wwm-btn--hero"
              href={`/play/${encodeURIComponent(first.ref)}`}
              data-testid="journey-start"
            >
              <span>{t('journey.page.start')}</span>
              <Icon name="arrow" size={24} />
            </a>
          )}
          <a className="wwm-btn wwm-btn--ghost" href="/">
            {t('journey.page.play')}
          </a>
          <a className="wwm-jcard__about" href="/about">
            {t('journey.page.about')}
          </a>
        </footer>
      </section>
    </main>
  );
}
