/**
 * /dev/physics — feel-tuning sandbox for @wwm/physics (Phase 05). Top-down canvas debug draw of the Rapier
 * colliders and the ball; no dependency on @wwm/engine.
 *
 * Keys (2013 keycontrol, E): arrows = target tilt ±25° ramped at 162°/s, any arrow (or Shift) = POWER,
 * Space = jump, R = respawn at the start. `?selftest=1` runs the fixture replay inside the worker and a
 * live free-run check, and prints JSON into [data-testid=selftest] (used by the Playwright test).
 */
import {
  createSimulation,
  createWorkerSimulation,
  DEFAULT_PARAMS,
  elevatorFootprint,
  FEEL_CHECKS,
  PARAM_LABELS,
  type PhysicsParams,
  type RapierSimulation,
  type WorkerSimulation,
} from '@wwm/physics';
import {
  type InputSample,
  KEYBOARD_TILT,
  type SimEvent,
  type SimStepResult,
  type StageData,
} from '@wwm/schema';
import { pxToMeters } from '@wwm/schema/space';
import { useCallback, useEffect, useRef, useState } from 'react';
import replayUrl from '../../../../fixtures/replays/handmade-simple.keyboard.json?url';
import handmade from '../../../../fixtures/stages/handmade-simple.json';

// Optional, gitignored 2013 reference stage (`pnpm ref:fetch`); the glob is empty when it isn't there.
const referenceStages = import.meta.glob<StageData>('../../../../reference/*.stage.json', {
  import: 'default',
});

type Mode = 'worker' | 'main';
interface Driver {
  frame(input: InputSample, dtMs: number): SimStepResult;
  reset(): void;
  lines(): Promise<{ vertices: Float32Array; colors: Float32Array }>;
  stats(): { stepMs: number; stepsPerSec: number; tick: number };
  dispose(): void;
}

const KEY_RAMP_RAD_PER_S = (162 * Math.PI) / 180; // 2.7°/tick at 60 Hz (E)

async function makeDriver(mode: Mode, stage: StageData, params: Partial<PhysicsParams>): Promise<Driver> {
  if (mode === 'worker') {
    const sim: WorkerSimulation = await createWorkerSimulation({ params });
    await sim.load(stage);
    return {
      frame: (input) => sim.step(input),
      reset: () => sim.reset(),
      lines: () => sim.debugLines(),
      stats: () => sim.stats(),
      dispose: () => sim.dispose(),
    };
  }
  const sim: RapierSimulation = await createSimulation({ params });
  await sim.load(stage);
  const hz = sim.params.simHz;
  let acc = 0;
  let last: SimStepResult | null = null;
  let steps = 0;
  let windowStart = performance.now();
  let sps = 0;
  return {
    frame(input, dtMs) {
      acc = Math.min(acc + dtMs, 250);
      const events: SimEvent[] = [];
      let jump = input.jump;
      while (acc >= 1000 / hz) {
        last = sim.step({ ...input, jump });
        jump = false;
        events.push(...last.events);
        acc -= 1000 / hz;
        steps++;
      }
      const now = performance.now();
      if (now - windowStart > 1000) {
        sps = (steps * 1000) / (now - windowStart);
        steps = 0;
        windowStart = now;
      }
      if (!last) last = sim.step({ ...input, jump: false });
      return { ...last, events };
    },
    reset: () => sim.reset(),
    lines: async () => sim.debugLines(),
    stats: () => ({ stepMs: sim.stats().lastStepMs, stepsPerSec: sps, tick: sim.stats().tick }),
    dispose: () => sim.dispose(),
  };
}

const NUMERIC_KEYS = (Object.keys(DEFAULT_PARAMS) as (keyof PhysicsParams)[]).filter(
  (k) => typeof DEFAULT_PARAMS[k] === 'number' && k !== 'simHz',
);

const CHECKLIST = [
  'Rolls downhill (tilt with POWER)',
  'Can crest a ramp at POWER',
  `Can't jump onto a +3 m island (apex ≈ ${FEEL_CHECKS.jumpApexM} m)`,
  'Bounces off rails without getting trapped',
  "Doesn't tunnel at max speed",
  'Stops within a reasonable distance when POWER is released',
  'Elevator lifts when entering the platform, 2 s cooldown',
];

async function selfTest(stage: StageData): Promise<unknown> {
  const inputs = (await (await fetch(replayUrl)).json()) as InputSample[];
  const sim = await createWorkerSimulation();
  const replay = await sim.replayInWorker(stage, inputs);
  // Live free-running check: 1.5 s of POWER + roll in the worker, driven by rAF.
  await sim.load(stage);
  const start = performance.now();
  let first: SimStepResult | null = null;
  let last: SimStepResult | null = null;
  const events: SimEvent[] = [];
  await new Promise<void>((resolve) => {
    const tick = () => {
      const r = sim.step({ tiltX: 0.3, tiltZ: 0, frameYaw: 0, power: true, jump: false });
      events.push(...r.events);
      if (r.ball.pos[1] > 0 && !first) first = r;
      last = r;
      if (performance.now() - start < 1500) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  const stats = sim.stats();
  sim.dispose();
  const f = first as SimStepResult | null;
  const l = last as SimStepResult | null;
  return {
    replay: { goalTick: replay.goalTick, ticks: replay.ticks, final: replay.final, events: replay.events },
    live: {
      stepsPerSec: stats.stepsPerSec,
      tick: stats.tick,
      moved: f && l ? l.ball.pos[0] - f.ball.pos[0] : 0,
      events: events.map((e) => e.type),
    },
  };
}

export default function PhysicsSandbox() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stageName, setStageName] = useState('handmade-simple');
  const [stage, setStage] = useState<StageData>(handmade as unknown as StageData);
  const [mode, setMode] = useState<Mode>('worker');
  const [params, setParams] = useState<Partial<PhysicsParams>>({});
  const [chase, setChase] = useState(false);
  const [hud, setHud] = useState('loading…');
  const [log, setLog] = useState<string[]>([]);
  const [selftest, setSelftest] = useState<string>('');
  const driverRef = useRef<Driver | null>(null);
  const keys = useRef(new Set<string>());

  const selfTestMode =
    typeof location !== 'undefined' && new URLSearchParams(location.search).has('selftest');

  useEffect(() => {
    if (!selfTestMode) return;
    selfTest(handmade as unknown as StageData)
      .then((r) => setSelftest(JSON.stringify(r)))
      .catch((e: unknown) => setSelftest(JSON.stringify({ error: String(e) })));
  }, [selfTestMode]);

  // Build the driver + static collider image whenever stage / mode / params change.
  useEffect(() => {
    if (selfTestMode) return;
    let cancelled = false;
    let raf = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const view = { scale: 1, w: pxToMeters(stage.size.width), h: pxToMeters(stage.size.height) };
    view.scale = Math.min(canvas.width / view.w, canvas.height / view.h);
    const bg = document.createElement('canvas');
    bg.width = canvas.width;
    bg.height = canvas.height;
    const collected = new Set<number>();
    const trail: [number, number][] = [];
    let tiltX = 0;
    let tiltZ = 0;
    let yaw = 0;
    let lastT = performance.now();
    let powerOffAt = 0;
    let prevJumpKey = false;
    setLog([]);

    (async () => {
      const d = await makeDriver(mode, stage, params);
      if (cancelled) {
        d.dispose();
        return;
      }
      driverRef.current = d;
      const { vertices, colors } = await d.lines();
      const g = bg.getContext('2d');
      if (g) {
        g.fillStyle = '#10141c';
        g.fillRect(0, 0, bg.width, bg.height);
        g.lineWidth = 1;
        for (let i = 0; i + 5 < vertices.length; i += 6) {
          const c = (i / 3) * 4;
          const r = Math.round((colors[c] ?? 1) * 255);
          const gg = Math.round((colors[c + 1] ?? 1) * 255);
          const b = Math.round((colors[c + 2] ?? 1) * 255);
          g.strokeStyle = `rgba(${r},${gg},${b},0.45)`;
          g.beginPath();
          g.moveTo((vertices[i] as number) * view.scale, (vertices[i + 2] as number) * view.scale);
          g.lineTo((vertices[i + 3] as number) * view.scale, (vertices[i + 5] as number) * view.scale);
          g.stroke();
        }
      }
      const loop = () => {
        const now = performance.now();
        const dt = Math.min(0.1, (now - lastT) / 1000);
        lastT = now;
        const k = keys.current;
        const tgtX = (k.has('ArrowRight') ? KEYBOARD_TILT : 0) - (k.has('ArrowLeft') ? KEYBOARD_TILT : 0);
        const tgtZ = (k.has('ArrowUp') ? KEYBOARD_TILT : 0) - (k.has('ArrowDown') ? KEYBOARD_TILT : 0);
        const ramp = KEY_RAMP_RAD_PER_S * dt;
        tiltX += Math.max(-ramp, Math.min(ramp, tgtX - tiltX));
        tiltZ += Math.max(-ramp, Math.min(ramp, tgtZ - tiltZ));
        const arrows = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].some((a) => k.has(a));
        if (arrows || k.has('Shift')) powerOffAt = now + 100; // E: POWER off 100 ms after release
        const power = now < powerOffAt;
        const jumpKey = k.has(' ');
        const input: InputSample = { tiltX, tiltZ, frameYaw: yaw, power, jump: jumpKey && !prevJumpKey };
        prevJumpKey = jumpKey;
        const r = d.frame(input, dt * 1000);
        const [bx, by, bz] = r.ball.pos;
        const speed = Math.hypot(r.ball.vel[0], r.ball.vel[2]);
        if (chase && speed > 1) {
          const target = Math.atan2(-r.ball.vel[0], -r.ball.vel[2]);
          let dy = target - yaw;
          while (dy > Math.PI) dy -= 2 * Math.PI;
          while (dy < -Math.PI) dy += 2 * Math.PI;
          yaw += dy * Math.min(1, dt / 0.6);
        } else if (!chase) yaw = 0;
        for (const e of r.events) {
          if (e.type === 'item') collected.add(e.itemId);
          if (e.type === 'lost') d.reset();
        }
        if (r.events.length) {
          setLog((l) =>
            [
              ...r.events.map((e) => `${(d.stats().tick / 120).toFixed(2)}s ${JSON.stringify(e)}`),
              ...l,
            ].slice(0, 14),
          );
        }
        trail.push([bx, bz]);
        if (trail.length > 600) trail.shift();

        ctx.drawImage(bg, 0, 0);
        ctx.fillStyle = '#3ad6c5';
        for (const it of stage.items) {
          if (collected.has(it.id)) continue;
          ctx.fillRect(
            pxToMeters(it.pos[0]) * view.scale - 1.5,
            pxToMeters(it.pos[1]) * view.scale - 1.5,
            it.kind === 'large' ? 5 : 3,
            it.kind === 'large' ? 5 : 3,
          );
        }
        ctx.strokeStyle = '#ffd24a';
        ctx.beginPath();
        ctx.arc(
          pxToMeters(stage.goal.pos[0]) * view.scale,
          pxToMeters(stage.goal.pos[1]) * view.scale,
          pxToMeters(stage.goal.radius) * view.scale,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
        for (const e of stage.elevators) {
          const f = elevatorFootprint(e, { ...DEFAULT_PARAMS, ...params });
          const y = r.elevators.find((x) => x.id === e.id)?.y ?? e.levelLow;
          const t = (y - e.levelLow) / Math.max(1e-6, e.levelHigh - e.levelLow);
          ctx.fillStyle = `rgba(230,80,80,${0.35 + 0.5 * t})`;
          ctx.save();
          ctx.translate(f.cx * view.scale, f.cz * view.scale);
          ctx.rotate(Math.atan2(f.uz, f.ux));
          ctx.fillRect(
            -f.halfLen * view.scale,
            -f.halfWidth * view.scale,
            2 * f.halfLen * view.scale,
            2 * f.halfWidth * view.scale,
          );
          ctx.restore();
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        for (const [i, [x, z]] of trail.entries()) {
          if (i) ctx.lineTo(x * view.scale, z * view.scale);
          else ctx.moveTo(x * view.scale, z * view.scale);
        }
        ctx.stroke();
        ctx.fillStyle = power ? '#8ff' : '#ddd';
        ctx.beginPath();
        ctx.arc(
          bx * view.scale,
          bz * view.scale,
          Math.max(2, DEFAULT_PARAMS.ballRadius * view.scale),
          0,
          Math.PI * 2,
        );
        ctx.fill();
        // heading arrow (frameYaw forward)
        ctx.strokeStyle = '#f80';
        ctx.beginPath();
        ctx.moveTo(bx * view.scale, bz * view.scale);
        ctx.lineTo((bx - Math.sin(yaw) * 2) * view.scale, (bz - Math.cos(yaw) * 2) * view.scale);
        ctx.stroke();

        const st = d.stats();
        setHud(
          `${mode} · tick ${st.tick} · ${st.stepsPerSec.toFixed(0)} steps/s · step ${st.stepMs.toFixed(3)} ms · ` +
            `y ${by.toFixed(2)} m · |v| ${speed.toFixed(2)} m/s · ${r.ball.grounded ? 'grounded' : 'air'} · ` +
            `tilt (${((tiltX * 180) / Math.PI).toFixed(0)}°, ${((tiltZ * 180) / Math.PI).toFixed(0)}°) · POWER ${power ? 'on' : 'off'}`,
        );
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    })().catch((e: unknown) => setHud(`error: ${String(e)}`));

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      driverRef.current?.dispose();
      driverRef.current = null;
    };
  }, [stage, mode, params, chase, selfTestMode]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault();
      if (e.key === 'r' || e.key === 'R') driverRef.current?.reset();
      keys.current.add(e.key);
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key);
    const blur = () => keys.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const loadFile = useCallback(async (f: File) => {
    setStage(JSON.parse(await f.text()) as StageData);
    setStageName(f.name);
  }, []);

  const exportParams = () => {
    const blob = new Blob([JSON.stringify({ ...DEFAULT_PARAMS, ...params }, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'physics-params.json';
    a.click();
  };

  if (selfTestMode) {
    return (
      <section>
        <h1>Physics self-test</h1>
        <pre data-testid="selftest">{selftest}</pre>
      </section>
    );
  }

  return (
    <section style={{ display: 'grid', gridTemplateColumns: 'auto 340px', gap: 16, fontSize: 13 }}>
      <div>
        <h1 style={{ margin: '0 0 8px' }}>Physics sandbox</h1>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <label>
            Stage{' '}
            <select
              value={stageName}
              onChange={async (e) => {
                const name = e.target.value;
                if (name === 'handmade-simple') setStage(handmade as unknown as StageData);
                else {
                  const loader = referenceStages[name];
                  if (loader) setStage(await loader());
                }
                setStageName(name);
              }}
            >
              <option value="handmade-simple">handmade-simple</option>
              {Object.keys(referenceStages).map((k) => (
                <option key={k} value={k}>
                  {k.split('/').pop()}
                </option>
              ))}
              {stageName.endsWith('.json') && !referenceStages[stageName] ? (
                <option value={stageName}>{stageName}</option>
              ) : null}
            </select>
          </label>
          <label>
            Load JSON{' '}
            <input
              type="file"
              accept=".json"
              onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])}
            />
          </label>
          <label>
            Run in{' '}
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="worker">Web Worker</option>
              <option value="main">main thread</option>
            </select>
          </label>
          <label>
            Rate{' '}
            <select
              value={params.simHz ?? 120}
              onChange={(e) => setParams((p) => ({ ...p, simHz: Number(e.target.value) }))}
            >
              <option value={120}>120 Hz</option>
              <option value={60}>60 Hz (2013 parity)</option>
            </select>
          </label>
          <label>
            <input type="checkbox" checked={chase} onChange={(e) => setChase(e.target.checked)} /> chase yaw
          </label>
        </div>
        <canvas
          ref={canvasRef}
          width={760}
          height={900}
          style={{ background: '#10141c', maxWidth: '100%' }}
        />
        <p data-testid="physics-hud" style={{ fontFamily: 'ui-monospace, monospace' }}>
          {hud}
        </p>
        <p>
          Arrows tilt (any arrow = POWER, or hold Shift), Space jumps, R respawns. Orange line = frameYaw
          forward.
        </p>
      </div>
      <aside>
        <h2 style={{ fontSize: 15 }}>Feel checklist</h2>
        {CHECKLIST.map((c) => (
          <label key={c} style={{ display: 'block' }}>
            <input type="checkbox" /> {c}
          </label>
        ))}
        <h2 style={{ fontSize: 15 }}>Events</h2>
        <pre style={{ fontSize: 11, minHeight: 120 }}>{log.join('\n')}</pre>
        <h2 style={{ fontSize: 15 }}>
          Params{' '}
          <button onClick={exportParams} type="button">
            export JSON
          </button>{' '}
          <button onClick={() => setParams({})} type="button">
            defaults
          </button>
        </h2>
        {NUMERIC_KEYS.map((k) => {
          const def = DEFAULT_PARAMS[k] as number;
          const val = (params[k] as number | undefined) ?? def;
          const max = def === 0 ? 5 : def * 3;
          return (
            <label
              key={k}
              style={{ display: 'grid', gridTemplateColumns: '150px 1fr 60px', alignItems: 'center' }}
            >
              <span title={`label ${PARAM_LABELS[k]}`}>
                {k} <small>({PARAM_LABELS[k]})</small>
              </span>
              <input
                type="range"
                min={0}
                max={max}
                step={max / 200}
                value={val}
                onChange={(e) => setParams((p) => ({ ...p, [k]: Number(e.target.value) }))}
              />
              <span>{Number(val.toFixed(3))}</span>
            </label>
          );
        })}
      </aside>
    </section>
  );
}
