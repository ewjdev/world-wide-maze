/**
 * What was added after the build clock's snapshot: content/build-story/since-launch.json, each entry with its build
 * logs (rendered further down this page) and whether it is live. The clock above stays a fixed measurement of the
 * launch build; this list carries the record forward. `pnpm record:drift` reports logs missing from it.
 */
import { SINCE, type SinceLaunchStatus, TL } from './story.ts';

export const STATUS_LABEL: Record<SinceLaunchStatus, string> = {
  live: 'Live',
  paused: 'Paused by the operator',
  'switched-off': 'Built, switched off',
  'operator-only': 'Operator only',
};

const REPO_URL = (import.meta.env.VITE_REPO_URL as string | undefined) || null;

export function SinceLaunch() {
  return (
    <section className="sc-section sl" aria-labelledby="since-launch">
      <h2 className="sc-h2" id="since-launch">
        Since launch
      </h2>
      <p className="sc-note">
        The clock above stops at commit <code>{TL.asOf.sha}</code>. Work carried on after it, in the same way:
        a written brief, an agent, a build log. Each item links to its logs in the record below.
      </p>
      <ol className="sl-list">
        {SINCE.entries.map((e) => (
          <li key={e.id} className="sl-item" id={`since-${e.id}`}>
            <div className="sl-head">
              {/* a plain link: some paths (/learn) are served by the Worker, not this app */}
              <h3 className="sl-title">{e.href ? <a href={e.href}>{e.title}</a> : e.title}</h3>
              <span className="sl-status" data-status={e.status} title={e.statusNote}>
                {STATUS_LABEL[e.status]}
              </span>
            </div>
            <p className="sl-summary">{e.summary}</p>
            <p className="sl-meta">
              <span className="sl-why">{e.statusNote}</span>{' '}
              <span className="sl-logs">
                Records:{' '}
                {e.logs.map((slug, k) => (
                  <span key={slug}>
                    {k ? ', ' : ''}
                    <a href={`#${slug}`} className="sc-mono">
                      {slug}
                    </a>
                  </span>
                ))}
                {(e.docs ?? []).map((path, k) => (
                  <span key={path}>
                    {e.logs.length || k ? ', ' : ''}
                    {REPO_URL ? (
                      <a href={`${REPO_URL}/blob/main/${path}`} className="sc-mono">
                        {path}
                      </a>
                    ) : (
                      <span className="sc-mono">{path}</span>
                    )}
                  </span>
                ))}
              </span>
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
