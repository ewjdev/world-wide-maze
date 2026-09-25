/**
 * /making/:stageId — "How it's made" (Phase 10). Rebuilds a captured page with the real stage builder in a Web
 * Worker and scrubs through its steps, drawn with tools/stage-debugger's drawing module; the last step is the
 * real engine. Each step quotes how the 2013 original did the same thing.
 * URL: /making/<fixture slug | handmade-simple | 64-hex stage id>?slice=0&step=0
 */
import type { InputSample, StageData } from '@wwm/schema';
import { sliceRange } from '@wwm/schema';
import type { DebugLayersEx } from '@wwm/stage-builder';
import { drawStage } from '@wwm/stage-debugger/draw';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ShowcaseFrame } from '../about/ShowcaseFrame.tsx';
import type { BuildRequest, BuildResponse } from './build.worker.ts';
import { DEFAULT_SOURCE, FIXTURES, loadBitmap, loadSource, type Source } from './sources.ts';
import { CASE_STUDY, STEPS, type Step } from './steps.ts';
import './making.css';

const Stage3D = lazy(() => import('./Stage3D.tsx').then((m) => ({ default: m.Stage3D })));

interface Built {
  stage: StageData;
  debug: DebugLayersEx | null;
  image: ImageBitmap;
  sliceCount: number;
  buildMs: number | null;
  valid: boolean | null;
  ghost: { inputs: InputSample[]; caption: string } | null;
}

type Load =
  | { status: 'loading'; what: string }
  | { status: 'error'; message: string }
  | { status: 'ready'; built: Built };

async function buildCapture(src: Extract<Source, { kind: 'capture' }>, slice: number): Promise<Built> {
  const shot = await loadBitmap(src.screenshotUrl);
  const cap = src.capture;
  const count = Math.max(1, Math.ceil(cap.page.height / 1700));
  const s = sliceRange(cap, Math.min(slice, count - 1));
  const sc = cap.screenshot.scale;
  const image = await createImageBitmap(
    shot,
    0,
    Math.round(s.y * sc),
    Math.round(cap.page.width * sc),
    Math.round(s.height * sc),
  );
  const off = new OffscreenCanvas(shot.width, shot.height);
  const octx = off.getContext('2d') as OffscreenCanvasRenderingContext2D;
  octx.drawImage(shot, 0, 0);
  const data = octx.getImageData(0, 0, shot.width, shot.height).data;
  const worker = new Worker(new URL('./build.worker.ts', import.meta.url), { type: 'module' });
  try {
    const res = await new Promise<BuildResponse>((resolve, reject) => {
      worker.onmessage = (ev: MessageEvent<BuildResponse>) => resolve(ev.data);
      worker.onerror = (ev) => reject(new Error(ev.message || 'builder worker failed'));
      const req: BuildRequest = {
        capture: cap,
        width: shot.width,
        height: shot.height,
        data: data.buffer,
        sliceIndex: s.index,
        seed: 1,
        difficulty: 'normal',
      };
      worker.postMessage(req, [data.buffer]);
    });
    if (res.type === 'error') throw new Error(res.message);
    return {
      stage: res.stage,
      debug: res.debug,
      image,
      sliceCount: count,
      buildMs: res.ms,
      valid: res.debug.validationErrors.length === 0,
      ghost: null,
    };
  } finally {
    worker.terminate();
  }
}

async function buildStageSource(src: Extract<Source, { kind: 'stage' }>): Promise<Built> {
  const image = await loadBitmap(src.textureUrl);
  let ghost: Built['ghost'] = null;
  if (src.replayUrl) {
    const inputs = (await (await fetch(src.replayUrl)).json()) as InputSample[];
    ghost = { inputs, caption: 'Ghost: the reference keyboard run, re-simulated with the game’s physics' };
  } else {
    try {
      const { createRankingClient } = await import('../../ranking/client.ts');
      const top = await createRankingClient().ghost(src.id);
      if (top)
        ghost = {
          inputs: top.inputs,
          caption: `Ghost: ${top.name}’s #1 run (${top.score.toLocaleString('en-US')})`,
        };
    } catch {
      // no leaderboard available: no ghost
    }
  }
  return {
    stage: src.stage,
    debug: null,
    image,
    sliceCount: src.stage.source.slice.count,
    buildMs: null,
    valid: null,
    ghost,
  };
}

function Plan({ built, step }: { built: Built; step: Step }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const draw = useCallback(() => {
    const c = ref.current;
    if (!c) return;
    const { width: W, height: H } = built.stage.size;
    const box = c.parentElement?.getBoundingClientRect();
    const fit = box ? Math.min(box.width / W, box.height / H) : 0.5;
    const k = Math.min(2, Math.max(0.25, fit * (window.devicePixelRatio || 1)));
    c.width = Math.round(W * k);
    c.height = Math.round(H * k);
    c.style.width = `${Math.round(W * fit)}px`;
    c.style.height = `${Math.round(H * fit)}px`;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    drawStage(ctx, built.stage, { image: built.image, debug: built.debug, layers: step.layers });
    c.dataset.ready = '1';
  }, [built, step]);
  useEffect(() => {
    draw();
    const ro = new ResizeObserver(draw);
    if (ref.current?.parentElement) ro.observe(ref.current.parentElement);
    return () => ro.disconnect();
  }, [draw]);
  return (
    <canvas
      ref={ref}
      className="mk-canvas"
      key={step.id}
      role="img"
      aria-label={`${step.title}: ${built.stage.source.title}, drawn as the builder sees it`}
    />
  );
}

export function MakingPage() {
  const { stageId = DEFAULT_SOURCE } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const slice = Math.max(0, Number(params.get('slice') ?? 0) || 0);
  const [load, setLoad] = useState<Load>({ status: 'loading', what: 'Loading the page…' });
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let live = true;
    setLoad({ status: 'loading', what: 'Loading the page…' });
    (async () => {
      const src = await loadSource(stageId);
      if (!live) return;
      if (src.kind === 'capture') setLoad({ status: 'loading', what: 'Building the maze in your browser…' });
      const built = src.kind === 'capture' ? await buildCapture(src, slice) : await buildStageSource(src);
      if (live) setLoad({ status: 'ready', built });
    })().catch(
      (e: unknown) =>
        live && setLoad({ status: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [stageId, slice]);

  const steps = useMemo(
    () => (load.status === 'ready' && !load.built.debug ? STEPS.filter((s) => !s.needsDebug) : STEPS),
    [load],
  );
  const stepIndex = Math.min(steps.length - 1, Math.max(0, Number(params.get('step') ?? 0) || 0));
  const step = steps[stepIndex] ?? STEPS[0];
  const setStep = useCallback(
    (i: number) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          n.set('step', String(Math.max(0, Math.min(steps.length - 1, i))));
          return n;
        },
        { replace: true, preventScrollReset: true },
      ),
    [setParams, steps.length],
  );

  useEffect(() => {
    if (!playing) return;
    if (stepIndex >= steps.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep(stepIndex + 1), 3200);
    return () => clearTimeout(t);
  }, [playing, stepIndex, steps.length, setStep]);

  const built = load.status === 'ready' ? load.built : null;
  const title = built?.stage.source.title ?? FIXTURES.find((f) => f.slug === stageId)?.label ?? stageId;

  // `?card=1`: just the finished 3D stage, full-bleed, for rendering share cards (content/scripts/render-cards.mjs).
  if (params.get('card') === '1')
    return (
      <div className="mk-card">
        {built ? (
          <Suspense fallback={null}>
            <Stage3D stage={built.stage} image={built.image} ghost={null} />
          </Suspense>
        ) : null}
      </div>
    );

  return (
    <ShowcaseFrame>
      <header className="mk-head">
        <h1 className="mk-title">How a page becomes a maze</h1>
        <p className="sc-lede">
          The same builder that makes every stage in the game, running here in your browser, one step at a
          time. Next to each step: how the 2013 original did it, in the words of its developer.
        </p>
        <nav className="mk-picker" aria-label="Choose a page">
          {FIXTURES.map((f) => (
            <Link
              key={f.slug}
              to={`/making/${f.slug}`}
              className="mk-chip"
              aria-current={f.slug === stageId ? 'page' : undefined}
            >
              {f.label}
            </Link>
          ))}
          <Link
            to="/making/handmade-simple"
            className="mk-chip"
            aria-current={stageId === 'handmade-simple' ? 'page' : undefined}
          >
            Hand-made test stage
          </Link>
        </nav>
      </header>

      <section className="mk-stage" aria-label={`${title}, step ${stepIndex + 1} of ${steps.length}`}>
        <div className="mk-view" data-step={step?.id}>
          {load.status === 'loading' ? (
            <p className="mk-view__msg" role="status">
              {load.what}
            </p>
          ) : load.status === 'error' ? (
            <div className="mk-view__msg" role="alert">
              <p>{load.message}</p>
              <button
                type="button"
                className="mk-btn mk-btn--light"
                onClick={() => navigate(`/making/${DEFAULT_SOURCE}`)}
              >
                Show the GOV.UK example
              </button>
            </div>
          ) : built && step?.threeD ? (
            <Suspense fallback={<p className="mk-view__msg">Starting the renderer…</p>}>
              <Stage3D stage={built.stage} image={built.image} ghost={built.ghost} />
            </Suspense>
          ) : built && step ? (
            <Plan built={built} step={step} />
          ) : null}
        </div>

        <aside className="mk-side">
          <ol className="mk-steps">
            {steps.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => {
                    setPlaying(false);
                    setStep(i);
                  }}
                  aria-current={i === stepIndex ? 'step' : undefined}
                >
                  <span className="sc-mono">{i + 1}</span>
                  {s.title}
                </button>
              </li>
            ))}
          </ol>
          {step ? (
            <div className="mk-caption" aria-live="polite">
              <h2 className="mk-caption__title">{step.title}</h2>
              <p>{step.now}</p>
              <figure className="mk-quote">
                <blockquote cite={CASE_STUDY}>
                  <p>“{step.quote}”</p>
                </blockquote>
                <figcaption>
                  Saqoosha, 2013, on the original:{' '}
                  <a href={CASE_STUDY} rel="noreferrer">
                    {step.quoteSection}
                  </a>
                </figcaption>
              </figure>
            </div>
          ) : null}
        </aside>

        <div className="mk-controls">
          <button
            type="button"
            className="mk-btn"
            onClick={() => {
              if (stepIndex >= steps.length - 1) setStep(0);
              setPlaying((p) => !p);
            }}
            aria-pressed={playing}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              {playing ? (
                <path d="M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z" fill="currentColor" />
              ) : (
                <path d="M5 3l8 5-8 5z" fill="currentColor" />
              )}
            </svg>
            {playing ? 'Pause' : stepIndex >= steps.length - 1 ? 'Replay' : 'Play through'}
          </button>
          <label className="mk-scrub">
            <span className="mk-sr">Step</span>
            <input
              type="range"
              min={0}
              max={steps.length - 1}
              step={1}
              value={stepIndex}
              onChange={(e) => {
                setPlaying(false);
                setStep(Number(e.target.value));
              }}
              aria-valuetext={`Step ${stepIndex + 1} of ${steps.length}: ${step?.title ?? ''}`}
              style={{ ['--p' as string]: `${(stepIndex / Math.max(1, steps.length - 1)) * 100}%` }}
            />
          </label>
          <span className="mk-count sc-mono" aria-hidden="true">
            {stepIndex + 1}/{steps.length}
          </span>
        </div>

        <p className="mk-meta">
          {built ? (
            <>
              <span>
                <strong>{title}</strong>
                {built.sliceCount > 1
                  ? ` · part ${Math.min(slice, built.sliceCount - 1) + 1} of ${built.sliceCount}`
                  : ''}
              </span>
              <span className="sc-mono">
                {built.stage.islands.length} islands · {built.stage.bridges.length} bridges
                {built.stage.elevators.length ? ` · ${built.stage.elevators.length} lifts` : ''} ·{' '}
                {built.stage.items.length} items
                {built.buildMs !== null ? ` · built in ${Math.round(built.buildMs)} ms` : ''}
                {built.valid === true
                  ? ' · passes validation'
                  : built.valid === false
                    ? ' · fails validation'
                    : ''}
              </span>
              {built.sliceCount > 1 ? (
                <span className="mk-slices">
                  {[...Array(built.sliceCount).keys()].map((i) => (
                    <Link
                      key={i}
                      to={`/making/${stageId}?slice=${i}&step=${stepIndex}`}
                      aria-current={i === Math.min(slice, built.sliceCount - 1) ? 'page' : undefined}
                    >
                      Part {i + 1}
                    </Link>
                  ))}
                </span>
              ) : null}
            </>
          ) : (
            ' '
          )}
        </p>
      </section>

      <section className="sc-section sc-prose">
        <h2 className="sc-h2">What’s different, and why</h2>
        <p>
          The 2013 builder was a C++ program using OpenCV and Boost, running on a server in the US. Ours is
          TypeScript, so the same code runs on the server and, as here, in your browser. Bridges still run
          only up, down, left and right, and the maze is still a tree carved by a random walk, because that is
          what the surviving 2013 stage data shows.
        </p>
        <p>
          How the original chose each island’s height isn’t documented anywhere we could find, so ours is a
          reconstruction: a gentle descent from the top of the page to the bottom, as in the one surviving
          2013 stage, plus some noise. Ramps are never steeper than 10°, like the 2013 ones; bigger rises get
          a lift. The <Link to="/about#fidelity">fidelity table</Link> lists every choice like this.
        </p>
      </section>
    </ShowcaseFrame>
  );
}

export default MakingPage;
