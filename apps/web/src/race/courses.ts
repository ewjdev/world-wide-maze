import { type RaceCourse, validateGates, validateStunts } from '@wwm/race';
import { parseStage, validateStage } from '@wwm/schema';

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
  {
    slug: 'flow-sprint',
    courseId: 'f46a6d44a8bb4ebb1339bed466646c529a013d1a211d34cc41b3e6e05cffa888',
    title: 'Flow Sprint',
    description: 'Broad turns and a gentle descent. Find your rhythm.',
    islands: 9,
    previewUrl: '/race/flow-sprint/texture.png',
    courseUrl: '/race/flow-sprint/course.json',
  },
  {
    slug: 'switchback',
    courseId: 'd1a4aed6fcfa065f5c0ca97f6753246f409d0b3b0fb9c876831fd981be8d6aff',
    title: 'Switchback',
    description: 'An alternating rhythm of descents and measured turns.',
    islands: 9,
    previewUrl: '/race/switchback/texture.png',
    courseUrl: '/race/switchback/course.json',
  },
  {
    slug: 'longline',
    courseId: '80ba08d1baee2f289fd2c24fcbd7f7f2ba7ccd97f54c91e17441e9d1bc2108dd',
    title: 'Longline',
    description: 'Long approaches, open islands, and a precise return.',
    islands: 8,
    previewUrl: '/race/longline/texture.png',
    courseUrl: '/race/longline/course.json',
  },
  {
    slug: 'island-leap',
    courseId: '26c62767177702939c8147f1f5915fc43a234511916c9bcc1c52e0afb7d0b83b',
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
  course.stage = parseStage(course.stage);
  if (!validateStage(course.stage).ok || validateGates(course.gates).length || validateStunts(course).length)
    throw new Error('Course geometry failed validation');
  if (course.stage.elevators.length || course.stage.items.length || course.stage.portals?.length)
    throw new Error('Course contains unsupported Race objects');
  return course;
}
