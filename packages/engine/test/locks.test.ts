/** Phase 22: lock visuals are placed exactly where @wwm/physics blocks; locked bridges can be dimmed per bridge. */
import { readFileSync } from 'node:fs';
import { barrierPose, lockBoxes } from '@wwm/physics/locks';
import type { LockSpec, StageData } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { buildStageMeshes } from '../src/geom/structures.ts';
import { planTiles } from '../src/geom/tiling.ts';
import { BADGE_Y, type LockVisual, planLocks } from '../src/world/locks.ts';

const HANDMADE: StageData = JSON.parse(
  readFileSync(new URL('../../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
);
const v = (lock: LockSpec, icon: LockVisual['icon'] = 'pip'): LockVisual => ({
  lock,
  label: `lock ${lock.id}`,
  color: '#4f9fd6',
  icon,
});

describe('planLocks', () => {
  const specs: LockVisual[] = [
    v({ id: 1, kind: 'bridge', targetId: 1, islandId: 0 }),
    v({ id: 2, kind: 'bridge', targetId: 3, islandId: 1 }, 'gem'),
    v({ id: 3, kind: 'elevator', targetId: 0, islandId: 2 }),
    v({ id: 4, kind: 'goal', targetId: 0, islandId: 3 }),
    v({ id: 5, kind: 'bridge', targetId: 1, islandId: 3 }), // not one of bridge 1's islands: skipped
  ];
  const plan = planLocks(HANDMADE, specs);

  test('gates stand on the physics barrier pose (same centre, yaw, size)', () => {
    expect(plan.map((p) => p.id)).toEqual([1, 2, 3, 4]);
    for (const p of plan.filter((q) => q.gate)) {
      const spec = specs.find((s) => s.lock.id === p.id)?.lock as LockSpec;
      const b = barrierPose(HANDMADE, spec);
      expect(b).not.toBeNull();
      expect(p.center).toEqual(b?.center);
      expect(p.yaw).toBe(b?.yaw);
      expect(p.width).toBe(b?.width);
      expect(p.height).toBe(b?.height);
      expect(p.thickness).toBe(b?.thickness);
      // …and the drawn gate is the collider: the gate box of lockBoxes has the same centre line and extent
      const gate = lockBoxes(HANDMADE, spec)[0];
      expect(gate?.center[0]).toBeCloseTo(p.center[0], 9);
      expect(gate?.center[2]).toBeCloseTo(p.center[2], 9);
      expect(gate?.half[2]).toBeCloseTo(p.width / 2, 9);
      expect((gate?.center[1] ?? 0) + (gate?.half[1] ?? 0)).toBeCloseTo(p.center[1] + p.height, 9);
    }
  });

  test('the badge hangs on the island side of the gate, at sign height; goal locks float over the goal', () => {
    const bridge = plan[0];
    const b = barrierPose(HANDMADE, specs[0]?.lock as LockSpec);
    if (!bridge || !b) throw new Error('plan');
    const along =
      (bridge.badge[0] - bridge.center[0]) * b.dir[0] + (bridge.badge[2] - bridge.center[2]) * b.dir[1];
    expect(along).toBeLessThan(-b.thickness / 2);
    expect(bridge.badge[1]).toBeCloseTo(bridge.center[1] + BADGE_Y, 9);
    const goal = plan[3];
    expect(goal?.gate).toBe(false);
    expect(goal?.center[0]).toBeCloseTo(HANDMADE.goal.pos[0] / 13.5, 9);
    expect(goal?.center[1]).toBeCloseTo(4, 9); // goal island level 4
    expect(goal?.color).toEqual([0x4f / 255, 0x9f / 255, 0xd6 / 255]);
  });
});

describe('bridge index attributes (locked-bridge dimming)', () => {
  test('every deck vertex knows its bridge; island rails and elevator pillars are −1', () => {
    const m = buildStageMeshes(HANDMADE, planTiles(640, 800, 1, 4096));
    expect(m.bridgeIndex.length).toBe(m.bridges.triangles * 3);
    expect(m.railBridgeIndex.length).toBe(m.rails.triangles * 3);
    const deckSet = new Set(m.bridgeIndex);
    expect([...deckSet].sort()).toEqual([0, 1, 2, 3]);
    const railSet = new Set(m.railBridgeIndex);
    expect([...railSet].sort()).toEqual([-1, 0, 1, 2, 3]);
    // the vertices tagged as bridge 1 lie between island 0 and island 1 around y = 170 px (the deck + aprons)
    for (let i = 0; i < m.bridgeIndex.length; i++) {
      if (m.bridgeIndex[i] !== 1) continue;
      const x = (m.bridges.position[i * 3] as number) * 13.5;
      const z = (m.bridges.position[i * 3 + 2] as number) * 13.5;
      expect(x).toBeGreaterThan(270);
      expect(x).toBeLessThan(370);
      expect(Math.abs(z - 170)).toBeLessThanOrEqual(24.5);
    }
  });
});
