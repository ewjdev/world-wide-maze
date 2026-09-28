/** Pure authored elevation pass shared by fixture generation and deterministic rebuild tests. */
import { PX_PER_METER, pointInPolygon, type StageData, type Vec2 } from '@wwm/schema';
import { sha256HexSync } from './sha256.ts';

export interface RaceElevationDesign {
  islandLevels: Record<string, number>;
  physicsProfile: 'elevation-v1';
  bridgeControls?: Record<string, Vec2>;
  bridgeEnds?: Record<string, Vec2>;
  bridgeStarts?: Record<string, Vec2>;
  islandContours?: Record<string, Vec2[]>;
}
interface ElevatableCourse {
  courseId: string;
  generatorVersion: string;
  stage: StageData;
  gates: { center: [number, number, number] }[];
  stunts?: { launchPads: { gate: { center: [number, number, number] } }[] };
  physicsProfile?: 'elevation-v1';
}
export function applyRaceElevation<T extends ElevatableCourse>(source: T, design: RaceElevationDesign): T {
  if (design.physicsProfile !== 'elevation-v1') throw new Error('Unsupported elevation design profile');
  const course = structuredClone(source);
  const oldIslands = structuredClone(course.stage.islands);
  const levels = design.islandLevels;
  for (const island of oldIslands) {
    if (!Number.isFinite(levels[island.id])) throw new Error(`Missing elevation for island ${island.id}`);
  }
  const support = (center: readonly number[]) =>
    oldIslands
      .filter((i) => pointInPolygon([center[0] * PX_PER_METER, center[2] * PX_PER_METER], i.contour, i.holes))
      .sort((a, b) => Math.abs(a.level + 0.5 - center[1]) - Math.abs(b.level + 0.5 - center[1]))[0] ??
    oldIslands.toSorted(
      (a, b) =>
        Math.hypot(
          a.restartPoints[0][0] / PX_PER_METER - center[0],
          a.restartPoints[0][1] / PX_PER_METER - center[2],
        ) -
        Math.hypot(
          b.restartPoints[0][0] / PX_PER_METER - center[0],
          b.restartPoints[0][1] / PX_PER_METER - center[2],
        ),
    )[0];
  for (const gate of [...course.gates, ...(course.stunts?.launchPads.map((p) => p.gate) ?? [])]) {
    const island = support(gate.center);
    gate.center[1] += levels[island.id] - island.level;
  }
  for (const island of course.stage.islands) {
    island.level = levels[island.id];
    if (design.islandContours?.[island.id])
      island.contour = structuredClone(design.islandContours[island.id]);
  }
  for (const bridge of course.stage.bridges) {
    if (design.bridgeControls?.[bridge.id]) bridge.control = [...design.bridgeControls[bridge.id]];
    if (design.bridgeEnds?.[bridge.id]) bridge.b = [...design.bridgeEnds[bridge.id]];
    if (design.bridgeStarts?.[bridge.id]) bridge.a = [...design.bridgeStarts[bridge.id]];
    bridge.levelA = levels[bridge.from];
    bridge.levelB = levels[bridge.to];
    bridge.type = bridge.levelA === bridge.levelB ? 'flat' : 'ramp';
    bridge.elevationProfile = 'smoothstep';
  }
  course.physicsProfile = 'elevation-v1';
  course.generatorVersion = 'race-elevation/1';
  course.courseId = '0'.repeat(64);
  course.stage.stageId = '0'.repeat(64);
  course.courseId = sha256HexSync(JSON.stringify(course));
  course.stage.stageId = course.courseId;
  return course;
}
