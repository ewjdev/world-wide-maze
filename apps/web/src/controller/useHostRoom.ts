/**
 * Host side of pairing, for Phase 08 and the input sandbox: create a room (`POST /api/rooms`), open the
 * host socket, and expose live pairing state. Build a `PhoneInputSource` from `room.conn`.
 */
import { type ConnectionState, createRoom, HostConnection, type RttSummary, roomWsUrl } from '@wwm/net';
import { useCallback, useEffect, useState } from 'react';

export interface HostRoom {
  status: 'creating' | 'ready' | 'error';
  code: string | null;
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

/** Non-React: create a room and connect as host. */
export async function openHostRoom(
  origin: string,
  code?: string,
): Promise<{ code: string; conn: HostConnection }> {
  const c = code ?? (await createRoom(origin));
  const conn = new HostConnection({ url: roomWsUrl(origin, c, 'host') });
  conn.connect();
  return { code: c, conn };
}

export function useHostRoom(opts: UseHostRoomOptions = {}): HostRoom {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Omit<HostRoom, 'retry'>>({
    status: 'creating',
    code: null,
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
