/**
 * The night, phase by phase: one lane per agent run on the wall-clock axis, grouped by wave, with the gates as
 * milestones, the owner's messages on their own lane and the idle stretches shaded. Select a run for its details.
 */
import { type CSSProperties, useState } from 'react';
import { WAVE_COLOR } from './BuildClock.tsx';
import { clock, dur, frac, hourTicks, phaseAnchor, type Run, runsByWave, TL, WAVE_NAMES } from './story.ts';

const pos = (start: string, end: string): CSSProperties => ({
  left: `${(frac(start) * 100).toFixed(3)}%`,
  width: `${Math.max(0.35, (frac(end) - frac(start)) * 100).toFixed(3)}%`,
});
const at = (iso: string): CSSProperties => ({ left: `${(frac(iso) * 100).toFixed(3)}%` });

function Details({ run }: { run: Run & { helpers: Run[] } }) {
  const anchor = phaseAnchor(run);
  return (
    <div className="sl-detail" aria-live="polite">
      <p className="sl-detail__head">
        <span className="sc-mono">{run.phase}</span> {run.title}
        <small>
          {run.kind === 'follow-up' ? 'Follow-up run' : 'Phase run'} · Wave {run.wave}
        </small>
      </p>
      <dl>
        <div>
          <dt>Agent run</dt>
          <dd>
            {clock(run.span.start)} to {run.running ? 'the snapshot' : clock(run.span.end)} ·{' '}
            <strong>{dur(run.span.min)}</strong>
            <small>from the agent’s own transcript</small>
          </dd>
        </div>
        <div>
          <dt>Its log says</dt>
          <dd>
            {run.logWindow ? run.logWindow.text : 'no start and end time'}
            {anchor ? (
              <small>
                <a href={anchor}>read the log</a>
              </small>
            ) : null}
          </dd>
        </div>
        {run.failedAttempts !== null ? (
          <div>
            <dt>Failed attempts</dt>
            <dd>
              <strong>{run.failedAttempts}</strong> recorded in the log, each with its fix
            </dd>
          </div>
        ) : null}
        {run.helpers.length ? (
          <div>
            <dt>Helpers</dt>
            <dd>
              {run.helpers.map((h) => (
                <span key={h.agentId} className="sl-helper">
                  {h.title} · {dur(h.span.min)}
                </span>
              ))}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Merged</dt>
          <dd>
            {run.merge ? (
              <>
                {clock(run.merge.at)} · <code>{run.merge.sha}</code>
              </>
            ) : (
              'merged by the orchestrator with other work'
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function Swimlane() {
  const groups = runsByWave();
  const all = groups.flatMap((g) => g.runs);
  const [selected, setSelected] = useState(all.find((r) => r.phase === '09')?.agentId ?? all[0]?.agentId);
  const current = all.find((r) => r.agentId === selected) ?? all[0];
  const ticks = hourTicks();
  return (
    <section className="sc-section sl-section" aria-labelledby="night">
      <h2 className="sc-h2" id="night">
        The night, phase by phase
      </h2>
      <p className="sc-note sl-intro">
        Each bar is one agent’s run, timed from its own transcript. Waves ran in parallel copies of the
        repository and were merged at the gates. Select a run to see what its log says.
      </p>
      <div className="sl">
        <div className="sl-axis" aria-hidden="true">
          <span className="sl-label" />
          <span className="sl-track">
            {ticks.map((t, k) => (
              <span key={t.iso} className="sl-tick" data-odd={k % 2 === 1} style={at(t.iso)}>
                {t.label}
              </span>
            ))}
          </span>
        </div>
        <div className="sl-body">
          <div className="sl-overlay" aria-hidden="true">
            {ticks.map((t) => (
              <span key={t.iso} className="sl-grid" style={at(t.iso)} />
            ))}
            {TL.idle.spans.map((s) => (
              <span key={s.start} className="sl-idle" style={pos(s.start, s.end)}>
                <span>nothing running · {dur(s.min)}</span>
              </span>
            ))}
            {TL.gates.map((g) => (
              <span key={g.id} className="sl-gate" style={at(g.at)}>
                <span>{g.id}</span>
              </span>
            ))}
          </div>
          <div className="sl-row sl-row--owner">
            <span className="sl-label">
              <span className="sl-name">Owner</span>
              <small>
                {TL.owner.messages} messages · {TL.owner.words} words
              </small>
            </span>
            <span className="sl-track">
              {TL.owner.touchpoints.map((p) => (
                <span
                  key={`${p.at}-${p.kind}`}
                  className="sl-touch"
                  data-kind={p.kind}
                  style={at(p.at)}
                  title={`${clock(p.at)}: ${p.label}`}
                />
              ))}
            </span>
          </div>
          {groups.map((g) => (
            <div key={g.wave} className="sl-wave" style={{ '--wave': WAVE_COLOR[g.wave] } as CSSProperties}>
              <p className="sl-wave__name">
                Wave {g.wave} · {WAVE_NAMES[g.wave]}
              </p>
              {g.runs.map((r) => (
                <button
                  key={r.agentId}
                  type="button"
                  className="sl-row"
                  aria-pressed={r.agentId === current?.agentId}
                  onClick={() => setSelected(r.agentId)}
                >
                  <span className="sl-label">
                    <span className="sl-name">
                      <span className="sc-mono">{r.phase}</span> {r.title}
                    </span>
                  </span>
                  <span className="sl-track">
                    <span className="sl-bar" data-kind={r.kind} style={pos(r.span.start, r.span.end)}>
                      {r.helpers.map((h) => (
                        <span
                          key={h.agentId}
                          className="sl-sub"
                          style={{
                            left: `${(((Date.parse(h.span.start) - Date.parse(r.span.start)) / (Date.parse(r.span.end) - Date.parse(r.span.start))) * 100).toFixed(2)}%`,
                            width: `${((h.span.min / r.span.min) * 100).toFixed(2)}%`,
                          }}
                        />
                      ))}
                    </span>
                    <span
                      className="sl-dur sc-mono"
                      style={at(
                        r.merge && Date.parse(r.merge.at) > Date.parse(r.span.end) ? r.merge.at : r.span.end,
                      )}
                    >
                      {dur(r.span.min)}
                    </span>
                    {r.merge ? (
                      <span
                        className="sl-merge"
                        style={at(r.merge.at)}
                        title={`merged ${clock(r.merge.at)}`}
                      />
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
      <ul className="sl-key sc-note">
        <li>
          <span className="sl-key__bar" /> agent run
        </li>
        <li>
          <span className="sl-key__sub" /> helper agent inside a run
        </li>
        <li>
          <span className="sl-key__merge" /> merged into main
        </li>
        <li>
          <span className="sl-key__touch" /> owner message
        </li>
        <li>
          <span className="sl-key__gate" /> gate passed
        </li>
        <li>
          <span className="sl-key__idle" /> {TL.idle.thresholdMin} min or more with nothing running
        </li>
      </ul>
      {current ? <Details run={current} /> : null}
    </section>
  );
}
