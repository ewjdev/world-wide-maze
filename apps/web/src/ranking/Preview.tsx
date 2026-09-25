/**
 * /dev/ranking: every ranking component and state on one page (dev preview + screenshots). Uses the in-memory
 * client seeded with sample names; `?api=1` talks to the real Worker through the Vite /api proxy instead.
 */
import type { ScoreEntry } from '@wwm/schema';
import { useMemo, useState } from 'react';
import { createMemoryRankingClient, createRankingClient } from './client.ts';
import { Leaderboard, useLeaderboard } from './Leaderboard.tsx';
import { NameEntry } from './NameEntry.tsx';
import { ChallengeBanner, ShareButton } from './ShareButton.tsx';

const STAGE = 'b2169063668c61be2d46c0f164480c1a6fa26d6baae08344228f1afd414d8a7b';
const at = '2026-09-25T10:00:00.000Z';
const sample = (rows: [string, number, number][]): ScoreEntry[] =>
  rows.map(([name, score, timeMs]) => ({ name, score, timeMs, at }));

export default function RankingPreview() {
  const api = typeof location !== 'undefined' && new URLSearchParams(location.search).has('api');
  const client = useMemo(
    () =>
      api
        ? createRankingClient()
        : createMemoryRankingClient({
            stages: {
              [STAGE]: sample([
                ['marble_mika', 1612, 64_200],
                ['tilt_master', 1587, 70_900],
                ['kaisoku', 1540, 81_300],
                ['ball_is_life', 1497, 92_000],
                ['hn_reader', 1402, 118_400],
                ['slow_and_steady', 1210, 171_000],
              ]),
            },
            runs: sample([
              ['marble_mika', 9120, 402_000],
              ['tilt_master', 8335, 455_000],
              ['kaisoku', 7004, 510_000],
              ['saqoo_fan', 6480, 390_000],
              ['ball_is_life', 5120, 377_000],
            ]),
          }),
    [api],
  );
  const [you, setYou] = useState<string | null>(null);
  const stageBoard = useLeaderboard(client, { kind: 'stage', stageId: STAGE });
  const runBoard = useLeaderboard(client, { kind: 'run' });

  return (
    <main style={{ background: '#f7f6f2', minHeight: '100vh', padding: '2.5rem clamp(1rem, 4vw, 3rem)' }}>
      <h1 style={{ font: '600 1.5rem/1.2 system-ui', margin: '0 0 2rem' }}>
        Ranking components (dev preview)
      </h1>
      <div
        style={{ display: 'grid', gap: '2rem', gridTemplateColumns: 'repeat(auto-fit, minmax(22rem, 1fr))' }}
      >
        <NameEntry
          score={1520}
          label="Stage score, Hacker News"
          onSubmit={(name) => client.submitStage({ stageId: STAGE, name, score: 1520, timeMs: 88_000 })}
          onSubmitted={(_, name) => {
            setYou(name);
            stageBoard.reload();
          }}
          onSkip={() => setYou(null)}
        />
        <Leaderboard
          title="This stage"
          subtitle="news.ycombinator.com"
          state={stageBoard}
          you={you}
          showTime
          limit={10}
          onRetry={stageBoard.reload}
        />
        <Leaderboard title="Ranking" subtitle="Session totals, all sites" state={runBoard} limit={10} />
        <div style={{ display: 'grid', gap: '1rem', alignContent: 'start' }}>
          <ChallengeBanner challenge={{ beat: 1612, by: 'marble_mika' }} />
          <div>
            <ShareButton stageId={STAGE} title="Hacker News" score={1520} name={you ?? 'your_name'} />
          </div>
          <div>
            <ShareButton stageId={STAGE} title="Hacker News" quiet />
          </div>
          <Leaderboard title="Empty board" state={{ status: 'ready', entries: [] }} />
          <Leaderboard title="Loading" state={{ status: 'loading' }} />
          <Leaderboard title="Offline" state={{ status: 'error', message: 'HTTP 503' }} onRetry={() => {}} />
        </div>
      </div>
      <section
        style={{
          marginTop: '2.5rem',
          padding: '2rem',
          borderRadius: 8,
          background: 'radial-gradient(120% 140% at 20% 0%, #2c4a5e 0%, #0f1720 70%)',
          display: 'grid',
          gap: '1.5rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(22rem, 1fr))',
        }}
      >
        <Leaderboard tone="dark" title="Ranking (over the game)" state={runBoard} you="kaisoku" limit={5} />
        <NameEntry
          tone="dark"
          score={7004}
          label="Session total"
          onSubmit={async () => ({ ok: true, rank: 3, verified: false })}
          onSkip={() => {}}
        />
      </section>
    </main>
  );
}
