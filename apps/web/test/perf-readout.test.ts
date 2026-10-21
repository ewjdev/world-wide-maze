/** `?perf` readout (portal windows M4): the frame summary it shows. */
import { describe, expect, test } from 'vitest';
import { summarizeFrames } from '../src/ui/PerfReadout.tsx';

describe('summarizeFrames', () => {
  test('average FPS from the intervals, and the worst frame', () => {
    const steady = summarizeFrames(Array(60).fill(1000 / 60));
    expect(steady.fps).toBeCloseTo(60, 9);
    expect(steady.worstMs).toBeCloseTo(1000 / 60, 9);
    const s = summarizeFrames([16, 16, 16, 50]);
    expect(s.fps).toBeCloseTo(4000 / 98, 6);
    expect(s.worstMs).toBe(50);
  });

  test('no frames: zeros, not NaN', () => {
    expect(summarizeFrames([])).toEqual({ fps: 0, worstMs: 0 });
  });
});
