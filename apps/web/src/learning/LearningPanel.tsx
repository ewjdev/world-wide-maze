/**
 * Phase 20 M4b + Phase 22 M3 (N): the lesson loader on the site-select screen ("Pip gates") with the level being
 * played and its generated description, a Grown-ups control (press and hold) to switch levels for the session, the
 * HUD chips while a lesson is on (steps, the mission in progress, the lock banner), and a notice when a lesson
 * couldn't be loaded. A picked file is read with `File.text()` and only its inert JSON is parsed (load.ts); it
 * never leaves the device.
 */
import { spriteMarkup } from '@wwm/learning';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGame } from '../ui/GameApp.tsx';
import { GemIcon } from '../ui/parts.tsx';
import { HoldButton } from './HoldButton.tsx';
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
  const [picking, setPicking] = useState(false);
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
          <>
            <p className="wwm-lpanel__lesson" data-testid="learning-lesson">
              <strong className="wwm-lpanel__name">{lesson.title}</strong>
              <span className="wwm-lpanel__meta">
                {lesson.source.kind === 'file'
                  ? t('learning.panel.from', { name: lesson.source.name })
                  : t('learning.panel.fromBaseline')}
              </span>
            </p>
            <p className="wwm-lpanel__level" data-testid="learning-level" data-level={lesson.level.id}>
              <span className="wwm-lpanel__levelname">
                {t('learning.panel.level')}: <strong>{lesson.level.label}</strong>
              </span>{' '}
              <span className="wwm-lpanel__desc">{lesson.level.description}</span>
            </p>
            {picking && (
              <fieldset className="wwm-lpanel__levels" data-testid="learning-levels">
                <legend>{t('learning.panel.levelsTitle')}</legend>
                {lesson.levels.map((level) => (
                  <label key={level.id} className="wwm-lpanel__choice">
                    <input
                      type="radio"
                      name="wwm-level"
                      value={level.id}
                      checked={level.id === lesson.level.id}
                      onChange={() => learning.setLevel(level.id)}
                      data-testid={`learning-level-${level.id}`}
                    />
                    <span>
                      <strong>{level.label}</strong>
                      {level.isDefault && (
                        <span className="wwm-muted"> · {t('learning.panel.authorDefault')}</span>
                      )}
                      <span className="wwm-lpanel__desc">{level.description}</span>
                    </span>
                  </label>
                ))}
                <button
                  type="button"
                  className="wwm-btn wwm-btn--small wwm-btn--ghost"
                  onClick={() => setPicking(false)}
                  data-testid="learning-levels-close"
                >
                  {t('learning.panel.close')}
                </button>
              </fieldset>
            )}
          </>
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
          <>
            {lesson.levels.length > 1 && !picking && (
              <HoldButton
                label={t('learning.panel.grownups')}
                hint={t('learning.panel.grownupsHint')}
                onDone={() => setPicking(true)}
                testId="learning-grownups"
                className="wwm-btn wwm-btn--small wwm-btn--ghost"
              />
            )}
            <button
              type="button"
              className="wwm-btn wwm-btn--small wwm-btn--ghost"
              onClick={() => {
                setPicking(false);
                learning.clear();
              }}
              data-testid="learning-remove"
            >
              {t('learning.panel.remove')}
            </button>
          </>
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

/** HUD: the lesson is on, its steps (planks for rounds, gems for missions), a mission in progress, a lock banner. */
export function LearningHud() {
  const [learning, view] = useLearning();
  const { t } = useTranslation();
  const lesson = learning.lesson;
  if (!lesson || !view.lesson) return null;
  const steps = view.steps.filter((s) => s.placed);
  const done = steps.filter((s) => s.done).length;
  const mission = view.mission;
  const banner = view.banner;
  return (
    <>
      <p className="wwm-lhud" data-testid="learning-hud">
        <PipBadge size={26} />
        <span className="wwm-lhud__title">{view.lesson.title}</span>
        <span
          className="wwm-lhud__bridge"
          role="img"
          aria-label={t('learning.steps', { done, total: steps.length })}
        >
          {steps.map((s) => (
            <span
              key={s.index}
              className={`${s.done ? 'is-built' : ''}${s.kind === 'mission' ? ' is-mission' : ''}`}
              data-lock={s.lock}
            />
          ))}
        </span>
      </p>
      {mission && (
        <p className="wwm-lmission" data-testid="learning-mission" data-kind={mission.kind}>
          <span className="wwm-lmission__title">{t('learning.mission.title')}</span>
          <span className="wwm-lmission__what">
            {mission.kind === 'collect'
              ? t('learning.mission.collect', { count: mission.count })
              : mission.by === 'letter'
                ? t('learning.mission.letter', { letter: mission.letter ?? '?' })
                : t(`learning.mission.${mission.by ?? 'most-gems'}`)}
          </span>
          {mission.kind === 'collect' && (
            <span
              className="wwm-lmission__gems"
              role="img"
              aria-label={t('learning.mission.progress', { have: mission.have, count: mission.count })}
              data-have={mission.have}
            >
              {Array.from({ length: mission.count }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed slots
                <GemIcon key={i} size={20} dim={i >= mission.have} />
              ))}
            </span>
          )}
        </p>
      )}
      {banner && (
        <p
          key={banner.seq}
          className="wwm-hud__inst wwm-flash wwm-lbanner"
          role="status"
          data-testid="learning-banner"
          data-kind={banner.kind}
        >
          {t(`learning.lock.${banner.kind}`, { n: banner.n, count: banner.count, have: banner.have })}
        </p>
      )}
    </>
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

/** Pause menu: the grown-up override (press and hold), only when the level allows it and a lock is shut. */
export function LearningOverride() {
  const [learning, view] = useLearning();
  const { t } = useTranslation();
  const g = useGame();
  const [opened, setOpened] = useState(0);
  if (!learning.lesson || !view.lesson?.override) return null;
  if (!view.canOverride)
    return opened > 0 ? (
      <p className="wwm-loverride__done" role="status" data-testid="learning-override-done">
        {t('learning.override.done')}
      </p>
    ) : null;
  return (
    <div className="wwm-loverride">
      <HoldButton
        label={t('learning.override.hold')}
        hint={t('learning.override.hint')}
        onDone={() => {
          if (g.overrideLock()) setOpened((n) => n + 1);
        }}
        testId="learning-override"
        className="wwm-btn wwm-btn--ghost"
      />
      {opened > 0 && (
        <p className="wwm-loverride__done" role="status" data-testid="learning-override-done">
          {t('learning.override.done')}
        </p>
      )}
    </div>
  );
}
