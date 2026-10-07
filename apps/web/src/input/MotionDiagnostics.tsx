import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { MotionSession } from './motion-session.ts';

/** A user can inspect/copy readings; this component never transmits them. */
export function MotionDiagnostics({ session }: { session: MotionSession }) {
  const data = useSyncExternalStore(session.subscribeDiagnostics, session.getDiagnostics);
  const { t } = useTranslation();
  const permission = (value: string) => t(`motion.debugPermission.${value}`);
  const readings = (events: number, usable: number, age: number | null) =>
    events === 0
      ? t('motion.debugWaiting')
      : t('motion.debugReadings', {
          usable,
          events,
          age: age === null ? t('motion.debugNever') : `${(age / 1000).toFixed(1)}s`,
        });
  const waiting = session.getSnapshot().state === 'probing' && data.elapsedMs < 2500;
  return (
    <div className="wwm-motion-debug" data-testid="motion-diagnostics">
      <p className="wwm-motion-debug__status" role="status" data-testid="motion-blocker">
        {t(
          waiting && (data.blocker === 'noOrientation' || data.blocker === 'noMotion')
            ? `motion.debugWaiting${data.blocker === 'noOrientation' ? 'Orientation' : 'Motion'}`
            : `motion.debugBlocker.${data.blocker}`,
        )}
      </p>
      <dl>
        <div>
          <dt>{t('motion.debugPermissionLabel')}</dt>
          <dd data-testid="motion-permissions">
            {t('motion.debugPermissions', {
              orientation: permission(data.orientationPermission),
              motion: permission(data.motionPermission),
            })}
          </dd>
        </div>
        <div>
          <dt>{t('motion.debugOrientation')}</dt>
          <dd>{readings(data.orientationEvents, data.usableOrientation, data.orientationAgeMs)}</dd>
        </div>
        <div>
          <dt>{t('motion.debugMotion')}</dt>
          <dd>{readings(data.motionEvents, data.usableMotion, data.motionAgeMs)}</dd>
        </div>
        <div>
          <dt>{t('motion.debugMovement')}</dt>
          <dd>{t('motion.debugDegrees', { degrees: data.movementDegrees.toFixed(1) })}</dd>
        </div>
      </dl>
    </div>
  );
}

export function MotionDebugReport({ session }: { session: MotionSession }) {
  const data = useSyncExternalStore(session.subscribeDiagnostics, session.getDiagnostics);
  const { t } = useTranslation();
  const [copy, setCopy] = useState<'idle' | 'copied' | 'copyFailed'>('idle');
  const report = JSON.stringify(
    {
      build: import.meta.env.VITE_PREVIEW_COMMIT || 'local / build not supplied',
      page: `${location.origin}${location.pathname}`,
      browser: navigator.userAgent,
      capturedAt: new Date().toISOString(),
      state: session.getSnapshot().state,
      reason: session.getSnapshot().reason,
      ...data,
    },
    null,
    2,
  );
  return (
    <details className="wwm-motion-debug wwm-motion-debug__details">
      <summary>{t('motion.debugDetails')}</summary>
      <p>{t('motion.debugPrivacy')}</p>
      <button
        type="button"
        className="wwm-btn wwm-btn--ghost"
        data-testid="motion-copy"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(report);
            setCopy('copied');
          } catch {
            setCopy('copyFailed');
          }
        }}
      >
        {t('motion.debugCopy')}
      </button>
      {copy !== 'idle' && (
        <p role="status">{t(`motion.debug${copy === 'copied' ? 'Copied' : 'CopyFailed'}`)}</p>
      )}
      <pre data-testid="motion-report">{report}</pre>
    </details>
  );
}
