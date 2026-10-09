/**
 * The game shell: one full-viewport canvas (the engine) with HTML/CSS screens layered over it, like the
 * 2013 original. Routes: `/` (title), `/play/:stageId` (deep link), `/p/:code` (host joins an existing room).
 */
import '@fontsource-variable/unbounded';
import '@fontsource-variable/figtree';
import './game.css';
import type { i18n } from 'i18next';
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { I18nextProvider } from 'react-i18next';
import { AudioManager } from '../audio/audio.ts';
import { Game, type GameTestHooks, type GameView } from '../game/game.ts';
import { GameBoards } from '../game/leaderboard.ts';
import { titleMotion } from '../game/render-cadence.ts';
import type { RunSource } from '../game/stages.ts';
import { createI18n } from '../i18n/index.ts';
import { learnParam } from '../learning/LearningPanel.tsx';
import { lessonFromBaseline } from '../learning/load.ts';
import { readChallenge } from '../ranking/share.ts';
import { observeGame } from '../telemetry/observe-game.ts';
import { Screens } from './Screens.tsx';

const GameCtx = createContext<Game | null>(null);

export function useGame(): Game {
  const g = useContext(GameCtx);
  if (!g) throw new Error('useGame outside <GameApp>');
  return g;
}

export function useView(): GameView {
  const g = useGame();
  return useSyncExternalStore(g.subscribe, g.getView, g.getView);
}

declare global {
  interface Window {
    /** e2e / automation: set before load to inject a replay, force lockstep, speed up time. */
    __WWM_TEST__?: GameTestHooks;
    __wwmGame?: Game;
  }
}

export interface GameAppProps {
  deepLink?: string;
  roomCode?: string;
  /** Phase 14 `/play/local`: a run built from a capture made in this browser. */
  localRun?: RunSource;
  homeTitle?: boolean;
  homeAudio?: AudioManager;
  homeI18n?: i18n;
  startIntent?: () => boolean;
  onGame?: (game: Game | null) => void;
}

export function GameApp({
  deepLink,
  roomCode,
  localRun,
  homeTitle,
  homeAudio,
  homeI18n,
  startIntent,
  onGame,
}: GameAppProps) {
  const host = useRef<HTMLDivElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [i18n] = useState<i18n>(() => homeI18n ?? createI18n());

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    document.documentElement.lang = i18n.language;
    document.body.classList.add('wwm-body');
    const params = new URLSearchParams(location.search);
    const test = window.__WWM_TEST__;
    const g = new Game({
      origin: '',
      audio: homeAudio ?? new AudioManager(),
      disposeAudio: !homeAudio,
      startIntent,
      // `?offline=1`: preservation mode, scores stay on this device (no server calls for boards or ghosts).
      boards: new GameBoards(
        params.has('offline') ? { fetch: () => Promise.reject(new Error('offline')) } : {},
      ),
      physics: params.get('physics') === 'worker' ? 'worker' : 'lockstep',
      challenge: deepLink ? readChallenge(params) : null,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      forceWebGL: params.get('backend') === 'webgl',
      deepLink,
      roomCode,
      localRun,
      test,
      titleMotion: import.meta.env.VITE_PREVIEW_COMMIT ? titleMotion(params.get('titleMotion')) : 'cached',
      onPhase: (phase) => {
        document.body.dataset.phase = phase;
      },
    });
    window.__wwmGame = g;
    onGame?.(g);
    // Phase 20 M4b: `?learn=<activityId>` plays that lesson of the built-in path through Pip gates
    g.learning.label = (n) => i18n.t('learning.gate.label', { n });
    // Phase 22: mission posts and lock cards in the maze
    g.learning.labels = {
      ...g.learning.labels,
      post: (s, count) =>
        s.mission.kind === 'collect'
          ? i18n.t('learning.maze.post', { count })
          : typeof s.mission.island === 'object'
            ? i18n.t('learning.maze.postLetter', { letter: s.mission.island.letter })
            : i18n.t(
                s.mission.island === 'most-gems' ? 'learning.maze.postMost' : 'learning.maze.postFewest',
              ),
      lock: (owner) =>
        !owner
          ? i18n.t('learning.maze.lockFinish')
          : owner.step.kind === 'round'
            ? i18n.t('learning.gate.label', { n: owner.number })
            : owner.step.mission.kind === 'collect'
              ? i18n.t('learning.maze.lockGems', { count: owner.step.mission.count })
              : i18n.t('learning.maze.lockMission'),
    };
    const learn = learnParam();
    if (learn) {
      try {
        g.learning.use(lessonFromBaseline(learn));
      } catch (err) {
        g.learning.fail(err);
      }
    }
    setGame(g);
    let alive = true;
    let stopFunnel = () => {};
    // StrictMode discards its first mount synchronously. Observe only the surviving instance.
    queueMicrotask(() => {
      if (alive) stopFunnel = observeGame(g);
    });
    void g.mount(el);
    return () => {
      alive = false;
      stopFunnel();
      g.dispose();
      onGame?.(null);
      if (window.__wwmGame === g) window.__wwmGame = undefined;
      document.body.classList.remove('wwm-body');
      setGame(null);
    };
  }, [deepLink, roomCode, localRun, i18n, homeAudio, startIntent, onGame]);

  return (
    <I18nextProvider i18n={i18n}>
      <div className="wwm-root" data-testid="game-root">
        <div ref={host} className="wwm-stage-host" />
        {game && (
          <GameCtx.Provider value={game}>
            <Screens homeTitle={homeTitle} />
          </GameCtx.Provider>
        )}
      </div>
    </I18nextProvider>
  );
}

export { GameMotionOptions } from './Settings.tsx';
