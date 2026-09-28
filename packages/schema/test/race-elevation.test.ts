import { describe, expect, test } from 'vitest';
import {
  type Bridge,
  bridgeGradeMetrics,
  bridgeSections,
  PX_PER_METER,
  parseStage,
  validateStage,
} from '../src/index.ts';
import { handmade } from './helpers.ts';

function ramp(angle: number, run = 10, smooth = false) {
  const stage = handmade();
  const rise = (Math.tan((angle * Math.PI) / 180) * run) / (smooth ? 1.5 : 1);
  const x = 100 + run * PX_PER_METER;
  stage.size = { ...stage.size, width: x + 100, height: 300 };
  stage.islands = [
    {
      id: 0,
      level: 0,
      contour: [
        [40, 100],
        [100, 100],
        [100, 180],
        [40, 180],
      ],
    },
    {
      id: 1,
      level: rise,
      contour: [
        [x, 100],
        [x + 60, 100],
        [x + 60, 180],
        [x, 180],
      ],
    },
  ].map((i) => ({
    ...i,
    contour: i.contour as [number, number][],
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
      a: [100, 140],
      b: [x, 140],
      width: 40,
      type: rise ? 'ramp' : 'flat',
      levelA: 0,
      levelB: rise,
      ...(smooth ? { elevationProfile: 'smoothstep' as const } : {}),
    },
  ];
  stage.elevators = [];
  stage.items = [];
  stage.portals = [];
  stage.flightLinks = [];
  stage.start = { islandId: 0, pos: [70, 140] };
  stage.goal = { islandId: 1, pos: [x + 30, 140], radius: 12.5 };
  return stage;
}

describe('Race elevation geometry contract', () => {
  test.each([0, 4.9, 5, 12, 20])('accepts %s degrees with correctly sized connectors', (angle) => {
    expect(validateStage(ramp(angle, angle < 5 ? 4 : 10), { mode: 'race' }).errors).toEqual([]);
  });
  test('rejects long flat/shallow connectors without relaxing legacy validation', () => {
    for (const angle of [0, 4.9]) {
      const stage = ramp(angle, 4.01);
      expect(validateStage(stage, { mode: 'race' }).errors.map((e) => e.code)).toContain(
        'race-shallow-connector-too-long',
      );
      expect(validateStage(stage).errors).toEqual([]);
    }
    expect(validateStage(ramp(20), { mode: 'race' }).errors).toEqual([]);
    expect(validateStage(ramp(20)).errors.map((e) => e.code)).toContain('ramp-too-steep');
    expect(validateStage(ramp(20.1), { mode: 'race' }).errors.map((e) => e.code)).toContain('ramp-too-steep');
  });
  test('straight unbanked smooth profile survives JSON and respects local not average grade', () => {
    const stage = ramp(20, 20, true);
    const parsed = parseStage(JSON.parse(JSON.stringify(stage)));
    expect(parsed).toEqual(stage);
    expect(validateStage(parsed, { mode: 'race' }).errors).toEqual([]);
    const bridge = parsed.bridges[0] as Bridge;
    const sections = bridgeSections(bridge);
    const quarter = sections[Math.round((sections.length - 1) / 4)];
    if (!quarter) throw new Error('Missing quarter section');
    const u = quarter.progress;
    expect(quarter.y).toBeCloseTo(bridge.levelB * u * u * (3 - 2 * u), 10);
    expect(Math.abs(quarter.y - bridge.levelB * u)).toBeGreaterThan(0.2);
    expect(bridgeGradeMetrics(bridge).maxColliderGrade).toBeLessThanOrEqual(
      Math.tan((20.01 * Math.PI) / 180),
    );
    expect(bridgeGradeMetrics(bridge).maxGrade).toBeCloseTo(Math.tan((20 * Math.PI) / 180), 10);
    expect(validateStage(ramp(20.1, 20, true), { mode: 'race' }).errors.map((e) => e.code)).toContain(
      'ramp-too-steep',
    );
  });
  test('banked deck cannot hide excessive combined surface grade', () => {
    const stage = ramp(19, 20, true);
    const bridge = stage.bridges[0] as Bridge;
    bridge.bank = 0.3;
    expect(bridgeGradeMetrics(bridge).maxGrade).toBeGreaterThan(Math.tan((20 * Math.PI) / 180));
    expect(validateStage(stage, { mode: 'race' }).errors.map((e) => e.code)).toContain('ramp-too-steep');
  });
  test('unknown profile fails structural parsing', () => {
    const stage = ramp(12);
    expect(() =>
      parseStage({ ...stage, bridges: [{ ...stage.bridges[0], elevationProfile: 'unchecked' }] }),
    ).toThrow();
  });
});
