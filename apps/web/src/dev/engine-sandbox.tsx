/**
 * /dev/engine: Phase 04 renderer sandbox (dev only). Loads handmade-simple, any fixtures/builder/*.json and,
 * if fetched (`pnpm ref:fetch`), reference/*.stage.json. No physics: the ball is faked along a route from
 * start to goal, or driven with the keyboard (arrows / WASD, relative to the camera; Space = hop).
 *
 * Automation hook: `window.wwm` (see the bottom of this file). `?clock=manual` stops the rAF loop so a script
 * can step time deterministically with `wwm.advance(sec)`.
 */
import {
  buildHeightfield,
  createEngine,
  type Engine,
  type EngineStats,
  type Heightfield,
  type QualitySetting,
  sampleTop,
} from '@wwm/engine';
import {
  type BallState,
  LEVEL_HEIGHT_M,
  PX_PER_METER,
  type SimEvent,
  type StageData,
  type Vec2,
} from '@wwm/schema';
import { useCallback, useEffect, useRef, useState } from 'react';
import handmadeJson from '../../../../fixtures/stages/handmade-simple.json';
import handmadePng from '../../../../fixtures/stages/handmade-simple.png?url';

interface StageEntry {
  id: string;
  label: string;
  load: () => Promise<{ stage: StageData; textureUrl: string }>;
}

const builderJson = import.meta.glob<{ default: StageData }>('../../../../fixtures/builder/*.json');
const builderPng = import.meta.glob<string>('../../../../fixtures/builder/*.{png,webp}', {
  query: '?url',
  import: 'default',
});
const referenceJson = import.meta.glob<{ default: StageData }>('../../../../reference/*.stage.json');
const referencePng = import.meta.glob<string>('../../../../reference/*.{png,webp}', {
  query: '?url',
  import: 'default',
});

function dirOf(p: string): string {
  return p.slice(0, p.lastIndexOf('/') + 1);
}

function globEntries(
  json: Record<string, () => Promise<{ default: StageData }>>,
  pngs: Record<string, () => Promise<string>>,
  prefix: string,
): StageEntry[] {
  return Object.entries(json).map(([path, loader]) => {
    const name = path.slice(path.lastIndexOf('/') + 1).replace(/(\.stage)?\.json$/, '');
    return {
      id: `${prefix}:${name}`,
      label: `${prefix}/${name}`,
      load: async () => {
        const stage = (await loader()).default;
        const texPath = dirOf(path) + stage.texture.path;
        const png = pngs[texPath];
        if (!png) throw new Error(`texture ${texPath} not found next to ${path}`);
        return { stage, textureUrl: await png() };
      },
    };
  });
}

const STAGES: StageEntry[] = [
  {
    id: 'handmade-simple',
    label: 'handmade-simple',
    load: async () => ({ stage: handmadeJson as unknown as StageData, textureUrl: handmadePng }),
  },
  ...globEntries(referenceJson, referencePng, 'reference'),
  ...globEntries(builderJson, builderPng, 'builder'),
];

// ── fake ball motion ──────────────────────────────────────────────────────────

interface Route {
  points: [number, number, number][];
  lengths: number[];
  total: number;
}

/** BFS start island → goal island over bridges and elevators; waypoints through each connector. */
function buildRoute(stage: StageData, hf: Heightfield): Route {
  type Hop = { to: number; via: Vec2[]; lift?: [number, number] };
  const adj = new Map<number, Hop[]>();
  const add = (a: number, h: Hop) => {
    const list = adj.get(a) ?? [];
    list.push(h);
    adj.set(a, list);
  };
  for (const b of stage.bridges) {
    add(b.from, { to: b.to, via: [b.a, b.b] });
    add(b.to, { to: b.from, via: [b.b, b.a] });
  }
  for (const e of stage.elevators) {
    add(e.islandFrom, { to: e.islandTo, via: [e.a, e.b], lift: [e.levelLow, e.levelHigh] });
    add(e.islandTo, { to: e.islandFrom, via: [e.b, e.a], lift: [e.levelHigh, e.levelLow] });
  }
  const prev = new Map<number, { from: number; hop: Hop }>();
  const q = [stage.start.islandId];
  const seen = new Set(q);
  while (q.length) {
    const i = q.shift() as number;
    for (const h of adj.get(i) ?? []) {
      if (seen.has(h.to)) continue;
      seen.add(h.to);
      prev.set(h.to, { from: i, hop: h });
      q.push(h.to);
    }
  }
  const hops: Hop[] = [];
  for (let at = stage.goal.islandId; at !== stage.start.islandId; ) {
    const p = prev.get(at);
    if (!p) break;
    hops.unshift(p.hop);
    at = p.from;
  }
  const pts: [number, number, number][] = [];
  const surf = (p: Vec2, fallbackLevel: number) => {
    const x = p[0] / PX_PER_METER;
    const z = p[1] / PX_PER_METER;
    const y = sampleTop(hf, x, z);
    return [x, (Number.isNaN(y) ? fallbackLevel * LEVEL_HEIGHT_M : y) + 0.5, z] as [number, number, number];
  };
  const level = (id: number) => stage.islands.find((i) => i.id === id)?.level ?? 0;
  pts.push(surf(stage.start.pos, level(stage.start.islandId)));
  for (const h of hops) {
    const [a, b] = h.via as [Vec2, Vec2];
    // step back from the connector mouth so the ball approaches square-on
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const back: Vec2 = [a[0] - (dx / len) * 30, a[1] - (dy / len) * 30];
    pts.push(surf(back, 0));
    if (h.lift) {
      const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const x = mid[0] / PX_PER_METER;
      const z = mid[1] / PX_PER_METER;
      pts.push([x, h.lift[0] * LEVEL_HEIGHT_M + 0.5, z], [x, h.lift[1] * LEVEL_HEIGHT_M + 0.5, z]);
    } else {
      pts.push(surf(a, 0), surf(b, 0));
    }
    const fwd: Vec2 = [b[0] + (dx / len) * 30, b[1] + (dy / len) * 30];
    pts.push(surf(fwd, level(h.to)));
  }
  pts.push(surf(stage.goal.pos, level(stage.goal.islandId)));
  const lengths = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as number[];
    const b = pts[i] as number[];
    lengths.push((lengths[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  return { points: pts, lengths, total: lengths[lengths.length - 1] as number };
}

function routeAt(r: Route, s: number): [number, number, number] {
  const d = Math.min(Math.max(0, s), r.total);
  let i = 1;
  while (i < r.lengths.length - 1 && (r.lengths[i] as number) < d) i++;
  const l0 = r.lengths[i - 1] as number;
  const l1 = r.lengths[i] as number;
  const t = l1 > l0 ? (d - l0) / (l1 - l0) : 0;
  const a = r.points[i - 1] as number[];
  const b = r.points[i] as number[];
  return [
    (a[0] as number) + ((b[0] as number) - (a[0] as number)) * t,
    (a[1] as number) + ((b[1] as number) - (a[1] as number)) * t,
    (a[2] as number) + ((b[2] as number) - (a[2] as number)) * t,
  ];
}

/** Rolling quaternion update: rotate about (up × v) by distance / r. */
function roll(q: [number, number, number, number], dx: number, dz: number): [number, number, number, number] {
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return q;
  const ax = dz / dist;
  const az = -dx / dist;
  const ang = dist / 0.5;
  const s = Math.sin(ang / 2);
  const r: [number, number, number, number] = [ax * s, 0, az * s, Math.cos(ang / 2)];
  // r * q
  const [x1, y1, z1, w1] = r;
  const [x2, y2, z2, w2] = q;
  const out: [number, number, number, number] = [
    w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
    w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
    w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
    w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
  ];
  const n = Math.hypot(...out);
  return out.map((v) => v / n) as [number, number, number, number];
}

// ── component ─────────────────────────────────────────────────────────────────

type Motion = 'route' | 'drive' | 'still';

export default function EngineSandbox() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [stageId, setStageId] = useState(
    () => new URLSearchParams(location.search).get('stage') ?? 'handmade-simple',
  );
  const [status, setStatus] = useState('starting…');
  const [motion, setMotion] = useState<Motion>('route');
  const [power, setPower] = useState(true);
  const [quality, setQuality] = useState<QualitySetting>(
    () => (new URLSearchParams(location.search).get('quality') as QualitySetting) ?? 'auto',
  );
  const [fireworks, setFireworks] = useState(7);
  const sim = useRef({
    stage: null as StageData | null,
    hf: null as Heightfield | null,
    route: null as Route | null,
    s: 0,
    pos: [0, 0, 0] as [number, number, number],
    vel: [0, 0, 0] as [number, number, number],
    quat: [0, 0, 0, 1] as [number, number, number, number],
    vy: 0,
    hop: 0,
    keys: new Set<string>(),
    motion: 'route' as Motion,
    power: true,
    nextItem: 0,
    frozen: false,
  });
  sim.current.motion = motion;
  sim.current.power = power;

  const params = new URLSearchParams(location.search);
  const manualClock = params.get('clock') === 'manual';
  const hideUi = params.get('ui') === '0';

  const step = useCallback((dt: number) => {
    const e = engineRef.current;
    const S = sim.current;
    if (!e || !S.stage || !S.hf) return;
    const speed = 6;
    let tiltX = 0;
    let tiltZ = 0;
    if (!S.frozen) {
      const [x0, , z0] = S.pos;
      if (S.motion === 'route' && S.route) {
        S.s = (S.s + speed * dt) % (S.route.total + 8);
        S.pos = routeAt(S.route, S.s);
        tiltZ = 0.3;
      } else if (S.motion === 'drive') {
        const yaw = e.cameraYaw();
        const f =
          (S.keys.has('ArrowUp') || S.keys.has('KeyW') ? 1 : 0) -
          (S.keys.has('ArrowDown') || S.keys.has('KeyS') ? 1 : 0);
        const r =
          (S.keys.has('ArrowRight') || S.keys.has('KeyD') ? 1 : 0) -
          (S.keys.has('ArrowLeft') || S.keys.has('KeyA') ? 1 : 0);
        tiltZ = f * 0.436;
        tiltX = r * 0.436;
        const fx = -Math.sin(yaw);
        const fz = -Math.cos(yaw);
        const rx = Math.cos(yaw);
        const rz = -Math.sin(yaw);
        const nx = S.pos[0] + (fx * f + rx * r) * speed * dt;
        const nz = S.pos[2] + (fz * f + rz * r) * speed * dt;
        const ground = sampleTop(S.hf, nx, nz);
        if (!Number.isNaN(ground) || S.hop > 0) {
          S.pos[0] = nx;
          S.pos[2] = nz;
        }
        const g = sampleTop(S.hf, S.pos[0], S.pos[2]);
        const floor = (Number.isNaN(g) ? S.pos[1] - 0.5 : g) + 0.5;
        S.vy -= 46.3 * dt;
        S.pos[1] += S.vy * dt;
        if (S.pos[1] <= floor) {
          S.pos[1] = floor;
          S.vy = 0;
          S.hop = 0;
        }
      }
      S.vel = [(S.pos[0] - x0) / Math.max(dt, 1e-3), S.vy, (S.pos[2] - z0) / Math.max(dt, 1e-3)];
      S.quat = roll(S.quat, S.pos[0] - x0, S.pos[2] - z0);
    }
    const state: BallState = { pos: [...S.pos], quat: [...S.quat], vel: [...S.vel], grounded: S.vy === 0 };
    e.setBall(state);
    e.setControl({ tiltX, tiltZ, power: S.power && S.motion !== 'still' });
    e.frame(dt);
  }, []);

  // engine lifetime: created once per mount; quality changes go through setQuality
  // biome-ignore lint/correctness/useExhaustiveDependencies: the engine must not be recreated on re-render
  useEffect(() => {
    let disposed = false;
    let raf = 0;
    const canvas = canvasRef.current as HTMLCanvasElement;
    const forceWebGL = params.get('backend') === 'webgl';
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    createEngine({ canvas, quality, forceWebGL, reducedMotion, pixelLook: params.get('pixel') === '1' })
      .then((engine) => {
        if (disposed) {
          engine.dispose();
          return;
        }
        engineRef.current = engine;
        const resize = () => engine.resize(canvas.clientWidth, canvas.clientHeight);
        resize();
        addEventListener('resize', resize);
        let last = performance.now();
        const loop = (now: number) => {
          const dt = (now - last) / 1000;
          last = now;
          step(dt);
          raf = requestAnimationFrame(loop);
        };
        if (!manualClock) raf = requestAnimationFrame(loop);
        const statTimer = setInterval(() => setStats(engine.stats()), 500);
        (window as unknown as { __cleanup?: () => void }).__cleanup = () => {
          removeEventListener('resize', resize);
          clearInterval(statTimer);
        };
        setStatus('engine ready');
        window.dispatchEvent(new Event('wwm-engine'));
      })
      .catch((err) => setStatus(`engine failed: ${String(err)}`));
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      (window as unknown as { __cleanup?: () => void }).__cleanup?.();
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  const loadStage = useCallback(async (id: string) => {
    const e = engineRef.current;
    const entry = STAGES.find((s) => s.id === id) ?? STAGES[0];
    if (!e || !entry) return;
    setStatus(`loading ${entry.label}…`);
    (window as unknown as { __stageReady?: boolean }).__stageReady = false;
    const t0 = performance.now();
    const { stage, textureUrl } = await entry.load();
    const blob = await (await fetch(textureUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    await e.loadStage(stage, bitmap);
    const S = sim.current;
    S.stage = stage;
    S.hf = buildHeightfield(stage);
    S.route = buildRoute(stage, S.hf);
    S.s = 0;
    S.pos = routeAt(S.route, 0);
    S.nextItem = 0;
    S.frozen = false;
    collected.current.clear();
    setStatus(
      `${entry.label}: ${stage.islands.length} islands · ${stage.bridges.length} bridges · ${stage.elevators.length} elevators · ${stage.items.length} items · loaded in ${Math.round(performance.now() - t0)} ms`,
    );
    (window as unknown as { __stageReady?: boolean }).__stageReady = true;
    window.dispatchEvent(new Event('wwm-stage'));
  }, []);

  useEffect(() => {
    const onReady = () => void loadStage(stageId);
    if (engineRef.current) onReady();
    else window.addEventListener('wwm-engine', onReady, { once: true });
    return () => window.removeEventListener('wwm-engine', onReady);
  }, [stageId, loadStage]);

  useEffect(() => {
    engineRef.current?.setQuality(quality);
  }, [quality]);

  // keyboard
  useEffect(() => {
    const down = (ev: KeyboardEvent) => {
      const S = sim.current;
      S.keys.add(ev.code);
      if (ev.code === 'Space' && S.hop === 0) {
        S.vy = 16.7;
        S.hop = 1;
      }
      if (ev.code === 'KeyM') engineRef.current?.setView('map');
      if (ev.code === 'KeyC') engineRef.current?.setView('chase');
      if (ev.code.startsWith('Arrow') || ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(ev.code))
        setMotion('drive');
    };
    const up = (ev: KeyboardEvent) => sim.current.keys.delete(ev.code);
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    return () => {
      removeEventListener('keydown', down);
      removeEventListener('keyup', up);
    };
  }, []);

  const fire = (ev: SimEvent) => engineRef.current?.handleEvent(ev);
  const collected = useRef(new Set<number>());
  /** Collect the nearest not-yet-collected item of a kind (so the pop happens in view). */
  const collectNext = (kind: 'small' | 'large') => {
    const S = sim.current;
    const [bx, , bz] = S.pos;
    let best: { id: number; d: number } | null = null;
    for (const it of S.stage?.items ?? []) {
      if (it.kind !== kind || collected.current.has(it.id)) continue;
      const d = Math.hypot(it.pos[0] / PX_PER_METER - bx, it.pos[1] / PX_PER_METER - bz);
      if (!best || d < best.d) best = { id: it.id, d };
    }
    if (!best) return;
    collected.current.add(best.id);
    fire({ type: 'item', itemId: best.id, kind });
  };

  // automation hook for Playwright evidence
  useEffect(() => {
    const api = {
      engine: () => engineRef.current,
      advance: (sec: number, fps = 60) => {
        const n = Math.max(1, Math.round(sec * fps));
        for (let i = 0; i < n; i++) step(1 / fps);
      },
      load: (id: string) => loadStage(id),
      stages: () => STAGES.map((s) => s.id),
      setMotion: (m: Motion) => setMotion(m),
      setPower: (p: boolean) => setPower(p),
      freeze: (f: boolean) => {
        sim.current.frozen = f;
      },
      placeOnRoute: (frac: number) => {
        const S = sim.current;
        if (!S.route) return;
        S.s = S.route.total * frac;
        S.pos = routeAt(S.route, S.s);
      },
      collectNext,
      fire,
    };
    (window as unknown as { wwm: typeof api }).wwm = api;
  });

  const btn = (label: string, on: () => void) => (
    <button type="button" onClick={on} style={buttonStyle}>
      {label}
    </button>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#f8f8f8', fontFamily: 'system-ui, sans-serif' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      {!hideUi && (
        <>
          <div style={{ ...panelStyle, top: 12, left: 12, width: 300 }}>
            <strong style={{ letterSpacing: '0.04em' }}>@wwm/engine sandbox</strong>
            <div style={{ color: '#5d6770', fontSize: 11, margin: '4px 0 8px' }}>{status}</div>
            <label style={rowStyle}>
              stage
              <select value={stageId} onChange={(e) => setStageId(e.target.value)} style={{ flex: 1 }}>
                {STAGES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={rowStyle}>
              quality
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as QualitySetting)}
                style={{ flex: 1 }}
              >
                {['auto', 'high', 'medium', 'low'].map((q) => (
                  <option key={q}>{q}</option>
                ))}
              </select>
            </label>
            <label style={rowStyle}>
              ball
              <select
                value={motion}
                onChange={(e) => setMotion(e.target.value as Motion)}
                style={{ flex: 1 }}
              >
                <option value="route">auto route start → goal</option>
                <option value="drive">keyboard (arrows/WASD, Space)</option>
                <option value="still">still</option>
              </select>
            </label>
            <label style={rowStyle}>
              <input type="checkbox" checked={power} onChange={(e) => setPower(e.target.checked)} /> POWER
              held
            </label>
            <div style={groupStyle}>
              {btn('chase', () => engineRef.current?.setView('chase'))}
              {btn('map (M)', () => engineRef.current?.setView('map'))}
              {btn('intro', () => void engineRef.current?.playIntro({ mode: 'full' }))}
              {btn('intro fast', () => void engineRef.current?.playIntro({ mode: 'fast' }))}
              {btn('skip', () => engineRef.current?.skipIntro())}
              {btn('spawn', () => void engineRef.current?.spawnBall())}
            </div>
            <div style={groupStyle}>
              {btn('item', () => collectNext('small'))}
              {btn('large', () => collectNext('large'))}
              {btn('landed', () => fire({ type: 'landed', impact: 12 }))}
              {btn('fell', () => fire({ type: 'fell', restartAt: [0, 0] }))}
              {btn('lost', () => fire({ type: 'lost' }))}
              {btn('pixel', () => engineRef.current?.setPixelLook(true))}
            </div>
            <div style={groupStyle}>
              <input
                type="number"
                min={0}
                max={9}
                value={fireworks}
                onChange={(e) => setFireworks(Number(e.target.value))}
                style={{ width: 40 }}
              />
              {btn('goal + fireworks', () => {
                sim.current.frozen = true;
                void engineRef.current?.playGoal(fireworks).then(() => {
                  sim.current.frozen = false;
                  void engineRef.current?.spawnBall();
                });
              })}
              {btn('5× load/unload', async () => {
                const e = engineRef.current;
                if (!e) return;
                e.unloadStage();
                e.frame(0.016);
                const base = e.stats().memory;
                for (let i = 0; i < 5; i++) {
                  await loadStage(stageId);
                  e.frame(0.016);
                  e.unloadStage();
                  e.frame(0.016);
                }
                const after = e.stats().memory;
                setStatus(
                  `memory baseline ${JSON.stringify(base)} → after 5 cycles ${JSON.stringify(after)}`,
                );
                await loadStage(stageId);
              })}
            </div>
          </div>
          {stats && (
            <div
              style={{ ...panelStyle, top: 12, right: 12, width: 210, fontVariantNumeric: 'tabular-nums' }}
            >
              <div>
                {stats.fps.toFixed(0)} fps · tier {stats.tier} · {stats.backend}
              </div>
              <div>
                draws {stats.drawCalls} (scene {stats.sceneDrawCalls}, env {stats.envDrawCalls}, post{' '}
                {stats.postDrawCalls})
              </div>
              <div>tris {stats.triangles.toLocaleString()}</div>
              <div style={{ color: '#5d6770' }}>
                geo {stats.memory.geometries} · tex {stats.memory.textures} · rt {stats.memory.renderTargets}
              </div>
              {stats.tierLog.length > 0 && (
                <div style={{ color: '#5d6770' }}>
                  ladder: {stats.tierLog.map((l) => `${l.from}→${l.to}@${l.fps.toFixed(0)}`).join(' ')}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  padding: '10px 12px',
  background: 'rgba(255,255,255,0.86)',
  backdropFilter: 'blur(6px)',
  border: '1px solid rgba(0,0,0,0.08)',
  borderRadius: 8,
  fontSize: 12,
  color: '#20262d',
  lineHeight: 1.5,
};
const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0' };
const groupStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 };
const buttonStyle: React.CSSProperties = {
  font: 'inherit',
  padding: '3px 8px',
  borderRadius: 5,
  border: '1px solid rgba(0,0,0,0.15)',
  background: '#fff',
  cursor: 'pointer',
};
