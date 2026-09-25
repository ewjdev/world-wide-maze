/**
 * `/dev/input`: input sandbox and latency overlay (Phase 06). Pairs a phone as host, graphs raw vs
 * filtered tilt, shows buttons, RTT p50/p95, receive rate, jitter, bursts, lost frames and filter lag, and
 * samples the keyboard, gamepad and touch sources side by side.
 *
 * Query params: `?code=NNNNNN` reuses a room, `?pairBase=https://…` sets the origin encoded in the QR.
 * Automation: `window.__wwmInput.summary()` returns the session summary (also logged by "Log summary").
 */

import {
  GamepadInputSource,
  KeyboardInputSource,
  ONE_EURO_TILT_DEFAULTS,
  PhoneInputSource,
  StreamStats,
  TooTiltedDetector,
  TouchInputSource,
} from '@wwm/net';
import type { ControllerInputFrame, InputSample } from '@wwm/schema';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PairingPanel } from '../controller/PairingPanel.tsx';
import { useHostRoom } from '../controller/useHostRoom.ts';

interface Point {
  t: number;
  rawX: number;
  rawZ: number;
  fx: number;
  fz: number;
  power: boolean;
}

interface LogEntry {
  id: number;
  at: string;
  msg: string;
}

let logSeq = 0;

const HISTORY_MS = 6000;
const DEG = 180 / Math.PI;

export function InputSandbox() {
  const params =
    typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
  const room = useHostRoom(params.get('code') ? { code: params.get('code') as string } : {});
  const pairBase = params.get('pairBase') ?? undefined;
  const [filter, setFilter] = useState({ ...ONE_EURO_TILT_DEFAULTS });
  const [tick, setTick] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stickRef = useRef<HTMLDivElement>(null);
  const live = useRef({
    phone: null as PhoneInputSource | null,
    keyboard: null as KeyboardInputSource | null,
    gamepad: null as GamepadInputSource | null,
    touch: null as TouchInputSource | null,
    stream: new StreamStats(600),
    history: [] as Point[],
    samples: {} as Record<string, InputSample>,
    lastFrame: null as ControllerInputFrame | null,
    calibrated: 0,
    menus: { phone: 0, keyboard: 0, gamepad: 0, touch: 0 } as Record<string, number>,
    presses: { power: 0, jump: 0, menu: 0 },
    tooTilted: new TooTiltedDetector(),
    startedAt: 0,
  });

  const addLog = useCallback((msg: string) => {
    const e = { id: ++logSeq, at: new Date().toISOString().slice(11, 23), msg };
    console.info(`[wwm-input] ${msg}`);
    setLog((l) => [e, ...l].slice(0, 60));
  }, []);

  // Local sources (keyboard, gamepad, touch).
  useEffect(() => {
    const L = live.current;
    L.startedAt = performance.now();
    L.keyboard = new KeyboardInputSource();
    L.gamepad = new GamepadInputSource();
    L.touch = new TouchInputSource();
    const offs = [
      L.keyboard.on('menu', () => {
        L.menus.keyboard = (L.menus.keyboard ?? 0) + 1;
        addLog('keyboard: menu');
      }),
      L.gamepad.on('menu', () => {
        L.menus.gamepad = (L.menus.gamepad ?? 0) + 1;
        addLog('gamepad: menu');
      }),
      L.gamepad.on('connected', () => addLog('gamepad connected')),
      L.gamepad.on('disconnected', () => addLog('gamepad disconnected')),
      L.touch.on('menu', () => addLog('touch: menu')),
    ];
    const detach = stickRef.current ? L.touch.attachStick(stickRef.current) : () => {};
    return () => {
      for (const o of offs) o();
      detach();
      L.keyboard?.dispose();
      L.gamepad?.dispose();
      L.touch?.dispose();
    };
  }, [addLog]);

  // Phone source on the host connection.
  useEffect(() => {
    const conn = room.conn;
    if (!conn) return;
    const L = live.current;
    const phone = new PhoneInputSource(conn, { filter });
    L.phone = phone;
    let prevButtons = 0;
    const offs = [
      phone.on('connected', () => addLog('phone: connected')),
      phone.on('disconnected', () => addLog('phone: disconnected (Phase 08 would auto-pause here)')),
      phone.on('menu', () => {
        L.menus.phone = (L.menus.phone ?? 0) + 1;
        addLog('phone: MENU');
      }),
      conn.on('input', (f, at) => {
        L.stream.add(at, f.seq);
        L.lastFrame = f;
        const b = (f.power ? 1 : 0) | (f.jump ? 2 : 0) | (f.menu ? 4 : 0);
        const rising = b & ~prevButtons;
        if (rising & 1) {
          L.presses.power++;
          addLog('phone: POWER down');
        }
        if (rising & 2) {
          L.presses.jump++;
          addLog('phone: JUMP');
        }
        if (rising & 4) L.presses.menu++;
        prevButtons = b;
      }),
      conn.on('message', (m) => {
        if (m.t === 'calibrated') {
          L.calibrated++;
          addLog('phone: calibrated');
        }
      }),
      conn.on('peer', (role, on) => {
        if (role === 'controller' && on) L.stream.resetSeq();
      }),
    ];
    return () => {
      for (const o of offs) o();
      phone.dispose();
      L.phone = null;
    };
  }, [room.conn, filter, addLog]);

  // Sample everything each frame and draw.
  useEffect(() => {
    let raf = 0;
    let lastUi = 0;
    const L = live.current;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      for (const [k, src] of Object.entries({
        phone: L.phone,
        keyboard: L.keyboard,
        gamepad: L.gamepad,
        touch: L.touch,
      })) {
        if (src) L.samples[k] = src.sample(now);
      }
      const p = L.samples.phone;
      const f = L.phone?.debug(now);
      if (p && f) {
        L.history.push({
          t: now,
          rawX: f.stale ? 0 : (f.raw?.tiltX ?? 0),
          rawZ: f.stale ? 0 : (f.raw?.tiltZ ?? 0),
          fx: p.tiltX,
          fz: p.tiltZ,
          power: p.power,
        });
        if (f.raw && !f.stale) L.tooTilted.update(f.raw, now);
      }
      while (L.history.length && (L.history[0]?.t ?? now) < now - HISTORY_MS) L.history.shift();
      draw(canvasRef.current, L.history, now);
      if (now - lastUi > 100) {
        lastUi = now;
        setTick((t) => t + 1);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const summary = () => {
    const L = live.current;
    const now = performance.now();
    return {
      at: new Date().toISOString(),
      code: room.code,
      durationSec: +((now - L.startedAt) / 1000).toFixed(1),
      controllerConnected: room.controllerConnected,
      rttHostToPhone: room.conn?.rtt.summary() ?? null,
      receive: L.stream.summary(now),
      phone: L.phone?.debug(now) ?? null,
      lastFrame: L.lastFrame,
      buttonPresses: L.presses,
      menus: L.menus,
      calibratedMessages: L.calibrated,
      filter,
      samples: L.samples,
      userAgent: navigator.userAgent,
    };
  };
  (globalThis as unknown as { __wwmInput?: unknown }).__wwmInput = { summary };

  const L = live.current;
  const now = typeof performance === 'undefined' ? 0 : performance.now();
  const recv = L.stream.summary(now);
  const dbg = L.phone?.debug(now);
  const rtt = room.rtt;
  void tick;

  return (
    <section
      style={{
        display: 'grid',
        gap: 16,
        gridTemplateColumns: 'minmax(300px, 420px) 1fr',
        alignItems: 'start',
      }}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <h1 style={{ margin: 0 }}>Input sandbox</h1>
        <PairingPanel room={room} {...(pairBase ? { pairBase } : {})} />
        <button type="button" onClick={() => console.info('[wwm-input] summary', JSON.stringify(summary()))}>
          Log session summary
        </button>
        <HostTools room={room} />
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        <canvas
          ref={canvasRef}
          width={900}
          height={260}
          style={{ width: '100%', background: '#0b1020', borderRadius: 8 }}
        />
        <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>
          Phone tilt, last 6 s: thin = raw, thick = One Euro filtered. Cyan = roll (tiltX), orange = pitch
          (tiltZ). Grey band = POWER held. Scale ±45°.
        </p>
        <table data-testid="phone-stats" style={{ fontVariantNumeric: 'tabular-nums', fontSize: 14 }}>
          <tbody>
            <Row
              k="controller"
              v={room.controllerConnected ? 'connected' : 'not connected'}
              id="controller"
            />
            <Row
              k="RTT host↔phone p50 / p95"
              v={`${fmt(rtt?.p50)} / ${fmt(rtt?.p95)} ms (n=${rtt?.count ?? 0})`}
              id="rtt"
            />
            <Row k="receive rate" v={`${recv.ratePerSec} /s`} id="rate" />
            <Row
              k="inter-arrival p50 / p95"
              v={`${fmt(recv.intervalP50)} / ${fmt(recv.intervalP95)} ms`}
              id="interval"
            />
            <Row k="jitter (sd)" v={`${fmt(recv.jitterMs)} ms`} id="jitter" />
            <Row
              k="bursts / lost / out-of-order"
              v={`${recv.bursts} / ${recv.lost} / ${dbg?.droppedOutOfOrder ?? 0}`}
              id="loss"
            />
            <Row k="filter lag (τ)" v={`${fmt(dbg?.filterLagMs)} ms`} id="lag" />
            <Row
              k="raw tilt (roll, pitch)"
              v={dbg?.raw ? `${fmt(dbg.raw.tiltX * DEG)}°, ${fmt(dbg.raw.tiltZ * DEG)}°` : '—'}
              id="raw"
            />
            <Row k="stale" v={dbg?.stale ? 'yes (neutral)' : 'no'} id="stale" />
            <Row
              k="buttons now"
              v={
                L.lastFrame
                  ? `${L.lastFrame.power ? 'POWER ' : ''}${L.lastFrame.jump ? 'JUMP ' : ''}${L.lastFrame.menu ? 'MENU' : ''}` ||
                    '—'
                  : '—'
              }
              id="buttons"
            />
            <Row
              k="presses POWER / JUMP / MENU"
              v={`${L.presses.power} / ${L.presses.jump} / ${L.presses.menu}`}
              id="presses"
            />
            <Row k="calibrated messages" v={String(L.calibrated)} id="calibrated" />
            <Row k="Too tilted!" v={L.tooTilted.visible ? 'SHOWING' : 'no'} id="tootilted" />
          </tbody>
        </table>
        <FilterControls value={filter} onChange={setFilter} />
        <h3 style={{ margin: '8px 0 0' }}>All sources</h3>
        <table style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13 }} data-testid="source-samples">
          <thead>
            <tr>
              <th align="left">source</th>
              <th>roll°</th>
              <th>pitch°</th>
              <th>power</th>
              <th>jump</th>
              <th>menus</th>
            </tr>
          </thead>
          <tbody>
            {(['phone', 'keyboard', 'gamepad', 'touch'] as const).map((k) => {
              const s = L.samples[k];
              return (
                <tr key={k} data-testid={`sample-${k}`}>
                  <td>{k}</td>
                  <td align="center">{s ? fmt(s.tiltX * DEG) : '—'}</td>
                  <td align="center">{s ? fmt(s.tiltZ * DEG) : '—'}</td>
                  <td align="center">{s?.power ? '●' : '○'}</td>
                  <td align="center">{s?.jump ? '●' : '○'}</td>
                  <td align="center">{L.menus[k] ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div
            ref={stickRef}
            style={{
              width: 120,
              height: 120,
              borderRadius: '50%',
              background: '#1b2a4a',
              touchAction: 'none',
              display: 'grid',
              placeItems: 'center',
              color: '#e9f0ff',
              fontSize: 12,
            }}
          >
            touch stick
          </div>
          <p style={{ fontSize: 13, opacity: 0.8 }}>
            Keyboard: arrows/WASD tilt (any arrow = POWER), Shift = POWER, Space = jump, M/Esc = map. Gamepad:
            left stick, A, RT, Start.
          </p>
        </div>
        <h3 style={{ margin: '8px 0 0' }}>Events</h3>
        <ol
          data-testid="event-log"
          style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, maxHeight: 220, overflow: 'auto' }}
        >
          {log.map((e) => (
            <li key={e.id}>
              {e.at} {e.msg}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function HostTools({ room }: { room: ReturnType<typeof useHostRoom> }) {
  const [score, setScore] = useState(0);
  const send = (m: Parameters<NonNullable<typeof room.conn>['send']>[0]) => room.conn?.send(m);
  return (
    <fieldset style={{ display: 'grid', gap: 6 }}>
      <legend>Send to phone</legend>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(['item', 'large', 'fall', 'goal'] as const).map((p) => (
          <button key={p} type="button" onClick={() => send({ t: 'haptic', pattern: p })}>
            haptic {p}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => {
            const s = score + 100;
            setScore(s);
            send({ t: 'state', phase: 'play', score: s, balls: 3, timeLeft: 300 - s / 100 });
          }}
        >
          state: play (+100)
        </button>
        <button
          type="button"
          onClick={() => send({ t: 'state', phase: 'calibrate', score, balls: 3, timeLeft: 300 })}
        >
          state: calibrate
        </button>
        <button
          type="button"
          onClick={() => send({ t: 'state', phase: 'paused', score, balls: 3, timeLeft: 300 })}
        >
          state: paused
        </button>
      </div>
    </fieldset>
  );
}

function FilterControls({
  value,
  onChange,
}: {
  value: { minCutoff: number; beta: number; dCutoff: number };
  onChange: (v: { minCutoff: number; beta: number; dCutoff: number }) => void;
}) {
  const slider = (k: 'minCutoff' | 'beta' | 'dCutoff', min: number, max: number, step: number) => (
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
      <span style={{ width: 80 }}>{k}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value[k]}
        onChange={(e) => onChange({ ...value, [k]: Number(e.target.value) })}
      />
      <span>{value[k].toFixed(2)}</span>
    </label>
  );
  return (
    <fieldset>
      <legend>One Euro filter</legend>
      {slider('minCutoff', 0.1, 5, 0.05)}
      {slider('beta', 0, 5, 0.05)}
      {slider('dCutoff', 0.1, 5, 0.05)}
    </fieldset>
  );
}

function Row({ k, v, id }: { k: string; v: string; id: string }) {
  return (
    <tr>
      <td style={{ paddingRight: 16, opacity: 0.75 }}>{k}</td>
      <td data-testid={`stat-${id}`}>{v}</td>
    </tr>
  );
}

function fmt(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : v.toFixed(1);
}

function draw(c: HTMLCanvasElement | null, h: Point[], now: number): void {
  const ctx = c?.getContext('2d');
  if (!c || !ctx) return;
  const W = c.width;
  const H = c.height;
  ctx.clearRect(0, 0, W, H);
  const x = (t: number) => W - ((now - t) / HISTORY_MS) * W;
  const y = (rad: number) => H / 2 - (rad / (Math.PI / 4)) * (H / 2 - 8);
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  for (const p of h) if (p.power) ctx.fillRect(x(p.t), 0, 3, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();
  const line = (key: keyof Point, color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    h.forEach((p, i) => {
      const px = x(p.t);
      const py = y(p[key] as number);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  };
  line('rawX', 'rgba(92,200,255,0.6)', 1);
  line('rawZ', 'rgba(255,182,39,0.6)', 1);
  line('fx', '#5cc8ff', 3);
  line('fz', '#ffb627', 3);
}
