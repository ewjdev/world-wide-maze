/**
 * Compile-time + runtime checks that the Zod schemas and the hand-written contract types agree exactly,
 * and that the public surface covers contracts.md.
 */
import { describe, expect, expectTypeOf, test } from 'vitest';
import type { z } from 'zod';
import type {
  ApiError,
  CaptureBundle,
  ControlMessage,
  CreateStageRequest,
  CreateStageResponse,
  CuratedResponse,
  DomElement,
  Elevator,
  InputSample,
  JobEvent,
  RunResponse,
  ScoresResponse,
  SimEvent,
  SimStepResult,
  StageData,
  StageSlice,
  SubmitScoreRequest,
} from '../src/index.ts';
import * as schema from '../src/index.ts';

describe('Zod ⇔ TS types', () => {
  test('inferred types equal the contract interfaces', () => {
    expectTypeOf<z.infer<typeof schema.CaptureBundleSchema>>().toEqualTypeOf<CaptureBundle>();
    expectTypeOf<z.infer<typeof schema.DomElementSchema>>().toEqualTypeOf<DomElement>();
    expectTypeOf<z.infer<typeof schema.StageDataSchema>>().toEqualTypeOf<StageData>();
    expectTypeOf<z.infer<typeof schema.StageSliceSchema>>().toEqualTypeOf<StageSlice>();
    expectTypeOf<z.infer<typeof schema.ElevatorSchema>>().toEqualTypeOf<Elevator>();
    expectTypeOf<z.infer<typeof schema.InputSampleSchema>>().toEqualTypeOf<InputSample>();
    expectTypeOf<z.infer<typeof schema.ControlMessageSchema>>().toEqualTypeOf<ControlMessage>();
    expectTypeOf<z.infer<typeof schema.ApiErrorSchema>>().toEqualTypeOf<ApiError>();
    expectTypeOf<z.infer<typeof schema.CreateStageRequestSchema>>().toEqualTypeOf<CreateStageRequest>();
    expectTypeOf<z.infer<typeof schema.CreateStageResponseSchema>>().toEqualTypeOf<CreateStageResponse>();
    expectTypeOf<z.infer<typeof schema.JobEventSchema>>().toEqualTypeOf<JobEvent>();
    expectTypeOf<z.infer<typeof schema.RunResponseSchema>>().toEqualTypeOf<RunResponse>();
    expectTypeOf<z.infer<typeof schema.CuratedResponseSchema>>().toEqualTypeOf<CuratedResponse>();
    expectTypeOf<z.infer<typeof schema.SubmitScoreRequestSchema>>().toEqualTypeOf<SubmitScoreRequest>();
    expectTypeOf<z.infer<typeof schema.ScoresResponseSchema>>().toEqualTypeOf<ScoresResponse>();
  });

  test('§5 shapes (no Zod schema; checked structurally)', () => {
    expectTypeOf<InputSample>().toHaveProperty('frameYaw').toEqualTypeOf<number>();
    expectTypeOf<Extract<SimEvent, { type: 'elevator' }>>().toEqualTypeOf<{
      type: 'elevator';
      elevatorId: number;
      phase: 'start' | 'end';
    }>();
    expectTypeOf<Extract<SimEvent, { type: 'lost' }>>().toEqualTypeOf<{ type: 'lost' }>();
    expectTypeOf<Extract<SimEvent, { type: 'island' }>>().toEqualTypeOf<{
      type: 'island';
      islandId: number;
    }>();
    expectTypeOf<SimStepResult['elevators']>().toEqualTypeOf<{ id: number; y: number }[]>();
  });
});

describe('contract surface', () => {
  test('constants (contracts §1) have the contract values', () => {
    expect({
      PX_PER_METER: schema.PX_PER_METER,
      BALL_RADIUS_M: schema.BALL_RADIUS_M,
      LEVEL_HEIGHT_M: schema.LEVEL_HEIGHT_M,
      MAX_RAMP_SLOPE: schema.MAX_RAMP_SLOPE,
      MIN_BRIDGE_WIDTH_PX: schema.MIN_BRIDGE_WIDTH_PX,
      MIN_ISLAND_SIZE_PX: schema.MIN_ISLAND_SIZE_PX,
      MAX_PAGE_HEIGHT_PX: schema.MAX_PAGE_HEIGHT_PX,
      MAX_STAGE_HEIGHT_PX: schema.MAX_STAGE_HEIGHT_PX,
      CAPTURE_DPR: schema.CAPTURE_DPR,
      MAX_LARGE_ITEMS: schema.MAX_LARGE_ITEMS,
      SIM_HZ: schema.SIM_HZ,
      GRAVITY_MPS2: schema.GRAVITY_MPS2,
      JUMP_DELTA_V_MPS: schema.JUMP_DELTA_V_MPS,
      JUMP_GRACE_SEC: schema.JUMP_GRACE_SEC,
      MAX_TILT_PITCH: schema.MAX_TILT_PITCH,
      MAX_TILT_ROLL: schema.MAX_TILT_ROLL,
      KEYBOARD_TILT: schema.KEYBOARD_TILT,
      ITEM_PICKUP_RADIUS_M: schema.ITEM_PICKUP_RADIUS_M,
      GOAL_RADIUS_M: schema.GOAL_RADIUS_M,
      GOAL_SENSOR_HEIGHT_M: schema.GOAL_SENSOR_HEIGHT_M,
      ELEVATOR_COOLDOWN_SEC: schema.ELEVATOR_COOLDOWN_SEC,
      FALL_DEPTH_M: schema.FALL_DEPTH_M,
      FALL_LOST_DELAY_SEC: schema.FALL_LOST_DELAY_SEC,
      TIME_LIMIT_SEC_DEFAULT: schema.TIME_LIMIT_SEC_DEFAULT,
      NUM_BALLS: schema.NUM_BALLS,
      SMALL_SCORE: schema.SMALL_SCORE,
      LARGE_SCORE: schema.LARGE_SCORE,
      TIME_SCORE: schema.TIME_SCORE,
      ONEUP_SCORE: schema.ONEUP_SCORE,
    }).toEqual({
      PX_PER_METER: 13.5,
      BALL_RADIUS_M: 0.5,
      LEVEL_HEIGHT_M: 1.0,
      MAX_RAMP_SLOPE: 0.1765,
      MIN_BRIDGE_WIDTH_PX: 34,
      MIN_ISLAND_SIZE_PX: 27,
      MAX_PAGE_HEIGHT_PX: 6000,
      MAX_STAGE_HEIGHT_PX: 1700,
      CAPTURE_DPR: 2,
      MAX_LARGE_ITEMS: 6,
      SIM_HZ: 120,
      GRAVITY_MPS2: 46.3,
      JUMP_DELTA_V_MPS: 16.7,
      JUMP_GRACE_SEC: 0.1,
      MAX_TILT_PITCH: 0.785,
      MAX_TILT_ROLL: 0.349,
      KEYBOARD_TILT: 0.436,
      ITEM_PICKUP_RADIUS_M: 0.926,
      GOAL_RADIUS_M: 0.926,
      GOAL_SENSOR_HEIGHT_M: 1.85,
      ELEVATOR_COOLDOWN_SEC: 2,
      FALL_DEPTH_M: 9,
      FALL_LOST_DELAY_SEC: 3,
      TIME_LIMIT_SEC_DEFAULT: 300,
      NUM_BALLS: 3,
      SMALL_SCORE: 1,
      LARGE_SCORE: 100,
      TIME_SCORE: 5,
      ONEUP_SCORE: 3000,
    });
    expect(schema.DEFAULT_VIEWPORT).toEqual({ width: 1280, height: 800 });
    expect(schema.BALL_RADIUS_PX).toBe(6.75);
    expect(schema.CONTRACT_VERSION).toBe('0.2.5');
    // Removed in 0.2.0.
    expect('OCEAN_Y_M' in schema).toBe(false);
    expect('MAX_TILT' in schema).toBe(false);
  });

  test('error codes (contracts §7)', () => {
    expect([...schema.API_ERROR_CODES].sort()).toEqual(
      [
        'BUILD_FAILED',
        'CAPTURE_BLOCKED',
        'CAPTURE_TIMEOUT',
        'RATE_LIMITED',
        'UNPLAYABLE',
        'URL_FORBIDDEN',
      ].sort(),
    );
    expect(schema.ApiErrorCodeSchema.options).toEqual([...schema.API_ERROR_CODES]);
    expect(schema.isApiErrorCode('RATE_LIMITED')).toBe(true);
    expect(schema.isApiErrorCode('NOPE')).toBe(false);
  });

  test('enums match contracts §2/§3/§6', () => {
    expect(schema.ElementKindSchema.options).toHaveLength(13);
    expect(schema.GamePhaseSchema.options).toHaveLength(18);
    expect(schema.GamePhaseSchema.options).toEqual(
      expect.arrayContaining(['howto', 'falling', 'restarting', 'error', 'paused']),
    );
    expect(schema.HapticPatternSchema.options).toEqual(['item', 'large', 'fall', 'goal']);
    expect(schema.DropReasonSchema.options).toEqual([
      'too-small',
      'fixed',
      'offscreen',
      'background',
      'merged',
      'out-of-slice',
      'other',
    ]);
  });

  test('every public function the other phases rely on is exported', () => {
    for (const fn of [
      'pageToWorld',
      'worldToPage',
      'createRng',
      'mulberry32',
      'parseStage',
      'parseCapture',
      'parseControlMessage',
      'validateStage',
      'rampSlope',
      'encodeInput',
      'decodeInput',
      'computeCaptureId',
      'computeStageId',
      'sliceCount',
      'sliceRange',
    ]) {
      expect(typeof (schema as Record<string, unknown>)[fn], fn).toBe('function');
    }
  });

  test('stageId is sha256 hex, stable, and depends on every field incl. the slice index', async () => {
    const a = await schema.computeStageId('cap', 0, 1, '1.0.0', 'easy');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await schema.computeStageId('cap', 0, 1, '1.0.0', 'easy')).toBe(a);
    expect(await schema.computeStageId('cap', 1, 1, '1.0.0', 'easy')).not.toBe(a);
    expect(await schema.computeStageId('cap', 0, 1, '1.0.0', 'hard')).not.toBe(a);
    expect(a).toBe(await schema.sha256Hex('cap|0|1|1.0.0|easy'));
    await expect(schema.computeStageId('cap', -1, 1, '1.0.0', 'easy')).rejects.toThrow(RangeError);
    expect(await schema.sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('HTTP body schemas accept valid and reject invalid', () => {
    expect(schema.CreateStageRequestSchema.safeParse({ url: 'https://example.com' }).success).toBe(true);
    expect(
      schema.CreateStageRequestSchema.safeParse({ url: 'https://example.com', difficulty: 'insane' }).success,
    ).toBe(false);
    expect(schema.RoomCodeSchema.safeParse('012345').success).toBe(true);
    expect(schema.RoomCodeSchema.safeParse('12345').success).toBe(false);
    expect(schema.JobEventSchema.safeParse({ type: 'error', code: 'UNPLAYABLE', message: 'x' }).success).toBe(
      true,
    );
    expect(schema.JobEventSchema.safeParse({ type: 'done', runId: 'r', stageIds: ['a', 'b'] }).success).toBe(
      true,
    );
    expect(schema.JobEventSchema.safeParse({ type: 'done', stageId: 'a' }).success).toBe(false);
    expect(schema.CreateStageResponseSchema.safeParse({ runId: 'r', stageIds: ['a'] }).success).toBe(true);
  });

  test('score submissions: stage and run kinds', () => {
    const P = schema.SubmitScoreRequestSchema;
    expect(P.safeParse({ kind: 'stage', stageId: 's', name: 'ab', score: 10, timeMs: 5000 }).success).toBe(
      true,
    );
    expect(
      P.safeParse({
        kind: 'run',
        name: 'wwm_fan',
        totalScore: 3120,
        stages: [{ stageId: 's', score: 3120, timeMs: 90_000 }],
      }).success,
    ).toBe(true);
    expect(P.safeParse({ stageId: 's', name: 'ab', score: 10, timeMs: 5000 }).success).toBe(false); // v0.1 body
    expect(P.safeParse({ kind: 'run', name: 'x', totalScore: 1, stages: [] }).success).toBe(false);
    expect(P.safeParse({ kind: 'stage', stageId: 's', name: '', score: 1, timeMs: 1 }).success).toBe(false);
    expect(
      schema.ScoresResponseSchema.safeParse({
        entries: [{ name: 'a', score: 1, at: '2026-01-01T00:00:00Z' }],
      }).success,
    ).toBe(true);
    expect(
      schema.CuratedResponseSchema.safeParse({
        runs: [{ runId: 'r', title: 't', url: 'u', thumb: 'x', stars: 3 }],
      }).success,
    ).toBe(true);
  });

  test('InputSample requires frameYaw', () => {
    expect(
      schema.InputSampleSchema.safeParse({ tiltX: 0, tiltZ: 0, frameYaw: 0, power: true, jump: false })
        .success,
    ).toBe(true);
    expect(schema.InputSampleSchema.safeParse({ tiltX: 0, tiltZ: 0, power: true, jump: false }).success).toBe(
      false,
    );
  });
});

describe('slicing (contracts §3/§4)', () => {
  const cap = (height: number) => ({ page: { width: 1280, height } });
  test('sliceCount', () => {
    expect(schema.sliceCount(cap(800))).toBe(1);
    expect(schema.sliceCount(cap(1700))).toBe(1);
    expect(schema.sliceCount(cap(1701))).toBe(2);
    expect(schema.sliceCount(cap(6000))).toBe(4);
  });
  test('sliceRange covers the page exactly, in order', () => {
    const c = cap(6000);
    const n = schema.sliceCount(c);
    const slices = Array.from({ length: n }, (_, i) => schema.sliceRange(c, i));
    expect(slices[0]).toEqual({ index: 0, count: 4, y: 0, height: 1500 });
    expect(slices[3]).toEqual({ index: 3, count: 4, y: 4500, height: 1500 });
    // balanced: no tiny tail slice
    const c2 = cap(1701);
    expect([0, 1].map((i) => schema.sliceRange(c2, i).height)).toEqual([851, 850]);
    expect(slices.reduce((s, x) => s + x.height, 0)).toBe(6000);
    for (let i = 1; i < n; i++)
      expect(slices[i]?.y).toBe((slices[i - 1]?.y ?? 0) + (slices[i - 1]?.height ?? 0));
    expect(() => schema.sliceRange(c, 4)).toThrow(RangeError);
    expect(() => schema.sliceRange(c, -1)).toThrow(RangeError);
    expect(() => schema.sliceRange(c, 0.5)).toThrow(RangeError);
    expect(schema.StageSliceSchema.safeParse(slices[3]).success).toBe(true);
  });
});
