/**
 * The build clock: the whole build on one 12-hour dial. The outer ring is the wall clock, from the empty project
 * folder to the snapshot commit; dots are the owner's messages; coloured arcs are agent runs (packed into lanes
 * so parallel runs sit side by side); the inner ring is the orchestrating session; a tick marks where Night 1
 * ends. On load a hand sweeps the build and paints each arc as it passes. All geometry comes from timeline.json.
 * The headline is Night 1 (the first segment); later segments follow it, never folded into it.
 */
import { type CSSProperties, useState } from 'react';
import { clock, dialHours, dur, FIRST, fmtInt, LATER, type Segment, TL, WAVE_NAMES } from './story.ts';

const SWEEP_S = 3.6;
const R_WALL = 166;
const R_LANE0 = 146;
const LANE_GAP = 13;
const R_ORCH = 64;

const t0 = Date.parse(TL.wallClock.start);
/** "10h 13m", for the dial's centre. */
const short = (min: number) => dur(min).replace(' min', 'm').replace(' h ', 'h ');
const h0 = dialHours(TL.wallClock.start);
/** Angle on the dial (radians from 12 o'clock, clockwise), continuous across midnight. */
const angle = (iso: string) => ((h0 + (Date.parse(iso) - t0) / 3_600_000) / 12) * 2 * Math.PI;
const pt = (r: number, a: number) => `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`;
function arc(r: number, a0: number, a1: number): string {
  const sweep = Math.max(a1 - a0, 0.004);
  return `M ${pt(r, a0)} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${pt(r, a0 + sweep)}`;
}
const f = (iso: string) => (Date.parse(iso) - t0) / (Date.parse(TL.wallClock.end) - t0);
const timing = (start: string, end: string): CSSProperties =>
  ({
    '--delay': `${(f(start) * SWEEP_S).toFixed(3)}s`,
    '--dur': `${Math.max(0.05, (f(end) - f(start)) * SWEEP_S).toFixed(3)}s`,
  }) as CSSProperties;

export const WAVE_COLOR = [
  'var(--ink-2)',
  'var(--teal)',
  'var(--green)',
  'var(--red)',
  'var(--gold)',
  'var(--violet)',
];

export function Dial({ caption = true }: { caption?: boolean }) {
  const a0 = angle(TL.wallClock.start);
  const a1 = angle(TL.wallClock.end);
  const deg = (a: number) => `${((a * 180) / Math.PI).toFixed(2)}deg`;
  /** SVG's transform attribute takes plain degrees (no unit); CSS custom properties take `deg`. */
  const rot = (a: number) => ((a * 180) / Math.PI).toFixed(2);
  const maxLane = Math.max(...TL.runs.map((r) => r.lane));
  return (
    <svg
      className="bc-dial"
      viewBox="-200 -200 400 400"
      role="img"
      aria-label={`A 12-hour clock face. ${FIRST.label} ran from ${clock(FIRST.wallClock.start)} to ${clock(FIRST.wallClock.end)}, ${dur(FIRST.wallClock.min)}; the build so far ends at ${clock(TL.wallClock.end)}, ${dur(TL.wallClock.min)} in all. Coloured arcs show ${TL.agents.runs} agent runs, up to ${TL.agents.maxConcurrent} at once.`}
    >
      <circle r="196" className="bc-face" />
      {Array.from({ length: 60 }, (_, k) => {
        const a = (k / 60) * 2 * Math.PI;
        const major = k % 5 === 0;
        return (
          <line
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed tick marks
            key={k}
            className={major ? 'bc-tick bc-tick--h' : 'bc-tick'}
            x1={(188 * Math.sin(a)).toFixed(2)}
            y1={(-188 * Math.cos(a)).toFixed(2)}
            x2={((major ? 178 : 184) * Math.sin(a)).toFixed(2)}
            y2={(-(major ? 178 : 184) * Math.cos(a)).toFixed(2)}
          />
        );
      })}
      {[12, 3, 6, 9].map((h) => {
        const a = ((h % 12) / 12) * 2 * Math.PI;
        return (
          <text
            key={h}
            className="bc-num"
            x={(166 * Math.sin(a)).toFixed(1)}
            y={(-166 * Math.cos(a) + 4).toFixed(1)}
          >
            {h}
          </text>
        );
      })}
      {/* the wall clock: the full span faint, the active stretches in ink */}
      <path className="bc-wall" d={arc(R_WALL - 16, a0, a1)} />
      {TL.active.spans.map((s) => (
        <path
          key={s.start}
          className="bc-active bc-draw"
          pathLength={1}
          style={timing(s.start, s.end)}
          d={arc(R_WALL - 16, angle(s.start), angle(s.end))}
        />
      ))}
      {TL.runs.map((r) => (
        <path
          key={r.agentId}
          className={`bc-run bc-draw bc-run--${r.kind}`}
          pathLength={1}
          style={{ ...timing(r.span.start, r.span.end), stroke: WAVE_COLOR[r.wave] ?? 'var(--ink)' }}
          d={arc(R_LANE0 - 14 - r.lane * LANE_GAP, angle(r.span.start), angle(r.span.end))}
        >
          <title>{`${r.kind === 'helper' ? 'Helper' : `Phase ${r.phase}`}: ${r.title} · ${clock(r.span.start)}–${clock(r.span.end)} · ${dur(r.span.min)}`}</title>
        </path>
      ))}
      {TL.orchestratorTurns.map((s) => (
        <path
          key={s.start}
          className="bc-orch bc-draw"
          pathLength={1}
          style={timing(s.start, s.end)}
          d={arc(R_LANE0 - 14 - (maxLane + 1) * LANE_GAP - 4, angle(s.start), angle(s.end))}
        />
      ))}
      {TL.owner.touchpoints.map((p) => {
        const a = angle(p.at);
        return (
          <g key={`${p.at}-${p.kind}`} className="bc-touch bc-pop" style={timing(p.at, p.at)}>
            <circle
              cx={(R_WALL - 16) * Math.sin(a)}
              cy={-(R_WALL - 16) * Math.cos(a)}
              r={p.kind === 'device test' ? 6 : 4.5}
            />
            <title>{`${clock(p.at)}: ${p.label}`}</title>
          </g>
        );
      })}
      <g
        className="bc-hand"
        style={{ '--a0': deg(a0), '--a1': deg(a1), '--sweep': `${SWEEP_S}s` } as CSSProperties}
      >
        <line x1="0" y1="10" x2="0" y2={-(R_WALL + 4)} />
        <circle r="4" />
      </g>
      <line
        className="bc-start"
        x1="0"
        y1={-(R_WALL - 24)}
        x2="0"
        y2={-(R_WALL - 8)}
        transform={`rotate(${rot(a0)})`}
      />
      {LATER.map((s) => (
        <line
          key={s.id}
          className="bc-seg"
          x1="0"
          y1={-(R_WALL - 28)}
          x2="0"
          y2={-(R_WALL + 6)}
          transform={`rotate(${rot(angle(s.wallClock.start))})`}
        >
          <title>{`${clock(s.wallClock.start)}: ${s.label} begins`}</title>
        </line>
      ))}
      <g className="bc-center">
        <circle r={R_ORCH - 14} />
        {caption ? (
          <>
            <text y={LATER.length ? -12 : -6} className="bc-big">
              {short(FIRST.wallClock.min)}
            </text>
            <text y={LATER.length ? 8 : 16} className="bc-small">
              {FIRST.label.toLowerCase()}
            </text>
            {LATER.map((s, k) => (
              <text key={s.id} y={26 + k * 14} className="bc-small bc-small--later">
                +{short(s.wallClock.min)} {s.label.toLowerCase()}
              </text>
            ))}
          </>
        ) : null}
      </g>
    </svg>
  );
}

/** The four measured facts of one segment. */
function Facts({ seg }: { seg: Segment }) {
  const stretches = seg.idle.spans.length;
  return (
    <dl className="bc-facts">
      <div>
        <dt>{dur(seg.activeMin)}</dt>
        <dd>
          with an agent or the orchestrating session at work. The other {dur(seg.idle.min)} were{' '}
          {stretches === 1 ? 'one stretch' : `${stretches} stretches`} of {TL.idle.thresholdMin} minutes or
          more with nothing running, waiting on the owner.
        </dd>
      </div>
      <div>
        <dt>{dur(seg.agents.agentMin)}</dt>
        <dd>
          of agent time, summed over {seg.agents.runs} runs of {TL.agents.model ?? 'the model'}:{' '}
          {seg.agents.runs - seg.agents.helperRuns} for phases and fixes, {seg.agents.helperRuns} helpers. Up
          to {seg.agents.maxConcurrent} ran at once.
        </dd>
      </div>
      <div>
        <dt>{seg.owner.messages} messages</dt>
        <dd>
          from the owner, {fmtInt(seg.owner.words)} words in all, and one iPhone test. The longest gap between
          messages was {dur(seg.owner.longestAway.min)}; agents put in {dur(seg.owner.agentMinWhileAway)} of
          work inside it.
        </dd>
      </div>
      <div>
        <dt>{seg.tests ? `${fmtInt(seg.tests.passed)} tests` : `${fmtInt(seg.lines.source)} lines`}</dt>
        <dd>
          {seg.tests ? `passing, ${fmtInt(seg.lines.source)} lines of source` : 'of source'} and{' '}
          {fmtInt(seg.lines.test)} of tests, in {seg.git.commits} commits, at <code>{seg.end.sha}</code>.
        </dd>
      </div>
    </dl>
  );
}

/** A later segment, in one paragraph, and the running total. */
function Later({ seg }: { seg: Segment }) {
  return (
    <div className="bc-later">
      <p className="bc-later__head">
        <span className="bc-eyebrow">{seg.label}</span>{' '}
        <span className="sc-mono">
          {clock(seg.wallClock.start)} → {clock(seg.wallClock.end, true)}
        </span>
      </p>
      <p className="bc-later__body">
        <strong>{dur(seg.wallClock.min)} more</strong>: {seg.what} {dur(seg.agents.agentMin)} of agent time
        over {seg.agents.runs} runs, up to {seg.agents.maxConcurrent} at once; {seg.owner.messages} messages
        from the owner, {fmtInt(seg.owner.words)} words; {seg.git.commits} commits.
      </p>
    </div>
  );
}

export function BuildClock() {
  const [take, setTake] = useState(0);
  return (
    <section className="bc" aria-labelledby="clock">
      <div className="bc-copy">
        <p className="bc-eyebrow">
          {FIRST.label} · {clock(FIRST.wallClock.start)} → {clock(FIRST.wallClock.end)}
        </p>
        <h1 className="bc-title" id="clock">
          Built in <span className="bc-num-hl">{dur(FIRST.wallClock.min)}</span> of wall-clock time
        </h1>
        <p className="bc-lede">
          From an empty project folder at {clock(FIRST.wallClock.start, true)} to commit{' '}
          <code>{FIRST.end.sha}</code> at {clock(FIRST.wallClock.end, true)} (Pacific time), where the fifth
          wave of work began. The clock counts every pause.
        </p>
        <Facts seg={FIRST} />
        {LATER.map((s) => (
          <Later key={s.id} seg={s} />
        ))}
        {LATER.length ? (
          <p className="bc-total">
            <strong>{dur(TL.wallClock.min)}</strong> in all, from the empty folder to commit{' '}
            <code>{TL.asOf.sha}</code> at {clock(TL.wallClock.end, true)}: {fmtInt(TL.tests.passed)} tests
            passing, {fmtInt(TL.lines.total.source)} lines of source and {fmtInt(TL.lines.total.test)} of
            tests in {TL.git.commits} commits, {dur(TL.agents.agentMin)} of agent time over {TL.agents.runs}{' '}
            runs.
          </p>
        ) : null}
      </div>
      <figure className="bc-fig">
        <Dial key={take} />
        <figcaption>
          <ul className="bc-legend">
            {Object.entries(WAVE_NAMES).map(([w, name]) => (
              <li key={w}>
                <span className="bc-swatch" style={{ background: WAVE_COLOR[Number(w)] }} />
                Wave {w}: {name}
              </li>
            ))}
          </ul>
          <p className="bc-caption">
            Outer ring: the wall clock, darker where something was running. Dots: the owner’s messages. Arcs:
            agent runs. Inner ring: the orchestrating session.
            {LATER.map((s) => (
              <span key={s.id}>
                {' '}
                The long tick at {clock(s.wallClock.start)} is where {s.label.toLowerCase()} begins.
              </span>
            ))}{' '}
            <button type="button" className="bc-replay" onClick={() => setTake((k) => k + 1)}>
              Replay the build
            </button>
          </p>
        </figcaption>
      </figure>
    </section>
  );
}
