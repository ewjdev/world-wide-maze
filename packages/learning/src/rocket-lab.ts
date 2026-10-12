import { baselinePath } from './baseline.ts';
import { GUIDED_VERSION, MOTION_CAPABILITIES, parseGuidedPath } from './guided-v05.ts';
import type { MotionRound } from './motion.ts';
import manifest from './rocket-voice-manifest.json' with { type: 'json' };
import type { LearningPath } from './schema.ts';

const markers: MotionRound['options'] = [
  { id: 'circle', label: 'Blue circle', motion: 'left' as const },
  { id: 'triangle', label: 'Yellow triangle', motion: 'right' as const },
];
const balloon = (exhaust: 'left' | 'right' | 'none') => ({
  apparatus: 'balloon' as const,
  setting: 'level-string' as const,
  exhaust,
  startsStill: true as const,
});
const rounds: MotionRound[] = [
  {
    id: 'r1',
    kind: 'predict-motion',
    scene: balloon('right'),
    options: markers,
    answer: 'circle',
    prompt: 'Air comes out toward the yellow triangle. Which way will the balloon go?',
    hints: [
      'Find the opening where the air comes out.',
      'Watch slowly. Air leaves one way; the balloon moves the other way.',
      'Air goes toward the triangle. The balloon moves toward the circle.',
    ],
    success: 'Air goes toward the triangle. That pushes the balloon toward the circle.',
  },
  {
    id: 'r2',
    kind: 'predict-motion',
    scene: balloon('left'),
    options: markers,
    answer: 'triangle',
    prompt: 'Pip turned the balloon around. Air goes toward the blue circle. Which way will the balloon go?',
    hints: [
      'Find the opening. It changed sides!',
      'Watch the air and the balloon move in opposite directions.',
      'Air goes toward the circle. The balloon moves toward the triangle.',
    ],
    success: 'The opening changed sides! Air goes toward the circle; the balloon moves toward the triangle.',
  },
  {
    id: 'r3',
    kind: 'predict-motion',
    scene: balloon('none'),
    answer: 'stay',
    options: [
      { id: 'zoom', label: 'Zoom along the string', motion: 'zoom' },
      { id: 'stay', label: 'Stay here', motion: 'still' },
    ],
    prompt:
      'This still balloon is tied shut. No air escapes. On our level string, will it zoom or stay here?',
    hints: [
      'Find the knot. Can air get out?',
      'The open balloon lets air out. This tied one keeps air inside.',
      'No escaping air means no rocket push. This balloon stays here.',
    ],
    success: 'No air escapes, so there is no rocket push. On our level string, the balloon stays here.',
  },
  {
    id: 'r4',
    kind: 'predict-motion',
    scene: { apparatus: 'rocket', setting: 'launch', exhaust: 'down', startsStill: true },
    answer: 'star',
    options: [
      { id: 'star', label: 'Up toward the star', motion: 'up' },
      { id: 'flower', label: 'Down toward the flower', motion: 'down' },
    ],
    prompt: 'This rocket starts still. Hot gas shoots down. Which way will the rocket start moving?',
    hints: [
      'Find the engine opening. Where does the gas go?',
      'Use the balloon idea. Gas goes one way; the rocket is pushed the other way.',
      'Gas goes down. This rocket gets pushed up toward the star.',
    ],
    success: 'The rocket pushes gas down, and the gas pushes the rocket up. Just like our balloon!',
  },
  {
    id: 'r5',
    kind: 'predict-motion',
    optional: true,
    scene: { apparatus: 'rocket', setting: 'space', exhaust: 'left', startsStill: true },
    answer: 'triangle',
    options: [{ id: 'cannot-move', label: 'It cannot move', motion: 'impossible' }, ...markers],
    prompt:
      'This rocket is still in space. Gas goes toward the circle. Which way can the rocket start moving?',
    hints: [
      'The rocket can send out its own gas in space.',
      'Gas goes one way. Where does the rocket get pushed?',
      'Gas goes toward the circle. The rocket starts moving toward the triangle.',
    ],
    success: 'Its own escaping gas pushes the rocket toward the triangle, even in space.',
  },
];
export const rocketPath: LearningPath = parseGuidedPath({
  format: GUIDED_VERSION,
  id: 'pip-discoveries',
  version: '1.0.0',
  title: 'Discover with Pip',
  description: 'Try a balloon experiment, then discover what gives a rocket its push.',
  language: 'en',
  suggestedAges: [4, 6],
  reviewStatus: 'pilot-needs-educator-review',
  provenance: 'original-baseline',
  theme: baselinePath.theme,
  requiredCapabilities: MOTION_CAPABILITIES,
  play: { shuffle: 'none', input: ['tap', 'arrows'] },
  voice: { provider: 'elevenlabs', ...manifest },
  activities: [
    {
      id: 'rocket-lab',
      title: 'Pip’s Rocket Lab',
      domain: 'physical-science',
      objective: 'Predict the starting direction when a balloon or rocket sends gas out.',
      introduction:
        'Let’s try a balloon rocket! Air is a kind of gas. The pale puffs in our picture show where invisible air goes. Watch the air and the balloon.',
      demonstration: {
        scene: balloon('right'),
        text: 'Air goes one way. The balloon gets pushed the other way.',
      },
      rounds,
      tools: [],
      input: ['tap', 'arrows'],
      play: {
        defaultLevel: 'rocket-gated',
        levels: [
          {
            id: 'rocket-gated',
            label: 'Rocket Lab',
            steps: 'rounds',
            locks: { mode: 'path', connectors: ['bridge', 'elevator'], goal: true, override: 'grown-up' },
          },
        ],
      },
      finale: 'You helped Pip discover the push! Gas goes one way. The rocket gets pushed the other way.',
      parentNote:
        'A guided pilot for ages four to six, requiring educator and family review. Every vehicle starts still; our string is level, and the upright rocket has enough thrust to rise. Pictures simplify friction, gravity and thrust strength. Four predictions are required; space is optional. Participation is practice, not proof of mastery.',
      offlineActivity:
        'With a grown-up, thread a straw onto a level string. The adult inflates a balloon, tapes it to the straw, holds its opening, then releases it. Predict, watch, reverse the balloon and try again. The adult handles balloons and cleans up broken pieces.',
      prerequisites: [],
    },
  ],
});
export const rocketLab = rocketPath.activities[0];
export function bundledLessonPath(id?: string | null, rocketEnabled = false): LearningPath {
  if (id === 'rocket-lab') {
    if (!rocketEnabled) throw new Error('Rocket Lab is not available in this build.');
    return rocketPath;
  }
  return baselinePath;
}
