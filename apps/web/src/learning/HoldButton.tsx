/**
 * Phase 22 M3 (N): a grown-ups control. It acts only after a press and hold (2 s by default; on a keyboard, hold
 * G), so a child tapping around doesn't change the level or open a lock. The fill shows the hold's progress.
 */
import { type CSSProperties, useEffect, useRef, useState } from 'react';

export const HOLD_MS = 2000;

export function HoldButton({
  label,
  hint,
  onDone,
  ms = HOLD_MS,
  holdKey = 'KeyG',
  testId,
  className = '',
}: {
  label: string;
  hint?: string;
  onDone: () => void;
  ms?: number;
  /** A keyboard key held for the same time does the same (`KeyboardEvent.code`); null for none. */
  holdKey?: string | null;
  testId?: string;
  className?: string;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  const start = () => {
    if (timer.current) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      done.current();
    }, ms);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: start/cancel only touch refs and state setters
  useEffect(() => {
    if (!holdKey) return;
    const down = (e: KeyboardEvent) => {
      if (e.code !== holdKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, [contenteditable="true"]')) return;
      start();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === holdKey) cancel();
    };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('blur', cancel);
    return () => {
      removeEventListener('keydown', down);
      removeEventListener('keyup', up);
      removeEventListener('blur', cancel);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [holdKey, ms]);

  return (
    <button
      type="button"
      className={`wwm-hold-btn${holding ? ' is-holding' : ''} ${className}`}
      style={{ '--hold-ms': `${ms}ms` } as CSSProperties}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        start();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onContextMenu={(e) => e.preventDefault()}
      title={hint}
      data-testid={testId}
      data-holding={holding}
    >
      <span className="wwm-hold-btn__fill" aria-hidden="true" />
      <span className="wwm-hold-btn__label">{label}</span>
      {hint && <span className="wwm-hold-btn__hint">{hint}</span>}
    </button>
  );
}
