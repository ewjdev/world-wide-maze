/** Owned HTML terrain with authored stunt routes. No changes to the Original maze generator. */
import {
  type Bridge,
  type BuildInput,
  type Island,
  PX_PER_METER,
  pointInPolygon,
  type StageData,
  sliceRange,
  type Vec2,
  validateStage,
} from '@wwm/schema';
import { pageToWorld } from '@wwm/schema/space';
import { deckBox } from './bridges.ts';
import { extractRaceTerrain, type RaceAuthoring } from './race.ts';
import { buildRails } from './rails.ts';
import { sha256HexSync } from './sha256.ts';

export function buildIslandLeap(input: BuildInput, author: RaceAuthoring) {
  const terrain = extractRaceTerrain(input);
  const shapes = author.sections.map((s) =>
    terrain.shapes.find((shape) => pointInPolygon(s.center, shape.contour, shape.holes)),
  );
  if (shapes.some((s) => !s) || new Set(shapes).size !== 6 || terrain.shapes.length !== 6)
    throw new Error('Island Leap requires all six distinct captured HTML islands');
  for (const section of author.sections)
    if (!section.elementIds.some((id) => input.capture.elements.some((e) => e.id === id)))
      throw new Error(`Missing DOM provenance: ${section.id}`);
  const levels = [10, 11.5, 10, 10, 10, 10];
  const specs: [number, number, Vec2, Vec2, number][] = [
    [0, 1, [960, 260], [1095, 260], 54],
    [2, 3, [1320, 260], [1360, 260], 40],
    [0, 4, [890, 340], [890, 520], 44],
    [4, 5, [1000, 590], [1320, 590], 44],
    [5, 3, [1460, 520], [1460, 370], 44],
  ];
  const bridges: Bridge[] = specs.map(([from, to, a, b, width], id) => ({
    id,
    from,
    to,
    a,
    b,
    width,
    levelA: levels[from],
    levelB: levels[to],
    type: levels[from] === levels[to] ? 'flat' : 'ramp',
  }));
  const islands: Island[] = shapes.map((shape, id) => {
    if (!shape) throw new Error('Missing shape');
    const mouths = bridges.filter((b) => b.from === id || b.to === id).map((b) => deckBox(b, 4));
    // Flight corridor is explicitly rail-free; safe route and outer edges retain protection.
    if (id === 1 || id === 2 || id === 3) mouths.push({ x0: 1080, x1: 1755, y0: 175, y1: 345 });
    return {
      id,
      contour: shape.contour,
      holes: shape.holes,
      level: levels[id],
      guardrails: buildRails(shape.contour, shape.holes, mouths),
      restartPoints: [author.sections[id].center],
      sourceElementIds: author.sections[id].elementIds,
    };
  });
  const gate = (id: string, x: number, y: number, width: number, kind: 'sector' | 'finish' = 'sector') => ({
    id,
    center: pageToWorld([x, y], 10.5),
    normal: [1, 0] as [number, number],
    halfWidth: width / PX_PER_METER,
    halfHeight: 7,
    kind,
  });
  const gates = [
    gate('choose-your-line', 800, 400, 300),
    gate('routes-merge', 1530, 260, 110),
    gate('finish', 1650, 260, 110, 'finish'),
  ];
  const stunts = {
    version: 1 as const,
    cruiseSpeed: 10,
    chargeTicks: 360,
    turboDeltaV: 12,
    turboMaxSpeed: 26,
    landingDeltaV: 1.5,
    launchPads: [
      {
        id: 'leap',
        gate: { ...gate('launch-lip', 1150, 260, 29), center: pageToWorld([1150, 260], 12), halfHeight: 1 },
        upSpeed: 18,
        minSpeed: 6,
        landingIslandIds: [2, 3],
      },
    ],
  };
  const slice = sliceRange(input.capture, input.sliceIndex);
  const stage: StageData = {
    schema: 'wwm.stage/2',
    stageId: '0'.repeat(64),
    builderVersion: '1.1.0',
    seed: input.seed,
    difficulty: 'normal',
    source: {
      url: input.capture.url,
      title: author.title,
      captureId: input.capture.captureId,
      pageWidth: input.capture.page.width,
      pageHeight: input.capture.page.height,
      slice,
    },
    size: { width: terrain.width, height: terrain.height },
    texture: {
      path: author.textureUrl,
      width: input.image.width,
      height: input.image.height,
      scale: input.capture.screenshot.scale,
    },
    timeLimitSec: 300,
    islands,
    bridges,
    elevators: [],
    items: [],
    portals: [],
    start: { pos: [100, 260], islandId: 0 },
    goal: { pos: [1700, 260], islandId: 3, radius: 12 },
    provenance: {
      keptElementIds: author.sections.flatMap((s) => s.elementIds),
      dropped: [],
      notes: [
        `HTML-derived Island Leap. source sha256 ${author.sourceHash}`,
        `texture sha256 ${author.textureHash}`,
        'Three legal routes; shared gates before choice and after merge. Launch assist is Race-only and deterministic.',
      ],
    },
  };
  const result = validateStage(stage);
  if (!result.ok) throw new Error(result.errors.map((e) => `${e.code}: ${e.message}`).join('; '));
  const courseId = sha256HexSync(
    JSON.stringify({ stage, stunts, gates, sourceHash: author.sourceHash, textureHash: author.textureHash }),
  );
  stage.stageId = courseId;
  return {
    schema: 'wwm.race-course/1' as const,
    courseId,
    title: author.title,
    description: author.description,
    stage,
    textureUrl: author.textureUrl,
    gates,
    stunts,
    generatorVersion: '1.1.0',
    seed: input.seed,
    provenance: { sourceHash: author.sourceHash, textureHash: author.textureHash },
    validation: { valid: true, extractedIslands: 6 },
  };
}
