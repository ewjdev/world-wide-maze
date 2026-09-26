import { type Activity, parseLearningPath, type Token } from './schema.ts';

const token = (shape: Token['shape'], color: Token['color'] = 'blue'): Token => ({ shape, color });
const group = (count: number): Token[] => Array.from({ length: count }, () => token('circle'));
const option = (id: string, label: string, tokens: Token[]) => ({ id, label, tokens });
const shared = { interaction: 'single-choice' as const, stimulus: [], prerequisites: [] };

const activities: Activity[] = [
  {
    ...shared,
    id: 'count-three',
    title: 'One, two, three',
    domain: 'counting',
    objective: 'Match the spoken number three to a group of three objects.',
    introduction: 'Let’s collect a little group of treasures.',
    prompt: 'Which group has three circles?',
    options: [
      option('two', 'Two circles', group(2)),
      option('three', 'Three circles', group(3)),
      option('four', 'Four circles', group(4)),
    ],
    answerId: 'three',
    hint: 'Count the circles slowly: one, two, three. Then choose a group.',
    explanation: 'One, two, three. This group has three circles!',
    parentNote:
      'Notice whether your child pairs one number word with each object. Naming the last number does not by itself establish understanding.',
    offlineActivity: 'Ask for three blocks. Rearrange them and count together again.',
  },
  {
    ...shared,
    id: 'count-five',
    title: 'A handful of five',
    domain: 'counting',
    prerequisites: ['count-three'],
    objective: 'Count a small group of five objects, counting each object once.',
    introduction: 'Our collection is growing. Let’s find five.',
    prompt: 'Which group has five circles?',
    options: [
      option('five', 'Five circles', group(5)),
      option('four', 'Four circles', group(4)),
      option('six', 'Six circles', group(6)),
    ],
    answerId: 'five',
    hint: 'Point to each circle and say one number. Stop after five.',
    explanation: 'One, two, three, four, five. Five circles altogether!',
    parentNote:
      'Try a different arrangement away from the screen. Repeating this one question can become position memory.',
    offlineActivity: 'Put five large blocks in a line, then a circle. Ask if the amount changed.',
  },
  {
    ...shared,
    id: 'compare-groups',
    title: 'Which has more?',
    domain: 'comparison',
    prerequisites: ['count-five'],
    objective: 'Compare groups of two and four same-size objects.',
    introduction: 'Two collections are waiting. Take a careful look.',
    prompt: 'Which group has more circles?',
    options: [option('two', 'Two circles', group(2)), option('four', 'Four circles', group(4))],
    answerId: 'four',
    hint: 'Count each group, or match one circle from each group. Which group has some left?',
    explanation: 'Four is more than two. The group of four has two extra circles.',
    parentNote:
      'Ask how your child decided. Later, vary spacing so a longer row is not mistaken for a larger amount.',
    offlineActivity: 'Build towers of two and four equal blocks. Match blocks one to one.',
  },
  {
    ...shared,
    id: 'find-triangle',
    title: 'Meet the triangle',
    domain: 'geometry',
    objective: 'Identify a triangle by its three straight sides and three corners.',
    introduction: 'Shapes have clues. Follow their edges with your finger.',
    prompt: 'Which shape has three straight sides?',
    options: [
      option('square', 'Square', [token('square')]),
      option('circle', 'Circle', [token('circle')]),
      option('triangle', 'Triangle', [token('triangle')]),
    ],
    answerId: 'triangle',
    hint: 'Count the straight sides. A triangle has three sides and three corners.',
    explanation: 'A triangle has three straight sides and three corners.',
    parentNote:
      'This is one triangle example. Show rotated and differently proportioned triangles before inferring recognition of the whole category.',
    offlineActivity: 'Make a triangle with three craft sticks. Turn it around. Is it still a triangle?',
  },
  {
    ...shared,
    id: 'finish-pattern',
    title: 'What comes next?',
    domain: 'patterns',
    prerequisites: ['find-triangle'],
    objective: 'Extend a repeating circle–triangle pattern by one element.',
    introduction: 'Some shapes like to take turns. Listen to their rhythm.',
    prompt: 'Circle, triangle, circle, triangle. What comes next?',
    stimulus: [token('circle'), token('triangle', 'yellow'), token('circle'), token('triangle', 'yellow')],
    options: [
      option('triangle', 'Triangle', [token('triangle', 'yellow')]),
      option('circle', 'Circle', [token('circle')]),
      option('square', 'Square', [token('square', 'green')]),
    ],
    answerId: 'circle',
    hint: 'Say the two parts that repeat: circle, triangle. Start that pair again.',
    explanation: 'Circle comes next. Circle, triangle is the part that repeats.',
    parentNote:
      'Both color and shape support this example. Try a pattern made with only movement to see whether the idea transfers.',
    offlineActivity: 'Clap, tap, clap, tap. Invite your child to continue, then invent a pattern together.',
  },
  {
    ...shared,
    id: 'sort-shapes',
    title: 'Find its family',
    domain: 'sorting',
    prerequisites: ['find-triangle'],
    objective: 'Match objects by shape while ignoring a change in color.',
    introduction: 'These shapes belong together, even when their colors change.',
    prompt: 'Which shape belongs with these squares?',
    stimulus: [token('square', 'red'), token('square', 'yellow'), token('square', 'blue')],
    options: [
      option('circle', 'Green circle', [token('circle', 'green')]),
      option('square', 'Green square', [token('square', 'green')]),
      option('triangle', 'Green triangle', [token('triangle', 'green')]),
    ],
    answerId: 'square',
    hint: 'Look at the shape instead of the color. Each square has four equal sides.',
    explanation: 'The green square belongs. All of these shapes are squares.',
    parentNote:
      'Ask your child to describe the sorting rule. Other valid grouping rules can be explored with physical objects.',
    offlineActivity: 'Sort large toy shapes by shape, mix them up, then sort by color.',
  },
];

export const baselinePath = parseLearningPath({
  format: 'wwm-learning/0.1',
  id: 'little-discoveries',
  version: '1.0.0',
  title: 'Little discoveries',
  description: 'Count a collection. Spot a shape. Find a pattern. Six small invitations to explore together.',
  language: 'en',
  suggestedAges: [4, 6],
  reviewStatus: 'pilot-needs-educator-review',
  provenance: 'original-baseline',
  activities,
});
