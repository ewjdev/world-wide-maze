/**
 * Share images for the build story, rendered at /log?card=<clock|maze|bugs|og> as a bare 1200×627 (og: 1200×630)
 * composition and screenshotted by `pnpm --filter @wwm/build-story social`. Same data as the page.
 */
import govukShot from '../../../../../fixtures/captures/govuk-card-grid/screenshot.png?url';
import '../about/showcase.css';
import { ASSETS } from './assets.ts';
import { Dial } from './BuildClock.tsx';
import { assetUrl, BUGS, clock, dur, TL } from './story.ts';
import './story.css';

export type CardVariant = 'clock' | 'maze' | 'bugs' | 'og';
export const CARD_VARIANTS: CardVariant[] = ['clock', 'maze', 'bugs', 'og'];

function Foot() {
  return (
    <p className="cd-foot">
      <span>World Wide Maze · a tribute</span>
      <span className="sc-mono">
        build record · as of commit {TL.asOf.sha} · {clock(TL.asOf.at, true)} PT
      </span>
    </p>
  );
}

function ClockCard() {
  return (
    <div className="cd-clock">
      <div className="cd-copy">
        <h1 className="cd-title">
          Built in <span>{dur(TL.wallClock.min)}</span> of wall-clock time
        </h1>
        <p className="cd-sub">
          {clock(TL.wallClock.start, true)} → {clock(TL.wallClock.end, true)}, from an empty folder
        </p>
        <dl className="cd-facts">
          <div>
            <dt>{dur(TL.agents.agentMin)}</dt>
            <dd>
              agent time across {TL.agents.runs} runs, up to {TL.agents.maxConcurrent} at once
            </dd>
          </div>
          <div>
            <dt>{TL.owner.messages} messages</dt>
            <dd>from the owner, {TL.owner.words} words in all</dd>
          </div>
          <div>
            <dt>{TL.tests.passed.toLocaleString('en-US')} tests</dt>
            <dd>passing, in {TL.git.commits} commits</dd>
          </div>
        </dl>
      </div>
      <div className="cd-dial">
        <Dial />
      </div>
    </div>
  );
}

function MazeCard() {
  const plan = assetUrl(ASSETS, 'phase-03/govuk-card-grid.png');
  const world = assetUrl(ASSETS, 'phase-10/cards/govuk-card-grid.png');
  return (
    <div className="cd-maze">
      <h1 className="cd-title cd-title--maze">Any web page becomes a maze</h1>
      <div className="cd-steps">
        <figure>
          <img src={govukShot} alt="" />
          <figcaption>
            <span className="sc-mono">1</span> The page, captured
          </figcaption>
        </figure>
        <figure>
          <img src={plan} alt="" />
          <figcaption>
            <span className="sc-mono">2</span> Blocks become islands, joined by bridges
          </figcaption>
        </figure>
        <figure className="cd-wide">
          <img src={world} alt="" />
          <figcaption>
            <span className="sc-mono">3</span> A 3D maze you steer with your phone
          </figcaption>
        </figure>
      </div>
    </div>
  );
}

function BugsCard() {
  const pick = BUGS.solver.filter((b) => b.id === 'BI-1' || b.id === 'BI-2');
  const rows = BUGS.batch.rows;
  return (
    <div className="cd-bugs">
      <div className="cd-copy">
        <h1 className="cd-title">Bugs the AI caught in its own work</h1>
        <p className="cd-sub">
          A solver bot played every generated stage and filed {BUGS.solver.length} bug reports against the
          maze builder, each with a repro. All {BUGS.solver.length} were fixed.
        </p>
        <table className="cd-table">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td className="sc-mono">{r.before}</td>
                <td className="sc-mono">→</td>
                <td className="sc-mono">
                  <strong>{r.after}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="cd-cases">
        {pick.map((b) => (
          <figure key={b.id}>
            <div>
              <img src={assetUrl(ASSETS, b.images.before)} alt="" />
              <img src={assetUrl(ASSETS, b.images.after)} alt="" />
            </div>
            <figcaption>
              <span className="sc-mono">{b.id}</span> {b.title}
              <small className="sc-mono">“{b.saw}”</small>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

export function SocialCard({ variant }: { variant: CardVariant }) {
  return (
    <div className="sc cd" data-variant={variant}>
      {variant === 'maze' ? <MazeCard /> : variant === 'bugs' ? <BugsCard /> : <ClockCard />}
      <Foot />
    </div>
  );
}
