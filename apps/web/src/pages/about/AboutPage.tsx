/**
 * /about: history, credits and the evidence behind the rebuild (Phase 10). Facts live in ./history.ts (every one
 * sourced); the evidenced/reconstructed/new table is generated from docs/reference/fidelity-spec.md.
 */
import type { StageData } from '@wwm/schema';
import { marked } from 'marked';
import { Fragment } from 'react';
import { Link } from 'react-router';
import govuk from '../../../../../fixtures/builder/govuk-card-grid.normal.seed1.json';
import { DocentPanel } from '../../docent/DocentPanel.tsx';
import { FIDELITY, type Mark, markCounts } from './fidelity.ts';
import { CREDITS, GAPS, ORIGINAL_ASSETS_NOTE, SONG, type Source, SRC, TECH, TIMELINE } from './history.ts';
import { ShowcaseFrame } from './ShowcaseFrame.tsx';
import { StagePlan } from './StagePlan.tsx';
import './about.css';

/** Inline markdown from the repo's own fidelity spec (trusted content). */
function Md({
  as: Tag = 'span',
  md,
  ...rest
}: {
  as?: 'span' | 'td' | 'th' | 'li' | 'small';
  md: string;
  scope?: string;
}) {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: renders this repo's own docs/reference markdown.
  return <Tag {...rest} dangerouslySetInnerHTML={{ __html: marked.parseInline(md, { async: false }) }} />;
}

const MARK_TEXT: Record<Mark, { name: string; blurb: string }> = {
  E: {
    name: 'Evidenced',
    blurb:
      'Read directly from a 2013 source: the archived game code, its text, the stage data or the case study.',
  },
  R: {
    name: 'Reconstructed',
    blurb: 'Inferred from the evidence, with the reasoning written down. Our best reading, not a certainty.',
  },
  N: {
    name: 'New',
    blurb:
      'Our own addition or a deliberate change, such as accessibility options or a different network stack.',
  },
};

export function MarkBadge({ k }: { k: Mark | '?' }) {
  const label = k === '?' ? 'No 2013 counterpart' : MARK_TEXT[k].name;
  return (
    <abbr className="sc-mark" data-k={k} title={label} aria-label={label}>
      {k === '?' ? '–' : k}
    </abbr>
  );
}

function Sources({ list }: { list: Source[] }) {
  if (!list.length) return null;
  return (
    <span className="ab-src">
      {list.map((s, i) => (
        <Fragment key={s.url}>
          {i > 0 ? <span aria-hidden="true"> · </span> : null}
          <a href={s.url} rel="noreferrer">
            {s.label}
          </a>
        </Fragment>
      ))}
    </span>
  );
}

export function AboutPage() {
  const counts = markCounts(FIDELITY.sections);
  const total = FIDELITY.sections.reduce((a, s) => a + s.rows.length, 0);
  return (
    <ShowcaseFrame>
      <article className="ab">
        <header className="ab-hero">
          <div className="ab-hero__text">
            <h1 className="ab-title">Any website, turned into a maze you roll a ball through.</h1>
            <p className="sc-lede">
              In 2013, World Wide Maze took a web page, found its text blocks and pictures, and raised them
              into floating islands joined by bridges. You steered a glowing ball to the goal by tilting your
              phone. This site is a tribute to that work, rebuilt from the surviving evidence.
            </p>
            <dl className="ab-placard" aria-label="About the original">
              <div>
                <dt>Work</dt>
                <dd>World Wide Maze, a Chrome Experiment</dd>
              </div>
              <div>
                <dt>Launched</dt>
                <dd className="sc-mono">March 21, 2013</dd>
              </div>
              <div>
                <dt>Made by</dt>
                <dd>Google Japan (client), PARTY (agency), AID-DCC, Katamari and FUTUREK (production)</dd>
              </div>
              <div>
                <dt>Played with</dt>
                <dd>A desktop browser and a smartphone as the controller, or the keyboard</dd>
              </div>
              <div>
                <dt>Today</dt>
                <dd>The original service no longer runs. Its launch address now redirects to Google.</dd>
              </div>
            </dl>
          </div>
          <figure className="ab-hero__plan">
            <StagePlan
              stage={govuk as unknown as StageData}
              maxHeight={1180}
              title="Plan of the GOV.UK home page as a maze: islands, bridges, items, start and goal"
              className="plan"
            />
            <figcaption>
              The GOV.UK home page as this rebuild’s builder lays it out (seed 1). Outlines are islands, green
              decks are bridges, teal dots are items.{' '}
              <Link to="/making/govuk-card-grid">See it being built</Link>.
            </figcaption>
          </figure>
        </header>

        <section className="sc-section sc-split" aria-labelledby="credits">
          <div>
            <h2 className="sc-h2" id="credits">
              Who made it
            </h2>
            <p className="sc-note">
              Organisations as recorded in award entries, with narrower roles only where the people themselves
              describe them. This is not a complete list of the designers, engineers, producers and sound
              contributors.
            </p>
          </div>
          <div>
            <ul className="ab-credits">
              {CREDITS.map((c) => (
                <li key={c.name}>
                  <h3 className="ab-credit__name">
                    {c.name}
                    {c.where ? <span>{c.where}</span> : null}
                  </h3>
                  <p>{c.role}</p>
                  <Sources list={c.sources} />
                </li>
              ))}
            </ul>
            <div className="ab-song">
              <h3 className="sc-h3">
                Promotional song: “{SONG.title}” by {SONG.artist}
              </h3>
              <p className="sc-note">
                Released {SONG.released}. It was the launch’s promotional music, not the in-game soundtrack.
                The band’s label says it redesigned the band’s homepage so it would work well as a maze.
              </p>
              <dl className="ab-song__credits">
                {SONG.credits.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <Sources list={[...SONG.sources, SRC.label]} />
            </div>
          </div>
        </section>

        <section className="sc-section sc-split" aria-labelledby="timeline">
          <div>
            <h2 className="sc-h2" id="timeline">
              Timeline
            </h2>
            <p className="sc-note">Only events with a source. Dates are as precise as the source allows.</p>
          </div>
          <ol className="ab-timeline">
            {TIMELINE.map((e) => (
              <li key={e.when} data-kind={e.kind ?? 'event'}>
                <time className="ab-timeline__date sc-mono" dateTime={e.when}>
                  {e.date}
                </time>
                <div>
                  <p>{e.text}</p>
                  <Sources list={e.sources} />
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="sc-section" aria-labelledby="tech">
          <h2 className="sc-h2" id="tech">
            How it worked, then and now
          </h2>
          <p className="sc-note">
            The same chain of steps, thirteen years of tools apart. The 2013 column comes from Saqoosha’s case
            study and Google’s architecture article; ours from this project’s code.
          </p>
          <div className="ab-scroll">
            <table className="ab-tech">
              <thead>
                <tr>
                  <th scope="col">Step</th>
                  <th scope="col">2013</th>
                  <th scope="col">This rebuild</th>
                </tr>
              </thead>
              <tbody>
                {TECH.map((t) => (
                  <tr key={t.part}>
                    <th scope="row">{t.part}</th>
                    <td>
                      {t.was} <Sources list={t.wasSources} />
                    </td>
                    <td>{t.now}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="sc-section" aria-labelledby="fidelity">
          <h2 className="sc-h2" id="fidelity">
            What we know, what we inferred, what we added
          </h2>
          <div className="ab-legend">
            {(['E', 'R', 'N'] as const).map((k) => (
              <div key={k} className="ab-legend__item">
                <MarkBadge k={k} />
                <div>
                  <strong>
                    {MARK_TEXT[k].name} <span className="sc-mono">{counts[k]}</span>
                  </strong>
                  <p>{MARK_TEXT[k].blurb}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="sc-note">
            {total} behaviours from the project’s fidelity spec, generated from{' '}
            <code>docs/reference/fidelity-spec.md</code>. Counts are per label, and a row can carry more than
            one. The “2013” column uses the original’s own units; “WU” is a 2013 world unit.
          </p>
          <div className="ab-fid">
            {FIDELITY.sections.map((s, i) => (
              <details key={s.id} open={i === 0}>
                <summary>
                  <span>{s.title}</span>
                  <span className="ab-fid__count sc-mono">{s.rows.length}</span>
                </summary>
                <div className="ab-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Feature</th>
                        <th scope="col">2013</th>
                        <th scope="col">Label</th>
                        <th scope="col">This rebuild</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.rows.map((r) => (
                        <tr key={r.feature}>
                          <Md as="th" scope="row" md={r.feature} />
                          <Md as="td" md={r.was} />
                          <td className="ab-fid__marks">
                            <span>
                              {r.marks.length ? (
                                r.marks.map((m) => <MarkBadge key={m} k={m} />)
                              ) : (
                                <MarkBadge k="?" />
                              )}
                            </span>
                            {r.source ? <Md as="small" md={r.source} /> : null}
                          </td>
                          <Md as="td" md={r.now} />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>
          <aside className="ab-correction">
            <h3 className="sc-h3">A correction we made along the way</h3>
            <p>
              Our first research notes counted 1,503 small and 12 large items in the one surviving 2013 stage
              (the installation’s AID-DCC stage). Those were the lengths of flat coordinate arrays. The real
              counts are 501 small and 4 large items, three numbers per item. The island (38) and bridge (37)
              counts were right.
            </p>
          </aside>
        </section>

        <section className="sc-section sc-split" aria-labelledby="isnt">
          <div>
            <h2 className="sc-h2" id="isnt">
              What this is, and isn’t
            </h2>
          </div>
          <div className="sc-prose">
            <p>
              <strong>This is a tribute, not a restoration.</strong> The original servers, the phone
              controller’s code and the art and sound were not recovered. What survives is enough to rebuild
              the rules and the feel, and to credit the people who made it, but not to bring the original
              back.
            </p>
            <p>{ORIGINAL_ASSETS_NOTE}</p>
            <p>Things nobody outside the original team can confirm from public sources yet:</p>
            <ul className="ab-gaps">
              {GAPS.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
            {FIDELITY.openQuestions.length ? (
              <>
                <p>Open questions in our own spec:</p>
                <ul className="ab-gaps">
                  {FIDELITY.openQuestions.map((q) => (
                    <Md as="li" key={q} md={q} />
                  ))}
                </ul>
              </>
            ) : null}
            <p>
              The rebuild itself was made with AI coding agents working under human direction. The{' '}
              <Link to="/log">build record</Link> shows every phase, what failed and what people had to step
              in for.
            </p>
          </div>
        </section>

        {/* Phase 15: AI docent */}
        <DocentPanel />

        <section className="sc-section" aria-labelledby="sources-h" id="sources">
          <h2 className="sc-h2" id="sources-h">
            Sources
          </h2>
          <p className="sc-note">
            Start with Saqoosha’s case study: it is the most complete first-person account of how the game
            worked. The trailer and the Japanese technical talk were located but not yet reviewed frame by
            frame.
          </p>
          <ul className="ab-sources">
            {Object.values(SRC).map((s) => (
              <li key={s.url}>
                <a href={s.url} rel="noreferrer">
                  {s.label}
                </a>
                <span className="sc-mono">{new URL(s.url).hostname.replace(/^www\./, '')}</span>
              </li>
            ))}
          </ul>
        </section>
      </article>
    </ShowcaseFrame>
  );
}

export default AboutPage;
