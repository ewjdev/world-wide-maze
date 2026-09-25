/** Conversation state for the docent panel: turns, streaming, stop, errors, and the history sent back. */
import { DOCENT_HISTORY_MAX, type DocentCitation, type DocentEvent, type DocentRequest } from '@wwm/schema';
import { useCallback, useEffect, useRef, useState } from 'react';
import { streamDocent } from './client.ts';

export type TurnStatus = 'streaming' | 'done' | 'error' | 'stopped';

export interface Turn {
  id: number;
  /** What the visitor sees as their question. */
  shown: string;
  /** What was sent. */
  asked: string;
  text: string;
  citations: DocentCitation[];
  status: TurnStatus;
  error?: { code: string; message: string };
}

export interface UseDocent {
  turns: Turn[];
  busy: boolean;
  ask(question: string, shown?: string): void;
  stop(): void;
  reset(): void;
}

export function useDocent(opts: { fetch?: typeof fetch; endpoint?: string } = {}): UseDocent {
  const [turns, setTurns] = useState<Turn[]>([]);
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;
  const abort = useRef<AbortController | null>(null);
  const seq = useRef(0);
  const busy = turns.at(-1)?.status === 'streaming';

  useEffect(() => () => abort.current?.abort(), []);

  const patch = useCallback((id: number, f: (t: Turn) => Turn) => {
    setTurns((ts) => ts.map((t) => (t.id === id ? f(t) : t)));
  }, []);

  const ask = useCallback(
    (question: string, shown = question) => {
      const q = question.trim();
      if (!q || turnsRef.current.at(-1)?.status === 'streaming') return;
      // earlier answered turns, most recent last, capped by the contract
      const history: NonNullable<DocentRequest['history']> = turnsRef.current
        .filter((t) => t.status === 'done' && t.text)
        .flatMap((t) => [
          { role: 'user' as const, text: t.asked },
          { role: 'assistant' as const, text: t.text },
        ])
        .slice(-DOCENT_HISTORY_MAX);
      const id = ++seq.current;
      setTurns((ts) => [...ts, { id, shown, asked: q, text: '', citations: [], status: 'streaming' }]);
      const ac = new AbortController();
      abort.current = ac;
      const onEvent = (e: DocentEvent) => {
        if (e.type === 'delta') patch(id, (t) => ({ ...t, text: t.text + e.text }));
        else if (e.type === 'citations') patch(id, (t) => ({ ...t, citations: e.items }));
        else if (e.type === 'done') patch(id, (t) => ({ ...t, status: 'done' }));
        else if (e.type === 'error')
          patch(id, (t) => ({ ...t, status: 'error', error: { code: e.code, message: e.message } }));
      };
      streamDocent(
        { question: q, ...(history.length ? { history } : {}) },
        {
          signal: ac.signal,
          onEvent,
          ...(opts.fetch ? { fetch: opts.fetch } : {}),
          ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
        },
      )
        .then(() => patch(id, (t) => (t.status === 'streaming' ? { ...t, status: 'done' } : t)))
        .catch(() => {
          patch(id, (t) =>
            t.status !== 'streaming'
              ? t
              : ac.signal.aborted
                ? { ...t, status: 'stopped' }
                : { ...t, status: 'error', error: { code: 'NETWORK', message: '' } },
          );
        });
    },
    [opts.fetch, opts.endpoint, patch],
  );

  const stop = useCallback(() => {
    abort.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abort.current?.abort();
    setTurns([]);
  }, []);

  return { turns, busy, ask, stop, reset };
}
