import { type RaceCourse, validateGates, validateStunts } from '@wwm/race';
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
    courseId: '43b1aaf3c6436c208d0d671bf11c7d0f0a429a8efa73d938101c0880c29a7db6',
    title: 'Flow Sprint',
    description: 'Broad turns and a gentle descent. Find your rhythm.',
    islands: 9,
    previewUrl: '/race/flow-sprint/texture.png',
    courseUrl: '/race/flow-sprint/course.json',
  },
  {
    slug: 'switchback',
    courseId: '3bdc270a029d088a09d5aadf268396a2d906771be7788b9d0bb6d4d8115bcc1a',
    title: 'Switchback',
    description: 'An alternating rhythm of descents and measured turns.',
    islands: 9,
    previewUrl: '/race/switchback/texture.png',
    courseUrl: '/race/switchback/course.json',
  },
  {
    slug: 'longline',
    courseId: '801c9a633b58af0e42e75c1f06326393cddd157959a1a106186c0d70c6c45e2f',
    title: 'Longline',
    description: 'Linked turns, one open straight, and a precise return.',
    islands: 8,
    previewUrl: '/race/longline/texture.png',
    courseUrl: '/race/longline/course.json',
  },
  {
    slug: 'island-leap',
    courseId: 'bbe4412705eb67bfeb76825f1942811f477575e92a9fdf0adde077d247453634',
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
