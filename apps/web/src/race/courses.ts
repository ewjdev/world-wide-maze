import { type RaceCourse, racePhysicsOptions, validateGates, validateStunts } from '@wwm/race';
import { parseStage, validateStage } from '@wwm/schema';
import { MAZE_COURSES } from './maze-catalog.ts';

export interface RaceCourseSummary {
  slug: string;
  courseId: string;
  title: string;
  description: string;
  islands: number;
  previewUrl: string;
  courseUrl: string;
}

/** Immutable build outputs; a retry never recaptures the HTML or chooses another seed. */
export const RACE_COURSES: readonly RaceCourseSummary[] = [
  ...MAZE_COURSES,
  {
    slug: 'flow-sprint',
    courseId: '0394bbfb036058076af0d77ef892fc6863e0d3fe3457b02ad290371a2c5f8d20',
    title: 'Flow Sprint',
    description: 'Broad turns and a gentle descent. Find your rhythm.',
    islands: 9,
    previewUrl: '/race/flow-sprint/texture.png',
    courseUrl: '/race/flow-sprint/course.json',
  },
  {
    slug: 'switchback',
    courseId: '3849f547391b8714e9bd80b11b37afc153d93e8018876aa6730a8a5d48dc3d24',
    title: 'Switchback',
    description: 'An alternating rhythm of descents and measured turns.',
    islands: 9,
    previewUrl: '/race/switchback/texture.png',
    courseUrl: '/race/switchback/course.json',
  },
  {
    slug: 'longline',
    courseId: 'c420e59c198f79a255cbe99a65acb9430567199cf9b53accef29e302dee09aa4',
    title: 'Longline',
    description: 'Linked turns, one open straight, and a precise return.',
    islands: 8,
    previewUrl: '/race/longline/texture.png',
    courseUrl: '/race/longline/course.json',
  },
  {
    slug: 'island-leap',
    courseId: '1e4da3a7712306717a20317ad62ab56a74d8485b6e7fff73a23e9049d99d0c52',
    title: 'Island Leap',
    description: 'Ground flow, short hops, or a long leap. Carry your speed through the exit turn.',
    islands: 8,
    previewUrl: '/race/island-leap/texture.png',
    courseUrl: '/race/island-leap/course.json',
  },
];

export async function loadRaceCourse(slugOrId: string, signal?: AbortSignal): Promise<RaceCourse> {
  const summary = RACE_COURSES.find((course) => course.slug === slugOrId || course.courseId === slugOrId);
  if (!summary) throw new Error('Unknown Race course');
  const response = await fetch(summary.courseUrl, { signal });
  if (!response.ok) throw new Error(`Course load failed (${response.status})`);
  const course = (await response.json()) as RaceCourse;
  if (
    course.schema !== 'wwm.race-course/1' ||
    course.courseId !== summary.courseId ||
    !Array.isArray(course.gates)
  )
    throw new Error('Course identity does not match its frozen release');
  racePhysicsOptions(course.physicsProfile);
  course.stage = parseStage(course.stage);
  if (
    !validateStage(course.stage, course.physicsProfile === 'elevation-v1' ? { mode: 'race' } : {}).ok ||
    validateGates(course.gates).length ||
    validateStunts(course).length
  )
    throw new Error('Course geometry failed validation');
  if (course.stage.elevators.length || course.stage.items.length || course.stage.portals?.length)
    throw new Error('Course contains unsupported Race objects');
  return course;
}
