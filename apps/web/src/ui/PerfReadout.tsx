/**
 * `?perf` (N; plans/portal-windows-execution.md M4): a small frame-time readout for measuring on a real phone, where
 * there is no console. Frames are timed with requestAnimationFrame (what the player sees), once a second: average
 * FPS, the worst frame, and the engine's quality tier, draw calls and backend. Dev and preview builds only, so a
 * production URL never shows it.
 */
import { useEffect, useState } from 'react';
import { useGame } from './GameApp.tsx';

export const PERF_READOUT =
  (import.meta.env.DEV || !!import.meta.env.VITE_PREVIEW_COMMIT) &&
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).has('perf');

interface Sample {
  fps: number;
  worstMs: number;
  tier: number | null;
  draws: number | null;
  backend: string | null;
}

/** Average FPS and the worst frame (ms) of one window of frame intervals. */
export function summarizeFrames(intervalsMs: readonly number[]): { fps: number; worstMs: number } {
  if (intervalsMs.length === 0) return { fps: 0, worstMs: 0 };
  const total = intervalsMs.reduce((a, b) => a + b, 0);
  return { fps: (intervalsMs.length * 1000) / total, worstMs: Math.max(...intervalsMs) };
}

export function PerfReadout() {
  const g = useGame();
  const [s, setS] = useState<Sample | null>(null);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let since = last;
    let frames: number[] = [];
    const tick = (now: number) => {
      frames.push(now - last);
      last = now;
      if (now - since >= 1000) {
        const e = (g.debugState().engine ?? null) as {
          tier: number;
          drawCalls: number;
          backend: string;
        } | null;
        setS({
          ...summarizeFrames(frames),
          tier: e?.tier ?? null,
          draws: e?.drawCalls ?? null,
          backend: e?.backend ?? null,
        });
        frames = [];
        since = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [g]);
  if (!s) return null;
  return (
    <output className="wwm-perf" aria-live="off" data-testid="perf-readout">
      {s.fps.toFixed(0)} fps · worst {s.worstMs.toFixed(0)} ms · tier {s.tier ?? '–'} · {s.draws ?? '–'} draws
      · {s.backend ?? '–'}
    </output>
  );
}
