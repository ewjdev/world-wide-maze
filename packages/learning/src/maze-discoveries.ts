import { baselinePath } from './baseline.ts';
import { parseLessonV04 } from './lesson-v04.ts';

/** Draft content: educator review is required before exposing the sampler. */
export const bridgeBuilders = parseLessonV04({
  format: 'wwm-learning/0.4',
  id: 'maze-discoveries',
  revision: 'bridge-draft-1',
  title: 'Maze discoveries',
  description: 'Four experimental lessons, each testing a different reason to act in a maze.',
  interfaceLocale: 'en-US',
  targetLocale: 'en-US',
  reviewStatus: 'draft-needs-educator-review',
  requiredCapabilities: ['inventory.deposit', 'session.resume'],
  connectors: ['crossing-1', 'crossing-2', 'crossing-3', 'crossing-4'],
  targets: [
    { id: 'repair-1', role: 'deposit' },
    { id: 'repair-2', role: 'deposit' },
    { id: 'repair-3', role: 'deposit' },
    { id: 'repair-4', role: 'deposit' },
    { id: 'gem-1a', role: 'pickup', item: 'gem', count: 1 },
    { id: 'gem-1b', role: 'pickup', item: 'gem', count: 1 },
    { id: 'gem-1c', role: 'pickup', item: 'gem', count: 1 },
    { id: 'pile-2a', role: 'pickup', item: 'gem', count: 2 },
    { id: 'pile-2b', role: 'pickup', item: 'gem', count: 4 },
    { id: 'pile-2c', role: 'pickup', item: 'gem', count: 3 },
    { id: 'pile-2d', role: 'pickup', item: 'gem', count: 3 },
    { id: 'pile-4a', role: 'pickup', item: 'gem', count: 2 },
    { id: 'pile-4b', role: 'pickup', item: 'gem', count: 3 },
    { id: 'pile-4c', role: 'pickup', item: 'gem', count: 4 },
  ],
  activities: [
    {
      id: 'bridge-builders',
      kind: 'bridge-builders',
      title: 'Bridge Builders',
      gradeTarget: 1,
      objective: 'Compose and decompose totals, then predict what remains after a transfer.',
      parentNote:
        'Observe the chosen quantities before hints. Collection alone is not evidence of arithmetic.',
      encounters: [
        {
          id: 'first-five',
          prompt: 'You have 2 gems. This bridge needs 5. How many more?',
          hints: [
            'Look at the empty slots.',
            'Pair each gem with a slot.',
            'Two are filled; count three empty slots.',
          ],
          initialInventory: [{ type: 'gem', count: 2 }],
          pickups: [
            { id: 'gem-1a', item: 'gem', count: 1, target: 'gem-1a' },
            { id: 'gem-1b', item: 'gem', count: 1, target: 'gem-1b' },
            { id: 'gem-1c', item: 'gem', count: 1, target: 'gem-1c' },
          ],
          deposit: { target: 'repair-1', item: 'gem', required: 5, prefilled: 0, connector: 'crossing-1' },
          validCompositions: [[2, 3]],
        },
        {
          id: 'two-piles',
          prompt: 'Find two piles that make 6. Try another way too.',
          hints: ['Count the open slots.', 'Try 2 and 4, or 3 and 3.', 'Both pairs fill six slots.'],
          initialInventory: [],
          pickups: [
            { id: 'pile-2a', item: 'gem', count: 2, target: 'pile-2a' },
            { id: 'pile-2b', item: 'gem', count: 4, target: 'pile-2b' },
            { id: 'pile-2c', item: 'gem', count: 3, target: 'pile-2c' },
            { id: 'pile-2d', item: 'gem', count: 3, target: 'pile-2d' },
          ],
          deposit: { target: 'repair-2', item: 'gem', required: 6, prefilled: 0, connector: 'crossing-2' },
          validCompositions: [
            [2, 4],
            [3, 3],
          ],
        },
        {
          id: 'nine-minus-four',
          prompt: 'Start with 9. Spend 4. What will remain?',
          hints: [
            'Picture nine before moving any.',
            'Take away four and count what is left.',
            'Nine minus four leaves five.',
          ],
          initialInventory: [{ type: 'gem', count: 9 }],
          pickups: [],
          deposit: { target: 'repair-3', item: 'gem', required: 4, prefilled: 0, connector: 'crossing-3' },
          validCompositions: [[4]],
        },
        {
          id: 'fresh-seven',
          prompt: 'This bridge needs 7 and already has 3. How many should you add?',
          hints: [
            'Count the empty slots.',
            'Find a pile for the missing part.',
            'Three plus four makes seven.',
          ],
          initialInventory: [],
          pickups: [
            { id: 'pile-4a', item: 'gem', count: 2, target: 'pile-4a' },
            { id: 'pile-4b', item: 'gem', count: 3, target: 'pile-4b' },
            { id: 'pile-4c', item: 'gem', count: 4, target: 'pile-4c' },
          ],
          deposit: { target: 'repair-4', item: 'gem', required: 7, prefilled: 3, connector: 'crossing-4' },
          validCompositions: [[4]],
          transfer: true,
        },
      ],
    },
  ],
});

export const pathRegistry = {
  'little-discoveries': {
    id: 'little-discoveries',
    status: 'live' as const,
    activities: baselinePath.activities.map((activity) => activity.id),
  },
  'maze-discoveries': {
    id: 'maze-discoveries',
    status: 'draft' as const,
    activities: ['bridge-builders', 'message-trail', 'mercado-perdido', 'expedition-dispatch'] as const,
  },
};
