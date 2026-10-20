import type { Activity, Round, Token } from './schema.ts';

type Choose = Extract<Round, { kind: 'choose' }>;
const word = (id: string, label: string) => ({ id, label, tokens: [] as Token[] });
const shape = (color: Token['color'], form: Token['shape'] = 'circle'): Token => ({ shape: form, color });
const group = (id: string, label: string, count: number, form: Token['shape'] = 'gem') => ({
  id,
  label,
  tokens: Array.from({ length: count }, () => shape('teal', form)),
});
const practice = (text: string, language: 'en-US' | 'es-ES' = 'es-ES') => ({ text, language });

/** Five short, supported activities for ages 4–5: four core turns and one optional stretch each. */
export const preschoolActivities: Activity[] = [
  {
    id: 'spanish-hello',
    title: 'Hola, Pip!',
    domain: 'language',
    objective: 'Listen to and try Spanish greetings and polite words in everyday situations.',
    introduction:
      'Let’s talk with Pip in Spanish! Listen, have a go out loud, then tap a meaning. A grown-up can help.',
    rounds: [
      {
        id: 'r1',
        kind: 'choose',
        prompt: 'Listen and try saying it. What does this greeting mean?',
        practice: practice('Hola'),
        stimulus: [],
        options: [word('goodbye', 'Goodbye'), word('hello', 'Hello')],
        answer: 'hello',
        hints: [
          'Imagine Pip has just arrived.',
          'Wave to welcome Pip. What would you say?',
          'Choose Hello to welcome Pip.',
        ],
        success: 'You found hello! Wave and try the Spanish greeting again.',
      },
      {
        id: 'r2',
        kind: 'choose',
        prompt: 'Listen and try saying it. What does this greeting mean?',
        practice: practice('Adiós'),
        stimulus: [],
        options: [word('goodbye', 'Goodbye'), word('thanks', 'Thank you')],
        answer: 'goodbye',
        hints: [
          'Pip is leaving for home.',
          'Think about what you say when someone leaves.',
          'Choose Goodbye. Wave as Pip leaves.',
        ],
        success: 'Goodbye! Try the Spanish word as you wave.',
      },
      {
        id: 'r3',
        kind: 'choose',
        prompt: 'Pip gives you a gift. Listen, say it, and find its meaning.',
        practice: practice('Gracias'),
        stimulus: [],
        options: [word('hello', 'Hello'), word('thanks', 'Thank you')],
        answer: 'thanks',
        hints: [
          'Pip did something kind.',
          'What do you say when someone gives you a gift?',
          'Choose Thank you.',
        ],
        success: 'Thank you! You can try this Spanish word when someone helps.',
      },
      {
        id: 'r4',
        kind: 'choose',
        prompt: 'You meet a friend. Which greeting could you use?',
        practice: practice('Hola'),
        stimulus: [],
        options: [word('hello', 'Hello'), word('goodbye', 'Goodbye'), word('thanks', 'Thank you')],
        answer: 'hello',
        hints: [
          'Your friend has just arrived.',
          'Say a greeting to welcome your friend.',
          'Choose Hello, just as you did for Pip.',
        ],
        success: 'Hello works for a friend too. Try greeting your grown-up in Spanish!',
      },
      {
        id: 'r5',
        kind: 'choose',
        optional: true,
        prompt: 'One more phrase to try. What does it mean?',
        practice: practice('Por favor'),
        stimulus: [],
        options: [word('thanks', 'Thank you'), word('hello', 'Hello'), word('please', 'Please')],
        answer: 'please',
        hints: [
          'Imagine asking for a turn with a toy.',
          'Think of a polite word to add to your request.',
          'Choose Please.',
        ],
        success: 'Please! Try the Spanish phrase when you ask for a turn.',
      },
    ],
    tools: [],
    input: ['tap', 'arrows'],
    finale: 'You tried Spanish greetings with Pip. Keep talking together!',
    parentNote:
      'For ages 4–5. Model the word, pause, and invite a reply without requiring it. Taps check a meaning only; speech is not recorded or assessed. Spanish models use an available Spanish browser voice. If unavailable, read the displayed word together.',
    offlineActivity:
      'Wave to toys and say hola or adiós. Pass a toy and try gracias. Accept gestures or a quiet turn.',
    prerequisites: [],
  },
  {
    id: 'spanish-colors',
    title: 'Colores with Pip',
    domain: 'language',
    objective: 'Hear and say four Spanish color words, matching each to a colored shape.',
    introduction: 'Pip has colorful shapes. Listen to a Spanish color, try saying it, then find the color.',
    rounds: [
      colorRound('r1', 'rojo', 'red', ['blue', 'red']),
      colorRound('r2', 'azul', 'blue', ['blue', 'green']),
      colorRound('r3', 'verde', 'green', ['red', 'blue', 'green']),
      colorRound('r4', 'rojo', 'red', ['green', 'red', 'blue'], 'triangle'),
      { ...colorRound('r5', 'amarillo', 'yellow', ['yellow', 'blue', 'red']), optional: true },
    ],
    tools: [],
    input: ['tap', 'arrows'],
    finale: 'Colors can have Spanish names too. Try naming a color around you!',
    parentNote:
      'For ages 4–5. Say the model and let the child copy at their own pace. The fourth round changes shape to revisit the color. Color labels are readable alternatives; this activity uses color as its teaching content. Speaking is optional and unscored.',
    offlineActivity:
      'Find a red, blue, or green object together. Try rojo, azul, or verde. Add amarillo for yellow if the child wants more.',
    prerequisites: [],
  },
  {
    id: 'spanish-counting',
    title: 'Uno, dos, tres',
    domain: 'language',
    objective: 'Listen to and say Spanish numbers one to three, matching each to a small group.',
    introduction: 'Count with Pip in Spanish. Listen, try the number aloud, and touch each gem once.',
    rounds: [
      numberRound('r1', 'uno', 1, [2, 1]),
      numberRound('r2', 'dos', 2, [2, 3]),
      numberRound('r3', 'tres', 3, [1, 2, 3]),
      numberRound('r4', 'dos', 2, [3, 2, 1], 'triangle'),
      { ...numberRound('r5', 'cuatro', 4, [3, 4, 2]), optional: true },
    ],
    tools: [],
    input: ['tap', 'arrows'],
    finale: 'You counted little groups with Spanish words. Count together again!',
    parentNote:
      'For ages 4–5. Begin with one to three. Touch one object for each count; repeat the Spanish model after listening. Changing gems to triangles checks a new example. Four is an optional stretch. No spoken response is recorded or scored.',
    offlineActivity:
      'Count up to three blocks together: uno, dos, tres. Move them and count again. Stop before it feels tiring.',
    prerequisites: [],
  },
  {
    id: 'little-word-builders',
    title: 'Little word builders',
    domain: 'literacy',
    objective:
      'Explore simple English spelling by choosing a missing letter in a supported three-letter word.',
    introduction:
      'Pip is making little words. Listen, say the word, then find the missing letter. Take your time with a grown-up.',
    rounds: [
      spellingRound('r1', 'Cat', 'C A _', ['T', 'P'], 'T', 'en-US', 'A cat is an animal that can meow.'),
      spellingRound('r2', 'Sun', 'S U _', ['M', 'N'], 'N', 'en-US', 'The sun shines in the sky.'),
      spellingRound('r3', 'Map', 'M _ P', ['O', 'A'], 'A', 'en-US', 'A map can show where to go.'),
      spellingRound('r4', 'Dog', '_ O G', ['C', 'B', 'D'], 'D', 'en-US', 'A dog is an animal that can bark.'),
      {
        ...spellingRound(
          'r5',
          'Cat',
          '_ A T',
          ['C', 'S', 'M'],
          'C',
          'en-US',
          'Remember the animal that can meow.',
        ),
        optional: true,
      },
    ],
    tools: [],
    input: ['tap', 'arrows'],
    finale: 'You helped Pip build little words. Say one you remember!',
    parentNote:
      'For ages 4–5 who want to explore letters, with adult support. Say the word naturally, then stretch its sounds without adding extra vowel sounds. Model a letter if needed. This is supported spelling practice, not independent reading or a mastery test.',
    offlineActivity:
      'Write CAT in large letters. Say the word, cover one letter, and let your child reveal or copy it. Try their own mark-making too.',
    prerequisites: [],
  },
  {
    id: 'spanish-word-builders',
    title: 'Build Spanish words',
    domain: 'literacy',
    objective:
      'Listen to and try short Spanish words, then explore their spelling one missing letter at a time.',
    introduction:
      'Try Spanish words with Pip: a word to hear, a word to say, and a letter to find. Your grown-up can help.',
    rounds: [
      spellingRound('r1', 'Sol', 'S O _', ['L', 'N'], 'L', 'es-ES', 'This Spanish word means sun.'),
      spellingRound('r2', 'Pan', 'P A _', ['L', 'N'], 'N', 'es-ES', 'This Spanish word means bread.'),
      spellingRound('r3', 'Oso', 'O _ O', ['M', 'P', 'S'], 'S', 'es-ES', 'This Spanish word means bear.'),
      spellingRound('r4', 'Sal', '_ A L', ['P', 'S', 'M'], 'S', 'es-ES', 'This Spanish word means salt.'),
      {
        ...spellingRound(
          'r5',
          'Sol',
          'S _ L',
          ['O', 'A', 'U'],
          'O',
          'es-ES',
          'Try the Spanish word for sun again.',
        ),
        optional: true,
      },
    ],
    tools: [],
    input: ['tap', 'arrows'],
    finale: 'You explored Spanish sounds and letters. Try saying a word together!',
    parentNote:
      'For ages 4–5 exploring print with a grown-up. Listen to the Spanish model instead of applying English vowel sounds. Model and copy freely. Letter choices check supported spelling only; repeating aloud is optional and unscored. Without a Spanish voice, use the transcript with a Spanish-speaking grown-up.',
    offlineActivity:
      'Draw a sun, write SOL beneath it, and say sol together. Cover and reveal one letter. Revisit PAN at snack time.',
    prerequisites: [],
  },
];

/** A "hear the Spanish colour, find the shape" round; also used by the `spanish-color` generator. */
export function colorRound(
  id: string,
  text: string,
  color: Token['color'],
  colors: Token['color'][],
  form: Token['shape'] = 'circle',
): Choose {
  const name = color[0]?.toUpperCase() + color.slice(1);
  return {
    id,
    kind: 'choose',
    prompt: 'Listen, try the Spanish word, then find its color.',
    practice: practice(text),
    stimulus: [],
    options: colors.map((value) => ({
      id: value,
      label: value[0]?.toUpperCase() + value.slice(1),
      tokens: [shape(value, form)],
    })),
    answer: color,
    hints: [
      'Listen again. Look carefully at the colors.',
      'Ask your grown-up to name the colors with you.',
      `The Spanish word names ${color}. Find the ${color} shape.`,
    ],
    success: `${name}! Try the Spanish word again with your grown-up.`,
  };
}

function numberRound(
  id: string,
  text: string,
  count: number,
  counts: number[],
  form: Token['shape'] = 'gem',
): Choose {
  const names = ['Zero', 'One', 'Two', 'Three', 'Four'];
  return {
    id,
    kind: 'choose',
    prompt: 'Listen, try the Spanish number, then find that many.',
    practice: practice(text),
    stimulus: [],
    options: counts.map((value) => group(`n${value}`, names[value] ?? String(value), value, form)),
    answer: `n${count}`,
    hints: [
      'Touch each object once as you count.',
      `Ask your grown-up to count to ${count} with you.`,
      `Find the group with exactly ${count}. Count it again.`,
    ],
    success: `${names[count]}! Try the Spanish number as you point to the group.`,
  };
}

function spellingRound(
  id: string,
  text: string,
  stimulusText: string,
  letters: string[],
  answer: string,
  language: 'en-US' | 'es-ES',
  meaning: string,
): Choose {
  const complete = stimulusText.replace('_', answer).replaceAll(' ', '');
  return {
    id,
    kind: 'choose',
    prompt: `${meaning} Listen, say it, and find the missing letter.`,
    practice: practice(text, language),
    stimulus: [],
    stimulusText,
    options: letters.map((letter) => word(letter.toLowerCase(), letter)),
    answer: answer.toLowerCase(),
    hints: [
      'Point to the empty space. A letter goes there.',
      'Ask your grown-up to say the word slowly and show its letters.',
      `Choose ${answer}. The letters are ${complete.split('').join(', ')}.`,
    ],
    success: `${complete.split('').join(', ')}. You completed the word! Listen and try saying it together.`,
  };
}
