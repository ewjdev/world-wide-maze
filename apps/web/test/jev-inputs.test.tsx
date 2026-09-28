import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { InputDisplay } from '../src/jev/InputDisplay.tsx';
import { inputKeys } from '../src/jev/input-keys.ts';

const input = { tiltX: 0, tiltZ: 0.4, frameYaw: 0, power: true, jump: false };
it('maps analog steering into the camera frame, including diagonals and a noise deadzone', () => {
  expect(inputKeys(input, 0)).toEqual({ up: true, down: false, left: false, right: false });
  expect(inputKeys({ ...input, frameYaw: Math.PI / 2 }, 0)).toEqual({
    up: false,
    down: false,
    left: true,
    right: false,
  });
  expect(inputKeys(input, Math.PI)).toEqual({ up: false, down: true, left: false, right: false });
  expect(inputKeys({ ...input, tiltX: 0.3 }, 0)).toEqual({ up: true, down: false, left: false, right: true });
  expect(Object.values(inputKeys({ ...input, tiltX: 0.001, tiltZ: 0.001 }, 0))).not.toContain(true);
});
it('shows actual jump pulses and releases all keys when paused, with recorded provenance', () => {
  const props = {
    input: { ...input, jump: true },
    viewYaw: 0,
    jumping: true,
    target: 'Jev target: Goal',
    recorded: true,
  };
  const active = renderToStaticMarkup(<InputDisplay {...props} active />);
  expect(active).toContain('Recorded steering: up, space');
  expect(active).toContain('data-key="space" data-active="true"');
  const paused = renderToStaticMarkup(<InputDisplay {...props} active={false} />);
  expect(paused).not.toContain('data-active="true"');
  expect(paused).toContain('no keys pressed');
});
