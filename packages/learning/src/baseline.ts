import { type Activity, type GemGroup, LEARNING_VERSION, parseLearningPath, type Token } from './schema.ts';
import { skyIslands } from './theme.ts';
import manifest from './voice-manifest.json' with { type: 'json' };
import './migrate.ts';

const token = (shape: Token['shape'], color: Token['color'] = 'blue'): Token => ({ shape, color });
const gems = (count: number): Token[] => Array.from({ length: count }, () => token('gem', 'teal'));
const option = (id: string, label: string, tokens: Token[]) => ({ id, label, tokens });
const island = (
  count: number,
  arrangement: GemGroup['arrangement'],
  size: GemGroup['size'] = 'medium',
  seed?: number,
): GemGroup => (seed === undefined ? { count, arrangement, size } : { count, arrangement, size, seed });

const activities: Activity[] = [
  {
    id: 'count-three',
    title: 'One, two, three',
    domain: 'counting',
    objective: 'Match the spoken number three to a group of three objects.',
    introduction: 'Pip is collecting gems for a bridge. Let’s find a little group.',
    rounds: [
      {
        id: 'r1',
        kind: 'choose',
        prompt: 'Which group has three gems?',
        stimulus: [],
        options: [
          option('two', 'Two gems', gems(2)),
          option('three', 'Three gems', gems(3)),
          option('four', 'Four gems', gems(4)),
        ],
        answer: 'three',
        hints: [
          'Point at each gem as you count.',
          'Count slowly: one, two, three. Then stop.',
          'Look at the glowing group. One, two, three!',
        ],
        success: 'One, two, three. This group has three gems!',
      },
    ],
    tools: [],
    finale: 'Three gems for Pip’s bridge. Nice counting!',
    play: {
      defaultLevel: 'gated',
      levels: [
        { id: 'explore', label: 'Explore', steps: 'rounds', locks: { mode: 'none' } },
        {
          id: 'gated',
          label: 'Gated',
          steps: 'rounds',
          locks: { mode: 'path', connectors: ['bridge', 'elevator'], goal: true, override: 'grown-up' },
        },
        {
          id: 'mission',
          label: 'Missions',
          steps: [{ mission: 'collect', count: 3 }, { round: 'r1' }],
          locks: { mode: 'path', connectors: ['bridge'], goal: true, override: 'grown-up' },
        },
      ],
    },
    parentNote:
      'Notice whether your child pairs one number word with each object. Naming the last number does not by itself establish understanding.',
    offlineActivity: 'Ask for three blocks. Rearrange them and count together again.',
    prerequisites: [],
  },
  {
    id: 'count-five',
    title: 'A handful of five',
    domain: 'counting',
    objective: 'Count a small group of five objects, counting each object once.',
    introduction: 'Pip’s collection is growing. Let’s find five gems.',
    rounds: [
      {
        id: 'r1',
        kind: 'choose',
        prompt: 'Which group has five gems?',
        stimulus: [],
        options: [
          option('five', 'Five gems', gems(5)),
          option('four', 'Four gems', gems(4)),
          option('six', 'Six gems', gems(6)),
        ],
        answer: 'five',
        hints: [
          'Touch each gem once as you count.',
          'Point and say one number for each gem. Stop after five.',
          'Look at the glowing group. One, two, three, four, five!',
        ],
        success: 'One, two, three, four, five. Five gems altogether!',
      },
    ],
    tools: [],
    finale: 'Five gems! Pip’s bridge is getting longer.',
    input: ['letter-key', 'tilt'],
    play: {
      defaultLevel: 'gated',
      levels: [
        { id: 'explore', label: 'Explore', steps: 'rounds', locks: { mode: 'none' } },
        {
          id: 'gated',
          label: 'Gated',
          steps: 'rounds',
          locks: { mode: 'path', connectors: ['bridge', 'elevator'], goal: true, override: 'grown-up' },
        },
        {
          id: 'mission',
          label: 'Missions',
          steps: [{ mission: 'collect', count: 5 }, { round: 'r1' }],
          locks: { mode: 'path', connectors: ['bridge'], goal: true, override: 'grown-up' },
        },
      ],
    },
    parentNote:
      'Try a different arrangement away from the screen. Repeating this one question can become position memory.',
    offlineActivity: 'Put five large blocks in a line, then a circle. Ask if the amount changed.',
    prerequisites: ['count-three'],
  },
  {
    id: 'compare-groups',
    title: 'Which has more?',
    domain: 'comparison',
    objective:
      'Compare two groups of up to six objects by counting or one-to-one matching, including when spacing or size makes the smaller group look bigger, and recognise equal groups.',
    introduction: 'Pip needs a bridge to roll across the sky. Bridges need gems!',
    rounds: [
      {
        id: 'r1',
        kind: 'compare',
        prompt: 'Which island has more gems?',
        islands: [island(2, 'dice'), island(4, 'dice')],
        allowSame: false,
        answer: 'b',
        hints: [
          'Look at both islands. Take your time.',
          'Let’s match them up. One gem from each island, then look for leftovers.',
          'See the leftovers? The island with leftovers has more.',
        ],
        success: 'Yes! Four is more than two. Bridge, go!',
      },
      {
        id: 'r2',
        kind: 'compare',
        input: ['letter-key', 'tilt'],
        prompt: 'Ooh, these are close. Which island has more gems?',
        islands: [island(5, 'scatter', 'medium', 7), island(4, 'scatter', 'medium', 3)],
        allowSame: false,
        answer: 'a',
        hints: [
          'Close ones are tricky. Count each island slowly.',
          'Let’s match them up and look for a leftover.',
          'Five and four. Five is more, so this island has more.',
        ],
        success: 'Yes! Five is more than four. Just one more!',
      },
      {
        id: 'r3',
        kind: 'compare',
        prompt: 'Tricky one! Some gems are spread out. Which island has more?',
        islands: [island(3, 'spread'), island(5, 'tight')],
        allowSame: false,
        answer: 'b',
        hints: [
          'Spread-out gems can look like a lot. Check carefully.',
          'Let’s match them up and see who has leftovers.',
          'Three and five. The bunched-up island has more!',
        ],
        success: 'You checked! Five is more than three, even bunched up.',
      },
      {
        id: 'r3b',
        kind: 'compare',
        input: ['arrows', 'tilt'],
        prompt: 'One more tricky one. Big gems or little gems. Which island has more?',
        onlyAfterHelpOn: 'r3',
        islands: [island(6, 'tight', 'small'), island(4, 'spread', 'large')],
        allowSame: false,
        answer: 'a',
        hints: [
          'Big gems take up more room. That doesn’t mean more gems.',
          'Match them up. Who has leftovers?',
          'Six little gems and four big gems. Six is more!',
        ],
        success: 'Yes! Six is more than four, even when they’re small.',
      },
      {
        id: 'r4',
        kind: 'compare',
        input: ['letter-key', 'tilt'],
        prompt: 'Which island has more? Or are they the same?',
        islands: [island(4, 'spread'), island(4, 'tight')],
        allowSame: true,
        answer: 'same',
        hints: [
          'Look closely. Could they be the same?',
          'Match them up. Are there any leftovers?',
          'No leftovers! Four and four. They’re the same.',
        ],
        success: 'The same! Four and four. That’s called equal.',
      },
      {
        id: 'r5',
        kind: 'compare',
        prompt: 'Bonus! Which island has more gems?',
        optional: true,
        islands: [island(3, 'dice'), island(6, 'dice')],
        allowSame: false,
        answer: 'b',
        hints: [
          'Look at both islands again.',
          'Match them up and look for leftovers.',
          'Three and six. Six is more!',
        ],
        success: 'Yes! Six is more than three.',
      },
      {
        id: 'r5b',
        kind: 'difference',
        input: ['number-key', 'tilt'],
        prompt: 'How many more gems are on the island with six?',
        optional: true,
        islands: [island(3, 'dice'), island(6, 'dice')],
        choices: [2, 3, 4],
        answer: 3,
        hints: [
          'Match them up, then count only the leftovers.',
          'Let’s match them up. Now count the leftovers.',
          'Three left over. Six is three more than three.',
        ],
        success: 'Yes! Three more. Six is three more than three.',
      },
    ],
    tools: ['match'],
    finale: 'We did it! You built the whole bridge.',
    play: {
      defaultLevel: 'gated',
      levels: [
        { id: 'explore', label: 'Explore', steps: 'rounds', locks: { mode: 'none' } },
        { id: 'goal-only', label: 'Answer before the finish', steps: 'rounds', locks: { mode: 'goal' } },
        {
          id: 'gated',
          label: 'Gated',
          steps: 'rounds',
          locks: { mode: 'path', connectors: ['bridge', 'elevator'], goal: true, override: 'grown-up' },
        },
        {
          id: 'mission',
          label: 'Missions',
          steps: [
            { round: 'r1' },
            { round: 'r2', lock: 'none' },
            { mission: 'collect', count: 4 },
            { round: 'r3' },
            { mission: 'reach', island: 'most-gems', lock: 'goal' },
            { round: 'r4' },
          ],
          locks: {
            mode: 'path',
            connectors: ['bridge'],
            goal: true,
            signals: { beacon: false },
            override: 'grown-up',
          },
        },
      ],
    },
    parentNote:
      'The tricky rounds space or size gems so the smaller group looks bigger. If your child chooses the longer or bigger-looking island, that is common at this age: use the match tool together and ask, "Who has leftovers?" Ask how they decided, and notice whether they count, match, or guess.',
    offlineActivity:
      'Make two rows of four blocks, then spread one row out. Ask which has more. Match the blocks one to one to check together.',
    prerequisites: ['count-five'],
  },
  {
    id: 'find-triangle',
    title: 'Meet the triangle',
    domain: 'geometry',
    objective: 'Identify a triangle by its three straight sides and three corners.',
    introduction: 'Pip’s gate has a shape lock. Shapes have clues. Follow their edges with your finger.',
    rounds: [
      {
        id: 'r1',
        kind: 'choose',
        prompt: 'Which shape has three straight sides?',
        stimulus: [],
        options: [
          option('square', 'Square', [token('square')]),
          option('circle', 'Circle', [token('circle')]),
          option('triangle', 'Triangle', [token('triangle')]),
        ],
        answer: 'triangle',
        hints: [
          'Trace each shape’s edges with your finger.',
          'Count the straight sides. A triangle has three sides and three corners.',
          'Look at the glowing shape. One, two, three sides!',
        ],
        success: 'A triangle has three straight sides and three corners.',
      },
    ],
    tools: [],
    finale: 'Click! The shape lock opens.',
    parentNote:
      'This is one triangle example. Show rotated and differently proportioned triangles before inferring recognition of the whole category.',
    offlineActivity: 'Make a triangle with three craft sticks. Turn it around. Is it still a triangle?',
    prerequisites: [],
  },
  {
    id: 'finish-pattern',
    title: 'What comes next?',
    domain: 'patterns',
    objective: 'Extend a repeating circle–triangle pattern by one element.',
    introduction: 'The bridge lights blink in a pattern. Listen to their rhythm.',
    rounds: [
      {
        id: 'r1',
        kind: 'choose',
        prompt: 'Circle, triangle, circle, triangle. What comes next?',
        stimulus: [
          token('circle'),
          token('triangle', 'yellow'),
          token('circle'),
          token('triangle', 'yellow'),
        ],
        options: [
          option('triangle', 'Triangle', [token('triangle', 'yellow')]),
          option('circle', 'Circle', [token('circle')]),
          option('square', 'Square', [token('square', 'green')]),
        ],
        answer: 'circle',
        hints: [
          'Say the pattern out loud with me.',
          'Circle, triangle is the part that repeats. Start that pair again.',
          'Circle, triangle, circle, triangle… circle!',
        ],
        success: 'Circle comes next. Circle, triangle is the part that repeats.',
      },
    ],
    tools: [],
    finale: 'The lights keep blinking. Great pattern spotting!',
    parentNote:
      'Both color and shape support this example. Try a pattern made with only movement to see whether the idea transfers.',
    offlineActivity: 'Clap, tap, clap, tap. Invite your child to continue, then invent a pattern together.',
    prerequisites: ['find-triangle'],
  },
  {
    id: 'sort-shapes',
    title: 'Find its family',
    domain: 'sorting',
    objective: 'Match objects by shape while ignoring a change in color.',
    introduction: 'Pip found a family of shapes. They belong together, even when their colors change.',
    rounds: [
      {
        id: 'r1',
        kind: 'choose',
        prompt: 'Which shape belongs with these squares?',
        stimulus: [token('square', 'red'), token('square', 'yellow'), token('square', 'blue')],
        options: [
          option('circle', 'Green circle', [token('circle', 'green')]),
          option('square', 'Green square', [token('square', 'green')]),
          option('triangle', 'Green triangle', [token('triangle', 'green')]),
        ],
        answer: 'square',
        hints: [
          'Look at the shape, not the color.',
          'Each square has four equal sides. Find another one.',
          'Look at the glowing shape. It has four equal sides, like the others!',
        ],
        success: 'The green square belongs. All of these shapes are squares.',
      },
    ],
    tools: [],
    finale: 'The square family is together again!',
    input: ['letter-key', 'tilt'],
    parentNote:
      'Ask your child to describe the sorting rule. Other valid grouping rules can be explored with physical objects.',
    offlineActivity: 'Sort large toy shapes by shape, mix them up, then sort by color.',
    prerequisites: ['find-triangle'],
  },
];

const voice = manifest.voiceId ? { provider: 'elevenlabs' as const, ...manifest } : undefined;

export const baselinePath = parseLearningPath({
  format: LEARNING_VERSION,
  id: 'little-discoveries',
  version: '3.0.0',
  title: 'Little discoveries',
  description:
    'Count gems. Spot a shape. Find a pattern. Six small adventures with Pip across the sky islands.',
  language: 'en',
  suggestedAges: [4, 6],
  reviewStatus: 'pilot-needs-educator-review',
  provenance: 'original-baseline',
  theme: skyIslands,
  play: { shuffle: 'positions', input: ['tap', 'arrows', 'tilt'] },
  ...(voice ? { voice } : {}),
  activities,
});
