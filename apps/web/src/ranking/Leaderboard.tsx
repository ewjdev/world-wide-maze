import type { ScoreEntry } from '@wwm/schema';
import { useCallback, useEffect, useState } from 'react';
import type { RankingClient } from './client.ts';
import './ranking.css';

export type BoardRef = { kind: 'run' } | { kind: 'stage'; stageId: string };

export type BoardState =
  | { status: 'loading' }
  | { status: 'ready'; entries: ScoreEntry[] }
  | { status: 'error'; message: string };

/** Fetch a board; `reload()` after a submission. */
export function useLeaderboard(client: RankingClient, board: BoardRef): BoardState & { reload(): void } {
  const [state, setState] = useState<BoardState>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);
  const key = board.kind === 'run' ? 'run' : `stage:${board.stageId}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` identifies the board; `nonce` forces reloads.
  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    (board.kind === 'run' ? client.runBoard() : client.stageBoard(board.stageId)).then(
      (entries) => live && setState({ status: 'ready', entries }),
      (e: unknown) =>
        live && setState({ status: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [client, key, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

export function formatTime(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '—';
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
}

export interface LeaderboardProps {
  title: string;
  /** Short line under the title, e.g. the site or "All sites, whole sessions". */
  subtitle?: string;
  state: BoardState;
  /** Highlight this player's row. */
  you?: string | null;
  /** Show the time column (stage boards). */
  showTime?: boolean;
  /** Visible rows (the API returns up to 50). */
  limit?: number;
  tone?: 'light' | 'dark';
  onRetry?: () => void;
  emptyText?: string;
}

/** A results sheet: rank, name, score (and time on stage boards). */
export function Leaderboard({
  title,
  subtitle,
  state,
  you,
  showTime = false,
  limit = 50,
  tone = 'light',
  onRetry,
  emptyText = 'No scores yet. Finish this stage to set the first one.',
}: LeaderboardProps) {
  const headingId = `rk-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <section className="rk rk-board" data-tone={tone} aria-labelledby={headingId}>
      <header className="rk-board__head">
        <h2 className="rk-board__title" id={headingId}>
          {title}
        </h2>
        {subtitle ? <span className="rk-board__sub">{subtitle}</span> : null}
      </header>
      {state.status === 'loading' ? (
        <div role="status" aria-busy="true" aria-label="Loading scores">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rk-skel" style={{ margin: '0.9rem 0', width: `${90 - i * 12}%` }} />
          ))}
        </div>
      ) : state.status === 'error' ? (
        <div className="rk-state" role="alert">
          <strong>Scores couldn’t load.</strong> Check the connection and try again.
          {onRetry ? (
            <div className="rk-actions">
              <button type="button" className="rk-btn rk-btn--quiet" onClick={onRetry}>
                Try again
              </button>
            </div>
          ) : null}
        </div>
      ) : state.entries.length === 0 ? (
        <p className="rk-state">{emptyText}</p>
      ) : (
        <table className="rk-table">
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Name</th>
              <th scope="col" className="rk-num">
                Score
              </th>
              {showTime ? (
                <th scope="col" className="rk-num">
                  Time
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {state.entries.slice(0, limit).map((e, i) => (
              <tr key={e.name} data-you={you === e.name} data-top={i < 3}>
                <td className="rk-rank">{i + 1}</td>
                <td className="rk-name">
                  {e.name}
                  {you === e.name ? <span className="rk-you">you</span> : null}
                </td>
                <td className="rk-num rk-score">{e.score.toLocaleString('en-US')}</td>
                {showTime ? <td className="rk-num rk-time">{formatTime(e.timeMs)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
