/** Phase 04b: the private three.js node-frame guard, fireworks choreography, idle particle pool. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mulberry32 } from '@wwm/schema';
import { Vector3 } from 'three/webgpu';
import { describe, expect, test } from 'vitest';
import { NodeFrameClock, privateNodeFrame } from '../src/three-private.ts';
import { Bin } from '../src/world/bin.ts';
import { BURST_KINDS, planFirework, rocketVelocity, travel } from '../src/world/fireworks.ts';
import { Particles } from '../src/world/particles.ts';
import { createSharedUniforms } from '../src/world/shared.ts';

// resolve through the package's own `./src/*` export (package.json itself is not exported)
const threeCommon = dirname(createRequire(import.meta.url).resolve('three/src/renderers/common/Renderer.js'));
const src = (file: string) => readFileSync(join(threeCommon, file), 'utf8');

describe('three-private: renderer._nodes.nodeFrame (re-check on every three.js upgrade)', () => {
  // If any of these fail, three.js moved the node frame. Update src/three-private.ts (or drop it if three
  // grew a public "advance node frame" API), then re-run the sandbox shots with ?clock=manual.
  test('the renderer still owns a NodeManager at _nodes', () => {
    expect(src('Renderer.js')).toMatch(/this\._nodes = new NodeManager\(/);
  });

  test('NodeManager still exposes nodeFrame with update() and frameId', async () => {
    const spec = 'three/src/renderers/common/nodes/NodeManager.js';
    const { default: NodeManager } = (await import(/* @vite-ignore */ spec)) as {
      default: new (r: unknown, b: unknown) => unknown;
    };
    const nf = privateNodeFrame({ _nodes: new NodeManager({}, {}) });
    expect(nf).not.toBeNull();
    const before = nf?.frameId ?? 0;
    nf?.update();
    expect(nf?.frameId).toBe(before + 1);
  });

  test('the public info.frame still mirrors the rAF-advanced frame id', () => {
    const anim = src('Animation.js');
    expect(anim).toMatch(/this\.nodes\.nodeFrame\.update\(\)/);
    expect(anim).toMatch(/this\.info\.frame = this\.nodes\.nodeFrame\.frameId/);
  });

  test('NodeFrameClock only touches the private field when the renderer did not advance', () => {
    const nodeFrame = {
      frameId: 5,
      update() {
        this.frameId++;
      },
    };
    const r = { info: { frame: 5 }, _nodes: { nodeFrame } };
    const clock = new NodeFrameClock(r as never);
    clock.tick(); // first frame after the renderer's rAF: nothing to do
    expect(nodeFrame.frameId).toBe(5);
    clock.tick(); // second frame() in the same rAF: advance privately
    clock.tick();
    expect(nodeFrame.frameId).toBe(7);
    expect(clock.manualAdvances).toBe(2);
    r.info.frame = 8; // renderer's rAF ran
    clock.tick();
    expect(clock.manualAdvances).toBe(2);
  });

  test('NodeFrameClock degrades (no throw) if the field disappears', () => {
    const r = { info: { frame: 1 } };
    const clock = new NodeFrameClock(r as never);
    const warn = console.warn;
    let warned = 0;
    console.warn = () => {
      warned++;
    };
    try {
      clock.tick();
      clock.tick();
      clock.tick();
    } finally {
      console.warn = warn;
    }
    expect(warned).toBe(1);
  });
});

describe('fireworks', () => {
  test('the rocket arrives at the burst point after its flight time', () => {
    const from = new Vector3(3, -2, 7);
    const to = new Vector3(5, 12, 4);
    const v = rocketVelocity(from, to, 1.1, 0.6, 3);
    const at = travel(from, v, 1.1, 0.6, 3);
    expect(at.distanceTo(to)).toBeLessThan(1e-9);
  });

  test('every burst kind: rocket first, burst scheduled at launch + flight, within the pool', () => {
    const rng = mulberry32(7);
    let worst = 0;
    for (const kind of BURST_KINDS) {
      const plan = planFirework({
        burst: new Vector3(0, 20, -25),
        launch: new Vector3(1, 7, -25),
        now: 10,
        viewDir: new Vector3(0, 0.6, -0.8).normalize(),
        kind,
        rng,
      });
      expect(plan.kind).toBe(kind);
      const rocket = plan.particles[0];
      expect(rocket?.birth).toBe(10);
      expect(rocket?.life).toBeCloseTo(plan.flight);
      const burst = plan.particles.filter((p) => p.birth === 10 + plan.flight);
      expect(burst.length).toBeGreaterThan(80);
      for (const p of burst) expect(p.origin.distanceTo(new Vector3(0, 20, -25))).toBeLessThan(1e-9);
      worst = Math.max(worst, plan.particles.length);
    }
    // E: at most 9 fireworks (remaining seconds mod 10) must fit the 4096 pool
    expect(worst * 9).toBeLessThan(4096);
  });
});

describe('particle pool idle bookkeeping', () => {
  test('hidden when idle, instances only the used prefix, restarts the ring once all are dead', () => {
    const bin = new Bin();
    const p = new Particles(4096, createSharedUniforms(), bin, mulberry32(1));
    p.update(0);
    expect(p.state.visible).toBe(false);
    p.emit(
      {
        origin: new Vector3(),
        count: 14,
        speed: [1, 2],
        life: [0.3, 0.5],
        size: [0.1, 0.1],
        colors: [0xffffff],
        delay: 0.5,
      },
      1,
    );
    p.update(1); // scheduled, not yet born: still drawn (zero-size) so the birth frame isn't late
    expect(p.state.visible).toBe(true);
    expect(p.state.instances).toBe(14);
    p.update(1.7);
    expect(p.state.visible).toBe(true);
    p.update(2.01);
    expect(p.state.visible).toBe(false);
    p.emit({ origin: new Vector3(), count: 3, speed: [1, 1], life: [1, 1], size: [1, 1], colors: [0] }, 3);
    p.update(3);
    expect(p.state.instances).toBe(3);
    bin.disposeAll();
  });
});
