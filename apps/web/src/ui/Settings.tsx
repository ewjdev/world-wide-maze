import type { Game, GameView } from '../game/game.ts';
/** Game actions supplied to the shared menu controls. */
import { MotionOptions } from '../input/TiltControls.tsx';
import { useGame, useView } from './GameApp.tsx';
import { MenuBar } from './MenuBar.tsx';

export function TopBar() {
  const g = useGame();
  const v = useView();
  return (
    <MenuBar
      muted={v.muted}
      onMuted={(on) => g.setMuted(on)}
      graphics={v.graphics}
      onGraphics={(q) => g.setGraphics(q)}
      sensitivity={v.sensitivity}
      onSensitivity={(value) => g.setSensitivity(value)}
      pixelLook={v.pixelLook}
      onPixelLook={(on) => g.setPixelLook(on)}
      motionOptions={g.motion ? (close) => <GameMotionOptions game={g} view={v} close={close} /> : undefined}
    />
  );
}

export function GameMotionOptions({
  game: g,
  view: v,
  close,
}: {
  game: Game;
  view: GameView;
  close: () => void;
}) {
  if (!g.motion) return null;
  return (
    <MotionOptions
      mode={v.inputMode}
      session={g.motion}
      onTilt={() => {
        g.playTilt();
        close();
      }}
      onJoystick={() => g.playJoystick()}
      onKeyboard={() => g.playKeyboard()}
      onRecenter={() => {
        g.recenterTilt();
        close();
      }}
      onPreferences={() => g.refreshControls()}
    />
  );
}
