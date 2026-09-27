/**
 * THESIS: watch a real maze run and inspect each choice in place.
 * OWN-WORLD: existing WWM white sky, ink, teal, cut corners, Figtree and Unbounded.
 * STORY: choose a maze and policy, watch, pause, inspect, then revisit every saved run.
 * FIRST VIEWPORT: large live maze left, compact decision notebook right, controls below.
 * FORM: the approved spectator composition; extend the incumbent game identity.
 */
import { createEngine, type Engine } from '@wwm/engine';
import {
  FIXTURES,
  type Frame,
  fixture,
  LIMITS,
  type Policy,
  type Receipt,
  type RunDetail,
  type RunSummary,
} from '@wwm/maze-agent';
import { type BallState, type InputSample, SIM_HZ, type SimEvent } from '@wwm/schema';
import { useCallback, useEffect, useRef, useState } from 'react';
import '@fontsource-variable/figtree';
import '@fontsource-variable/unbounded';
import { type Availability, JevClient } from './client.ts';
import { ReplaySession, Session } from './session.ts';
import './jev.css';

const api = new JevClient();
function time(ticks: number) {
  return `${(ticks / SIM_HZ).toFixed(1)}s`;
}
function download(name: string, value: unknown, mime = 'application/json') {
  const blob = new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function texture(id: string) {
  const f = fixture(id);
  const canvas = document.createElement('canvas');
  canvas.width = f.stage.size.width;
  canvas.height = f.stage.size.height;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#eef3f3';
  c.fillRect(0, 0, canvas.width, canvas.height);
  for (const island of f.stage.islands) {
    const [x, y] = f.centers[island.id];
    c.fillStyle = island.id % 2 ? '#e0eef0' : '#e6ecdf';
    c.fillRect(x - 65, y - 65, 130, 130);
    c.fillStyle = '#385663';
    c.font = 'bold 13px Figtree';
    c.fillText(`ISLAND ${island.id + 1}`, x - 47, y - 39);
    c.fillStyle = '#b9ced0';
    for (let row = 0; row < 4; row++) c.fillRect(x - 47, y - 15 + row * 12, row === 3 ? 47 : 92, 3);
  }
  return canvas;
}
export default function JevPage() {
  const canvas = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const live = useRef<Session | null>(null);
  const replay = useRef<ReplaySession | null>(null);
  const [, render] = useState(0);
  const [fixtureId, setFixture] = useState('first-fork');
  const [policy, setPolicy] = useState<Policy>('baseline');
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'decision' | 'history'>('decision');
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [selected, setSelected] = useState(0);
  const [follow, setFollow] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [camera, setCamera] = useState<'map' | 'chase'>('map');
  const refresh = useCallback(() => render((n) => n + 1), []);
  const ball = (b: BallState, events: SimEvent[], input: InputSample | null) => {
    engine.current?.setBall(b);
    if (input) engine.current?.setControl(input);
    for (const e of events) engine.current?.handleEvent(e);
  };
  const reloadHistory = useCallback(async () => {
    try {
      const h = await api.history(query, offset);
      setHistory(h.runs);
      setTotal(h.total);
      setAvailability(h);
    } catch (e) {
      setError(String(e));
    }
  }, [query, offset]);
  useEffect(() => {
    void api
      .connect()
      .then(async (a) => {
        // Only this tab's owner capabilities trigger refresh recovery. History reads never do.
        for (const key of Object.keys(sessionStorage).filter((k) => k.startsWith('jev-owner:'))) {
          const owner = sessionStorage.getItem(key);
          await api
            .request(`runs/${key.slice(10)}/command`, {
              owner,
              documentId: crypto.randomUUID(),
              epoch: 0,
              type: 'heartbeat',
              data: {},
            })
            .catch(() => {});
          const prior = await api.detail(key.slice(10)).catch(() => null);
          if (prior && ['finished', 'failed', 'stopped', 'interrupted'].includes(prior.summary.status))
            sessionStorage.removeItem(key);
          else
            setError(
              'Previous run recovery is pending. Reload after the server reconnects; its ownership is retained.',
            );
        }
        setAvailability(a);
        if (a.available) setPolicy('jev');
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    let dead = false;
    let raf = 0;
    let last = performance.now();
    let owned: Engine | null = null;
    const container = canvas.current;
    if (!container) return;
    const host = container;
    const element = document.createElement('canvas');
    element.setAttribute('aria-label', 'Live 3D maze');
    container.append(element);
    const resize = new ResizeObserver(() => engine.current?.resize(host.clientWidth, host.clientHeight));
    resize.observe(host);
    void createEngine({
      canvas: element,
      quality: 'low',
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      forceWebGL: true,
      maxDpr: 1.5,
    })
      .then(async (e) => {
        owned = e;
        if (dead) {
          e.dispose();
          return;
        }
        engine.current = e;
        e.resize(host.clientWidth, host.clientHeight);
        await e.loadStage(fixture('first-fork').stage, texture('first-fork'));
        if (dead) return;
        e.setView('map');
        setReady(true);
        const frame = (now: number) => {
          if (dead) return;
          const dt = Math.min((now - last) / 1000, 0.1);
          last = now;
          live.current?.advance(dt);
          replay.current?.advance(dt);
          e.frame(dt);
          raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
      })
      .catch((e) => setError(`Renderer: ${e.message}`));
    const visibility = () => {
      if (document.hidden) {
        void live.current?.pause();
        if (replay.current) replay.current.paused = true;
      }
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      resize.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      void live.current?.dispose();
      replay.current?.dispose();
      owned?.dispose();
      element.remove();
      engine.current = null;
    };
  }, []);
  useEffect(() => {
    if (tab === 'history' && api.token) void reloadHistory();
  }, [tab, reloadHistory]);
  async function showStage(id: string) {
    await engine.current?.loadStage(fixture(id).stage, texture(id));
    engine.current?.setView(camera);
  }
  async function start() {
    setBusy(true);
    setError(null);
    try {
      const parent = live.current?.view.runId ?? null;
      await live.current?.dispose();
      live.current = null;
      replay.current?.dispose();
      replay.current = null;
      setDetail(null);
      setSelected(0);
      setFollow(true);
      await showStage(fixtureId);
      const s = new Session(api, fixtureId, policy, 0);
      live.current = s;
      s.onChange = refresh;
      s.onBall = ball;
      await s.create(parent);
      await s.resume();
      setTab('decision');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      refresh();
    }
  }
  async function openRun(id: string, play = false, imported?: RunDetail) {
    setBusy(true);
    setError(null);
    try {
      await live.current?.dispose();
      live.current = null;
      replay.current?.dispose();
      replay.current = null;
      const d = imported ?? (await api.detail(id));
      const r = new ReplaySession(d);
      setDetail(d);
      setSelected(0);
      setFixture(d.summary.fixture);
      await showStage(d.summary.fixture);
      r.onBall = ball;
      r.onChange = refresh;
      replay.current = r;
      await r.init();
      r.paused = !play;
      setTab('decision');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      refresh();
    }
  }
  async function exportSummary() {
    const rows: RunSummary[] = [];
    for (let page = 0; ; page += 20) {
      const h = await api.history('', page);
      rows.push(...h.runs);
      if (rows.length >= h.total) break;
    }
    const columns = [
      'id',
      'fixture',
      'policy',
      'model',
      'status',
      'createdAt',
      'endedAt',
      'tick',
      'decisions',
      'attempts',
      'reason',
    ] as const;
    const cell = (value: unknown) => {
      const t = String(value ?? '');
      return '"' + (/^[=+@\-\t\r]/.test(t) ? "'" : '') + t.replaceAll('"', '""') + '"';
    };
    download(
      'jev-run-summary.csv',
      [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n'),
      'text/csv',
    );
  }
  const v = live.current?.view;
  useEffect(() => {
    if (follow && !detail) setSelected(Math.max(0, (v?.decisions.length ?? 0) - 1));
  }, [follow, detail, v?.decisions.length]);
  const frames = detail
    ? detail.events.filter((e) => e.type === 'frame').map((e) => e.data.frame as Frame)
    : (v?.decisions ?? []);
  const receipts = detail
    ? detail.events.filter((e) => e.type === 'receipt').map((e) => e.data.receipt as Receipt)
    : (v?.receipts ?? []);
  const frame = frames[Math.min(selected, Math.max(0, frames.length - 1))] ?? null;
  const choices = frame ? receipts.filter((r) => r.decisionId === frame.id) : [];
  const latest = choices.at(-1);
  const elapsed = replay.current?.tick ?? v?.tick ?? 0;
  const phase = replay.current ? 'recorded run' : (v?.phase ?? 'ready');
  const errors = error ?? v?.error ?? replay.current?.error;
  const f = fixture(fixtureId);
  return (
    <main className={`jev-page ${collapsed ? 'is-collapsed' : ''}`}>
      <header className="jev-header">
        <a className="jev-brand" href="/">
          World Wide Maze
        </a>
        <h1>Watch Jev</h1>
        <button
          type="button"
          className="jev-history-button"
          onClick={() => {
            setCollapsed(false);
            setTab(tab === 'history' ? 'decision' : 'history');
          }}
        >
          {tab === 'history' ? 'Back to decisions' : `Run history${total ? ` (${total})` : ''}`}
        </button>
      </header>
      <div className="jev-workspace">
        <section className="jev-stage" aria-label="Maze spectator">
          <div ref={canvas} className="jev-canvas-host" />
          <div className="jev-stage-title">
            <h2>{f.title}</h2>
            <p>
              {replay.current
                ? 'Recorded run — no model calls'
                : `${policy === 'jev' ? 'Jev chooses' : policy === 'scripted' ? 'Scripted demo chooses' : 'Baseline explorer chooses'} · physics controller steers`}
            </p>
          </div>
          <div className="jev-view">
            <button
              type="button"
              aria-pressed={camera === 'map'}
              onClick={() => {
                setCamera('map');
                engine.current?.setView('map');
              }}
            >
              Overview
            </button>
            <button
              type="button"
              aria-pressed={camera === 'chase'}
              onClick={() => {
                setCamera('chase');
                engine.current?.setView('chase');
              }}
            >
              Follow ball
            </button>
          </div>
          <div className="jev-stage-footer">
            <span className={`jev-status ${phase === 'executing' ? 'is-active' : ''}`} aria-live="polite">
              {phase === 'deciding'
                ? policy === 'jev'
                  ? 'Waiting for Jev'
                  : 'Choosing next branch'
                : phase === 'executing'
                  ? 'Local steering'
                  : phase}
            </span>
            <span>
              {time(elapsed)} active · {frames.length} decisions
            </span>
          </div>
          {!ready && <p className="jev-loading">Preparing the maze…</p>}
        </section>
        <button
          className="jev-collapse"
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? 'Show notebook' : 'Hide notebook'}
        </button>
        <aside className="jev-notebook" aria-label={tab === 'history' ? 'Run history' : 'Decision notebook'}>
          {tab === 'history' ? (
            <>
              <div className="jev-panel-heading">
                <h2>Every run</h2>
                <button type="button" onClick={() => void reloadHistory()}>
                  Refresh
                </button>
              </div>
              <p className="jev-muted">
                Saved locally. Failed and interrupted runs stay here too.{' '}
                {((availability?.archiveBytes ?? 0) / 1048576).toFixed(1)} / 512 MiB used.
              </p>
              <div className="jev-import-export">
                <button type="button" onClick={() => void exportSummary().catch((e) => setError(e.message))}>
                  Export summary CSV
                </button>
                <label>
                  Import recording
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > LIMITS.runBytes) {
                        setError('Import exceeds 32 MiB limit');
                        return;
                      }
                      void file
                        .text()
                        .then(JSON.parse)
                        .then((d) => openRun('', false, d))
                        .catch((e) => setError(e.message));
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              <label className="jev-search">
                Find a run
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setOffset(0);
                  }}
                  placeholder="Maze, model, status, date or run ID"
                />
              </label>
              <div className="jev-run-list">
                {history.map((r) => (
                  <button className="jev-run" type="button" key={r.id} onClick={() => void openRun(r.id)}>
                    <span>
                      <strong>{fixture(r.fixture).title}</strong>
                      <em>{r.status}</em>
                    </span>
                    <span>
                      {r.policy === 'jev'
                        ? r.model
                        : r.policy === 'scripted'
                          ? 'Scripted demo'
                          : 'Baseline explorer'}{' '}
                      · {time(r.tick)} · {r.decisions} decisions
                    </span>
                    <small>{new Date(r.createdAt).toLocaleString()}</small>
                    <code>{r.id.slice(0, 8)}</code>
                  </button>
                ))}
                {!history.length && (
                  <p className="jev-empty">
                    No runs yet. Start an explorer and its full decision trail will appear here.
                  </p>
                )}
              </div>
              <div className="jev-pages">
                <button disabled={!offset} type="button" onClick={() => setOffset(Math.max(0, offset - 20))}>
                  Previous
                </button>
                <span>{total} runs</span>
                <button disabled={offset + 20 >= total} type="button" onClick={() => setOffset(offset + 20)}>
                  Next
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="jev-panel-heading">
                <h2>{detail ? 'Run notebook' : 'Decision notebook'}</h2>
                <span className="jev-count">{frames.length}</span>
              </div>
              <p className="jev-muted">What was known. What was chosen. What happened.</p>
              {!frames.length ? (
                <div className="jev-empty">
                  <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true">
                    <path d="M8 8h18v14H16v14h24V22h8v26H8V8Z" stroke="currentColor" strokeWidth="2" />
                    <circle cx="39" cy="9" r="4" fill="currentColor" />
                  </svg>
                  <h3>A maze, one choice at a time.</h3>
                  <p>
                    Watch the explorer discover branches. Each choice is saved here with the options it could
                    see.
                  </p>
                </div>
              ) : (
                <>
                  <label className="jev-field">
                    Decision
                    <select
                      value={Math.min(selected, frames.length - 1)}
                      onChange={(e) => {
                        setSelected(Number(e.target.value));
                        setFollow(false);
                      }}
                    >
                      {frames.map((fr, i) => (
                        <option key={fr.id} value={i}>
                          {i + 1}. {fr.observation.current} · {time(fr.tick)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="jev-knowledge">
                    <span>Known islands</span>
                    <strong>{frame?.observation.nodes.length}</strong>
                    <span>Current position</span>
                    <strong>{frame?.observation.current}</strong>
                  </div>
                  {frame && <DiscoveredGraph frame={frame} choice={latest?.choice} />}
                  <h3>Available paths</h3>
                  <div className="jev-options">
                    {frame?.candidates.map((c) => (
                      <div key={c.id} className={`jev-option ${latest?.choice === c.id ? 'is-chosen' : ''}`}>
                        <div>
                          <strong>{c.direction}</strong>
                          <span>{c.destination ?? 'Unexplored island'}</span>
                        </div>
                        <div>
                          <strong>
                            {latest?.probabilities
                              ? `${Math.round(latest.probabilities[c.id] * 100)}%`
                              : latest?.choice === c.id
                                ? 'Chosen'
                                : '—'}
                          </strong>
                          <small>{c.traversals ? `${c.traversals} crossings` : 'Untraversed'}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                  {latest && (
                    <p className="jev-choice">
                      {latest.source === 'jev'
                        ? 'Jev'
                        : latest.source.startsWith('forced')
                          ? 'Forced move'
                          : 'Local explorer'}{' '}
                      selected{' '}
                      <strong>{frame?.candidates.find((c) => c.id === latest.choice)?.direction}</strong>.
                      {latest.confidence !== null &&
                        ` Reported confidence: ${Math.round(latest.confidence * 100)}%.`}{' '}
                      <span>
                        {Math.round(latest.latencyMs)} ms · {latest.status}
                      </span>
                      {latest.confidence !== null && (
                        <small> Confidence is the provider’s estimate, not measured accuracy.</small>
                      )}
                    </p>
                  )}
                  <details>
                    <summary>Exact observation</summary>
                    <pre>{JSON.stringify(frame?.observation, null, 2)}</pre>
                  </details>
                  <details>
                    <summary>All attempts & returned decisions ({choices.length})</summary>
                    <pre>{JSON.stringify(choices, null, 2)}</pre>
                  </details>
                  {detail && (
                    <details>
                      <summary>Request, response & action evidence</summary>
                      <pre>
                        {JSON.stringify(
                          detail.events.filter(
                            (e) =>
                              e.data.decisionId === frame?.id ||
                              (e.data.frame as Frame | undefined)?.id === frame?.id ||
                              choices.some((c) => c.attemptId === e.data.attemptId),
                          ),
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  )}
                  {detail && (
                    <button
                      className="jev-wide"
                      type="button"
                      onClick={() => {
                        void replay.current?.seek(frame?.tick ?? 0).catch((e) => setError(e.message));
                      }}
                    >
                      Show this decision in the maze
                    </button>
                  )}
                  {!detail && frames.length > 1 && selected !== frames.length - 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(frames.length - 1);
                        setFollow(true);
                      }}
                    >
                      Jump to latest choice
                    </button>
                  )}
                </>
              )}
              {!detail && v?.paused && v.runId && (
                <button type="button" onClick={() => void openRun(v.runId!)}>
                  End & inspect saved evidence
                </button>
              )}
              {detail && (
                <div className="jev-record-summary">
                  <p>
                    <strong>{detail.summary.status}</strong> · {detail.summary.reason ?? 'Run recorded'}
                  </p>
                  <p>
                    Saved through {time(detail.summary.tick)}.{' '}
                    {detail.summary.status === 'interrupted'
                      ? 'An unacknowledged movement suffix may be missing.'
                      : ''}
                  </p>
                  <button type="button" onClick={() => download(`jev-${detail.summary.id}.json`, detail)}>
                    Export full run
                  </button>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
      <footer className="jev-controls">
        <div className="jev-setup">
          <label>
            Maze
            <select
              value={fixtureId}
              disabled={busy || (!!live.current && !live.current.closed)}
              onChange={(e) => {
                setFixture(e.target.value);
                void showStage(e.target.value);
              }}
            >
              {FIXTURES.filter((f) => f.id !== 'confirmation').map((f) => (
                <option key={f.id} value={f.id}>
                  {f.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Explorer
            <select
              aria-label="Explorer"
              value={policy}
              disabled={busy || (!!live.current && !live.current.closed)}
              onChange={(e) => setPolicy(e.target.value as Policy)}
            >
              <option value="jev">Jev {availability?.available ? '— live' : '— key needed'}</option>
              <option value="baseline">Baseline explorer</option>
              <option value="scripted">Scripted demo</option>
            </select>
          </label>
        </div>
        <div className="jev-actions">
          {replay.current ? (
            <>
              <button
                type="button"
                className="jev-primary"
                onClick={() => {
                  const r = replay.current!;
                  if (r.tick === r.inputs.length)
                    void r.seek(0).then(() => {
                      r.paused = false;
                      refresh();
                    });
                  else {
                    r.paused = !r.paused;
                    refresh();
                  }
                }}
              >
                {replay.current.paused ? 'Play recording' : 'Pause recording'}
              </button>
              <label className="jev-speed">
                Speed
                <select
                  defaultValue="1"
                  onChange={(e) => {
                    if (replay.current) replay.current.speed = Number(e.target.value);
                  }}
                >
                  <option value="0.5">½×</option>
                  <option value="1">1×</option>
                  <option value="2">2×</option>
                  <option value="4">4×</option>
                </select>
              </label>
              <button type="button" onClick={() => void start()} disabled={busy}>
                New run
              </button>
            </>
          ) : !live.current || live.current.closed ? (
            <button
              className="jev-primary"
              type="button"
              onClick={() => void start()}
              disabled={!ready || !availability || busy}
            >
              {busy ? 'Preparing…' : live.current ? 'Run again' : 'Start watching'}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="jev-primary"
                disabled={!!v?.paused && (busy || live.current.working || live.current.flushing)}
                onClick={() => {
                  if (v?.paused) void live.current?.resume();
                  else void live.current?.pause();
                }}
              >
                {v?.paused ? 'Resume' : 'Pause'}
              </button>
              <button
                type="button"
                disabled={!v?.paused || live.current.working || live.current.flushing}
                onClick={() => void live.current?.resume(true)}
              >
                Next decision
              </button>
              <button
                type="button"
                onClick={() => {
                  void live.current?.end().catch((e) => setError(e.message));
                }}
              >
                End run
              </button>
            </>
          )}
        </div>
        <p className="jev-provider">
          {availability?.available
            ? `Jev connected · ${availability.attempts}/${availability.limit} provider attempts`
            : 'Jev key not configured · baseline and replay work locally'}
          <span>
            {v?.runId
              ? `Run ${v.runId.slice(0, 8)} · saved through ${time(v.savedTick)}`
              : 'All runs and observed decisions are saved on this computer.'}
          </span>
        </p>
        {errors && (
          <div className="jev-error" role="alert">
            <strong>Run paused</strong>
            <span>{errors}</span>
            <button type="button" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}
      </footer>
    </main>
  );
}

function DiscoveredGraph({ frame, choice }: { frame: Frame; choice?: string }) {
  const nodes = frame.observation.nodes;
  const point = (id: string) => {
    const i = nodes.findIndex((n) => n.id === id);
    const a = (i * 2 * Math.PI) / Math.max(1, nodes.length) - Math.PI / 2;
    return [150 + Math.cos(a) * 100, 75 + Math.sin(a) * 48];
  };
  return (
    <figure className="jev-graph">
      <figcaption>Discovered graph · {nodes.length} islands</figcaption>
      <svg viewBox="0 0 300 150" role="img" aria-label="Known islands and connections, current island filled">
        {frame.observation.edges
          .filter((e) => e.to)
          .map((e) => {
            const a = point(e.from),
              b = point(e.to!);
            return (
              <line
                key={e.id}
                x1={a[0]}
                y1={a[1]}
                x2={b[0]}
                y2={b[1]}
                stroke={choice === e.id ? '#237c85' : '#a0b4b7'}
                strokeWidth={choice === e.id ? 4 : 2}
              />
            );
          })}
        {nodes.map((n) => {
          const [x, y] = point(n.id);
          return (
            <g key={n.id}>
              <circle
                cx={x}
                cy={y}
                r="12"
                fill={n.id === frame.observation.current ? '#237c85' : '#fff'}
                stroke="#237c85"
                strokeWidth="2"
              />
              <text
                x={x}
                y={y + 4}
                textAnchor="middle"
                fill={n.id === frame.observation.current ? '#fff' : '#203b42'}
                fontSize="10"
              >
                {n.id.replace('island-', '')}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
