import type { InputSample } from '@wwm/schema';
import { inputKeys } from './input-keys.ts';

/** Press/release is the focal motion: 100ms travel, no looping animation or extra render loop. */
export function InputDisplay({
  input,
  viewYaw,
  jumping,
  active,
  target,
  recorded,
}: {
  input: InputSample | null;
  viewYaw: number;
  jumping: boolean;
  active: boolean;
  target: string;
  recorded: boolean;
}) {
  const keys = inputKeys(active ? input : null, viewYaw);
  const jump = active && jumping;
  const pressed = Object.entries(keys)
    .filter(([, on]) => on)
    .map(([key]) => key);
  if (jump) pressed.push('space');
  return (
    <section className="jev-input-display" aria-label="Controller inputs">
      <p className="jev-input-target">{target}</p>
      <div
        className="jev-keyboard"
        role="img"
        aria-label={`${recorded ? 'Recorded' : 'Live'} steering: ${pressed.join(', ') || 'no keys pressed'}`}
      >
        {(['up', 'left', 'down', 'right'] as const).map((key) => (
          <kbd key={key} data-key={key} data-active={keys[key]} className={`jev-key jev-key-${key}`}>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 19V5m-6 6 6-6 6 6" />
            </svg>
          </kbd>
        ))}
        <kbd data-key="space" data-active={jump} className="jev-key jev-key-space">
          space<span>jump</span>
        </kbd>
      </div>
      <p className="jev-input-caption">{recorded ? 'Recorded' : 'Live'} steering · view-relative</p>
      <p className="jev-input-note">Jump is off in the current controller.</p>
    </section>
  );
}
