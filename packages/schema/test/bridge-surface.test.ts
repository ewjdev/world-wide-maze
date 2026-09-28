import { describe, expect, test } from 'vitest';
import {
  type Bridge,
  bridgeArcLength,
  bridgeSections,
  bridgeSurfaceMesh,
  parseStage,
  type StageData,
  validateStage,
} from '../src/index.ts';
import { handmade } from './helpers.ts';

function crossing(level = 2): StageData {
  const stage = handmade();
  stage.islands = [
    {
      id: 0,
      contour: [
        [60, 170],
        [120, 170],
        [120, 230],
        [60, 230],
      ],
      level,
    },
    {
      id: 1,
      contour: [
        [480, 170],
        [540, 170],
        [540, 230],
        [480, 230],
      ],
      level,
    },
    {
      id: 2,
      contour: [
        [270, 170],
        [330, 170],
        [330, 230],
        [270, 230],
      ],
      level: 0,
    },
  ].map((island) => ({
    ...island,
    contour: island.contour as [number, number][],
    holes: [],
    guardrails: [],
    restartPoints: [],
    sourceElementIds: [],
  }));
  stage.bridges = [
    {
      id: 0,
      from: 0,
      to: 1,
      a: [120, 200],
      b: [480, 200],
      width: 40,
      type: 'flat',
      levelA: level,
      levelB: level,
    },
  ];
  stage.elevators = [];
  stage.items = [];
  stage.portals = [];
  stage.flightLinks = [{ from: 0, to: 2 }];
  stage.start = { islandId: 0, pos: [90, 200] };
  stage.goal = { islandId: 1, pos: [510, 200], radius: 12.5 };
  return stage;
}

describe('race bridge contract', () => {
  test('separated crossover permits a ball beneath the slab; insufficient and equal clearance reject', () => {
    expect(validateStage(crossing()).errors).toEqual([]);
    for (const level of [0, 1.5])
      expect(validateStage(crossing(level)).errors.map((e) => e.code)).toContain('bridge-crosses-island');
    const beneath = crossing(0);
    const upper = beneath.islands[2];
    if (upper) upper.level = 2;
    expect(validateStage(beneath).errors).toEqual([]);
  });

  test('curved footprint checks actual arc, not only its endpoint chord', () => {
    const stage = crossing(0);
    const bridge = stage.bridges[0] as Bridge;
    bridge.control = [300, 360];
    const other = stage.islands[2];
    if (other)
      other.contour = [
        [270, 260],
        [330, 260],
        [330, 300],
        [270, 300],
      ];
    expect(validateStage(stage).errors.map((e) => e.code)).toContain('bridge-crosses-island');
  });

  test('optional fields round-trip and bank is bounded', () => {
    const stage = crossing();
    const bridge = stage.bridges[0] as Bridge;
    bridge.control = [300, 350];
    bridge.bank = 0.2;
    bridge.rails = false;
    expect(parseStage(stage)).toEqual(stage);
    bridge.bank = 0.5;
    expect(validateStage(stage).errors.map((e) => e.code)).toContain('schema');
  });

  test('flight links are directed, reference checked, and never self loops', () => {
    const stage = crossing();
    stage.flightLinks = [{ from: 2, to: 0 }];
    expect(validateStage(stage).errors.map((e) => e.code)).toContain('unreachable-island');
    stage.flightLinks = [
      { from: 0, to: 0 },
      { from: 0, to: 99 },
    ];
    expect(validateStage(stage).errors.map((e) => e.code)).toEqual(
      expect.arrayContaining(['flight-self-loop', 'unknown-island']),
    );
  });

  test('bank endpoints meet flat mouths and tessellation is a closed outward prism', () => {
    const bridge = {
      ...(crossing().bridges[0] as Bridge),
      control: [300, 350] as [number, number],
      bank: 0.25,
    };
    const sections = bridgeSections(bridge);
    expect(sections[0]?.bank).toBe(0);
    expect(sections.at(-1)?.bank).toBeCloseTo(0, 12);
    expect(bridgeArcLength(bridge)).toBeGreaterThan(360);
    const mesh = bridgeSurfaceMesh(bridge, 0.463);
    const edges = new Map<string, number>();
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const triangle = Array.from(mesh.indices.slice(i, i + 3));
      for (let j = 0; j < 3; j++) {
        const a = triangle[j] as number;
        const b = triangle[(j + 1) % 3] as number;
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    expect([...edges.values()].every((count) => count === 2)).toBe(true);
    // First quad is the upward top, second is the downward underside.
    const normalY = (triangle: number) => {
      const [a, b, c] = Array.from(mesh.indices.slice(triangle * 3, triangle * 3 + 3)).map((i) =>
        Array.from(mesh.vertices.slice(i * 3, i * 3 + 3)),
      );
      if (!a || !b || !c) throw new Error('triangle');
      return (
        ((b[2] as number) - (a[2] as number)) * ((c[0] as number) - (a[0] as number)) -
        ((b[0] as number) - (a[0] as number)) * ((c[2] as number) - (a[2] as number))
      );
    };
    expect(normalY(0)).toBeGreaterThan(0);
    expect(normalY(2)).toBeLessThan(0);
  });
});
