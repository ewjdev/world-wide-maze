/**
 * Reviewed vocabulary for model-written spelling items (Phase 31 M4), and the spelling checks that use it.
 *
 * The M0 spike (docs/education/item-bank-spike/2026-10-19/) found that a dictionary check accepts obscure words and
 * that independent runs converge on the same few words. So the authoring agent may only use words from a list a
 * person has reviewed, and the bank so far is passed to it as an exclusion list. Every spelling item, whoever
 * wrote it, passes `spellingIssues`; `spellingFlags` adds notes for the human reviewer that don't fail an item.
 */
import type { Round, Token } from './schema.ts';

export interface VocabularyWord {
  /** Lower case, consonant-vowel-consonant. */
  word: string;
  /** One short, kid-friendly sentence that tells a 4-year-old which word it is. */
  meaning: string;
}

export interface Vocabulary {
  id: string;
  language: 'en-US';
  ages: readonly [number, number];
  /** Nobody has signed this list off until the owner changes this to `reviewed`. */
  reviewStatus: 'needs-owner-review' | 'reviewed';
  words: readonly VocabularyWord[];
}

const entry = (word: string, meaning: string): VocabularyWord => ({ word, meaning });

/**
 * Starter list: common three-letter consonant-vowel-consonant words with short vowels, for ages 4–5. Words with a
 * final X (box, fox, six) are included because they appear in most early-phonics lists; the X makes two sounds.
 * Proposed by the M4 agent. Reviewed 2026-10-20 by the orchestrator under the owner's delegation: removed gum
 * (a choking risk for under-5s), pin (sharp), mom and dad (not every child's family), and reworded can and leg so
 * they assume neither British English nor a particular body. Every item built from it still needs an operator's
 * approval in the lesson-drafts workbench, and the owner can revise this list at any time.
 */
export const spellingVocabulary: Vocabulary = {
  id: 'en-cvc-starter',
  language: 'en-US',
  ages: [4, 5],
  reviewStatus: 'reviewed',
  words: [
    entry('cat', 'A cat is an animal that can meow.'),
    entry('dog', 'A dog is an animal that can bark.'),
    entry('pig', 'A pig is a pink farm animal that says oink.'),
    entry('hen', 'A hen is a mother chicken that lays eggs.'),
    entry('fox', 'A fox is a wild animal with a bushy tail.'),
    entry('bug', 'A bug is a tiny animal, like a beetle.'),
    entry('cub', 'A cub is a baby bear or a baby lion.'),
    entry('pup', 'A pup is a baby dog.'),
    entry('bat', 'A bat is an animal that flies at night.'),
    entry('yak', 'A yak is a big hairy animal like a cow.'),
    entry('ram', 'A ram is a daddy sheep with curly horns.'),
    entry('bus', 'A bus is a big car that carries lots of people.'),
    entry('van', 'A van is a car with lots of room inside.'),
    entry('jet', 'A jet is a fast airplane.'),
    entry('bed', 'You sleep in a bed at night.'),
    entry('hat', 'You wear a hat on your head.'),
    entry('cap', 'A cap is a soft hat with a brim at the front.'),
    entry('wig', 'A wig is pretend hair you can wear.'),
    entry('bib', 'A baby wears a bib to keep food off their clothes.'),
    entry('cup', 'You drink from a cup.'),
    entry('mug', 'A mug is a cup with a handle.'),
    entry('pot', 'You cook soup in a pot.'),
    entry('pan', 'You cook eggs in a pan.'),
    entry('lid', 'A lid goes on top of a pot or a box.'),
    entry('jam', 'Jam is sweet and sticky. You spread it on bread.'),
    entry('bun', 'A bun is a small round bread.'),
    entry('nut', 'A squirrel likes to eat a nut.'),
    entry('pen', 'You can draw and write with a pen.'),
    entry('map', 'A map can show where to go.'),
    entry('box', 'You can put toys in a box.'),
    entry('bag', 'You carry things in a bag.'),
    entry('can', 'A can holds soup or beans.'),
    entry('fan', 'A fan blows cool air on a hot day.'),
    entry('mat', 'You wipe your feet on a mat.'),
    entry('rug', 'A rug is a soft mat on the floor.'),
    entry('mop', 'A mop cleans up a wet floor.'),
    entry('tub', 'You take a bath in a tub.'),
    entry('net', 'You can catch a fish with a net.'),
    entry('zip', 'A zip closes your coat. Zip it up!'),
    entry('kit', 'A kit is a set of things you need, like a first aid kit.'),
    entry('web', 'A spider spins a web.'),
    entry('log', 'A log is a big piece of a tree.'),
    entry('sun', 'The sun shines in the sky.'),
    entry('mud', 'Mud is wet, sticky dirt.'),
    entry('fog', 'Fog is a cloud near the ground. It is hard to see in fog.'),
    entry('hut', 'A hut is a small, simple house.'),
    entry('leg', 'Your knee is in the middle of your leg.'),
    entry('lip', 'Your lip is part of your mouth.'),
    entry('lap', 'You can sit on a grown-up’s lap.'),
    entry('kid', 'A kid is a child, like you.'),
    entry('red', 'Red is the color of a strawberry.'),
    entry('big', 'An elephant is big.'),
    entry('hot', 'Fire is hot. Don’t touch!'),
    entry('wet', 'Rain makes you wet.'),
    entry('sad', 'When you feel sad, you might cry.'),
    entry('fun', 'Playing with friends is fun.'),
    entry('six', 'Six is the number after five.'),
    entry('ten', 'Ten is how many fingers you have.'),
    entry('run', 'You run when you go really fast.'),
    entry('hop', 'A bunny can hop.'),
    entry('sit', 'You sit on a chair.'),
    entry('dig', 'You dig a hole with a spade.'),
    entry('hug', 'You hug someone you love.'),
    entry('nap', 'A nap is a little sleep in the day.'),
  ],
};

/**
 * Common three-letter English words a grown-up would recognise. Used only to flag distractors for review (a
 * distractor that completes a real word makes the round depend on listening), never to accept a word.
 */
const COMMON_WORDS = `
ace act add ado age ago aid aim air ale all and ant any ape apt arc are ark arm art ash ask ate awe axe
bad bag ban bar bat bay bed bee beg bet bib bid big bin bit boa bob bog boo bow box boy bra bud bug bum bun
bus but buy bye cab cad cam can cap car cat cob cod cog con cop cot cow coy cry cub cud cue cup cur cut dab
dad dam day den dew did die dig dim din dip doe dog don dot dry dub dud due dug dye ear eat ebb egg ego elf
elk elm emu end era eve ewe eye fad fan far fat fax fed fee fen few fib fig fin fir fit fix flu fly foe fog
for fox fry fun fur gab gag gal gap gas gay gel gem get gig gin god got gum gun gut guy gym had ham has hat
hay hem hen her hew hey hid him hip his hit hob hog hop hot how hub hue hug hum hut ice icy ill imp ink inn
ion ire irk its ivy jab jam jar jaw jay jet jig job jog jot joy jug jut keg ken key kid kin kit lab lad lag
lap law lax lay led leg let lid lie lip lit log lot low lug mad man map mat maw may men met mid mix mob mod
mom mop mow mud mug mum nab nag nap net new nib nil nip nit nod nor not now nun nut oak oar oat odd off oft
oil old one opt orb ore our out owe owl own pad pal pan pap par pat paw pay pea peg pen pep per pet pew pie
pig pin pit ply pod pop pot pox pro pry pub pug pun pup pus put rag ram ran rap rat raw ray red rib rid rig
rim rip rob rod roe rot row rub rug rum run rut rye sad sag sap sat saw say sea set sew she shy sin sip sir
sis sit six ski sky sly sob sod son sop sot sow soy spa spy sty sub sue sum sun sup tab tad tag tan tap tar
tax tea ted tee ten the thy tic tie tin tip toe tog tom ton too top tot tow toy try tub tug tun two urn use
van vat vet vex via vie vow wad wag wan war was wax way web wed wee wet who why wig win wit woe wok won woo
wow yak yam yap yaw yen yes yet yew you yum zap zed zen zip zit zoo
`
  .trim()
  .split(/\s+/);

export const commonThreeLetterWords: ReadonlySet<string> = new Set([
  ...COMMON_WORDS,
  ...spellingVocabulary.words.map((entry) => entry.word),
]);

// ── spelling items ────────────────────────────────────────────────────────────────────────────────────────

type Choose = Extract<Round, { kind: 'choose' }>;
const STIMULUS = /^([A-Z_] ){2}[A-Z_]$/;

/** The completed word (upper case) of a missing-letter round, or undefined if it isn't one. */
export function spelledWord(round: Round): string | undefined {
  if (round.kind !== 'choose' || !round.stimulusText) return undefined;
  const answer = round.options.find((option) => option.id === round.answer);
  return round.stimulusText.replace('_', answer?.label ?? '?').replaceAll(' ', '');
}

/** Problems with a missing-letter spelling item; empty when it passes. `vocabulary` limits the words. */
export function spellingIssues(round: Round, vocabulary: Vocabulary = spellingVocabulary): string[] {
  if (round.kind !== 'choose') return ['Must be a choose round.'];
  const issues: string[] = [];
  const text = round.stimulusText ?? '';
  if (!STIMULUS.test(text) || text.split(' ').filter((part) => part === '_').length !== 1)
    issues.push('stimulusText must be three capital letters separated by spaces with exactly one "_".');
  if (round.stimulus.length) issues.push('Use stimulusText, not picture stimulus.');
  if (round.practice?.language !== 'en-US') issues.push('practice must be the whole word in en-US.');
  if (round.options.length < 2 || round.options.length > 3) issues.push('Use two or three letter options.');
  const answer = round.options.find((option) => option.id === round.answer);
  if (!answer || !/^[A-Z]$/.test(answer.label)) issues.push('The answer option must be one capital letter.');
  for (const option of round.options) {
    if (!/^[A-Z]$/.test(option.label) || option.id !== option.label.toLowerCase())
      issues.push(`Option "${option.label}" must be one capital letter with a lowercase id.`);
    if (option.tokens.length) issues.push('Letter options have no tokens.');
  }
  if (new Set(round.options.map((option) => option.label)).size !== round.options.length)
    issues.push('Each option must be a different letter.');
  const word = spelledWord(round) ?? '';
  if (round.practice && round.practice.text.toUpperCase() !== word)
    issues.push(`practice.text must be the completed word "${word}".`);
  if (!vocabulary.words.some((entry) => entry.word === word.toLowerCase()))
    issues.push(`"${word}" is not on the reviewed word list.`);
  if (!round.hints.at(-1)?.includes(answer?.label ?? '\0'))
    issues.push('The last hint must name the letter.');
  return issues;
}

/** Notes for the human reviewer that don't fail a spelling item. */
export function spellingFlags(round: Round): string[] {
  if (round.kind !== 'choose' || !round.stimulusText) return [];
  const flags: string[] = [];
  const others = round.options
    .filter((option) => option.id !== round.answer)
    .map((option) => round.stimulusText?.replace('_', option.label).replaceAll(' ', '') ?? '')
    .filter((word) => commonThreeLetterWords.has(word.toLowerCase()));
  if (others.length)
    flags.push(
      `Distractor also spells a real word (${others.join(', ')}); the meaning sentence and audio must decide.`,
    );
  if (round.prompt.length > 100)
    flags.push(`Long prompt (${round.prompt.length} characters) for a 4-year-old.`);
  return flags;
}

/**
 * A missing-letter round in the authored lesson's shape (preschool.ts `spellingRound`). `blank` is the 0-based
 * position of the missing letter; `letters` are the options in order, including the answer.
 */
export function spellingBankRound(
  id: string,
  entry: VocabularyWord,
  blank: number,
  letters: string[],
): Choose {
  const word = entry.word.toUpperCase();
  const answer = word[blank] ?? '';
  const stimulusText = word
    .split('')
    .map((letter, i) => (i === blank ? '_' : letter))
    .join(' ');
  const spelled = word.split('').join(', ');
  return {
    id,
    kind: 'choose',
    prompt: `${entry.meaning} Listen, say it, and find the missing letter.`,
    practice: { text: word.charAt(0) + word.slice(1).toLowerCase(), language: 'en-US' },
    stimulus: [],
    stimulusText,
    options: letters.map((letter) => ({ id: letter.toLowerCase(), label: letter, tokens: [] as Token[] })),
    answer: answer.toLowerCase(),
    hints: [
      'Point to the empty space. A letter goes there.',
      'Ask your grown-up to say the word slowly and show its letters.',
      `Choose ${answer}. The letters are ${spelled}.`,
    ],
    success: `${spelled}. You completed the word! Listen and try saying it together.`,
  };
}
