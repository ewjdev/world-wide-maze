/**
 * Stage-builder seam and the injected hooks (moderation, playability).
 *
 * `StageBuilder` wraps contracts §4 `buildStage` plus the version that goes into stage IDs and cache keys.
 * `defaultStageBuilder()` returns the real `@wwm/stage-builder`; STUB_BUILDER remains for fast tests.
 */
import {
  type BuildInput,
  type BuildResult,
  type BuildStageFn,
  parseStage,
  type StageData,
  sliceRange,
  type Vec2,
} from '@wwm/schema';
import { BUILDER_VERSION, buildStage as realBuildStage } from '@wwm/stage-builder';
import handmade from '../../../fixtures/stages/handmade-simple.json' with { type: 'json' };

export interface StageBuilder {
  /** Goes into `stageId`, `runId` and the KV cache key. */
  readonly version: string;
  buildStage: BuildStageFn;
}

/** Content-safety hook (task 8). No-op now; Phase 11/12 can plug in a model. */
export type ModerateFn = (shot: {
  png: Uint8Array;
  width: number;
  height: number;
  url: string;
}) => Promise<'ok' | 'block'>;
export const allowAllContent: ModerateFn = async () => 'ok';

/** Phase 09's solver hook, injected later: reject stages the bot can't finish. */
export type ValidatePlayableFn = (stage: StageData) => Promise<{ ok: true } | { ok: false; reason: string }>;

const TEMPLATE: StageData = parseStage(handmade);
export const STUB_BUILDER_VERSION = '0.0.0-stub';

function shift(p: Vec2, dx: number, dy: number): Vec2 {
  return [p[0] + dx, p[1] + dy];
}

/**
 * STUB (not the real builder): places `fixtures/stages/handmade-simple` (640×800, 4 islands, ramp,
 * elevator) in the middle of the slice. Valid for any slice ≥ 640×800, which every capture produces
 * (viewport 1280×800; balanced slices of a taller page are ≥ 850 px). Ignores the screenshot.
 */
export const stubBuildStage: BuildStageFn = (input: BuildInput): BuildResult => {
  const { capture } = input;
  const slice = sliceRange(capture, input.sliceIndex);
  const W = capture.page.width;
  const H = slice.height;
  if (W < TEMPLATE.size.width || H < TEMPLATE.size.height)
    throw new Error(
      `stub builder needs a slice ≥ ${TEMPLATE.size.width}×${TEMPLATE.size.height}, got ${W}×${H}`,
    );
  const dx = Math.round((W - TEMPLATE.size.width) / 2);
  const dy = Math.round((H - TEMPLATE.size.height) / 2);
  const s = (p: Vec2) => shift(p, dx, dy);
  const t = TEMPLATE;
  const stage: StageData = {
    ...t,
    stageId: '',
    builderVersion: STUB_BUILDER_VERSION,
    seed: input.seed >>> 0,
    difficulty: input.difficulty,
    source: {
      url: capture.url,
      title: capture.title,
      captureId: capture.captureId,
      pageWidth: capture.page.width,
      pageHeight: capture.page.height,
      slice,
    },
    size: { width: W, height: H },
    texture: {
      path: '',
      width: W * capture.screenshot.scale,
      height: H * capture.screenshot.scale,
      scale: capture.screenshot.scale,
    },
    islands: t.islands.map((i) => ({
      ...i,
      contour: i.contour.map(s),
      holes: i.holes.map((h) => h.map(s)),
      guardrails: i.guardrails.map((g) => g.map(s)),
      restartPoints: i.restartPoints.map(s),
    })),
    bridges: t.bridges.map((b) => ({ ...b, a: s(b.a), b: s(b.b) })),
    elevators: t.elevators.map((e) => ({ ...e, a: s(e.a), b: s(e.b) })),
    items: t.items.map((it) => ({ ...it, pos: s(it.pos) })),
    start: { ...t.start, pos: s(t.start.pos) },
    goal: { ...t.goal, pos: s(t.goal.pos) },
    provenance: {
      keptElementIds: [],
      dropped: [],
      notes: [
        'STUB builder (Phase 07): handmade-simple centred in the slice; replace with @wwm/stage-builder',
      ],
    },
  };
  return {
    stage,
    debug: {
      gridCellPx: 0,
      backgroundMask: new Uint8Array(0),
      islandMask: new Uint8Array(0),
      labels: new Int32Array(0),
      candidateBridges: [],
      timingsMs: { stub: 0 },
    },
  };
};

export const STUB_BUILDER: StageBuilder = { version: STUB_BUILDER_VERSION, buildStage: stubBuildStage };

/**
 * Hooks the Worker uses. Phase 09 sets `validatePlayable` (solver), Phase 11/12 replace `moderate`.
 */
export const DEFAULT_HOOKS: { moderate: ModerateFn; validatePlayable?: ValidatePlayableFn } = {
  moderate: allowAllContent,
};

/** The real Phase 03 builder. The stub stays exported for fast tests. */
export const REAL_BUILDER: StageBuilder = {
  version: BUILDER_VERSION,
  buildStage: (input) => realBuildStage(input),
};

/** The builder the Worker uses. */
export function defaultStageBuilder(): StageBuilder {
  return REAL_BUILDER;
}
