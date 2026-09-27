import type { InputSample } from '@wwm/schema';

/** Project the controller's analog tilt into the viewer's keyboard/camera frame. */
export function inputKeys(input: InputSample | null, viewYaw: number) {
  if (!input) return { up: false, down: false, left: false, right: false };
  const side = Math.sin(input.tiltX),
    forward = Math.sin(input.tiltZ);
  const delta = input.frameYaw - viewYaw;
  const right = side * Math.cos(delta) - forward * Math.sin(delta);
  const up = side * Math.sin(delta) + forward * Math.cos(delta);
  // Suppress tiny analog corrections; diagonals may light two keys together.
  return { up: up > 0.025, down: up < -0.025, left: right < -0.025, right: right > 0.025 };
}
