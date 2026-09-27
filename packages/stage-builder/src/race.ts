/** Curated Race construction: shared terrain primitives, then a route (never the Original DFS maze). */
import {
  BALL_RADIUS_PX,
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
import { classifyBackground } from './background.ts';
import { type Candidate, deckBox, findCandidates, type IslandShape } from './bridges.ts';
import { outlineIsland, removeDiagonalPinches } from './contours.ts';
import { createGrid } from './grid.ts';
import { componentInfo, extractIslands, labelComponents, splitOversized } from './islands.ts';
import { close, fillHoles, open, or } from './morphology.ts';
import { type BuildParams, resolveParams } from './params.ts';
import { RACE_ROUTE_WEIGHTS, type RaceRouteSearch, searchRaceRoute } from './race-route.ts';
import { buildRails } from './rails.ts';
import { semanticFill } from './semantic.ts';
import { sha256HexSync } from './sha256.ts';
import { sliceElements } from './slice-elements.ts';
import { analyzeWalkable, onMain } from './walkable.ts';

export const RACE_BUILDER_VERSION = '1.1.0';
/** Content-authoring hints are verified against extracted polygons, never substituted for them. */
export interface RaceAuthoring {
  schema: 'wwm.race-authoring/1';
  title: string;
  description: string;
  /** Stable HTML id and its measured page-space center, in route order. */
  sections: { id: string; center: Vec2; elementIds: number[] }[];
  sourceHash: string;
  textureHash: string;
  textureUrl: string;
  /** Default retains explicit author order. Search keeps first/last and visits every curated island. */
  routeStrategy?: 'authored' | 'search';
  descentPerBridge?: number;
  bridgeWidthPx?: number;
  enableTurbo?: boolean;
}

export interface RaceTerrain {
  shapes: IslandShape[];
  centers: Vec2[];
  labels: Int32Array;
  cols: number;
  rows: number;
  cell: number;
  width: number;
  height: number;
  params: BuildParams;
}

/** Shared raster/semantic/contour pipeline exposed before topology, heights, items or portals exist. */
export function extractRaceTerrain(input: BuildInput, overrides: Partial<BuildParams> = {}): RaceTerrain {
  const params = resolveParams(overrides, 'normal');
  const { capture, image } = input;
  const slice = sliceRange(capture, input.sliceIndex);
  const width = capture.page.width;
  const height = slice.height;
  const { elements } = sliceElements(capture, slice, width);
  const grid = createGrid(image, capture.screenshot.scale, width, height, slice.y, params.cellPx);
  const { cols, rows } = grid;
  const bg = classifyBackground(
    grid,
    elements,
    capture.backgroundColor,
    capture.viewport.width * capture.viewport.height,
    params,
  );
  const semantic = semanticFill(grid, elements, bg.backgroundMask, params);
  const fg = bg.backgroundMask.map((v) => (v ? 0 : 1));
  let land = or(open(fg, cols, rows, params.pixelOpenCells), semantic.mask);
  land = close(land, cols, rows, params.closeCellsX, params.closeCellsY);
  land = fillHoles(land, cols, rows, Math.floor(params.holeFillMaxPx2 / params.cellPx ** 2));
  land = open(land, cols, rows, params.neckOpenCells);
  splitOversized(land, cols, rows, params.cellPx, params);
  const extracted = extractIslands(land, cols, rows, params.cellPx, params);
  const kept = Uint8Array.from(extracted.labels, (v) => (v > 0 ? 1 : 0));
  removeDiagonalPinches(kept, cols, rows);
  const { labels, count } = labelComponents(kept, cols, rows);
  const infos = componentInfo(labels, count, cols);
  const shapes = infos.map((info): IslandShape => {
    const outline = outlineIsland(
      labels,
      cols,
      rows,
      info.label,
      info,
      params.cellPx,
      width,
      height,
      params.simplifyEpsPx,
      params.cornerBevelPx,
    );
    if (!outline) throw new Error(`Race terrain: empty outline ${info.label}`);
    return {
      contour: outline.contour,
      holes: outline.holes,
      bbox: {
        x0: info.c0 * params.cellPx,
        y0: info.r0 * params.cellPx,
        x1: Math.min(width, info.c1 * params.cellPx),
        y1: Math.min(height, info.r1 * params.cellPx),
      },
    };
  });
  return {
    shapes,
    labels,
    cols,
    rows,
    cell: params.cellPx,
    width,
    height,
    params,
    centers: shapes.map((s) => [(s.bbox.x0 + s.bbox.x1) / 2, (s.bbox.y0 + s.bbox.y1) / 2]),
  };
}

export function buildRaceCourse(input: BuildInput, hints: RaceAuthoring) {
  let author = hints;
  if (author.schema !== 'wwm.race-authoring/1' || author.sections.length < 2 || author.sections.length > 16)
    throw new Error('Race authoring requires 2–16 ordered sections');
  if (new Set(author.sections.map((s) => s.id)).size !== author.sections.length)
    throw new Error('Race authoring section ids must be unique');
  const descent = author.descentPerBridge ?? 0.35;
  const widthPx = author.bridgeWidthPx ?? 84;
  if (
    !Number.isFinite(descent) ||
    descent < 0 ||
    descent > 0.8 ||
    !Number.isFinite(widthPx) ||
    widthPx < 54 ||
    widthPx > 120
  )
    throw new Error('Race settings outside curated envelope');
  const terrain = extractRaceTerrain(input, {
    bridgeWidthMinPx: widthPx,
    bridgeWidthMaxPx: widthPx,
    maxBridgeSpanPx: 220,
    elevatorChance: 0,
    levelNoise: 0,
    railGapPx: 0,
  });
  const { shapes, labels, cols, rows, cell, width, height, params } = terrain;
  const walk = analyzeWalkable(shapes, width, height, params.walkCellPx, params.walkClearancePx);
  let order = author.sections.map((section) => {
    const index = shapes.findIndex((s) => pointInPolygon(section.center, s.contour, s.holes));
    if (index < 0 || !onMain(walk, index + 1, section.center))
      throw new Error(`Race section ${section.id} is not inside extracted walkable terrain`);
    if (!section.elementIds.some((id) => input.capture.elements.some((e) => e.id === id)))
      throw new Error(`Race section ${section.id} has no captured DOM provenance`);
    return index;
  });
  if (new Set(order).size !== order.length || order.length !== shapes.length)
    throw new Error(
      `Race authoring covers ${new Set(order).size} of ${shapes.length} islands: adjust source HTML, do not silently omit terrain`,
    );
  const candidates = findCandidates(labels, shapes, { cols, rows, cell, width, height }, params, (c) => {
    const len = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]);
    const u = [(c.b[0] - c.a[0]) / len, (c.b[1] - c.a[1]) / len];
    return (
      onMain(walk, c.from + 1, [c.a[0] - u[0] * 15, c.a[1] - u[1] * 15]) &&
      onMain(walk, c.to + 1, [c.b[0] + u[0] * 15, c.b[1] + u[1] * 15])
    );
  });
  let routeSearch: RaceRouteSearch | undefined;
  if (author.routeStrategy === 'search') {
    const centers = shapes.map((_, i) => author.sections[order.indexOf(i)].center);
    routeSearch = searchRaceRoute({
      shapes,
      centers,
      candidates,
      width,
      height,
      start: order[0],
      finish: order[order.length - 1],
    });
    author = { ...author, sections: routeSearch.order.map((id) => author.sections[order.indexOf(id)]) };
    order = routeSearch.order;
  }
  const chosen: Candidate[] = [];
  for (let i = 1; i < order.length; i++) {
    const from = order[i - 1];
    const to = order[i];
    const c = candidates.find((v) => (v.from === from && v.to === to) || (v.from === to && v.to === from));
    if (!c)
      throw new Error(
        `No safe cardinal connector from ${author.sections[i - 1].id} to ${author.sections[i].id}; move the HTML sections closer or align their mouths`,
      );
    chosen.push(c.from === from ? c : { ...c, from: c.to, to: c.from, a: c.b, b: c.a });
  }
  // Check actual interior travel via the authored centers at ball clearance, not centroid distances alone.
  let interiorDistancePx = 0;
  for (let i = 0; i < order.length; i++) {
    const center = author.sections[i].center;
    const endpoints = [i > 0 ? chosen[i - 1].b : center, i < chosen.length ? chosen[i].a : center];
    for (const endpoint of endpoints) {
      const len = Math.hypot(endpoint[0] - center[0], endpoint[1] - center[1]);
      interiorDistancePx += len;
      for (let d = 0; d < Math.max(0, len - 16); d += 3) {
        const p: Vec2 = [
          center[0] + ((endpoint[0] - center[0]) * d) / len,
          center[1] + ((endpoint[1] - center[1]) * d) / len,
        ];
        if (!onMain(walk, order[i] + 1, p))
          throw new Error(`Interior approach obstructed at ${author.sections[i].id}`);
      }
    }
  }
  const levels = author.sections.map((_, i) => 12 - i * descent);
  const bridges: Bridge[] = chosen.map((c, i) => ({
    id: i,
    from: i,
    to: i + 1,
    a: c.a,
    b: c.b,
    width: c.width,
    levelA: levels[i],
    levelB: levels[i + 1],
    type: descent ? 'ramp' : 'flat',
  }));
  const islands: Island[] = order.map((sourceIndex, id) => {
    const shape = shapes[sourceIndex];
    const mouths = bridges.filter((b) => b.from === id || b.to === id).map((b) => deckBox(b, 2));
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
  const finishBridge = bridges[bridges.length - 1];
  const len = Math.hypot(finishBridge.b[0] - finishBridge.a[0], finishBridge.b[1] - finishBridge.a[1]);
  const finishNormal: Vec2 = [
    (finishBridge.b[0] - finishBridge.a[0]) / len,
    (finishBridge.b[1] - finishBridge.a[1]) / len,
  ];
  const goalPos = author.sections[author.sections.length - 1].center;
  const finishPos: Vec2 = [goalPos[0] - finishNormal[0] * 30, goalPos[1] - finishNormal[1] * 30];
  const gates = bridges.map((b, i) => {
    const length = Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1]);
    const normal: Vec2 = [(b.b[0] - b.a[0]) / length, (b.b[1] - b.a[1]) / length];
    const center = pageToWorld(
      [(b.a[0] + b.b[0]) / 2, (b.a[1] + b.b[1]) / 2],
      (b.levelA + b.levelB) / 2 + 0.5,
    );
    return {
      id: `sector-${i + 1}`,
      kind: 'sector' as 'sector' | 'finish',
      center,
      normal,
      halfWidth: (b.width / 2 + BALL_RADIUS_PX) / PX_PER_METER,
      halfHeight: 3,
    };
  });
  gates.push({
    id: 'finish',
    kind: 'finish',
    center: pageToWorld(finishPos, levels[levels.length - 1] + 0.5),
    normal: finishNormal,
    halfWidth: 7,
    halfHeight: 3,
  });
  const slice = sliceRange(input.capture, input.sliceIndex);
  const stage: StageData = {
    schema: 'wwm.stage/2',
    stageId: '',
    builderVersion: RACE_BUILDER_VERSION,
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
    size: { width, height },
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
    start: { pos: author.sections[0].center, islandId: 0 },
    goal: { pos: goalPos, islandId: islands.length - 1, radius: 12 },
    provenance: {
      keptElementIds: author.sections.flatMap((s) => s.elementIds),
      dropped: [],
      notes: [
        `Race builder ${RACE_BUILDER_VERSION}; ordered authored route from real screenshot/DOM terrain`,
        `source sha256 ${author.sourceHash}`,
        `texture sha256 ${author.textureHash}`,
        'No maze DFS, elevators, portals, or collectibles. Route-relative descent.',
      ],
    },
  };
  const validation = validateStage({ ...stage, stageId: '0'.repeat(64) });
  if (!validation.ok)
    throw new Error(
      `Race stage invalid: ${validation.errors.map((e) => `${e.code}: ${e.message}`).join('; ')}`,
    );
  const generator = {
    version: RACE_BUILDER_VERSION,
    seed: input.seed,
    params,
    descent,
    authoring: author.sections,
    ...(routeSearch ? { routeWeights: RACE_ROUTE_WEIGHTS, searchBudget: 4096 } : {}),
  };
  const stunts = author.enableTurbo
    ? {
        version: 1 as const,
        cruiseSpeed: 8,
        chargeTicks: 360,
        turboDeltaV: 8,
        turboMaxSpeed: 24,
        landingDeltaV: 1,
        launchPads: [],
      }
    : undefined;
  const courseId = sha256HexSync(
    JSON.stringify({
      sourceHash: author.sourceHash,
      textureHash: author.textureHash,
      generator,
      islands,
      bridges,
      gates,
      start: stage.start,
      goal: stage.goal,
      ...(stunts ? { stunts } : {}),
    }),
  );
  stage.stageId = courseId;
  return {
    schema: 'wwm.race-course/1' as const,
    ...(stunts ? { stunts } : {}),
    courseId,
    title: author.title,
    description: author.description,
    stage,
    textureUrl: author.textureUrl,
    gates,
    generatorVersion: RACE_BUILDER_VERSION,
    seed: input.seed,
    provenance: { sourceHash: author.sourceHash, textureHash: author.textureHash, generator },
    validation: {
      valid: true,
      ...(routeSearch ? { routeSearch } : {}),
      extractedIslands: shapes.length,
      candidateCount: candidates.length,
      selectedConnections: chosen.length,
      rejectedConnections: candidates
        .filter(
          (c) =>
            !chosen.some((x) => (x.from === c.from && x.to === c.to) || (x.from === c.to && x.to === c.from)),
        )
        .map((c) => ({ from: c.from, to: c.to, reason: 'outside authored route' })),
      interiorDistanceM: interiorDistancePx / PX_PER_METER,
      routeDistanceM:
        (interiorDistancePx + chosen.reduce((n, c) => n + Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]), 0)) /
        PX_PER_METER,
    },
  };
}
