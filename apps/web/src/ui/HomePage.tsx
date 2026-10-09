/** Interactive title; the engine, builder and gameplay module graph load after its first paint. */
import '@fontsource-variable/unbounded';
import '@fontsource-variable/figtree';
import './game.css';
import type { QualitySetting } from '@wwm/engine';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { I18nextProvider } from 'react-i18next';
import { AudioManager } from '../audio/audio.ts';
import type { Game } from '../game/game.ts';
import { createI18n } from '../i18n/index.ts';
import { readGraphics, saveGraphics } from './graphics-preference.ts';
import { MenuBar } from './MenuBar.tsx';
import { TitleLanding } from './TitleLanding.tsx';

type Runtime = typeof import('./GameApp.tsx');
const noSubscribe = () => () => {};
const noView = () => null;
function saved(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage can be disabled. */
  }
}

export function HomePage() {
  const [i18n] = useState(() => createI18n());
  const [audio] = useState(() => new AudioManager());
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState(false);
  const intent = useRef(false);
  const previousPhase = useRef('title');
  const loading = useRef<Promise<void> | null>(null);
  const alive = useRef(false);
  const lifetime = useRef(0);
  const view = useSyncExternalStore(game?.subscribe ?? noSubscribe, game?.getView ?? noView, noView);
  const [graphics, setGraphics] = useState<QualitySetting>(() => {
    try {
      return readGraphics(localStorage);
    } catch {
      return 'auto';
    }
  });
  const [pixelLook, setPixelLook] = useState(() => saved('wwm.pixelLook', '0') === '1');
  const [sensitivity, setSensitivity] = useState(() => {
    const value = Number(saved('wwm.sensitivity', '1'));
    return Number.isFinite(value) && value >= 0.5 && value <= 1.5 ? value : 1;
  });
  const [muted, setMuted] = useState(audio.muted);
  const startIntent = useCallback(() => intent.current, []);
  const load = useCallback(() => {
    if (loading.current) return loading.current;
    setError(false);
    loading.current = import('./GameApp.tsx')
      .then((module) => {
        if (alive.current) setRuntime(module);
      })
      .catch(() => {
        loading.current = null;
        if (alive.current) {
          setError(true);
          setPreparing(false);
        }
      });
    return loading.current;
  }, []);

  useEffect(() => {
    alive.current = true;
    const generation = ++lifetime.current;
    document.documentElement.lang = i18n.language;
    document.body.classList.add('wwm-body');
    const stop = audio.onChange(() => setMuted(audio.muted));
    // Give the title and fonts two paint opportunities before warming the larger runtime.
    let secondFrame = 0;
    let timer = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        timer = window.setTimeout(() => {
          void load();
        }, 800);
      });
    });
    return () => {
      alive.current = false;
      stop();
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      clearTimeout(timer);
      document.body.classList.remove('wwm-body');
      // React's StrictMode immediately sets up the same owner again. Dispose only on a real exit.
      queueMicrotask(() => {
        if (lifetime.current === generation && !alive.current) audio.dispose();
      });
    };
  }, [audio, i18n, load]);

  const start = () => {
    if (intent.current) return;
    intent.current = true;
    if (game?.getView().engineReady) game.start();
    else {
      audio.unlock(); // Synchronous in this gesture, before any import/await.
      setPreparing(true);
      void load();
    }
    // Start is explicit play intent. Fetch/compile physics in parallel with the deferred game,
    // after the preparing state has had a paint opportunity. Worker mode owns another realm.
    if (
      new URLSearchParams(location.search).get('physics') !== 'worker' &&
      !window.__WWM_TEST__?.forceWorker
    ) {
      requestAnimationFrame(() => {
        if (alive.current)
          window.setTimeout(() => {
            if (alive.current)
              void import('@wwm/physics').then((module) => module.loadRapier()).catch(() => {});
          }, 0);
      });
    }
  };
  const onGraphics = (setting: QualitySetting) => {
    setGraphics(setting);
    try {
      saveGraphics(localStorage, setting);
    } catch {
      /* Storage can be disabled. */
    }
    game?.setGraphics(setting);
  };
  // Reset the one-shot intent when an existing game returns home, without replaying Start.
  useEffect(() => {
    if (view?.phase === 'title' && previousPhase.current !== 'title') {
      intent.current = false;
      setPreparing(false);
    }
    previousPhase.current = view?.phase ?? 'title';
  }, [view?.phase]);
  const GameApp = runtime?.GameApp;
  const MotionOptions = runtime?.GameMotionOptions;
  const title = !view || (view.phase === 'title' && !view.unsupported);
  return (
    <I18nextProvider i18n={i18n}>
      {GameApp && (
        <GameApp homeTitle homeAudio={audio} homeI18n={i18n} startIntent={startIntent} onGame={setGame} />
      )}
      {title && (
        <div className="wwm-root" data-testid="home-shell">
          {!view?.engineReady && (
            <div className="wwm-home-backdrop" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </div>
          )}
          <main className="wwm-screen wwm-screen--title" data-screen="title">
            <TitleLanding
              onStart={start}
              disabled={preparing}
              preparing={preparing}
              error={error}
              onRetry={() => location.reload()}
            />
          </main>
          <MenuBar
            muted={muted}
            onMuted={(on) => audio.setMuted(on)}
            graphics={view?.graphics ?? graphics}
            onGraphics={onGraphics}
            pixelLook={view?.pixelLook ?? pixelLook}
            onPixelLook={(on) => {
              setPixelLook(on);
              save('wwm.pixelLook', on ? '1' : '0');
              game?.setPixelLook(on);
            }}
            sensitivity={view?.sensitivity ?? sensitivity}
            onSensitivity={(value) => {
              setSensitivity(value);
              save('wwm.sensitivity', String(value));
              game?.setSensitivity(value);
            }}
            motionOptions={
              MotionOptions && game && view && game.motion
                ? (close) => <MotionOptions game={game} view={view} close={close} />
                : undefined
            }
          />
        </div>
      )}
    </I18nextProvider>
  );
}
