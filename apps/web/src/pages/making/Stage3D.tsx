/**
 * The last step of /making: the real engine playing the fast intro ("the website becomes a maze"), then orbiting
 * the finished stage. If a replay is available, a ghost ball rolls it (the same code as "Race the #1 run").
 */
import type { Engine } from '@wwm/engine';
import type { InputSample, StageData } from '@wwm/schema';
import { useEffect, useRef, useState } from 'react';
import { createGhostBall, type GhostBall, recordGhostTrack } from '../../ranking/ghost.ts';

export interface Stage3DProps {
  stage: StageData;
  image: ImageBitmap;
  /** Replay for a ghost ball, with a caption naming whose run it is. */
  ghost?: { inputs: InputSample[]; caption: string } | null;
  /** Initial view once the intro is over. */
  view?: 'map' | 'chase';
}

type Status = 'loading' | 'intro' | 'ready' | 'error';

export function Stage3D({ stage, image, ghost, view = 'map' }: Stage3DProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ drawCalls: number; backend: string } | null>(null);

  useEffect(() => {
    const host = wrap.current;
    if (!host) return;
    // A disposed WebGL2 renderer loses its context, so every mount gets a fresh canvas (engine README).
    const canvas = document.createElement('canvas');
    canvas.className = 'mk-3d__canvas';
    canvas.setAttribute('aria-hidden', 'true');
    host.prepend(canvas);
    let engine: Engine | null = null;
    let ghostBall: GhostBall | null = null;
    let raf = 0;
    let ro: ResizeObserver | null = null;
    let disposed = false;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const q = new URLSearchParams(location.search);

    (async () => {
      const { createEngine } = await import('@wwm/engine');
      if (disposed) return;
      engine = await createEngine({
        canvas,
        reducedMotion: reduced,
        quality: 'auto',
        forceWebGL: q.get('backend') === 'webgl',
      });
      if (disposed) return engine.dispose();
      const size = () => {
        const r = host.getBoundingClientRect();
        engine?.resize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)));
      };
      size();
      ro = new ResizeObserver(size);
      ro.observe(host);
      await engine.loadStage(stage, image);
      if (disposed) return;
      let last = performance.now();
      let ghostT0 = 0;
      const loop = (now: number) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (ghostBall && ghostT0 > 0 && ghostBall.update((now - ghostT0) / 1000)) ghostT0 = now + 1500;
        engine?.frame(dt);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      setStatus('intro');
      await engine.playIntro({ mode: 'fast' });
      if (disposed) return;
      engine.setView(view);
      if (ghost) {
        const track = await recordGhostTrack(stage, ghost.inputs);
        if (disposed || !engine) return;
        ghostBall = createGhostBall(engine, track, { scale: view === 'map' ? 2.4 : 1 });
        ghostT0 = performance.now();
      }
      setStatus('ready');
      const s = engine.stats();
      setStats({ drawCalls: s.drawCalls, backend: String(s.backend) });
      host.dataset.ready = '1';
    })().catch((e: unknown) => {
      if (disposed) return;
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      ghostBall?.dispose();
      engine?.dispose();
      canvas.remove();
      delete host.dataset.ready;
    };
  }, [stage, image, ghost, view]);

  return (
    <div className="mk-3d" ref={wrap}>
      <div className="mk-3d__hud" aria-live="polite">
        {status === 'loading' ? 'Starting the renderer…' : null}
        {status === 'intro' ? 'The page folds flat, the islands rise, the bridges follow.' : null}
        {status === 'ready' ? (
          <>
            {ghost ? <span className="mk-ghost-key">{ghost.caption}</span> : null}
            {stats ? (
              <span className="sc-mono">
                {stats.drawCalls} draw calls · {stats.backend}
              </span>
            ) : null}
          </>
        ) : null}
        {status === 'error' ? `3D view unavailable here: ${error}` : null}
      </div>
    </div>
  );
}
