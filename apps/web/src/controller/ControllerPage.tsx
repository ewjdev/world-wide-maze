/**
 * `/c/:code`: the phone controller (Phase 06). Full-screen and portrait: MENU at the top, a live tilt
 * indicator, and JUMP (left thumb) + a big POWER hold button (right thumb) at the bottom.
 *
 * Pairing secret (contracts v0.2.7): the QR link is `/c/<code>#p=<pairToken>`. The token is read from the
 * fragment, remembered in sessionStorage (reloads and reconnects keep it) and removed from the address bar.
 * A typed code (`/c/<code>` with no token) still works while no other phone is connected.
 */
import { isRoomCode, resolvePairToken } from '@wwm/net';
import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { useNavigate, useParams } from 'react-router';
import { browserEnv } from './browser-env.ts';
import { type ButtonName, ControllerSession, type ControllerView } from './session.ts';
import { strings } from './strings.ts';
import { TiltIndicator } from './TiltIndicator.tsx';
import './controller.css';

const noopSubscribe = () => () => {};

function initialView(code: string): ControllerView {
  return {
    code,
    screen: 'connecting',
    connection: 'idle',
    hostConnected: false,
    rttP50: null,
    rttP95: null,
    tilt: { tiltX: 0, tiltZ: 0 },
    dot: { x: 0, z: 0, r: 0 },
    tooTilted: false,
    calibration: { progress: 0, remainingMs: 15000 },
    buttons: { power: false, jump: false, menu: false },
    host: null,
    landscape: false,
    sendRate: 0,
    sensorRate: 0,
    permission: 'unknown',
    lastHaptic: null,
  };
}

export function ControllerPage() {
  const { code = '' } = useParams();
  if (!isRoomCode(code)) return <CodeEntry message={strings().notFound} />;
  return <ControllerForCode key={code} code={code} />;
}

function ControllerForCode({ code }: { code: string }) {
  const t = strings();
  const [session, setSession] = useState<ControllerSession | null>(null);
  const fallback = useMemo(() => initialView(code), [code]);
  useEffect(() => {
    const env = browserEnv();
    const pairToken = resolvePairToken(code, location.hash, env.storage);
    // Keep the secret out of the address bar (screenshots, shared links, history).
    if (location.hash) history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    const s = new ControllerSession(code, { ...env, pairToken });
    s.start();
    setSession(s);
    (window as unknown as { __wwmController?: ControllerSession }).__wwmController = s;
    return () => s.dispose();
  }, [code]);
  const view = useSyncExternalStore(
    session?.subscribe ?? noopSubscribe,
    session?.getView ?? (() => fallback),
    () => fallback,
  );
  const debug = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');

  return (
    <div className="wwmc" data-screen={view.screen} data-testid="controller">
      <header className="wwmc-top">
        <HoldButton name="menu" label={t.menu} session={session} view={view} className="wwmc-menu" />
        <Status view={view} />
      </header>
      {view.host && <HostHud view={view} />}
      <main className="wwmc-main">
        <Body view={view} session={session} />
      </main>
      {view.screen === 'play' && (
        <footer className="wwmc-bottom">
          <HoldButton name="jump" label={t.jump} session={session} view={view} className="wwmc-jump" />
          <HoldButton name="power" label={t.power} session={session} view={view} className="wwmc-power" />
        </footer>
      )}
      {view.landscape && <div className="wwmc-banner">{t.lockPortrait}</div>}
      {debug && session && <DebugPanel session={session} view={view} />}
    </div>
  );
}

function Status({ view }: { view: ControllerView }) {
  const t = strings();
  const open = view.connection === 'open';
  const label = open
    ? view.hostConnected
      ? view.rttP50 != null
        ? `${Math.round(view.rttP50)} ms`
        : 'OK'
      : '—'
    : view.connection === 'reconnecting'
      ? t.reconnecting
      : view.connection === 'closed'
        ? '—' // terminal screens (not found / replaced / refused) explain themselves
        : t.connecting;
  return (
    <div
      className="wwmc-status"
      data-testid="status"
      data-connection={view.connection}
      data-host={view.hostConnected}
    >
      <span className={`wwmc-dot ${open && view.hostConnected ? 'ok' : open ? 'half' : 'off'}`} />
      <span>
        {t.roomCode} {view.code}
      </span>
      <span className="wwmc-rtt">{label}</span>
    </div>
  );
}

function HostHud({ view }: { view: ControllerView }) {
  const t = strings();
  const h = view.host;
  if (!h) return null;
  return (
    <div className="wwmc-hud" data-testid="host-hud">
      <span>
        {t.time} <b>{Math.max(0, Math.ceil(h.timeLeft))}</b>
      </span>
      <span>
        {t.score} <b>{h.score}</b>
      </span>
      <span>
        {t.balls} <b>{h.balls}</b>
      </span>
    </div>
  );
}

function Body({ view, session }: { view: ControllerView; session: ControllerSession | null }) {
  const t = strings();
  switch (view.screen) {
    case 'connecting':
      return <p className="wwmc-msg">{t.connecting}</p>;
    case 'not-found':
      return <CodeEntry message={t.notFound} />;
    case 'replaced':
      return (
        <div className="wwmc-card">
          <p>{t.replaced}</p>
          <button type="button" className="wwmc-cta" onClick={() => location.reload()}>
            {t.takeOver}
          </button>
        </div>
      );
    case 'unauthorized':
      return (
        <div className="wwmc-card" data-testid="unauthorized">
          <p>{t.unauthorized}</p>
          <button type="button" className="wwmc-cta" onClick={() => location.reload()}>
            {t.retry}
          </button>
        </div>
      );
    case 'enable':
    case 'requesting':
      return (
        <div className="wwmc-card">
          <h1>{t.enableTitle}</h1>
          <button
            type="button"
            className="wwmc-cta"
            data-testid="enable-tilt"
            disabled={view.screen === 'requesting'}
            onClick={() => session?.enableTilt()}
          >
            {t.enableTilt}
          </button>
          <p className="wwmc-hint">{t.enableHint}</p>
          <p className="wwmc-hint">{t.lockPortrait}</p>
        </div>
      );
    case 'denied':
    case 'no-sensor':
      return (
        <div className="wwmc-card" data-testid="fallback">
          <p>{view.screen === 'denied' ? t.denied : t.noSensor}</p>
          <button type="button" className="wwmc-cta" onClick={() => session?.enableTilt()}>
            {t.retry}
          </button>
        </div>
      );
    case 'calibrate':
      return (
        <div className="wwmc-card">
          <h1>{t.calibrateTitle}</h1>
          <TiltIndicator x={view.dot.x} z={view.dot.z} progress={view.calibration.progress} />
          <p className="wwmc-hint">{t.calibrateHint}</p>
          <p className="wwmc-count" data-testid="calibration-remaining">
            {Math.ceil(view.calibration.remainingMs / 1000)}
          </p>
          <button type="button" className="wwmc-secondary" onClick={() => session?.calibrateHere()}>
            {t.useThisPosition}
          </button>
        </div>
      );
    case 'calibration-failed':
      return (
        <div className="wwmc-card" data-testid="calibration-failed">
          <p>{t.calibrationFailed}</p>
          <p>{t.keyboardFallback}</p>
          <button type="button" className="wwmc-cta" onClick={() => session?.retryCalibration()}>
            {t.retry}
          </button>
        </div>
      );
    case 'play':
      return (
        <div className="wwmc-play">
          {!view.hostConnected && (
            <p className="wwmc-overlay" data-testid="host-waiting">
              {view.connection === 'open' ? t.waitingHost : t.reconnecting}
            </p>
          )}
          <TiltIndicator x={view.dot.x} z={view.dot.z} warn={view.tooTilted} />
          <p className={`wwmc-warn ${view.tooTilted ? 'on' : ''}`} aria-live="polite">
            {view.tooTilted ? t.tooTilted : ' '}
          </p>
          <p className="wwmc-hint">{t.powerHint}</p>
          <button type="button" className="wwmc-link" onClick={() => session?.retryCalibration()}>
            {t.recalibrate}
          </button>
        </div>
      );
  }
}

function HoldButton({
  name,
  label,
  session,
  view,
  className,
}: {
  name: ButtonName;
  label: string;
  session: ControllerSession | null;
  view: ControllerView;
  className: string;
}) {
  const set = (pressed: boolean) => session?.setButton(name, pressed);
  const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    set(true);
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId); // keep the press if the thumb slides off
    } catch {
      // synthetic or already-released pointer
    }
  };
  const up = () => set(false);
  return (
    <button
      type="button"
      className={`wwmc-btn ${className} ${view.buttons[name] ? 'pressed' : ''}`}
      data-testid={`btn-${name}`}
      disabled={view.screen !== 'play'}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );
}

function CodeEntry({ message }: { message: string }) {
  const t = strings();
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (isRoomCode(value)) navigate(`/c/${value}`);
  };
  return (
    <div className="wwmc wwmc-entry" data-testid="code-entry">
      <form className="wwmc-card" onSubmit={submit}>
        <p>{message}</p>
        <input
          className="wwmc-code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          placeholder={t.enterCode}
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        <button type="submit" className="wwmc-cta" disabled={!isRoomCode(value)}>
          {t.go}
        </button>
      </form>
    </div>
  );
}

function DebugPanel({ session, view }: { session: ControllerSession; view: ControllerView }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  const d = session.diag();
  return (
    <pre className="wwmc-debug" data-testid="debug">
      {JSON.stringify({ ...d, sendRate: view.sendRate, sensorRate: view.sensorRate }, null, 1)}
    </pre>
  );
}
