#!/usr/bin/env node
/**
 * Load test: N concurrent rooms relaying 60 Hz controller input (Phase 12, task 4).
 * Plain Node (≥ 22, built-in WebSocket), no k6/Artillery install needed.
 *
 *   node tests/load/rooms.mjs http://localhost:8899 [--rooms 200] [--seconds 30] [--hz 60] [--ramp-ms 5000]
 *                              [--spoof-ips] [--out result.json]
 *
 * Per room: `POST /api/rooms`, a host and a controller socket, then the controller sends the contract's 12-byte
 * INPUT frame at `--hz` (plus a `state` text frame from the host at 4 Hz, like the game). The host decodes the
 * sequence number and measures the relay's one-way latency (same machine, same clock) and loss. Both sides
 * answer the relay's keepalive pings. `--spoof-ips` sends a distinct `cf-connecting-ip` per room so the
 * per-IP room limits (30 creates / min) don't cap the test: that only works locally; Cloudflare's edge
 * overwrites the header in production.
 *
 * Local numbers measure THIS machine's workerd + this load generator, not Cloudflare's edge.
 */
import { writeFileSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const base = (args.find((a) => /^https?:/.test(a)) ?? 'http://localhost:8899').replace(/\/$/, '');
const ROOMS = Number(opt('--rooms', '200'));
const SECONDS = Number(opt('--seconds', '30'));
const HZ = Number(opt('--hz', '60'));
const RAMP_MS = Number(opt('--ramp-ms', '5000'));
const spoof = args.includes('--spoof-ips');
const out = opt('--out', null);

const wsBase = base.replace(/^http/, 'ws');
const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();

function frame(seq, t) {
  const b = new ArrayBuffer(12);
  const v = new DataView(b);
  v.setUint8(0, 1);
  v.setUint8(1, seq % 30 === 0 ? 1 : 0);
  v.setUint16(2, seq & 0xffff, true);
  v.setFloat32(4, Math.sin(t / 500) * 0.3, true);
  v.setFloat32(8, 0.2, true);
  return b;
}

function open(url, headers) {
  return new Promise((resolve, reject) => {
    // Node's (undici) WebSocket accepts non-standard `headers` in its init object.
    const ws = headers ? new WebSocket(url, { headers }) : new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    const timer = setTimeout(() => reject(new Error('ws open timeout')), 15_000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve(ws);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('ws error'));
    };
  });
}

const stats = {
  createOk: 0,
  createFail: {},
  socketsOk: 0,
  socketFail: 0,
  closes: {},
  sent: 0,
  received: 0,
  latencies: [],
  pingsAnswered: 0,
};

async function runRoom(i) {
  const headers = spoof ? { 'cf-connecting-ip': `198.18.${(i >> 8) & 255}.${i & 255}` } : {};
  const res = await fetch(`${base}/api/rooms`, { method: 'POST', headers });
  if (!res.ok) {
    stats.createFail[res.status] = (stats.createFail[res.status] ?? 0) + 1;
    return null;
  }
  stats.createOk++;
  const { code, hostToken, pairToken } = await res.json();
  let host;
  let ctl;
  try {
    host = await open(
      `${wsBase}/api/rooms/${code}/ws?role=host&token=${hostToken}`,
      spoof ? headers : undefined,
    );
    ctl = await open(
      `${wsBase}/api/rooms/${code}/ws?role=controller&token=${pairToken}`,
      spoof ? headers : undefined,
    );
    stats.socketsOk += 2;
  } catch {
    stats.socketFail++;
    host?.close();
    return null;
  }
  const sentAt = new Map();
  const pong = (ws) => (e) => {
    if (typeof e.data !== 'string') return;
    const m = JSON.parse(e.data);
    if (m.t === 'ping' && m.id < 0) {
      ws.send(JSON.stringify({ t: 'pong', id: m.id, ts: m.ts }));
      stats.pingsAnswered++;
    }
  };
  host.onmessage = (e) => {
    if (typeof e.data === 'string') return pong(host)(e);
    const seq = new DataView(e.data).getUint16(2, true);
    const t = sentAt.get(seq);
    if (t !== undefined) {
      stats.latencies.push(performance.now() - t);
      sentAt.delete(seq);
    }
    stats.received++;
  };
  ctl.onmessage = pong(ctl);
  for (const ws of [host, ctl])
    ws.onclose = (e) => {
      stats.closes[e.code] = (stats.closes[e.code] ?? 0) + 1;
    };
  return { host, ctl, sentAt, seq: 0, code };
}

console.log(`creating ${ROOMS} rooms over ${RAMP_MS} ms against ${base} (spoof ips: ${spoof})`);
const t0 = performance.now();
const rooms = (
  await Promise.all(
    Array.from({ length: ROOMS }, (_, i) =>
      new Promise((r) => setTimeout(r, (RAMP_MS * i) / ROOMS)).then(() =>
        runRoom(i).catch((e) => {
          stats.createFail[String(e.message)] = (stats.createFail[String(e.message)] ?? 0) + 1;
          return null;
        }),
      ),
    ),
  )
).filter(Boolean);
const setupMs = performance.now() - t0;
console.log(
  `${rooms.length} rooms live after ${Math.round(setupMs)} ms; streaming ${HZ} Hz for ${SECONDS} s`,
);

// One timer drives every room (setInterval per room would jitter more at 200 × 60 Hz).
const period = 1000 / HZ;
let tick = 0;
const start = performance.now();
let lastStateAt = 0;
await new Promise((resolve) => {
  const step = () => {
    const now = performance.now();
    if (now - start >= SECONDS * 1000) return resolve();
    const due = Math.floor((now - start) / period);
    while (tick <= due) {
      for (const r of rooms) {
        if (r.ctl.readyState !== WebSocket.OPEN) continue;
        r.seq = (r.seq + 1) & 0xffff;
        r.sentAt.set(r.seq, performance.now());
        r.ctl.send(frame(r.seq, now));
        stats.sent++;
      }
      tick++;
    }
    if (now - lastStateAt > 250) {
      lastStateAt = now;
      const s = JSON.stringify({ t: 'state', phase: 'play', score: 0, balls: 3, timeLeft: 300 });
      for (const r of rooms) if (r.host.readyState === WebSocket.OPEN) r.host.send(s);
    }
    setTimeout(step, Math.max(0, period - (performance.now() - now)) / 2);
  };
  step();
});
await new Promise((r) => setTimeout(r, 1000)); // drain
// Relay-side view (only where ROOM_STATS=1, i.e. local dev): messages the DO's rate cap dropped.
const relayDropped = { rate: 0, oversize: 0, roomsSampled: 0 };
for (const r of rooms.slice(0, 20)) {
  const s = await fetch(`${base}/api/rooms/${r.code}/stats`).catch(() => null);
  if (!s?.ok) break;
  const j = await s.json();
  relayDropped.rate += j.dropped?.rate ?? 0;
  relayDropped.oversize += j.dropped?.oversize ?? 0;
  relayDropped.roomsSampled++;
}
for (const r of rooms) {
  r.ctl.close(1000);
  r.host.close(1000);
}
loop.disable();

const lat = stats.latencies.sort((a, b) => a - b);
const p = (q) =>
  lat.length ? Math.round(lat[Math.min(lat.length - 1, Math.floor(q * lat.length))] * 10) / 10 : null;
const result = {
  base,
  when: new Date().toISOString(),
  roomsRequested: ROOMS,
  roomsLive: rooms.length,
  setupMs: Math.round(setupMs),
  hz: HZ,
  seconds: SECONDS,
  createOk: stats.createOk,
  createFail: stats.createFail,
  socketsOk: stats.socketsOk,
  socketFail: stats.socketFail,
  framesSent: stats.sent,
  framesReceived: stats.received,
  lossPct: stats.sent ? Math.round((1000 * (stats.sent - stats.received)) / stats.sent) / 10 : null,
  achievedSendRatePerRoom: rooms.length ? Math.round((stats.sent / rooms.length / SECONDS) * 10) / 10 : 0,
  relayLatencyMs: {
    p50: p(0.5),
    p95: p(0.95),
    p99: p(0.99),
    max: lat.length ? Math.round(lat.at(-1)) : null,
  },
  closesDuringRun: stats.closes,
  relayDroppedInFirst20Rooms: relayDropped,
  pingsAnswered: stats.pingsAnswered,
  generatorEventLoopDelayMs: { p50: loop.percentile(50) / 1e6, p99: loop.percentile(99) / 1e6 },
};
console.log(JSON.stringify(result, null, 2));
if (out) writeFileSync(out, JSON.stringify(result, null, 2));
process.exit(0);
