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
import { LocalLeaderboard } from '../game/leaderboard.ts';
import { createI18n } from '../i18n/index.ts';
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
}

export function GameApp({ deepLink, roomCode }: GameAppProps) {
  const host = useRef<HTMLDivElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [i18n] = useState<i18n>(() => createI18n());

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    document.documentElement.lang = i18n.language;
    document.body.classList.add('wwm-body');
    const params = new URLSearchParams(location.search);
    const test = window.__WWM_TEST__;
    const g = new Game({
      origin: '',
      audio: new AudioManager(),
      leaderboard: new LocalLeaderboard(),
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      forceWebGL: params.get('backend') === 'webgl',
      deepLink,
      roomCode,
      test,
      onPhase: (phase) => {
        document.body.dataset.phase = phase;
      },
    });
    window.__wwmGame = g;
    setGame(g);
    void g.mount(el);
    return () => {
      g.dispose();
      if (window.__wwmGame === g) window.__wwmGame = undefined;
      document.body.classList.remove('wwm-body');
      setGame(null);
    };
  }, [deepLink, roomCode, i18n]);

  return (
    <I18nextProvider i18n={i18n}>
      <div className="wwm-root" data-testid="game-root">
        <div ref={host} className="wwm-stage-host" />
        {game && (
          <GameCtx.Provider value={game}>
            <Screens />
          </GameCtx.Provider>
        )}
      </div>
    </I18nextProvider>
  );
}
