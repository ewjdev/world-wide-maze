/**
 * Zod schemas mirroring types.ts. These check STRUCTURE (shapes, enums, finite numbers, integers).
 * Semantic invariants (reachability, widths, slopes, clearances…) live in validate.ts (`validateStage`).
 * test/types.test.ts asserts every schema infers exactly the hand-written contract type.
 */
import { z } from 'zod';

const finite = z.number();
const nonNegInt = z.int().min(0);
const posFinite = z.number().positive();
const nonNegFinite = z.number().min(0);

export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected "#rrggbb"');
export const Vec2Schema = z.tuple([finite, finite]);
export const RectSchema = z.object({ x: finite, y: finite, w: z.number().min(0), h: z.number().min(0) });
export const DifficultySchema = z.enum(['easy', 'normal', 'hard']);

// §2 ---------------------------------------------------------------------------------------------

export const ElementKindSchema = z.enum([
  'text',
  'heading',
  'image',
  'video',
  'canvas',
  'button',
  'link',
  'input',
  'nav',
  'header',
  'footer',
  'adlike',
  'block',
]);

export const DomElementSchema = z.object({
  id: nonNegInt,
  kind: ElementKindSchema,
  rect: RectSchema,
  lines: z.array(RectSchema).optional(),
  bg: HexColorSchema.optional(),
  depth: nonNegInt,
  z: finite,
  fixed: z.boolean(),
  text: z.string().max(120).optional(),
  fontSize: posFinite.optional(),
});

const SizeSchema = z.object({ width: posFinite, height: posFinite });

export const CaptureBundleSchema = z.object({
  schema: z.literal('wwm.capture/1'),
  captureId: z.string().min(1),
  url: z.string().min(1),
  title: z.string(),
  capturedAt: z.iso.datetime({ offset: true }),
  viewport: SizeSchema,
  page: SizeSchema,
  screenshot: z.object({
    path: z.string().min(1),
    width: posFinite,
    height: posFinite,
    format: z.enum(['png', 'webp']),
    scale: posFinite,
  }),
  backgroundColor: HexColorSchema,
  elements: z.array(DomElementSchema),
});

// §3 ---------------------------------------------------------------------------------------------

export const IslandSchema = z.object({
  id: nonNegInt,
  contour: z.array(Vec2Schema),
  holes: z.array(z.array(Vec2Schema)),
  level: finite,
  guardrails: z.array(z.array(Vec2Schema)),
  restartPoints: z.array(Vec2Schema),
  sourceElementIds: z.array(nonNegInt),
});

export const BridgeTypeSchema = z.enum(['flat', 'ramp']);
export const BridgeSchema = z.object({
  id: nonNegInt,
  from: nonNegInt,
  to: nonNegInt,
  a: Vec2Schema,
  b: Vec2Schema,
  width: posFinite,
  type: BridgeTypeSchema,
  levelA: finite,
  levelB: finite,
});

export const ElevatorSchema = z.object({
  id: nonNegInt,
  islandFrom: nonNegInt,
  islandTo: nonNegInt,
  a: Vec2Schema,
  b: Vec2Schema,
  width: posFinite,
  levelLow: finite,
  levelHigh: finite,
  travelSec: posFinite,
  cooldownSec: nonNegFinite,
});

export const ItemKindSchema = z.enum(['small', 'large']);
export const ItemSchema = z.object({
  id: nonNegInt,
  kind: ItemKindSchema,
  pos: Vec2Schema,
  islandId: nonNegInt,
});
export const SpawnSchema = z.object({ pos: Vec2Schema, islandId: nonNegInt });
export const GoalSchema = z.object({ pos: Vec2Schema, islandId: nonNegInt, radius: posFinite });

export const DropReasonSchema = z.enum([
  'too-small',
  'fixed',
  'offscreen',
  'background',
  'merged',
  'out-of-slice',
  'other',
]);
export const ProvenanceSchema = z.object({
  keptElementIds: z.array(nonNegInt),
  dropped: z.array(z.object({ elementId: nonNegInt, reason: DropReasonSchema })),
  notes: z.array(z.string()),
});

export const StageSliceSchema = z.object({
  index: nonNegInt,
  count: z.int().min(1),
  y: nonNegFinite,
  height: posFinite,
});

export const StageDataSchema = z.object({
  schema: z.literal('wwm.stage/2'),
  stageId: z.string().min(1),
  builderVersion: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, 'expected semver'),
  seed: z.int().min(0).max(0xffffffff),
  difficulty: DifficultySchema,
  source: z.object({
    url: z.string(),
    title: z.string(),
    captureId: z.string(),
    pageWidth: posFinite,
    pageHeight: posFinite,
    slice: StageSliceSchema,
  }),
  size: SizeSchema,
  // path may be '' between buildStage and storage (contracts §4: the caller fills it in).
  texture: z.object({ path: z.string(), width: posFinite, height: posFinite, scale: posFinite }),
  timeLimitSec: posFinite,
  islands: z.array(IslandSchema).min(1),
  bridges: z.array(BridgeSchema),
  elevators: z.array(ElevatorSchema),
  items: z.array(ItemSchema),
  start: SpawnSchema,
  goal: GoalSchema,
  provenance: ProvenanceSchema,
});

// §5 ---------------------------------------------------------------------------------------------

export const InputSampleSchema = z.object({
  tiltX: finite,
  tiltZ: finite,
  frameYaw: finite,
  power: z.boolean(),
  jump: z.boolean(),
});
export const ReplaySchema = z.array(InputSampleSchema);
export const VersionedReplaySchema = z.object({ physicsVersion: z.string().min(1), inputs: ReplaySchema });

// §6 ---------------------------------------------------------------------------------------------

export const GamePhaseSchema = z.enum([
  'title',
  'howto',
  'pairing',
  'calibrate',
  'select',
  'building',
  'intro',
  'countdown',
  'play',
  'paused',
  'falling',
  'restarting',
  'goal',
  'timeup',
  'gameover',
  'result',
  'ranking',
  'error',
]);
export const RoomRoleSchema = z.enum(['host', 'controller']);
export const HapticPatternSchema = z.enum(['item', 'large', 'fall', 'goal']);

export const ControlMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('peer'), role: RoomRoleSchema, connected: z.boolean() }),
  z.object({ t: z.literal('state'), phase: GamePhaseSchema, score: finite, balls: finite, timeLeft: finite }),
  z.object({ t: z.literal('haptic'), pattern: HapticPatternSchema }),
  z.object({ t: z.literal('pos'), x: finite, y: finite, heading: finite }),
  z.object({ t: z.literal('text'), field: z.enum(['url', 'name']), value: z.string().max(2048) }),
  z.object({ t: z.literal('calibrated') }),
  z.object({ t: z.literal('ping'), id: finite, ts: finite }),
  z.object({ t: z.literal('pong'), id: finite, ts: finite }),
]);

// §7 ---------------------------------------------------------------------------------------------

export const ApiErrorCodeSchema = z.enum([
  'CAPTURE_BLOCKED',
  'CAPTURE_TIMEOUT',
  'URL_FORBIDDEN',
  'BUILD_FAILED',
  'UNPLAYABLE',
  'RATE_LIMITED',
]);
export const ApiErrorSchema = z.object({ code: ApiErrorCodeSchema, message: z.string() });
export const RoomCodeSchema = z.string().regex(/^\d{6}$/, 'expected 6 digits');

export const CreateStageRequestSchema = z.object({
  url: z.string().min(1).max(2048),
  difficulty: DifficultySchema.optional(),
  seed: z.int().min(0).max(0xffffffff).optional(),
});
const StageIdsSchema = z.array(z.string()).min(1);
export const CreateStageResponseSchema = z.union([
  z.object({ jobId: z.string() }),
  z.object({ runId: z.string(), stageIds: StageIdsSchema }),
]);
export const JobEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('progress'), step: z.string(), pct: z.number().min(0).max(100) }),
  z.object({ type: z.literal('done'), runId: z.string(), stageIds: StageIdsSchema }),
  z.object({ type: z.literal('error'), code: ApiErrorCodeSchema, message: z.string() }),
]);
export const RunResponseSchema = z.object({
  runId: z.string(),
  url: z.string(),
  title: z.string(),
  stageIds: StageIdsSchema,
});
export const CuratedResponseSchema = z.object({
  runs: z.array(
    z.object({
      runId: z.string(),
      title: z.string(),
      url: z.string(),
      thumb: z.string(),
      stars: z.int().min(0).max(5),
    }),
  ),
});
export const CreateRoomResponseSchema = z.object({ code: RoomCodeSchema });
const ScoreNameSchema = z.string().min(1).max(32);
export const SubmitScoreRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('stage'),
    stageId: z.string().min(1),
    name: ScoreNameSchema,
    score: z.int().min(0),
    timeMs: z.number().min(0),
    replay: z.union([VersionedReplaySchema, ReplaySchema]).optional(),
  }),
  z.object({
    kind: z.literal('run'),
    runId: z.string().min(1).optional(),
    name: ScoreNameSchema,
    totalScore: z.int().min(0),
    stages: z
      .array(z.object({ stageId: z.string().min(1), score: z.int().min(0), timeMs: z.number().min(0) }))
      .min(1),
  }),
]);
export const SubmitScoreResponseSchema = z.object({
  rank: z.int().min(1),
  verified: z.boolean().optional(),
  note: z.string().optional(),
});
export const ScoresResponseSchema = z.object({
  entries: z.array(z.object({ name: z.string(), score: finite, timeMs: finite.optional(), at: z.string() })),
});
