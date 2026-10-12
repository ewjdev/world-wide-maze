import { expectedMotion, type MotionScene } from './motion.ts';
import type { Activity, VoiceClip } from './schema.ts';
import type { LessonState } from './session.ts';

/** Finite, replayable teaching motion. Narration can extend the visible explanation, with a bounded silent fallback. */
export function runMotionEffect(
  root: Element,
  scene: MotionScene,
  complete: () => void,
  reduced = false,
  duration = 2800,
  narrationReady: () => boolean = () => true,
): () => void {
  const document = root.ownerDocument;
  const view = document.defaultView;
  if (!view) return () => {};
  let disposed = false;
  let frame = 0;
  let timer = 0;
  let deadline = 0;
  const body = root.querySelector('[data-motion-body]');
  const gas = root.querySelector('[data-motion-gas]');
  const motion = expectedMotion(scene);
  const dx = motion === 'left' ? -150 : motion === 'right' ? 150 : 0;
  const dy = motion === 'up' ? -90 : 0;
  const stop = () => {
    view.cancelAnimationFrame(frame);
    view.clearTimeout(timer);
  };
  const reset = () => {
    body?.setAttribute('transform', 'translate(0 0)');
    gas?.setAttribute('transform', 'translate(0 0)');
    root.removeAttribute('data-experiment-frame');
  };
  const after = () => {
    body?.setAttribute('transform', `translate(${dx} ${dy})`);
    gas?.setAttribute('transform', `translate(${-dx * 0.55} ${-dy * 0.55})`);
    root.setAttribute('data-experiment-frame', 'after');
  };
  const start = () => {
    stop();
    reset();
    if (disposed || document.hidden) return;
    deadline = view.performance.now() + duration + 30000;
    root.setAttribute('data-experiment-frame', 'before');
    if (reduced) {
      timer = view.setTimeout(() => {
        after();
        timer = view.setTimeout(finish, Math.max(1100, duration - 700));
      }, 700);
    } else {
      const began = view.performance.now();
      const tick = (now: number) => {
        if (disposed || document.hidden) return;
        const t = Math.max(0, Math.min(1, (now - began - 400) / 1800));
        const progress = t * t * (3 - 2 * t);
        body?.setAttribute('transform', `translate(${dx * progress} ${dy * progress})`);
        gas?.setAttribute('transform', `translate(${-dx * progress * 0.55} ${-dy * progress * 0.55})`);
        if (t < 1) frame = view.requestAnimationFrame(tick);
        else {
          after();
          timer = view.setTimeout(finish, Math.max(600, duration - 2200));
        }
      };
      frame = view.requestAnimationFrame(tick);
    }
  };
  const visibility = () => {
    if (document.hidden) {
      stop();
      reset();
    } else start();
  };
  const finish = () => {
    if (disposed || document.hidden) return;
    if (!narrationReady() && view.performance.now() < deadline) {
      timer = view.setTimeout(finish, 100);
      return;
    }
    disposed = true;
    stop();
    document.removeEventListener('visibilitychange', visibility);
    complete();
  };
  document.addEventListener('visibilitychange', visibility);
  start();
  return () => {
    disposed = true;
    stop();
    reset();
    document.removeEventListener('visibilitychange', visibility);
  };
}

export function motionEffectMs(
  activity: Activity,
  state: LessonState,
  clips: readonly VoiceClip[] = [],
): number {
  const round = activity.rounds[state.index];
  const text =
    state.effect?.purpose === 'intro'
      ? [activity.introduction, activity.demonstration?.text ?? '']
      : [
          state.effect?.purpose === 'hint' || state.effect?.purpose === 'worked'
            ? (round?.hints[state.hintLevel - 1] ?? '')
            : (round?.success ?? ''),
        ];
  return Math.max(
    2800,
    text.reduce(
      (sum, t) => sum + (clips.find((c) => c.text === t)?.ms ?? t.split(/\s+/).length * 420) + 400,
      0,
    ),
  );
}
