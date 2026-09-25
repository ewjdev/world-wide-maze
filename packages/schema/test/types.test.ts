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
  InputSample,
  JobEvent,
  ScoresResponse,
  StageData,
  SubmitScoreRequest,
} from '../src/index.ts';
import * as schema from '../src/index.ts';

describe('Zod ⇔ TS types', () => {
  test('inferred types equal the contract interfaces', () => {
    expectTypeOf<z.infer<typeof schema.CaptureBundleSchema>>().toEqualTypeOf<CaptureBundle>();
    expectTypeOf<z.infer<typeof schema.DomElementSchema>>().toEqualTypeOf<DomElement>();
    expectTypeOf<z.infer<typeof schema.StageDataSchema>>().toEqualTypeOf<StageData>();
    expectTypeOf<z.infer<typeof schema.InputSampleSchema>>().toEqualTypeOf<InputSample>();
    expectTypeOf<z.infer<typeof schema.ControlMessageSchema>>().toEqualTypeOf<ControlMessage>();
    expectTypeOf<z.infer<typeof schema.ApiErrorSchema>>().toEqualTypeOf<ApiError>();
    expectTypeOf<z.infer<typeof schema.CreateStageRequestSchema>>().toEqualTypeOf<CreateStageRequest>();
    expectTypeOf<z.infer<typeof schema.CreateStageResponseSchema>>().toEqualTypeOf<CreateStageResponse>();
    expectTypeOf<z.infer<typeof schema.JobEventSchema>>().toEqualTypeOf<JobEvent>();
    expectTypeOf<z.infer<typeof schema.CuratedResponseSchema>>().toEqualTypeOf<CuratedResponse>();
    expectTypeOf<z.infer<typeof schema.SubmitScoreRequestSchema>>().toEqualTypeOf<SubmitScoreRequest>();
    expectTypeOf<z.infer<typeof schema.ScoresResponseSchema>>().toEqualTypeOf<ScoresResponse>();
  });
});

describe('contract surface', () => {
  test('constants (contracts §1) have the contract values', () => {
    expect({
      PX_PER_METER: schema.PX_PER_METER,
      BALL_RADIUS_M: schema.BALL_RADIUS_M,
      LEVEL_HEIGHT_M: schema.LEVEL_HEIGHT_M,
      MIN_BRIDGE_WIDTH_PX: schema.MIN_BRIDGE_WIDTH_PX,
      MIN_ISLAND_SIZE_PX: schema.MIN_ISLAND_SIZE_PX,
      OCEAN_Y_M: schema.OCEAN_Y_M,
      SIM_HZ: schema.SIM_HZ,
      NUM_BALLS: schema.NUM_BALLS,
      SMALL_SCORE: schema.SMALL_SCORE,
      LARGE_SCORE: schema.LARGE_SCORE,
      TIME_SCORE: schema.TIME_SCORE,
      ONEUP_SCORE: schema.ONEUP_SCORE,
      MAX_PAGE_HEIGHT_PX: schema.MAX_PAGE_HEIGHT_PX,
      MAX_TILT: schema.MAX_TILT,
    }).toEqual({
      PX_PER_METER: 40,
      BALL_RADIUS_M: 0.5,
      LEVEL_HEIGHT_M: 1.5,
      MIN_BRIDGE_WIDTH_PX: 100,
      MIN_ISLAND_SIZE_PX: 120,
      OCEAN_Y_M: -6,
      SIM_HZ: 120,
      NUM_BALLS: 3,
      SMALL_SCORE: 1,
      LARGE_SCORE: 100,
      TIME_SCORE: 5,
      ONEUP_SCORE: 3000,
      MAX_PAGE_HEIGHT_PX: 6000,
      MAX_TILT: 0.44,
    });
    expect(schema.DEFAULT_VIEWPORT).toEqual({ width: 1280, height: 800 });
    expect(schema.CONTRACT_VERSION).toBe('0.1.0');
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
    expect(schema.GamePhaseSchema.options).toHaveLength(14);
    expect(schema.DropReasonSchema.options).toEqual([
      'too-small',
      'fixed',
      'offscreen',
      'background',
      'merged',
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
      'encodeInput',
      'decodeInput',
      'computeCaptureId',
      'computeStageId',
    ]) {
      expect(typeof (schema as Record<string, unknown>)[fn], fn).toBe('function');
    }
  });

  test('ids are sha256 hex and stable', async () => {
    const a = await schema.computeStageId('cap', 1, '1.0.0', 'easy');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await schema.computeStageId('cap', 1, '1.0.0', 'easy')).toBe(a);
    expect(await schema.computeStageId('cap', 1, '1.0.0', 'hard')).not.toBe(a);
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
  });
});
