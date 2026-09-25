import { describe, expect, test } from 'vitest';
import {
  MIN_BRIDGE_WIDTH_PX,
  parseControlMessage,
  parseStage,
  SchemaError,
  type StageData,
  validateStage,
} from '../src/index.ts';
import { handmade } from './helpers.ts';

function codes(stage: unknown): string[] {
  return validateStage(stage).errors.map((e) => e.code);
}

/** Apply a mutation to a fresh handmade stage and return the error codes. */
function mutate(fn: (s: StageData) => void): string[] {
  const s = handmade();
  fn(s);
  return codes(s);
}

describe('handmade-simple fixture', () => {
  test('passes validateStage', () => {
    const r = validateStage(handmade());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test('matches the brief: 4 islands (levels 0,0,1,3), 3 flat + 1 ramp, 1 elevator, 20 small + 2 large', () => {
    const s = handmade();
    expect(s.islands.map((i) => i.level)).toEqual([0, 0, 1, 3]);
    expect(s.bridges.filter((b) => b.type === 'flat')).toHaveLength(3);
    expect(s.bridges.filter((b) => b.type === 'ramp')).toHaveLength(1);
    expect(s.elevators).toHaveLength(1);
    expect(s.items.filter((i) => i.kind === 'small')).toHaveLength(20);
    expect(s.items.filter((i) => i.kind === 'large')).toHaveLength(2);
    expect(s.islands.every((i) => i.restartPoints.length > 0 && i.guardrails.length > 0)).toBe(true);
    expect(s.texture).toMatchObject({ width: 1280, height: 1600 });
  });

  test('parseStage round-trips it', () => {
    const s = handmade();
    expect(parseStage(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});

describe('structure (Zod)', () => {
  test('rejects wrong schema tag', () => {
    expect(mutate((s) => Object.assign(s, { schema: 'wwm.stage/2' }))).toEqual(['schema']);
  });
  test('rejects non-integer level', () => {
    expect(
      mutate((s) => {
        (s.islands[0] as { level: number }).level = 0.5;
      }),
    ).toContain('schema');
  });
  test('rejects non-uint32 seed', () => {
    expect(mutate((s) => Object.assign(s, { seed: -1 }))).toContain('schema');
    expect(mutate((s) => Object.assign(s, { seed: 2 ** 32 }))).toContain('schema');
  });
  test('rejects NaN / Infinity coordinates', () => {
    expect(mutate((s) => Object.assign(s.start, { pos: [Number.NaN, 0] }))).toContain('schema');
    expect(mutate((s) => Object.assign(s.goal, { pos: [Number.POSITIVE_INFINITY, 0] }))).toContain('schema');
  });
  test('rejects a stage with no islands', () => {
    expect(mutate((s) => Object.assign(s, { islands: [] }))).toContain('schema');
  });
  test('parseStage throws SchemaError with paths', () => {
    const s = handmade() as unknown as Record<string, unknown>;
    delete s.goal;
    expect(() => parseStage(s)).toThrow(SchemaError);
    try {
      parseStage(s);
    } catch (e) {
      expect((e as SchemaError).issues[0]?.path).toBe('goal');
    }
  });
  test('validateStage never throws on garbage', () => {
    for (const x of [null, undefined, 42, 'x', [], {}]) expect(validateStage(x).ok).toBe(false);
  });
});

describe('invariants (one negative test each)', () => {
  test('unreachable-island: every island reachable from start', () => {
    // Remove the elevator: D (goal) becomes unreachable.
    expect(mutate((s) => Object.assign(s, { elevators: [] }))).toContain('unreachable-island');
    // Remove the ramp: C and D unreachable.
    expect(
      mutate((s) => Object.assign(s, { bridges: s.bridges.filter((b) => b.type !== 'ramp') })),
    ).toContain('unreachable-island');
  });

  test('goal-on-start-island: goal differs from start when > 1 island', () => {
    expect(
      mutate((s) => {
        s.goal = { pos: [320, 400], islandId: 0, radius: 48 };
      }),
    ).toContain('goal-on-start-island');
  });

  test('goal on the start island is allowed for a 1-island stage', () => {
    const s = handmade();
    const only = s.islands[0];
    if (!only) throw new Error('fixture');
    s.islands = [only];
    s.bridges = [];
    s.elevators = [];
    s.items = s.items.filter((i) => i.islandId === 0);
    s.goal = { pos: [320, 400], islandId: 0, radius: 48 };
    // The remaining guardrail gaps are harmless; only structural/invariant errors matter.
    expect(codes(s)).toEqual([]);
  });

  test('bridge-too-narrow: width ≥ MIN_BRIDGE_WIDTH_PX', () => {
    expect(mutate((s) => Object.assign(s.bridges[0] ?? {}, { width: MIN_BRIDGE_WIDTH_PX - 1 }))).toContain(
      'bridge-too-narrow',
    );
  });

  test('bridge-crosses-island: bridges must not cross unconnected islands', () => {
    // A long bridge A→C whose centerline passes straight through B.
    expect(
      mutate((s) => {
        s.bridges.push({
          id: 99,
          from: 0,
          to: 2,
          a: [560, 300],
          b: [960, 760],
          width: 100,
          type: 'ramp',
          levelA: 0,
          levelB: 1,
        });
      }),
    ).toContain('bridge-crosses-island');
  });

  test('bridge-type-mismatch: ramp must join levels differing by exactly 1', () => {
    expect(
      mutate((s) => {
        const b = s.bridges[3];
        if (b) b.type = 'flat';
      }),
    ).toContain('bridge-type-mismatch');
    // Ramp spanning 2 levels (C L1 → D L3) is invalid.
    expect(
      mutate((s) => {
        s.bridges.push({
          id: 98,
          from: 2,
          to: 3,
          a: [720, 1150],
          b: [560, 1150],
          width: 100,
          type: 'ramp',
          levelA: 1,
          levelB: 3,
        });
      }),
    ).toContain('bridge-type-mismatch');
  });

  test('bridge-level-mismatch: endpoint levels match their islands', () => {
    expect(
      mutate((s) => {
        const b = s.bridges[3];
        if (b) b.levelB = 2;
      }),
    ).toContain('bridge-level-mismatch');
  });

  test('bridge-endpoint-off-island', () => {
    expect(
      mutate((s) => {
        const b = s.bridges[0];
        if (b) b.a = [400, 700];
      }),
    ).toContain('bridge-endpoint-off-island');
  });

  test('bridge-self-loop', () => {
    expect(
      mutate((s) => {
        const b = s.bridges[0];
        if (b) b.to = b.from;
      }),
    ).toContain('bridge-self-loop');
  });

  test('bridge-mouth-blocked: guardrails need gaps at bridge mouths', () => {
    expect(
      mutate((s) => {
        const a = s.islands[0];
        if (a) a.guardrails = [[...a.contour, a.contour[0] as [number, number]]]; // closed rail, no gaps
      }),
    ).toContain('bridge-mouth-blocked');
  });

  test('elevator-level-mismatch', () => {
    expect(
      mutate((s) => {
        const e = s.elevators[0];
        if (e) e.levelHigh = 2;
      }),
    ).toContain('elevator-level-mismatch');
  });

  test('item-outside-island: items inside with BALL_RADIUS_PX clearance', () => {
    // Outside entirely.
    expect(mutate((s) => Object.assign(s.items[0] ?? {}, { pos: [640, 700] }))).toContain(
      'item-outside-island',
    );
    // Inside, but 10px from the edge (< 20px clearance).
    expect(mutate((s) => Object.assign(s.items[0] ?? {}, { pos: [90, 300] }))).toContain(
      'item-outside-island',
    );
  });

  test('restart-outside-island: restart points need clearance too', () => {
    expect(
      mutate((s) => {
        const i = s.islands[1];
        if (i) i.restartPoints.push([1195, 300]);
      }),
    ).toContain('restart-outside-island');
  });

  test('start-outside-island / goal-outside-island', () => {
    expect(mutate((s) => Object.assign(s.start, { pos: [640, 640] }))).toContain('start-outside-island');
    expect(mutate((s) => Object.assign(s.goal, { pos: [640, 1400] }))).toContain('goal-outside-island');
  });

  test('items inside a hole are rejected', () => {
    expect(
      mutate((s) => {
        const d = s.islands[3];
        if (d)
          d.holes = [
            [
              [260, 1060],
              [260, 1140],
              [380, 1140],
              [380, 1060],
            ],
          ]; // CW (negative area)
      }),
    ).toContain('item-outside-island'); // item at [320,1100] now sits in the hole
  });

  test('contour-orientation: contours must be CCW (positive area)', () => {
    expect(
      mutate((s) => {
        const i = s.islands[2];
        if (i) i.contour.reverse();
      }),
    ).toContain('contour-orientation');
  });

  test('hole-orientation / hole-outside', () => {
    expect(
      mutate((s) => {
        const d = s.islands[3];
        if (d)
          d.holes = [
            [
              [200, 1200],
              [300, 1200],
              [300, 1300],
              [200, 1300],
            ],
          ]; // CCW = wrong for a hole
      }),
    ).toContain('hole-orientation');
    expect(
      mutate((s) => {
        const d = s.islands[3];
        if (d)
          d.holes = [
            [
              [600, 1200],
              [600, 1300],
              [700, 1300],
              [700, 1200],
            ],
          ];
      }),
    ).toContain('hole-outside');
  });

  test('contour-self-intersection', () => {
    expect(
      mutate((s) => {
        const i = s.islands[1];
        if (i)
          i.contour = [
            [720, 80],
            [1200, 80],
            [720, 600],
            [1000, 600],
          ]; // asymmetric bow-tie (non-zero area)
      }),
    ).toContain('contour-self-intersection');
  });

  test('contour-degenerate', () => {
    expect(
      mutate((s) => {
        const i = s.islands[1];
        if (i)
          i.contour = [
            [720, 80],
            [1200, 80],
          ];
      }),
    ).toContain('contour-degenerate');
  });

  test('duplicate-id and unknown-island', () => {
    expect(mutate((s) => Object.assign(s.items[1] ?? {}, { id: 0 }))).toContain('duplicate-id');
    expect(mutate((s) => Object.assign(s.items[0] ?? {}, { islandId: 42 }))).toContain('unknown-island');
    expect(mutate((s) => Object.assign(s.bridges[0] ?? {}, { to: 42 }))).toContain('unknown-island');
  });
});

describe('parseControlMessage', () => {
  test('accepts every contract message', () => {
    const msgs = [
      { t: 'peer', role: 'host', connected: true },
      { t: 'state', phase: 'play', score: 10, balls: 3, timeLeft: 42.5 },
      { t: 'haptic', pattern: 'item' },
      { t: 'calibrated' },
      { t: 'ping', id: 1, ts: 1000 },
      { t: 'pong', id: 1, ts: 1000 },
    ];
    for (const m of msgs) expect(parseControlMessage(JSON.stringify(m))).toEqual(m);
  });
  test('rejects malformed / unknown', () => {
    expect(parseControlMessage('not json')).toBeNull();
    expect(parseControlMessage(JSON.stringify({ t: 'nope' }))).toBeNull();
    expect(
      parseControlMessage(JSON.stringify({ t: 'state', phase: 'flying', score: 0, balls: 0, timeLeft: 0 })),
    ).toBeNull();
  });
});
