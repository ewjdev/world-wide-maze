import { describe, expect, test } from 'vitest';
import {
  MAX_LARGE_ITEMS,
  MAX_RAMP_SLOPE,
  MIN_BRIDGE_WIDTH_PX,
  PX_PER_METER,
  parseControlMessage,
  parseStage,
  rampSlope,
  SchemaError,
  type StageData,
  validateStage,
} from '../src/index.ts';
import { handmade } from './helpers.ts';

// handmade-simple (v0.2) layout, stage px: A x40..280 y40..300 (L0, start) · B x360..600 y40..300 (L0)
// C x360..600 y460..620 (L1.5) · D x40..344 y400..760 (L4, goal). b0–b2 flat A→B, b3 ramp B→C, e0 C→D.

function codes(stage: unknown): string[] {
  return validateStage(stage).errors.map((e) => e.code);
}

/** Apply a mutation to a fresh handmade stage and return the error codes. */
function mutate(fn: (s: StageData) => void): string[] {
  const s = handmade();
  fn(s);
  return codes(s);
}

function at<T>(xs: T[], i: number): T {
  const x = xs[i];
  if (x === undefined) throw new Error(`fixture has no index ${i}`);
  return x;
}

describe('handmade-simple fixture', () => {
  test('passes validateStage', () => {
    const r = validateStage(handmade());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test('matches the brief: 4 islands (levels 0,0,1.5,4), 3 flat + 1 ramp, 1 elevator, 20 small + 2 large', () => {
    const s = handmade();
    expect(s.schema).toBe('wwm.stage/2');
    expect(s.islands.map((i) => i.level)).toEqual([0, 0, 1.5, 4]);
    expect(s.bridges.filter((b) => b.type === 'flat')).toHaveLength(3);
    expect(s.bridges.filter((b) => b.type === 'ramp')).toHaveLength(1);
    expect(s.elevators).toHaveLength(1);
    expect(s.items.filter((i) => i.kind === 'small')).toHaveLength(20);
    expect(s.items.filter((i) => i.kind === 'large')).toHaveLength(2);
    expect(s.islands.every((i) => i.restartPoints.length > 0 && i.guardrails.length > 0)).toBe(true);
    expect(s.size).toEqual({ width: 640, height: 800 });
    expect(s.texture).toMatchObject({ width: 1280, height: 1600, scale: 2 });
    expect(s.source.slice).toEqual({ index: 0, count: 1, y: 0, height: 800 });
  });

  test('parseStage round-trips it', () => {
    const s = handmade();
    expect(parseStage(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});

describe('structure (Zod)', () => {
  test('rejects the v0.1 schema tag', () => {
    expect(mutate((s) => Object.assign(s, { schema: 'wwm.stage/1' }))).toEqual(['schema']);
  });
  test('accepts float levels, rejects non-finite ones', () => {
    // A float level is structurally fine (it then fails the consistency checks, not the schema).
    expect(mutate((s) => Object.assign(at(s.islands, 0), { level: 0.25 }))).not.toContain('schema');
    expect(mutate((s) => Object.assign(at(s.islands, 0), { level: Number.NaN }))).toContain('schema');
  });
  test('requires size, texture.scale, source.slice and the new elevator shape', () => {
    expect(
      mutate((s) => {
        delete (s as Partial<StageData>).size;
      }),
    ).toContain('schema');
    expect(mutate((s) => Object.assign(s.texture, { scale: 0 }))).toContain('schema');
    expect(
      mutate((s) => {
        delete (s.source as Partial<StageData['source']>).slice;
      }),
    ).toContain('schema');
    expect(
      mutate((s) => {
        s.elevators = [{ id: 0, islandFrom: 2, islandTo: 3, pos: [352, 540], size: 48 }] as never;
      }),
    ).toContain('schema');
  });
  test('texture.path may be empty (buildStage output before storage)', () => {
    expect(mutate((s) => Object.assign(s.texture, { path: '' }))).toEqual([]);
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
        s.goal = { pos: [160, 170], islandId: 0, radius: 12.5 };
      }),
    ).toContain('goal-on-start-island');
  });

  test('goal on the start island is allowed for a 1-island stage', () => {
    const s = handmade();
    s.islands = [at(s.islands, 0)];
    s.bridges = [];
    s.elevators = [];
    s.items = s.items.filter((i) => i.islandId === 0);
    s.goal = { pos: [160, 170], islandId: 0, radius: 12.5 };
    // The remaining guardrail gaps are harmless; only structural/invariant errors matter.
    expect(codes(s)).toEqual([]);
  });

  test('bridge-too-narrow: width ≥ MIN_BRIDGE_WIDTH_PX', () => {
    expect(mutate((s) => Object.assign(at(s.bridges, 0), { width: MIN_BRIDGE_WIDTH_PX - 1 }))).toContain(
      'bridge-too-narrow',
    );
  });

  test('bridge-crosses-island: bridges must not cross unconnected islands', () => {
    // A long diagonal ramp A→C whose deck runs straight through B.
    expect(
      mutate((s) => {
        s.bridges.push({
          id: 98,
          from: 0,
          to: 2,
          a: [280, 200],
          b: [620, 470],
          width: 40,
          type: 'ramp',
          levelA: 0,
          levelB: 1.5,
        });
      }),
    ).toContain('bridge-crosses-island');
  });

  test("bridge-type-mismatch: 'ramp' iff levels differ", () => {
    expect(mutate((s) => Object.assign(at(s.bridges, 3), { type: 'flat' }))).toContain(
      'bridge-type-mismatch',
    );
    expect(mutate((s) => Object.assign(at(s.bridges, 0), { type: 'ramp' }))).toContain(
      'bridge-type-mismatch',
    );
  });

  test('ramp-too-steep: slope ≤ MAX_RAMP_SLOPE in world units', () => {
    // The B→C ramp has a 160 px run (11.85 m). Raise C to just over / just under the limit.
    const run = 160 / PX_PER_METER;
    expect(rampSlope([0, 0], [0, 160], 0, MAX_RAMP_SLOPE * run)).toBeCloseTo(MAX_RAMP_SLOPE, 12);
    expect(
      mutate((s) => {
        const hi = MAX_RAMP_SLOPE * run * 1.01;
        at(s.islands, 2).level = hi;
        Object.assign(at(s.bridges, 3), { levelB: hi });
        Object.assign(at(s.elevators, 0), { levelLow: hi });
      }),
    ).toEqual(['ramp-too-steep']);
    expect(
      mutate((s) => {
        const ok = MAX_RAMP_SLOPE * run * 0.99;
        at(s.islands, 2).level = ok;
        Object.assign(at(s.bridges, 3), { levelB: ok });
        Object.assign(at(s.elevators, 0), { levelLow: ok });
      }),
    ).toEqual([]);
  });

  test('bridge-level-mismatch: endpoint levels match their islands', () => {
    expect(mutate((s) => Object.assign(at(s.bridges, 3), { levelB: 1 }))).toContain('bridge-level-mismatch');
  });

  test('bridge-endpoint-off-island', () => {
    expect(mutate((s) => Object.assign(at(s.bridges, 0), { a: [200, 360] }))).toContain(
      'bridge-endpoint-off-island',
    );
  });

  test('bridge-self-loop', () => {
    expect(mutate((s) => Object.assign(at(s.bridges, 0), { to: 0 }))).toContain('bridge-self-loop');
  });

  test('bridge-mouth-blocked: guardrails need gaps at bridge mouths', () => {
    expect(
      mutate((s) => {
        const a = at(s.islands, 0);
        a.guardrails = [[...a.contour, at(a.contour, 0)]]; // closed rail, no gaps
      }),
    ).toContain('bridge-mouth-blocked');
  });

  test('elevator-level-mismatch: levels match islands, from = lower island', () => {
    expect(mutate((s) => Object.assign(at(s.elevators, 0), { levelHigh: 3 }))).toContain(
      'elevator-level-mismatch',
    );
    // Swapping from/to (upper island as `from`) is rejected even with the same level pair.
    expect(
      mutate((s) => {
        const e = at(s.elevators, 0);
        Object.assign(e, { islandFrom: e.islandTo, islandTo: e.islandFrom, a: e.b, b: e.a });
      }),
    ).toContain('elevator-level-mismatch');
    expect(mutate((s) => Object.assign(at(s.elevators, 0), { levelLow: 4, levelHigh: 4 }))).toContain(
      'elevator-level-mismatch',
    );
  });

  test('elevator-endpoint-off-island: lower platform on islandFrom, upper on islandTo', () => {
    expect(mutate((s) => Object.assign(at(s.elevators, 0), { a: [360, 700] }))).toContain(
      'elevator-endpoint-off-island',
    );
    expect(mutate((s) => Object.assign(at(s.elevators, 0), { b: [300, 360] }))).toContain(
      'elevator-endpoint-off-island',
    );
  });

  test('elevator-too-narrow / elevator-self-loop', () => {
    expect(mutate((s) => Object.assign(at(s.elevators, 0), { width: MIN_BRIDGE_WIDTH_PX - 1 }))).toContain(
      'elevator-too-narrow',
    );
    expect(mutate((s) => Object.assign(at(s.elevators, 0), { islandTo: 2 }))).toContain('elevator-self-loop');
  });

  test('elevator-mouth-blocked: rails gapped at elevator mouths too', () => {
    expect(
      mutate((s) => {
        const d = at(s.islands, 3);
        d.guardrails = [[...d.contour, at(d.contour, 0)]];
      }),
    ).toContain('elevator-mouth-blocked');
  });

  test('elevator-crosses-island', () => {
    expect(
      mutate((s) => {
        // Footprint pushed up from C into B (an island it does not connect).
        Object.assign(at(s.elevators, 0), { a: [480, 460], b: [480, 250] });
      }),
    ).toContain('elevator-crosses-island');
  });

  test('too-many-large-items: at most MAX_LARGE_ITEMS', () => {
    expect(
      mutate((s) => {
        for (let k = 0; k < MAX_LARGE_ITEMS - 1; k++)
          s.items.push({ id: 100 + k, kind: 'large', pos: [100 + 20 * k, 700], islandId: 3 });
      }),
    ).toEqual(['too-many-large-items']);
    // Exactly MAX_LARGE_ITEMS is fine.
    expect(
      mutate((s) => {
        for (let k = 0; k < MAX_LARGE_ITEMS - 2; k++)
          s.items.push({ id: 100 + k, kind: 'large', pos: [100 + 20 * k, 700], islandId: 3 });
      }),
    ).toEqual([]);
  });

  test('out-of-bounds: all geometry lies within size', () => {
    expect(mutate((s) => Object.assign(s.size, { width: 500 }))).toContain('out-of-bounds');
    expect(mutate((s) => Object.assign(s.size, { height: 700 }))).toContain('out-of-bounds');
    expect(
      mutate((s) => {
        at(s.islands, 0).guardrails.push([
          [40, 40],
          [-5, 40],
        ]);
      }),
    ).toContain('out-of-bounds');
  });

  test('slice-invalid: index < count', () => {
    expect(mutate((s) => Object.assign(s.source.slice, { index: 1 }))).toEqual(['slice-invalid']);
  });

  test('item-outside-island: items inside with BALL_RADIUS_PX clearance', () => {
    // Outside entirely (in the A–B gap).
    expect(mutate((s) => Object.assign(at(s.items, 0), { pos: [320, 330] }))).toContain(
      'item-outside-island',
    );
    // Inside, but 4 px from the edge (< 6.75 px clearance).
    expect(mutate((s) => Object.assign(at(s.items, 0), { pos: [44, 150] }))).toContain('item-outside-island');
  });

  test('restart-outside-island: restart points need clearance too', () => {
    expect(mutate((s) => at(s.islands, 1).restartPoints.push([597, 150]))).toContain(
      'restart-outside-island',
    );
  });

  test('start-outside-island / goal-outside-island', () => {
    expect(mutate((s) => Object.assign(s.start, { pos: [320, 350] }))).toContain('start-outside-island');
    expect(mutate((s) => Object.assign(s.goal, { pos: [480, 700] }))).toContain('goal-outside-island');
  });

  test('items inside a hole are rejected', () => {
    expect(
      mutate((s) => {
        at(s.islands, 3).holes = [
          [
            [80, 440],
            [80, 480],
            [120, 480],
            [120, 440],
          ],
        ]; // negative area
      }),
    ).toContain('item-outside-island'); // item at [100,460] now sits in the hole
  });

  test('contour-orientation: contours must have positive signed area', () => {
    expect(mutate((s) => at(s.islands, 2).contour.reverse())).toContain('contour-orientation');
  });

  test('hole-orientation / hole-outside', () => {
    expect(
      mutate((s) => {
        at(s.islands, 3).holes = [
          [
            [200, 650],
            [240, 650],
            [240, 680],
            [200, 680],
          ],
        ]; // positive area = wrong for a hole
      }),
    ).toContain('hole-orientation');
    expect(
      mutate((s) => {
        at(s.islands, 3).holes = [
          [
            [400, 650],
            [400, 680],
            [440, 680],
            [440, 650],
          ],
        ];
      }),
    ).toContain('hole-outside');
  });

  test('contour-self-intersection', () => {
    expect(
      mutate((s) => {
        at(s.islands, 1).contour = [
          [360, 40],
          [600, 40],
          [360, 300],
          [500, 300],
        ]; // asymmetric bow-tie (non-zero area)
      }),
    ).toContain('contour-self-intersection');
  });

  test('contour-degenerate', () => {
    expect(
      mutate((s) => {
        at(s.islands, 1).contour = [
          [360, 40],
          [600, 40],
        ];
      }),
    ).toContain('contour-degenerate');
  });

  test('duplicate-id and unknown-island', () => {
    expect(mutate((s) => Object.assign(at(s.items, 1), { id: 0 }))).toContain('duplicate-id');
    expect(mutate((s) => Object.assign(at(s.items, 0), { islandId: 42 }))).toContain('unknown-island');
    expect(mutate((s) => Object.assign(at(s.bridges, 0), { to: 42 }))).toContain('unknown-island');
    expect(mutate((s) => Object.assign(at(s.elevators, 0), { islandTo: 42 }))).toContain('unknown-island');
  });
});

describe('parseControlMessage', () => {
  test('accepts every contract message (incl. optional pos/text)', () => {
    const msgs = [
      { t: 'peer', role: 'host', connected: true },
      { t: 'state', phase: 'play', score: 10, balls: 3, timeLeft: 42.5 },
      { t: 'state', phase: 'falling', score: 10, balls: 2, timeLeft: 300 },
      { t: 'haptic', pattern: 'item' },
      { t: 'haptic', pattern: 'large' },
      { t: 'pos', x: 100, y: 200, heading: 1.2 },
      { t: 'text', field: 'name', value: 'wwm_fan' },
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
    expect(parseControlMessage(JSON.stringify({ t: 'text', field: 'email', value: 'x' }))).toBeNull();
  });
});
