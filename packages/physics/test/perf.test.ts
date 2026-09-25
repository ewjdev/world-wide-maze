/**
 * Performance: a stage with > 100k triangles must step at 120 Hz in < 3 ms per step (reference desktop).
 * Timings are logged; CI runners get a looser bound because their CPUs vary.
 */
import { existsSync, readFileSync } from 'node:fs';
import { type InputSample, SIM_HZ, type StageData, type Vec2 } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { createSimulation } from '../src/simulation.ts';
import { AID_DCC_URL, circle, island, makeStage } from './helpers/stages.ts';

const LIMIT_MS = process.env.CI ? 8 : 3;

/** 8 × 8 blob islands with 400-vertex outlines, bridged in a grid: ≈ 64 × 1,600 tris + rails. */
function bigStage(): StageData {
  const islands = [];
  const bridges = [];
  let id = 0;
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 8; gx++) {
      const cx = 80 + gx * 150;
      const cy = 80 + gy * 150;
      const ring = circle(cx, cy, 60, 400);
      islands.push(island(id, ring, (gx + gy) % 3, { guardrails: [[...ring, ring[0] as Vec2]] }));
      id++;
    }
  }
  let bid = 0;
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 7; gx++) {
      const a = gy * 8 + gx;
      const cy = 80 + gy * 150;
      bridges.push({
        id: bid++,
        from: a,
        to: a + 1,
        a: [80 + gx * 150 + 60, cy] as Vec2,
        b: [80 + (gx + 1) * 150 - 60, cy] as Vec2,
        width: 40,
        type: 'flat' as const,
        levelA: (gx + gy) % 3,
        levelB: (gx + 1 + gy) % 3,
      });
    }
  }
  return makeStage({ islands, bridges, start: [80, 80], width: 1280, height: 1280 });
}

function bench(stage: StageData, steps: number) {
  return (async () => {
    const t0 = performance.now();
    const sim = await createSimulation();
    await sim.load(stage);
    const loadMs = performance.now() - t0;
    const times: number[] = [];
    let touching = 0;
    let firstMs = 0;
    // Circle around inside the rails (heading keeps turning), jumping now and then.
    for (let i = 0; i < steps; i++) {
      const input: InputSample = {
        tiltX: 0.1 * Math.sin(i / 50),
        tiltZ: 0.3,
        frameYaw: i / 45,
        power: true,
        jump: i % 240 === 0,
      };
      const s = performance.now();
      const r = sim.step(input);
      const ms = performance.now() - s;
      if (i === 0) firstMs = ms;
      else times.push(ms);
      if (r.ball.grounded) touching++;
      for (const e of r.events) if (e.type === 'lost') sim.reset();
    }
    const stats = sim.stats();
    sim.dispose();
    times.sort((a, b) => a - b);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    return {
      loadMs,
      firstMs,
      groundedPct: (100 * touching) / steps,
      mean,
      p95: times[Math.floor(times.length * 0.95)] as number,
      max: times[times.length - 1] as number,
      stats,
    };
  })();
}

describe('performance', () => {
  test(`> 100k-triangle stage steps in < ${LIMIT_MS} ms (mean) at ${SIM_HZ} Hz`, async () => {
    const r = await bench(bigStage(), 10 * SIM_HZ);
    console.log(
      `[physics] big stage: ${r.stats.triangles} tris, ${r.stats.colliders} colliders, load ${r.loadMs.toFixed(0)} ms, ` +
        `first step ${r.firstMs.toFixed(1)} ms, then mean ${r.mean.toFixed(3)} ms, p95 ${r.p95.toFixed(3)} ms, ` +
        `max ${r.max.toFixed(2)} ms; ball grounded ${r.groundedPct.toFixed(0)}% of ticks`,
    );
    expect(r.stats.triangles).toBeGreaterThan(100_000);
    expect(r.groundedPct).toBeGreaterThan(50); // the ball is really rolling over the meshes, not falling
    expect(r.mean).toBeLessThan(LIMIT_MS);
  }, 60_000);

  test.skipIf(!existsSync(AID_DCC_URL))(
    'reference aid-dcc (2013 stage) steps well under budget',
    async () => {
      const stage = JSON.parse(readFileSync(AID_DCC_URL, 'utf8')) as StageData;
      const r = await bench(stage, 5 * SIM_HZ);
      console.log(
        `[physics] aid-dcc: ${r.stats.triangles} tris, ${r.stats.colliders} colliders, load ${r.loadMs.toFixed(0)} ms, ` +
          `step mean ${r.mean.toFixed(3)} ms, p95 ${r.p95.toFixed(3)} ms; grounded ${r.groundedPct.toFixed(0)}%`,
      );
      expect(r.mean).toBeLessThan(LIMIT_MS);
    },
    60_000,
  );
});
