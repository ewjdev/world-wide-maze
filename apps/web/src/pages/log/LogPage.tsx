/**
 * /log: the build record (Phase 10). Renders every docs/build-log/*.md unedited, with a summary table whose
 * numbers come only from what the logs themselves state (see parse-log.ts). No productivity multipliers.
 */
import { marked } from 'marked';
import { useEffect, useMemo } from 'react';
import { Link } from 'react-router';
import { ShowcaseFrame } from '../about/ShowcaseFrame.tsx';
import { fmtClock, type LogFile, type LogSummary, modelOf, summarize, totals } from './parse-log.ts';
import './log.css';

const RAW = import.meta.glob<string>('../../../../../docs/build-log/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});
/**
 * Evidence screenshots, except the internal-only BBC fixture's (licensing, see fixtures/captures/README.md): the
 * `[!b]` pattern keeps `bbc-*` files out of the build entirely. Name evidence files so they don't start with `b`.
 */
const ASSETS = import.meta.glob<string>('../../../../../docs/build-log/assets/**/[!b]*.{png,jpg,webp}', {
  query: '?url',
  import: 'default',
  eager: true,
});

export const LOG_FILES: LogFile[] = Object.entries(RAW)
  .map(([path, md]) => ({ slug: (path.split('/').pop() ?? '').replace(/\.md$/, ''), md }))
  .sort((a, b) => a.slug.localeCompare(b.slug));

function assetsFor(phase: string): { name: string; url: string }[] {
  return Object.entries(ASSETS)
    .filter(([p]) => p.includes(`/assets/phase-${phase}/`) && !/bbc/i.test(p))
    .map(([p, url]) => ({ name: (p.split('/').pop() ?? '').replace(/\.\w+$/, ''), url }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Demote headings one level (the page owns the h1) and render. Logs are trusted repo content. */
function renderLog(md: string): string {
  const shifted = md.replace(/^(#{1,5})\s/gm, '#$1 ');
  return marked.parse(shifted, { async: false, gfm: true });
}

const REPO_URL = (import.meta.env.VITE_REPO_URL as string | undefined) || null;

function minutes(l: LogSummary): number | null {
  return l.window ? l.window.endMin - l.window.startMin : null;
}

export function LogPage() {
  const summaries = useMemo(() => LOG_FILES.map(summarize), []);
  const html = useMemo(() => new Map(LOG_FILES.map((f) => [f.slug, renderLog(f.md)])), []);
  const t = totals(summaries);
  // The page renders client-side, so honour a #phase-XX link once the documents exist.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);
  const mains = summaries.filter((s) => !s.supplement);
  const span = t.span;
  const scale = (min: number) =>
    span ? ((min - span.startMin) / Math.max(1, span.endMin - span.startMin)) * 100 : 0;
  const hourTicks = span
    ? Array.from(
        { length: Math.floor(span.endMin / 60) - Math.ceil(span.startMin / 60) + 1 },
        (_, i) => (Math.ceil(span.startMin / 60) + i) * 60,
      )
    : [];

  return (
    <ShowcaseFrame>
      <header className="lg-head">
        <h1 className="lg-title">Build record</h1>
        <div className="sc-prose">
          <p className="sc-lede">
            Each phase of this rebuild was carried out by an AI coding agent working from a written brief, in
            its own copy of the repository. Every agent kept a log: what it was asked, what it built, what
            failed, where a person stepped in, and what the tests showed.
          </p>
          <p className="sc-note">
            The logs below are reproduced as written. The table only restates what they say; where a log
            doesn’t state something, it says so. Nothing here compares this effort with the original team’s:
            their effort was never published, and a rebuild with a known design to follow is a different task
            from inventing one.
          </p>
          <p className="sc-note">
            {REPO_URL ? (
              <>
                Source code: <a href={REPO_URL}>{REPO_URL.replace(/^https?:\/\//, '')}</a>
              </>
            ) : (
              'The source repository is not public yet.'
            )}
          </p>
        </div>
      </header>

      <section className="sc-section" aria-labelledby="ledger">
        <h2 className="sc-h2" id="ledger">
          At a glance
        </h2>
        <p className="lg-sum">
          {t.phases} phases have logs so far ({t.logs} documents). The logs name{' '}
          {t.models.length === 1 ? 'one model' : `${t.models.length} models`}:{' '}
          {t.models.join(', ') || 'not stated'}. They record {t.failedAttempts} failed or reworked attempts
          and {t.humanInterventions} human interventions during the agents’ own runs. Briefing, reviews,
          merges and gate checks were done by a separate orchestrating session under the project owner’s
          direction and are not counted in these logs; the physical iPhone test was run by the orchestrator
          and the owner together.
        </p>
        <div className="ab-scroll">
          <table className="lg-table">
            <thead>
              <tr>
                <th scope="col">Phase</th>
                <th scope="col">Logged window (UTC, {span?.date ?? 'date not stated'})</th>
                <th scope="col" className="lg-num">
                  Failed attempts
                </th>
                <th scope="col" className="lg-num">
                  Human interventions
                </th>
              </tr>
            </thead>
            <tbody>
              {mains.map((l) => {
                const m = minutes(l);
                return (
                  <tr key={l.slug}>
                    <th scope="row">
                      <a href={`#${l.slug}`} className="lg-rowlink">
                        <span className="sc-mono">{l.phase}</span>{' '}
                        {l.title.replace(/^Phase\s+\d+\w?[:\s]*/i, '').replace(/^\(|\)$/g, '')}
                      </a>
                      <small>{modelOf(l.agent) ?? 'model not stated'}</small>
                    </th>
                    <td className="lg-gantt">
                      {l.window ? (
                        <>
                          <div className="lg-track" aria-hidden="true">
                            {hourTicks.map((h) => (
                              <span key={h} className="lg-tick" style={{ left: `${scale(h)}%` }} />
                            ))}
                            <span
                              className="lg-bar"
                              data-approx={l.window.approx}
                              style={{
                                left: `${scale(l.window.startMin)}%`,
                                width: `${Math.max(1.5, scale(l.window.endMin) - scale(l.window.startMin))}%`,
                              }}
                            />
                          </div>
                          <span className="sc-mono lg-when">
                            {l.window.approx ? '≈ ' : ''}
                            {fmtClock(l.window.startMin)}–{fmtClock(l.window.endMin)}
                            {m !== null ? ` · ${m} min` : ''}
                          </span>
                        </>
                      ) : (
                        <span className="lg-when">{l.windowText ?? 'not stated'}</span>
                      )}
                    </td>
                    <td className="lg-num sc-mono">{l.failedAttempts}</td>
                    <td className="lg-num sc-mono">
                      {l.noHumanInterventions ? 'none' : l.humanInterventions}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {span ? (
              <tfoot>
                <tr>
                  <td />
                  <td className="lg-gantt">
                    <div className="lg-axis" aria-hidden="true">
                      {hourTicks.map((h) => (
                        <span key={h} style={{ left: `${scale(h)}%` }} className="sc-mono">
                          {fmtClock(h)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
        <p className="sc-note">
          Windows are the start and end times each agent wrote in its log, most of them approximate (≈).
          Several phases ran at the same time in parallel copies of the repository, so windows overlap and
          should not be added up. They cover the agents’ runs only, not research, planning, review or the
          owner’s time.
        </p>
      </section>

      <div className="lg-docs">
        <nav className="lg-index" aria-label="Logs">
          <ol>
            {summaries.map((l) => (
              <li key={l.slug}>
                <a href={`#${l.slug}`} className="lg-index__link" data-supplement={l.supplement}>
                  {l.supplement ? l.title : `Phase ${l.phase}`}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div>
          {summaries.map((l) => {
            const assets = l.supplement || !l.phase ? [] : assetsFor(l.phase);
            return (
              <article key={l.slug} id={l.slug} className="lg-doc" aria-label={l.title}>
                <p className="lg-doc__file sc-mono">docs/build-log/{l.slug}.md</p>
                {/* biome-ignore lint/security/noDangerouslySetInnerHtml: the build logs are this repo's own markdown. */}
                <div className="lg-md" dangerouslySetInnerHTML={{ __html: html.get(l.slug) ?? '' }} />
                {assets.length ? (
                  <figure className="lg-assets">
                    <figcaption>Evidence screenshots from this phase</figcaption>
                    <div>
                      {assets.map((a) => (
                        <a key={a.url} className="lg-asset" href={a.url} target="_blank" rel="noreferrer">
                          <img
                            src={a.url}
                            alt={`${l.title}: ${a.name.replace(/[-_]/g, ' ')}`}
                            loading="lazy"
                          />
                          <span className="sc-mono">{a.name}</span>
                        </a>
                      ))}
                    </div>
                  </figure>
                ) : null}
              </article>
            );
          })}
          <p className="sc-note">
            Next: <Link to="/making">see how a page becomes a maze</Link>, or read the{' '}
            <Link to="/about">history of the original</Link>.
          </p>
        </div>
      </div>
    </ShowcaseFrame>
  );
}

export default LogPage;
