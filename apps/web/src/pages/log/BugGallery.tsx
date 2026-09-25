/**
 * "Bugs the AI caught in its own work": the five issues the Phase 09 solver bot filed against the stage builder,
 * with the solver's own words and before/after renders of the same page region, then six other catches from the
 * build logs. Quotes are verbatim (checked by tools/build-story/test/content.test.ts).
 */
import { ASSETS } from './assets.ts';
import { assetUrl, BUGS, type OtherBug, type Quote, type SolverBug, sourceHref } from './story.ts';

function Cite({ q }: { q: Quote }) {
  const href = sourceHref(q.file);
  const label = q.file.startsWith('git:')
    ? `commit ${q.file.slice(4)}`
    : q.file.replace('docs/build-log/', '');
  return (
    <blockquote className="bg-quote">
      <p>{q.quote}</p>
      <footer className="sc-mono">{href ? <a href={href}>{label}</a> : label}</footer>
    </blockquote>
  );
}

function Shot({ rel, label, tone }: { rel: string; label: string; tone: 'before' | 'after' }) {
  const url = assetUrl(ASSETS, rel);
  return (
    <figure className="bg-shot" data-tone={tone}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img
            src={url}
            alt={`${label}: the solver’s view of the stage`}
            loading="lazy"
            width={660}
            height={480}
          />
        </a>
      ) : null}
      <figcaption>{label}</figcaption>
    </figure>
  );
}

function Case({ b }: { b: SolverBug }) {
  return (
    <article className="bg-case" aria-labelledby={`bug-${b.id}`}>
      <header className="bg-case__head">
        <span className="bg-id sc-mono">{b.id}</span>
        <h3 className="bg-title" id={`bug-${b.id}`}>
          {b.title}
        </h3>
      </header>
      <div className="bg-case__body">
        <div className="bg-text">
          <p className="bg-plain">{b.plain}</p>
          <div className="bg-saw">
            <p className="bg-label">What the solver reported</p>
            <p className="bg-out sc-mono">{b.saw}</p>
            <p className="bg-cmd">
              Repro <code>{b.repro}</code>
            </p>
          </div>
          <div className="bg-pair-q">
            <div>
              <p className="bg-label">By the numbers</p>
              <Cite q={b.evidence} />
            </div>
            <div>
              <p className="bg-label">The fix · {b.fixedIn}</p>
              <Cite q={b.fix} />
            </div>
          </div>
        </div>
        <div className="bg-shots">
          <Shot
            rel={b.images.before}
            tone="before"
            label={b.imageLabels?.before ?? 'Before · builder 0.3.0'}
          />
          <Shot rel={b.images.after} tone="after" label={b.imageLabels?.after ?? 'After · builder 0.4.0'} />
        </div>
      </div>
    </article>
  );
}

const KIND: Record<OtherBug['kind'], string> = { bug: 'Bug', security: 'Security', check: 'Check' };

export function BugGallery() {
  const { batch } = BUGS;
  const before = assetUrl(ASSETS, batch.images.before);
  const after = assetUrl(ASSETS, batch.images.after);
  return (
    <section className="sc-section bg" aria-labelledby="bugs">
      <h2 className="sc-h2" id="bugs">
        Bugs the AI caught in its own work
      </h2>
      <div className="sc-prose">
        <p className="sc-lede">
          One agent wrote the stage builder. Another built a solver bot, had it play every stage the builder
          could make, and filed what it found as bug reports, each with a repro. A third agent fixed them.
        </p>
      </div>

      <div className="bg-batch">
        <div className="bg-batch__nums">
          <p className="bg-label">{batch.title}</p>
          <table>
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">Before</th>
                <th scope="col">After</th>
              </tr>
            </thead>
            <tbody>
              {batch.rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td className="sc-mono">{r.before}</td>
                  <td className="sc-mono">
                    <strong>{r.after}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="sc-note">
            From the before/after table in <a href="#phase-03">the Phase 03b log</a>.
          </p>
        </div>
        <div className="bg-batch__shots">
          {before ? (
            <a href={before} target="_blank" rel="noreferrer" className="bg-dash" data-tone="before">
              <img
                src={before}
                alt="The batch-eval dashboard before the fixes, listing the failure classes"
                loading="lazy"
                width={1440}
                height={1000}
              />
              <span>Solver dashboard, before</span>
            </a>
          ) : null}
          {after ? (
            <a href={after} target="_blank" rel="noreferrer" className="bg-dash" data-tone="after">
              <img
                src={after}
                alt="The batch-eval dashboard after the fixes: no failures"
                loading="lazy"
                width={1440}
                height={1000}
              />
              <span>After: “No failures.”</span>
            </a>
          ) : null}
        </div>
      </div>

      <p className="bg-legend sc-note">
        The pictures are the solver’s view of the same page region, rebuilt with the builder before and after
        the fix, in the batch dashboard’s colours: bridges blue (ramps orange), elevators cyan, the planned
        route yellow, the ball’s path magenta, and a red ring where the run failed.
      </p>
      <div className="bg-cases">
        {BUGS.solver.map((b) => (
          <Case key={b.id} b={b} />
        ))}
      </div>

      <h3 className="bg-more" id="caught">
        Caught along the way
      </h3>
      <ul className="bg-others">
        {BUGS.other.map((o) => (
          <li key={o.id} className="bg-other">
            <p className="bg-other__head">
              <span className="bg-kind" data-kind={o.kind}>
                {KIND[o.kind]}
              </span>
              <strong className="bg-other__title">{o.title}</strong>
            </p>
            <p className="bg-by">{o.caughtBy}</p>
            <p>{o.plain}</p>
            <Cite q={o.evidence} />
            {o.diff ? (
              <pre className="bg-diff">
                {o.diff.map((l) => (
                  <span key={l} data-sign={l[0]}>
                    {l}
                    {'\n'}
                  </span>
                ))}
              </pre>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
