/** Extend WWM's cut-corner controls; keep the playfield visible behind the small action strip. */
import type { TiltInputSource } from '@wwm/net';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { readMotionPreferences, saveMotionPreferences } from './motion-preferences.ts';
import type { MotionSession } from './motion-session.ts';
import type { TurboControl } from './TouchControls.tsx';
import './tilt.css';

interface SetupProps {
  session: MotionSession;
  onEnable: () => void;
  onJoystick: () => void;
  fallbackLabel?: string;
}
export function MotionSetup({
  session,
  onEnable,
  onJoystick,
  fallbackLabel = 'motion.joystick',
}: SetupProps) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { t } = useTranslation();
  const id = useId();
  const action = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const state = snapshot.state;
  const visible = state !== 'ready' && state !== 'disposed';
  // biome-ignore lint/correctness/useExhaustiveDependencies: a state transition can replace the focused action ref.
  useEffect(() => {
    if (visible && !root.current?.contains(document.activeElement)) action.current?.focus();
  }, [visible, state]);
  useEffect(() => {
    if (!visible) return;
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      if (!items?.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!root.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const recoverFocus = (event: FocusEvent) => {
      if (!root.current?.contains(event.target as Node)) action.current?.focus();
    };
    document.addEventListener('keydown', trap);
    document.addEventListener('focusin', recoverFocus);
    return () => {
      document.removeEventListener('keydown', trap);
      document.removeEventListener('focusin', recoverFocus);
    };
  }, [visible]);
  if (!visible) return null;
  const busy = state === 'requesting' || state === 'probing' || state === 'calibrating';
  const warning = state === 'denied' || state === 'unavailable' || state === 'interrupted';
  const message =
    snapshot.reason === 'secure'
      ? 'secure'
      : state === 'denied'
        ? 'denied'
        : state === 'unavailable'
          ? 'unavailable'
          : state === 'interrupted'
            ? 'interrupted'
            : state === 'probing'
              ? 'probe'
              : state === 'calibrating'
                ? snapshot.reason === 'pose'
                  ? 'pose'
                  : 'hold'
                : state === 'requesting'
                  ? 'requesting'
                  : 'intro';
  return (
    <div
      ref={root}
      className="wwm-motion-setup"
      role="dialog"
      aria-modal="true"
      aria-labelledby={id}
      data-testid="motion-setup"
      data-state={state}
    >
      <section className="wwm-panel wwm-motion-setup__panel">
        <h2 id={id} className="wwm-h2">
          {t(warning ? 'motion.warningTitle' : 'motion.title')}
        </h2>
        <p role={warning ? 'alert' : 'status'}>{t(`motion.${message}`)}</p>
        {state === 'calibrating' && (
          <progress max={1} value={snapshot.progress} aria-label={t('motion.hold')} />
        )}
        {state === 'idle' && <p className="wwm-muted">{t('motion.privacy')}</p>}
        {state === 'calibrating' && (
          <button
            type="button"
            className="wwm-btn wwm-btn--primary"
            disabled={!snapshot.captureAvailable}
            onClick={session.captureHere}
            data-testid="motion-capture"
          >
            {t('motion.capture')}
          </button>
        )}
        {!busy && (
          <button
            ref={action}
            type="button"
            className="wwm-btn wwm-btn--primary"
            onClick={onEnable}
            data-testid="motion-enable"
          >
            {t(state === 'idle' ? 'motion.enable' : 'motion.check')}
          </button>
        )}
        <button
          type="button"
          ref={busy ? action : undefined}
          className="wwm-btn wwm-btn--ghost"
          onClick={onJoystick}
          data-testid="motion-joystick"
        >
          {t(fallbackLabel)}
        </button>
        {state === 'denied' && <p className="wwm-muted">{t('motion.permissionHelp')}</p>}
      </section>
    </div>
  );
}

interface ControlsProps {
  source: TiltInputSource;
  session: MotionSession;
  live: boolean;
  onPause: () => void;
  turbo?: TurboControl;
}
export function TiltControls({ source, session, live, onPause, turbo }: ControlsProps) {
  const { t } = useTranslation();
  const surface = useRef<HTMLDivElement>(null);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const active = live && snapshot.state === 'ready';
  useEffect(() => {
    const element = surface.current;
    if (!element || !active) {
      source.clearPending();
      return;
    }
    return source.attachSurface(
      element,
      (event) =>
        !event
          .composedPath()
          .some(
            (node) =>
              node instanceof Element &&
              node.matches('button, a, input, select, textarea, [data-gameplay-owner]'),
          ),
    );
  }, [source, active]);
  const jump = () => {
    const token = source.requestJump();
    source.completeJump(token);
  };
  return (
    <div className="wwm-tilt" data-testid="tilt-controls" data-live={active}>
      <div
        ref={surface}
        className="wwm-tilt__surface"
        data-testid="tilt-playfield"
        aria-hidden="true"
        onContextMenu={(event) => event.preventDefault()}
      />
      {active && (
        <div className="wwm-tilt__actions">
          <button type="button" onClick={onPause} data-testid="tilt-pause">
            {t('touch.pause')}
          </button>
          {turbo?.available && (
            <button type="button" disabled={!turbo.ready} onClick={turbo.onTurbo} data-testid="tilt-turbo">
              {t('touch.turbo')} ×{turbo.count}
            </button>
          )}
          {readMotionPreferences().showJump && (
            <button type="button" onClick={jump} data-testid="tilt-jump">
              {t('touch.jump')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface OptionsProps {
  mode: 'tilt' | 'touch' | 'keyboard' | 'phone' | null;
  session: MotionSession;
  onTilt: () => void;
  onJoystick: () => void;
  onKeyboard: () => void;
  onRecenter: () => void;
  onPreferences: () => void;
}
export function MotionOptions({
  mode,
  session,
  onTilt,
  onJoystick,
  onKeyboard,
  onRecenter,
  onPreferences,
}: OptionsProps) {
  const { t } = useTranslation();
  const [preferences, setPreferences] = useState(readMotionPreferences);
  const sensitivityChanged = useRef(false);
  const finishSensitivity = () => {
    if (!sensitivityChanged.current) return;
    sensitivityChanged.current = false;
    onRecenter();
  };
  return (
    <fieldset className="wwm-motion-options" data-gameplay-owner="settings">
      <legend>{t('motion.controls')}</legend>
      <div className="wwm-motion-options__choices">
        <button type="button" aria-pressed={mode === 'tilt'} onClick={onTilt} data-testid="controls-tilt">
          {t('motion.tilt')}
        </button>
        <button type="button" aria-pressed={mode === 'touch'} onClick={onJoystick}>
          {t('motion.joystickName')}
        </button>
        <button type="button" aria-pressed={mode === 'keyboard'} onClick={onKeyboard}>
          {t('common.keyboard')}
        </button>
      </div>
      {mode === 'tilt' && (
        <>
          <button type="button" className="wwm-btn wwm-btn--ghost" onClick={onRecenter}>
            {t('motion.recenter')}
          </button>
          <label>
            {t('settings.sensitivity')}
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              value={preferences.sensitivity}
              data-testid="motion-sensitivity"
              onChange={(event) => {
                const next = { ...preferences, sensitivity: Number(event.target.value) };
                setPreferences(next);
                saveMotionPreferences(next);
                session.source.setSensitivity(next.sensitivity);
                sensitivityChanged.current = true;
              }}
              onPointerUp={finishSensitivity}
              onPointerCancel={finishSensitivity}
              onKeyUp={finishSensitivity}
              onBlur={finishSensitivity}
            />
          </label>
          <label className="wwm-motion-options__check">
            <input
              type="checkbox"
              checked={preferences.showJump}
              onChange={(event) => {
                const next = { ...preferences, showJump: event.target.checked };
                setPreferences(next);
                saveMotionPreferences(next);
                onPreferences();
              }}
            />
            {t('motion.showJump')}
          </label>
        </>
      )}
    </fieldset>
  );
}
