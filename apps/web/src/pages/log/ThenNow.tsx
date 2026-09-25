/**
 * 2013 and this rebuild, side by side: facts from /about's sourced data (history.ts) and from timeline.json.
 * No verdict is drawn: the original's schedule and team size were never published.
 */
import { Link } from 'react-router';
import { CREDITS, TECH } from '../about/history.ts';
import { dur, TL } from './story.ts';

export function ThenNow() {
  const orgs = CREDITS.filter((c) => c.name !== 'Saqoosha').map((c) => c.name);
  const rows: { part: string; was: string; now: string }[] = [
    {
      part: 'Who',
      was: `${orgs.slice(0, -1).join(', ')} and ${orgs.at(-1)}, as credited in award entries. The individual credits are incomplete.`,
      now: `One owner directing ${TL.agents.model ?? 'one AI model'}: an orchestrating session and ${TL.agents.runs} agent runs.`,
    },
    {
      part: 'Starting point',
      was: 'The original concept: any web page becomes a maze you steer with your phone.',
      now: 'A known design: the archived 2013 game code and localization (read as text, never run) and Saqoosha’s engineering case study.',
    },
    {
      part: 'Time',
      was: 'Not published. The original budget and schedule are among the gaps no source fills.',
      now: `${dur(TL.wallClock.min)} of wall-clock time to the snapshot, ${dur(TL.agents.agentMin)} of summed agent time. The owner’s own time between messages wasn’t recorded.`,
    },
    ...TECH.filter((t) =>
      ['Building the maze', 'Physics', 'Phone to computer', 'Servers'].includes(t.part),
    ).map((t) => ({ part: t.part, was: t.was, now: t.now })),
  ];
  return (
    <section className="sc-section tn" aria-labelledby="then-now">
      <h2 className="sc-h2" id="then-now">
        2013 and 2026, side by side
      </h2>
      <p className="sc-note">
        Facts only, and no verdict: a rebuild that follows a known design is a different task from inventing
        one, and the original team’s effort was never published. Sources for the 2013 column are on{' '}
        <Link to="/about#sources">the history page</Link>.
      </p>
      <table className="tn-grid">
        <thead>
          <tr className="tn-row tn-row--head">
            <td />
            <th scope="col">World Wide Maze, 2013</th>
            <th scope="col">This tribute, 2026</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.part} className="tn-row">
              <th scope="row" className="tn-part">
                {r.part}
              </th>
              <td className="tn-was">{r.was}</td>
              <td className="tn-now">{r.now}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
