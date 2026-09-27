import { describe, expect, test } from 'vitest';
import { RenderCadence } from '../src/game/render-cadence.ts';

describe('inactive render cadence', () => {
  test('active gameplay preserves every display frame and its animation delta', () => {
    const cadence = new RenderCadence();
    for (let frame = 0; frame < 240; frame++)
      expect(cadence.advance((frame * 1000) / 60, 1 / 60, 'play')).toBe(1 / 60);
  });

  test('map transition stays smooth, then submits 15 frames/s without slowing its animation clock', () => {
    const cadence = new RenderCadence();
    let frames = 0;
    let seconds = 0;
    for (let frame = 0; frame < 180; frame++) {
      const dt = cadence.advance((frame * 1000) / 60, 1 / 60, 'paused');
      if (frame < 60) expect(dt).not.toBeNull();
      if (dt !== null) {
        seconds += dt;
        if (frame >= 60) frames++;
      }
    }
    expect(frames).toBe(30);
    expect(seconds).toBeCloseTo(3, 5);
  });

  test('title settles to 30 frames/s and switching back to play renders immediately', () => {
    const cadence = new RenderCadence();
    let frames = 0;
    for (let frame = 0; frame < 180; frame++) {
      const dt = cadence.advance((frame * 1000) / 60, 1 / 60, 'title');
      if (frame >= 60 && dt !== null) frames++;
    }
    expect(frames).toBe(60);
    expect(cadence.advance(3000, 1 / 60, 'play')).not.toBeNull();
  });

  test('visibility reset drops accumulated idle animation time and renders immediately', () => {
    const cadence = new RenderCadence();
    cadence.advance(0, 1 / 60, 'paused');
    cadence.advance(1000, 1 / 60, 'paused');
    expect(cadence.advance(1016, 1 / 60, 'paused')).toBeNull();
    cadence.reset();
    expect(cadence.advance(6016, 1 / 60, 'paused')).toBe(1 / 60);
  });
});
