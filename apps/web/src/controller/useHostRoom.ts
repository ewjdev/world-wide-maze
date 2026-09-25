/**
 * Host side of pairing, for Phase 08 and the input sandbox: create a room (`POST /api/rooms`), open the
 * host socket, and expose live pairing state. Build a `PhoneInputSource` from `room.conn`.
 *
 * Contracts v0.2.7 (pairing secret): the host connects with its `hostToken`; `pairToken` goes into the QR code
 * / link (`pairingUrl(origin, code, pairToken)`). Both are remembered in sessionStorage so `/p/<code>` (or
 * `/dev/input?code=`) can rejoin after a reload; a `#h=<hostToken>&p=<pairToken>` fragment works too.
 */
import {
  type ConnectionState,
  createRoom,
  HostConnection,
  type RttSummary,
  recallHostRoom,
  rememberHostRoom,
  roomWsUrl,
  type TokenStorage,
} from '@wwm/net';
import { useCallback, useEffect, useState } from 'react';

export interface HostRoom {
  status: 'creating' | 'ready' | 'error';
  code: string | null;
  /** The phone's pairing secret for the QR code / link (null when rejoining a room whose token we don't have). */
  pairToken: string | null;
  conn: HostConnection | null;
  connection: ConnectionState;
  controllerConnected: boolean;
  rtt: RttSummary | null;
  error: string | null;
  /** Throw away the room and create a new one. */
  retry: () => void;
}

export interface UseHostRoomOptions {
  /** API origin (default `location.origin`, which Vite proxies to the worker in dev). */
  origin?: string;
  /** Reuse an existing code (e.g. after the host page reloads) instead of creating one. */
  code?: string;
}

function sessionStore(): TokenStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Non-React: create a room (or rejoin `code` with remembered tokens) and connect as host. Rejoining a room
 * without its host token still connects, and the relay refuses it with 4401 (`conn` emits `error`).
 */
export async function openHostRoom(
  origin: string,
  code?: string,
): Promise<{ code: string; conn: HostConnection; pairToken: string | null }> {
  const store = sessionStore();
  let c: string;
  let hostToken: string | null;
  let pairToken: string | null;
  if (code) {
    const hash = typeof location === 'undefined' ? '' : location.hash;
    const known = recallHostRoom(code, hash, store);
    // A `#h=` link was used: the tokens are now in sessionStorage, keep them out of the address bar.
    if (/[#&]h=/.test(hash))
      history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    c = code;
    hostToken = known?.hostToken ?? null;
    pairToken = known?.pairToken ?? null;
  } else {
    const room = await createRoom(origin);
    c = room.code;
    hostToken = room.hostToken;
    pairToken = room.pairToken;
  }
  if (hostToken) rememberHostRoom(c, { hostToken, pairToken }, store);
  const conn = new HostConnection({ url: roomWsUrl(origin, c, 'host', hostToken) });
  conn.connect();
  return { code: c, conn, pairToken };
}

export function useHostRoom(opts: UseHostRoomOptions = {}): HostRoom {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Omit<HostRoom, 'retry'>>({
    status: 'creating',
    code: null,
    pairToken: null,
    conn: null,
    connection: 'idle',
    controllerConnected: false,
    rtt: null,
    error: null,
  });
  const origin = opts.origin;
  const fixedCode = opts.code;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the effect on retry.
  useEffect(() => {
    let cancelled = false;
    let conn: HostConnection | null = null;
    const unsubs: (() => void)[] = [];
    setState((s) => ({ ...s, status: 'creating', error: null, controllerConnected: false }));
    openHostRoom(origin ?? location.origin, fixedCode).then(
      (room) => {
        if (cancelled) {
          room.conn.close();
          return;
        }
        conn = room.conn;
        setState((s) => ({
          ...s,
          status: 'ready',
          code: room.code,
          pairToken: room.pairToken,
          conn: room.conn,
          connection: room.conn.state,
        }));
        unsubs.push(
          room.conn.on('state', (st) => setState((s) => ({ ...s, connection: st }))),
          room.conn.on('peer', (role, connected) => {
            if (role === 'controller') setState((s) => ({ ...s, controllerConnected: connected }));
          }),
          room.conn.on('rtt', () => setState((s) => ({ ...s, rtt: room.conn.rtt.summary() }))),
          room.conn.on('error', (e) => setState((s) => ({ ...s, status: 'error', error: e }))),
        );
      },
      (err: unknown) => {
        if (!cancelled) setState((s) => ({ ...s, status: 'error', error: String(err) }));
      },
    );
    return () => {
      cancelled = true;
      for (const u of unsubs) u();
      conn?.close();
    };
  }, [origin, fixedCode, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { ...state, retry };
}
