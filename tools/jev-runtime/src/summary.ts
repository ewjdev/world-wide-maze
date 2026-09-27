import type { StageData } from '@wwm/schema';
import type { Chunk, JournalEvent, RunSummary } from '../../../packages/maze-agent/src/contracts.ts';
import { fixture } from '../../../packages/maze-agent/src/fixtures.ts';
import { scoreAt } from '../../../packages/maze-agent/src/score.ts';
export function summarize(ev: JournalEvent[]): RunSummary {
  const s = { ...(ev[0]?.data.summary as RunSummary) };
  if (!s.id) throw new Error('Corrupt run manifest');
  for (const e of ev) {
    if (e.type === 'status') {
      s.status = e.data.status as RunSummary['status'];
      s.reason = (e.data.reason as string) ?? null;
      if (['finished', 'failed', 'stopped', 'interrupted'].includes(s.status)) s.endedAt = e.at;
    }
    if (e.type === 'chunk') s.tick = Number((e.data.chunk as { to: number }).to);
    if (e.type === 'frame') s.decisions++;
    if (e.type === 'reservation') s.attempts++;
    if (e.type === 'action') s.actions++;
  }
  if (s.scoreMode) {
    const stage = (ev[0].data.maze as { stage: StageData } | undefined)?.stage ?? fixture(s.fixture).stage;
    const collected = new Set<number>();
    let cleared = false;
    for (const e of ev)
      if (e.type === 'chunk')
        for (const { event } of (e.data.chunk as Chunk).events) {
          if (event.type === 'item') collected.add(event.itemId);
          if (event.type === 'goal') cleared = true;
        }
    const score = scoreAt(stage, collected, s.tick, cleared);
    s.score = score.score;
    s.gems = score.gems;
  }
  return s;
}
