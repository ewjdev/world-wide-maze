/**
 * Phase 14 `/play/local` (contracts §10.2): receives a capture made in the player's browser and plays it.
 *
 * waiting → (a trusted `wwm:capture`) → checking → playing (the normal game shell with a `LocalRun`)
 *                                               ↘ rejected
 * While playing, a small plate says where the maze came from and offers Share, the only thing that uploads.
 */
import '@fontsource-variable/unbounded';
import '@fontsource-variable/figtree';
import '../ui/game.css';
import './local.css';
import { normalizeUrl } from '@wwm/capture-script';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { GameApp } from '../ui/GameApp.tsx';
import { Icon } from '../ui/parts.tsx';
import { LocalRun } from './local-run.ts';
import {
  isCaptureMessage,
  isTrustedSource,
  type LocalCapture,
  LocalCaptureError,
  MSG,
  validateCaptureMessage,
} from './protocol.ts';
import { ShareError, shareCapture } from './share.ts';
import { renderSketch, sketchBundle } from './sketch.ts';
import { type LocalStrings, localStrings } from './strings.ts';

type State =
  | { phase: 'waiting'; slow: boolean }
  | { phase: 'checking' }
  | { phase: 'rejected'; message: string }
  | { phase: 'playing'; run: LocalRun };

/** Test / automation view of the receiver (e2e reads it; nothing else depends on it). */
export interface LocalDebug {
  phase: State['phase'];
  via: LocalCapture['via'] | null;
  rejected: number;
  ignored: number;
  sharedUrl: string | null;
}

declare global {
  interface Window {
    __wwmLocal?: LocalDebug;
  }
}

const SLOW_MS = 8000;
const READY_EVERY_MS = 500;
/** The in-game phases where the origin plate is shown. */
const PLATE_PHASES = new Set([
  'building',
  'intro',
  'countdown',
  'play',
  'paused',
  'falling',
  'restarting',
  'result',
]);

async function decode(cap: LocalCapture): Promise<{ capture: LocalCapture; source: ImageBitmap }> {
  if (!cap.image) {
    // Sketch mode: the bookmarklet sent the DOM only.
    const bundle = sketchBundle(cap.bundle);
    return { capture: { ...cap, bundle }, source: await renderSketch(bundle) };
  }
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(new Blob([cap.image.bytes], { type: cap.image.mime }));
  } catch {
    throw new LocalCaptureError('image', 'the screenshot could not be decoded');
  }
  const s = cap.bundle.screenshot;
  if (Math.abs(bmp.width - s.width) > 2 || Math.abs(bmp.height - s.height) > 2) {
    bmp.close();
    throw new LocalCaptureError(
      'image',
      `the screenshot is ${bmp.width}×${bmp.height}, not ${s.width}×${s.height}`,
    );
  }
  return { capture: cap, source: bmp };
}

export default function LocalPlayPage() {
  const [state, setState] = useState<State>({ phase: 'waiting', slow: false });
  const s = localStrings();
  const debug = useRef<LocalDebug>({ phase: 'waiting', via: null, rejected: 0, ignored: 0, sharedUrl: null });

  useEffect(() => {
    debug.current.phase = state.phase;
    window.__wwmLocal = debug.current;
    document.body.dataset.local = state.phase;
  }, [state.phase]);

  // Receive exactly one capture from a trusted sender.
  useEffect(() => {
    let taken = false;
    let run: LocalRun | null = null;
    const self = { window, opener: window.opener as unknown, origin: location.origin };
    const reply = (target: MessageEventSource | null, origin: string, msg: object) => {
      try {
        (target as Window | null)?.postMessage(msg, origin === 'null' ? '*' : origin);
      } catch {
        // the sender went away
      }
    };
    const onMessage = async (e: MessageEvent) => {
      if (!isCaptureMessage(e.data)) return;
      const via = isTrustedSource(e, self);
      if (!via) {
        debug.current.ignored++;
        return;
      }
      if (taken) return;
      taken = true;
      setState({ phase: 'checking' });
      try {
        const cap = await validateCaptureMessage(e.data, via, normalizeUrl);
        const { capture, source } = await decode(cap);
        debug.current.via = via;
        run = new LocalRun(capture, source);
        reply(e.source, e.origin, { type: MSG.ack });
        setState({ phase: 'playing', run });
      } catch (err) {
        debug.current.rejected++;
        const message = err instanceof Error ? err.message : String(err);
        reply(e.source, e.origin, { type: MSG.reject, reason: message });
        setState({ phase: 'rejected', message });
      }
    };
    addEventListener('message', onMessage);
    // Announce readiness until a capture arrives: to this page (the extension's content script listens here)
    // and to the opener (the bookmarklet). `wwm:ready` carries nothing.
    const ready = () => {
      if (taken) return;
      window.postMessage({ type: MSG.ready }, location.origin);
      if (window.opener) reply(window.opener as Window, '*', { type: MSG.ready });
    };
    ready();
    const iv = setInterval(ready, READY_EVERY_MS);
    const slow = setTimeout(
      () => setState((st) => (st.phase === 'waiting' ? { ...st, slow: true } : st)),
      SLOW_MS,
    );
    return () => {
      removeEventListener('message', onMessage);
      clearInterval(iv);
      clearTimeout(slow);
      run?.dispose();
    };
  }, []);

  if (state.phase === 'playing')
    return (
      <>
        <GameApp localRun={state.run} />
        <OriginPlate run={state.run} s={s} debug={debug.current} />
      </>
    );
  return (
    <main className="wwm-local" data-testid="local-receiver" data-phase={state.phase}>
      <div className="wwm-local__facets" aria-hidden="true" />
      {state.phase === 'rejected' ? (
        <section className="wwm-local__panel" aria-labelledby="local-h" role="alert">
          <h1 id="local-h" className="wwm-h1">
            {s.rejectedTitle}
          </h1>
          <p className="wwm-local__lead">{s.rejectedBody}</p>
          <p className="wwm-local__detail" data-testid="local-reject-reason">
            {state.message}
          </p>
          <div className="wwm-row">
            <Link className="wwm-btn wwm-btn--secondary" to="/">
              {s.tryAnother}
            </Link>
            <Link className="wwm-btn wwm-btn--ghost" to="/mazify">
              {s.getTools}
            </Link>
          </div>
        </section>
      ) : (
        <section className="wwm-local__panel" aria-labelledby="local-h" aria-live="polite">
          <Receiving />
          <h1 id="local-h" className="wwm-h1">
            {state.phase === 'checking' ? s.checking : s.waitingTitle}
          </h1>
          {state.phase === 'waiting' && <p className="wwm-local__lead">{s.waitingBody}</p>}
          {state.phase === 'waiting' && state.slow && (
            <div className="wwm-local__help" data-testid="local-slow">
              <p>
                <strong>{s.waitingSlow}</strong> {s.waitingHelp}
              </p>
              <div className="wwm-row">
                <Link className="wwm-btn wwm-btn--secondary wwm-btn--small" to="/mazify">
                  {s.getTools} <Icon name="arrow" size={18} />
                </Link>
                <Link className="wwm-btn wwm-btn--ghost wwm-btn--small" to="/">
                  {s.backToGame}
                </Link>
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

/** A page folding into four islands in the 2013 colour roles: the "a capture is on its way" mark. */
function Receiving() {
  return (
    <div className="wwm-local__mark" aria-hidden="true">
      <span className="wwm-local__sheet">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="wwm-local__isles">
        <i className="is-red" />
        <i className="is-green" />
        <i className="is-blue" />
        <i className="is-yellow" />
      </span>
    </div>
  );
}

/** Where this maze came from, and Share. */
function OriginPlate({ run, s, debug }: { run: LocalRun; s: LocalStrings; debug: LocalDebug }) {
  const [phase, setPhase] = useState(document.body.dataset.phase ?? '');
  const [share, setShare] = useState<
    { st: 'idle' } | { st: 'busy' } | { st: 'done'; url: string } | { st: 'error'; message: string }
  >({ st: 'idle' });
  const [copied, setCopied] = useState(false);
  const sketch = !run.capture.image;
  const host = new URL(run.url).hostname;

  useEffect(() => {
    const mo = new MutationObserver(() => setPhase(document.body.dataset.phase ?? ''));
    mo.observe(document.body, { attributes: true, attributeFilter: ['data-phase'] });
    return () => mo.disconnect();
  }, []);

  const doShare = async () => {
    setShare({ st: 'busy' });
    try {
      const r = await shareCapture(run.capture.bundle, run.source);
      const url = `${location.origin}/play/${r.stageIds[0]}`;
      debug.sharedUrl = url;
      setShare({ st: 'done', url });
    } catch (e) {
      const code = e instanceof ShareError ? e.code : 'NETWORK';
      const message =
        code === 'RATE_LIMITED'
          ? s.shareRateLimited
          : code === 'URL_FORBIDDEN'
            ? s.shareForbidden
            : s.shareGeneric;
      setShare({ st: 'error', message });
    }
  };
  const copy = async () => {
    if (share.st !== 'done') return;
    try {
      await navigator.clipboard.writeText(share.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard blocked: the link is selectable
    }
  };

  if (!PLATE_PHASES.has(phase) && share.st !== 'done') return null;
  return (
    <aside
      className="wwm-origin"
      data-testid="local-origin"
      data-sketch={sketch || undefined}
      aria-label={s.chipLocal}
    >
      <div className="wwm-origin__head">
        <span className={`wwm-origin__tag${sketch ? ' is-sketch' : ''}`}>
          {sketch ? s.chipSketch : s.chipLocal}
        </span>
        <span className="wwm-origin__host" title={run.url}>
          {host}
        </span>
      </div>
      {sketch ? (
        <p className="wwm-origin__note">{s.sketchNote}</p>
      ) : (
        share.st !== 'done' && <p className="wwm-origin__note">{s.privateNote}</p>
      )}
      {share.st === 'done' ? (
        <div className="wwm-origin__shared" data-testid="local-shared">
          <p className="wwm-origin__note">{s.shared}</p>
          <input
            className="wwm-origin__link"
            readOnly
            value={share.url}
            aria-label={s.copy}
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="wwm-row">
            <button type="button" className="wwm-btn wwm-btn--secondary wwm-btn--small" onClick={copy}>
              <Icon name="link" size={18} /> {copied ? s.copied : s.copy}
            </button>
            <a
              className="wwm-btn wwm-btn--ghost wwm-btn--small"
              href={share.url}
              target="_blank"
              rel="noreferrer"
            >
              {s.open}
            </a>
          </div>
        </div>
      ) : (
        <div className="wwm-origin__actions">
          <button
            type="button"
            className="wwm-btn wwm-btn--secondary wwm-btn--small"
            onClick={doShare}
            disabled={share.st === 'busy'}
            data-testid="local-share"
            title={s.shareHint}
          >
            <Icon name="share" size={18} />{' '}
            {share.st === 'busy' ? s.sharing : share.st === 'error' ? s.retry : s.share}
          </button>
          {share.st === 'error' ? (
            <p className="wwm-origin__error" role="alert">
              <strong>{s.shareFailed}.</strong> {share.message}
            </p>
          ) : (
            <p className="wwm-origin__hint">{s.shareHint}</p>
          )}
        </div>
      )}
    </aside>
  );
}
