/**
 * Phase 20 M4b (N): the lesson loader on the site-select screen ("Pip gates"), a small chip on the HUD while a
 * lesson is on, and a notice when a lesson couldn't be loaded (e.g. a bad `?learn=`). A picked file is read with
 * `File.text()` and only its inert JSON is parsed (load.ts); it never leaves the device.
 */
import { requiredRounds, spriteMarkup } from '@wwm/learning';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useGame } from '../ui/GameApp.tsx';
import { useLearning } from './LearningGateCard.tsx';
import { lessonFromBaseline, lessonFromFile } from './load.ts';
import './learning.css';

/** The built-in button starts the reference lesson (Phase 20's "Which has more?"). */
const BUILT_IN = 'compare-groups';

/** `?learn=<activityId>` from the address bar (also picks the activity of a loaded file). */
export function learnParam(): string | null {
  if (typeof location === 'undefined') return null;
  return new URLSearchParams(location.search).get('learn');
}

function PipBadge({ size }: { size: number }) {
  const [learning] = useLearning();
  const theme = learning.lesson?.path.theme;
  if (!theme) return <span className="wwm-lpanel__pip wwm-lpanel__pip--empty" aria-hidden="true" />;
  return (
    <span
      className="wwm-lpanel__pip"
      aria-hidden="true"
      // trusted renderer output: numbers and validated hex colours only
      // biome-ignore lint/security/noDangerouslySetInnerHtml: spriteMarkup writes no document text
      dangerouslySetInnerHTML={{ __html: spriteMarkup(theme, 'pip', size) }}
    />
  );
}

export function LearningPanel() {
  const [learning, view] = useLearning();
  const g = useGame();
  const { t } = useTranslation();
  const file = useRef<HTMLInputElement>(null);
  const lesson = view.lesson;
  return (
    <section
      className="wwm-lpanel"
      aria-labelledby="lpanel-h"
      data-testid="learning-panel"
      data-on={!!lesson}
    >
      <PipBadge size={40} />
      <div className="wwm-lpanel__text">
        <h3 id="lpanel-h" className="wwm-lpanel__title">
          {t('learning.panel.title')}
          {lesson && <span className="wwm-lpanel__tag">{t('learning.panel.on')}</span>}
        </h3>
        {lesson ? (
          <p className="wwm-lpanel__lesson" data-testid="learning-lesson">
            <strong className="wwm-lpanel__name">{lesson.title}</strong>
            <span className="wwm-lpanel__meta">
              {lesson.source.kind === 'file'
                ? t('learning.panel.from', { name: lesson.source.name })
                : t('learning.panel.fromBaseline')}
              {' · '}
              {t('learning.panel.gates', { count: lesson.gates })}
            </span>
          </p>
        ) : (
          <p className="wwm-lpanel__body">{t('learning.panel.body')}</p>
        )}
        {view.error ? (
          <p className="wwm-lpanel__error" role="alert" data-testid="learning-error">
            {t(`learning.error.${view.error.kind}`)}
          </p>
        ) : (
          <p className="wwm-lpanel__note">{t('learning.panel.note')}</p>
        )}
      </div>
      <div className="wwm-lpanel__actions">
        <input
          ref={file}
          type="file"
          accept=".html,.htm,text/html"
          className="wwm-lpanel__file"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (!f) return;
            g.audio.unlock();
            void learning.load(() => lessonFromFile(f, learnParam())).then(() => learning.unlock());
          }}
          data-testid="learning-file"
        />
        <button
          type="button"
          className="wwm-btn wwm-btn--small wwm-btn--secondary"
          onClick={() => file.current?.click()}
          disabled={view.loading}
          data-testid="learning-load"
        >
          {view.loading ? t('learning.panel.loading') : t('learning.panel.load')}
        </button>
        {lesson ? (
          <button
            type="button"
            className="wwm-btn wwm-btn--small wwm-btn--ghost"
            onClick={() => learning.clear()}
            data-testid="learning-remove"
          >
            {t('learning.panel.remove')}
          </button>
        ) : (
          <button
            type="button"
            className="wwm-btn wwm-btn--small wwm-btn--ghost"
            onClick={() => {
              try {
                learning.use(lessonFromBaseline(BUILT_IN));
                learning.unlock();
              } catch (err) {
                learning.fail(err);
              }
            }}
            data-testid="learning-builtin"
          >
            {t('learning.panel.builtIn')}
          </button>
        )}
      </div>
    </section>
  );
}

/** HUD: the lesson is on, and how much of Pip's bridge is built. */
export function LearningHud() {
  const [learning, view] = useLearning();
  const { t } = useTranslation();
  const lesson = learning.lesson;
  if (!lesson || !view.lesson) return null;
  const planks = requiredRounds(lesson.activity);
  const built = Math.min(view.built, planks);
  return (
    <p className="wwm-lhud" data-testid="learning-hud">
      <PipBadge size={26} />
      <span className="wwm-lhud__title">{view.lesson.title}</span>
      <span
        className="wwm-lhud__bridge"
        role="img"
        aria-label={t('learning.gate.bridge', { built, total: planks })}
      >
        {Array.from({ length: planks }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed slots
          <span key={i} className={i < built ? 'is-built' : ''} />
        ))}
      </span>
    </p>
  );
}

/** A lesson that couldn't be loaded, outside the select screen (which shows it in its panel). */
export function LearningNotice() {
  const [learning, view] = useLearning();
  const { t } = useTranslation();
  if (!view.error) return null;
  return (
    <div className="wwm-lnotice" role="alert" data-testid="learning-notice">
      <p>
        <strong>{t('learning.error.title')}</strong> {t(`learning.error.${view.error.kind}`)}
      </p>
      <button
        type="button"
        className="wwm-btn wwm-btn--small wwm-btn--ghost"
        onClick={() => learning.dismissError()}
      >
        {t('learning.error.dismiss')}
      </button>
    </div>
  );
}
