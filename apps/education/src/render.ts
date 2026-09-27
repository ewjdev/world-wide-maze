/**
 * Static HTML for every page, generated at build time (scripts/generate.ts) and reused by the browser code to
 * re-render the stage. Everything visible is escaped here; every picture comes from the trusted scene renderer
 * in `@wwm/learning`, which only ever draws validated theme data.
 */
import {
  type Activity,
  choicesInOrder,
  defaultLevelId,
  describeLevel,
  type GemGroup,
  type InputPolicy,
  type LearningPath,
  learningScript,
  levelsFor,
  neutralLabels,
  type Orientation,
  type Round,
  requiredRounds,
  resolveLevel,
  sceneLayout,
  sceneSvg,
  spriteMarkup,
  spriteSvg,
  type Theme,
  wordsOf,
} from '@wwm/learning';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Text as one span per spoken word (the unit voice timings use), so the current word can be highlighted. */
export function spokenHtml(text: string): string {
  let out = '';
  let last = 0;
  wordsOf(text).forEach((word, i) => {
    out += `${escapeHtml(text.slice(last, word.start))}<span class="w" data-w="${i}">${escapeHtml(word.word)}</span>`;
    last = word.end;
  });
  return out + escapeHtml(text.slice(last));
}

// ── describing rounds for grown-ups ───────────────────────────────────────────────────────────────────────

const ARRANGEMENT_WORDS: Record<GemGroup['arrangement'], string> = {
  dice: 'in a dice pattern',
  row: 'in a row',
  spread: 'spread out',
  tight: 'bunched up',
  scatter: 'scattered',
};
const SIZE_RANK: Record<GemGroup['size'], number> = { small: 0, medium: 1, large: 2 };

export function groupWords(group: GemGroup): string {
  const size = group.size === 'small' ? ' small' : group.size === 'large' ? ' big' : '';
  return `${group.count}${size} ${ARRANGEMENT_WORDS[group.arrangement]}`;
}

const isRequired = (round: Round) => !round.optional && !round.onlyAfterHelpOn;

/** Planks already on the bridge when `index` starts (plus one when that round is solved). */
export function planksBuilt(activity: Activity, index: number, solved = false): number {
  const before = activity.rounds.slice(0, index).filter(isRequired).length;
  const round = activity.rounds[index];
  return Math.min(requiredRounds(activity), before + (solved && round && isRequired(round) ? 1 : 0));
}

/** A short name for what a round is for, derived from its data (so it can't drift from the numbers). */
export function roundTitle(activity: Activity, round: Round, index: number): string {
  let name: string;
  if (round.kind === 'difference') name = 'How many more';
  else if (round.kind === 'choose')
    name = activity.rounds.length > 1 ? `Question ${index + 1}` : 'The question';
  else {
    const [a, b] = round.islands;
    if (a.count === b.count) name = 'Same';
    else {
      const [fewer, more] = a.count < b.count ? [a, b] : [b, a];
      const looksBigger =
        (fewer.arrangement === 'spread' && more.arrangement !== 'spread') ||
        SIZE_RANK[fewer.size] > SIZE_RANK[more.size];
      if (looksBigger) name = round.onlyAfterHelpOn ? 'Trick again' : 'Trick';
      else if (more.count - fewer.count === 1) name = 'Close call';
      else name = index === 0 ? 'Warm-up' : 'Compare';
    }
  }
  if (!round.optional) return name;
  return name === 'Compare' || name === 'Warm-up'
    ? 'Bonus'
    : `Bonus, ${name.charAt(0).toLowerCase()}${name.slice(1)}`;
}

export function answerLabel(round: Round): string {
  if (round.kind === 'compare')
    return round.answer === 'same' ? 'Same' : `Island ${round.answer.toUpperCase()}`;
  if (round.kind === 'difference') return String(round.answer);
  return round.options.find((option) => option.id === round.answer)?.label ?? round.answer;
}

/** "Trick: 3 spread out vs 5 bunched up", one line per round. */
export function roundCheck(activity: Activity, round: Round, index: number): string {
  const title = roundTitle(activity, round, index);
  let what: string;
  if (round.kind === 'compare') {
    const [a, b] = round.islands;
    what = `${groupWords(a)} vs ${groupWords(b)}${round.allowSame ? ', or “Same”' : ''}`;
  } else if (round.kind === 'difference') {
    const [a, b] = round.islands;
    what = `${a.count} vs ${b.count}; choose ${round.choices.join(', ')}`;
  } else {
    const stimulus = round.stimulus.length
      ? `after ${round.stimulus.map((token) => `${token.color} ${token.shape}`).join(', ')}; `
      : '';
    what = `${stimulus}${round.options.map((option) => option.label.toLowerCase()).join(', ')}`;
  }
  const trigger = activity.rounds.findIndex((candidate) => candidate.id === round.onlyAfterHelpOn);
  const when =
    trigger >= 0
      ? ` (played only if round ${trigger + 1} needed the match tool)`
      : round.optional
        ? ' (optional)'
        : '';
  return `${title}: ${what}${when}`;
}

// ── game levels and answering, for grown-ups (Phase 22) ─────────────────────────────────────────────────

/** "In the game: Gated. Bridges and lifts stay locked…": the level this lesson plays at, in plain words. */
export function gameLevelText(path: Pick<LearningPath, 'family'>, activity: Activity): string {
  const level = resolveLevel(path, activity);
  const recommended = level.id === defaultLevelId(activity) ? ' (recommended by the lesson)' : '';
  const tap = path.family?.tapOnly ? ' Answering: tapping only.' : '';
  return `In the game: ${level.label}${recommended}. ${describeLevel(activity, level)}${tap}`;
}

/**
 * The line under the question when a round invites keys or arrows: "Press A or B", "Type the number: 2, 3 or
 * 4", "Use ← →, then Enter". Keys come in on-screen order. Empty when tapping is what's invited.
 */
export function inputHintHtml(
  round: Round,
  policy: InputPolicy,
  keys: Record<string, string>,
  orientation: Orientation,
): string {
  const kbd = (key: string) => `<kbd>${escapeHtml(key)}</kbd>`;
  const list = (items: string[]) =>
    items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;
  const ordered = choicesInOrder(round, orientation)
    .map((id) => keys[id])
    .filter((key): key is string => key !== undefined);
  if (policy.badges && policy.invited.includes('number-key') && round.kind === 'difference')
    return `Type the number: ${list(ordered.map(kbd))}`;
  if (policy.badges) return `Press ${list(ordered.map(kbd))}`;
  if (policy.promptLine && policy.invited.includes('arrows'))
    return `Use ${kbd('←')} ${kbd('→')}, then ${kbd('Enter')}`;
  return '';
}

/** How the path list describes an activity's length. */
export function roundSummary(activity: Activity): string {
  const total = requiredRounds(activity) + (activity.rounds.some((round) => round.optional) ? 1 : 0);
  if (total <= 1) return 'One quick question with Pip';
  return `${total}-round challenge${activity.tools.includes('match') ? ' with the match tool' : ''}`;
}

// ── the scene ─────────────────────────────────────────────────────────────────────────────────────────────

const pct = (value: number, total: number) => `${Math.round((value / total) * 10000) / 100}%`;

/**
 * The themed SVG with real, transparent answer buttons over each choice (the SVG itself is decorative). The
 * buttons follow on-screen order and are disabled until the page's script takes over. With `keys`, the key
 * badges show on the drawing and each button's name ends with its key ("Island A: 3 gems, spread out. Key A").
 */
export function sceneBlock(
  theme: Theme,
  activity: Activity,
  round: Round,
  options: {
    orientation: Orientation;
    built: number;
    enabled: boolean;
    preview?: boolean;
    keys?: Record<string, string>;
  },
): string {
  const planks = requiredRounds(activity);
  const neutral = neutralLabels(activity);
  const layout = sceneLayout(round, options.orientation, planks, neutral);
  const byId = new Map(layout.choices.map((choice) => [choice.id, choice]));
  const keys = options.preview ? undefined : options.keys;
  const buttons = choicesInOrder(round, options.orientation)
    .map((id) => byId.get(id))
    .filter((choice) => choice !== undefined)
    .map((choice) => {
      const key = keys?.[choice.id];
      const label = key ? `${choice.ariaLabel}. Key ${key}` : choice.ariaLabel;
      return `<button class="choice-hit" type="button" data-answer="${escapeHtml(choice.id)}" aria-label="${escapeHtml(label)}" style="left:${pct(choice.box.x, layout.width)};top:${pct(choice.box.y, layout.height)};width:${pct(choice.box.w, layout.width)};height:${pct(choice.box.h, layout.height)}"${options.enabled && !options.preview ? '' : ' disabled'}></button>`;
    })
    .join('');
  let svg = sceneSvg(theme, round, {
    orientation: options.orientation,
    planks,
    built: options.built,
    neutral,
  });
  if (keys) svg = svg.replace('<svg class="wwm-scene"', '<svg class="wwm-scene show-keys"');
  const ratio = Math.round((layout.width / layout.height) * 10000) / 10000;
  return `<div class="scene${options.preview ? ' is-preview' : ''}" id="scene" data-orientation="${options.orientation}" style="--ratio:${ratio};aspect-ratio:${layout.width} / ${layout.height}">${svg}<div class="scene-choices" role="group" aria-label="Answers">${buttons}</div></div>`;
}

/** The finished bridge: the bottom strip of a wide scene with every plank built. */
export function bridgeSvg(theme: Theme, activity: Activity): string {
  const planks = requiredRounds(activity);
  const round = activity.rounds[0] as Round;
  const { width, height } = sceneLayout(round, 'wide', planks);
  return sceneSvg(theme, round, {
    orientation: 'wide',
    planks,
    built: planks,
    neutral: neutralLabels(activity),
  }).replace(`viewBox="0 0 ${width} ${height}"`, `viewBox="0 446 ${width} ${height - 446}"`);
}

/** A small decorative Sky Islands picture (home page), composed from the theme's sprites. */
export function skyIslandsArt(theme: Theme): string {
  const gems = [
    { x: 36, y: 116 },
    { x: 66, y: 110 },
    { x: 96, y: 116 },
  ]
    .map((at) => spriteSvg(theme, 'gem', { x: at.x, y: at.y, w: 26, h: 26 }))
    .join('');
  const planks = [0, 1, 2]
    .map((i) => spriteSvg(theme, 'plank', { x: 158 + i * 56, y: 118, w: 52, h: 38 }, { stretch: true }))
    .join('');
  return `<svg class="sky-art" viewBox="0 0 480 190" aria-hidden="true" focusable="false">${spriteSvg(theme, 'cloud', { x: 170, y: 0, w: 110, h: 64 })}${spriteSvg(theme, 'cloud', { x: 380, y: 96, w: 90, h: 52 })}${spriteSvg(theme, 'island', { x: 18, y: 104, w: 132, h: 74 }, { stretch: true })}${gems}${planks}${spriteSvg(theme, 'island', { x: 328, y: 104, w: 132, h: 74 }, { stretch: true })}${spriteSvg(theme, 'gate', { x: 360, y: 34, w: 68, h: 68 })}${spriteSvg(theme, 'pip', { x: 214, y: 44, w: 78, h: 78 })}</svg>`;
}

// ── pages ─────────────────────────────────────────────────────────────────────────────────────────────────

const MUTE_ICON =
  '<svg class="icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path class="waves" d="M16 9c1.3 1.6 1.3 4.4 0 6M18.5 6.5c2.7 3 2.7 8 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path class="slash" d="M16 9l6 6M22 9l-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

function shell(
  title: string,
  content: string,
  path: LearningPath,
  entry: string,
  options: { head?: string; bodyClass?: string } = {},
): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="A parent-guided learning path for ages 4–6. Play with Pip across the sky islands: count, compare, spot shapes and patterns, and see what each activity teaches."><meta name="theme-color" content="#f8f8f8"><title>${escapeHtml(title)} · WWM Learning</title>${options.head ?? ''}</head>
<body${options.bodyClass ? ` class="${options.bodyClass}"` : ''}>
<!-- THESIS: a visible learning path and a large, direct activity canvas. OWN-WORLD: inherited WWM Figtree/Unbounded, fog-white, the Sky Islands theme (Pip, gems, islands, bridge) drawn from the learning document. STORY: choose, explore, understand, personalize. FIRST VIEWPORT: path introduction alongside six ordered stops; lessons lead with Pip, the question, and the scene. FORM: established WWM system, parent workspace and child activity canvas. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md -->
<a class="skip" href="#main">Skip to content</a>
<header class="site-header"><a class="wordmark" href="/"><span class="brand-shapes" aria-hidden="true"><i></i><i></i><i></i></span>WWM <span>Learning</span></a><nav aria-label="Main navigation"><a href="/">Learning path</a><a href="/#personalize">For parents</a></nav></header>
<main id="main">${content}</main>
<footer><p>Small discoveries. Shared adventures.</p><p>Original pilot material · Ages 4–6 · English</p><p class="small">Adult-guided practice. Educator review and family testing are still ahead.</p></footer>
${learningScript(path)}
<script type="module" src="${entry}"></script>
</body></html>`;
}

/** "Gated (recommended by the lesson)" or "Missions (your choice)": a lesson's level at a glance. */
export function levelChoiceText(path: Pick<LearningPath, 'family'>, activity: Activity): string {
  const level = resolveLevel(path, activity);
  return `${level.label} ${level.id === defaultLevelId(activity) ? '(recommended by the lesson)' : '(your choice)'}`;
}

/**
 * The parent area's Game settings: per lesson, its own levels (each described from its configuration, the
 * author's default marked), a reset to the recommendations, and the tap-only switch. Rendered with the path's
 * current choices; the home script re-checks them from this browser's saved settings.
 */
export function gameSettingsHtml(path: LearningPath): string {
  const lessons = path.activities
    .map((activity, index) => {
      const chosen = resolveLevel(path, activity).id;
      const recommended = defaultLevelId(activity);
      const options = levelsFor(activity)
        .map((level) => {
          const id = `level-${activity.id}-${level.id}`;
          return `<label class="level-option" for="${id}"><input type="radio" id="${id}" name="level-${activity.id}" value="${escapeHtml(level.id)}"${level.id === chosen ? ' checked' : ''}><span><strong>${escapeHtml(level.label)}</strong>${level.id === recommended ? ' <span class="recommended">(recommended by the lesson)</span>' : ''}<span class="level-description">${escapeHtml(describeLevel(activity, level))}</span></span></label>`;
        })
        .join('');
      return `<details class="level-choice" data-activity="${escapeHtml(activity.id)}"><summary><span class="stop-number" aria-hidden="true">${index + 1}</span><span class="level-title"><strong>${escapeHtml(activity.title)}</strong><span class="level-current" data-level-current>${escapeHtml(levelChoiceText(path, activity))}</span></span></summary><fieldset><legend class="visually-hidden">Game level for “${escapeHtml(activity.title)}”</legend>${options}</fieldset></details>`;
    })
    .join('');
  return `<section id="game-settings" class="parent-workspace game-settings" aria-labelledby="game-settings-heading">
    <div class="section-intro"><h2 id="game-settings-heading">Game settings</h2><p>How each lesson plays in the World Wide Maze game. Every lesson recommends a level; pick another if it suits your child better.</p><p class="small">Open a lesson to see its levels, described in plain words. Pip’s gates and locks never cost a life or a score. Your choices stay in this browser and travel in the learning HTML you download. Restoring the original path keeps them.</p></div>
    <div class="parent-controls">
      <p id="settings-state" class="save-state" role="status">Every lesson uses its recommended level.</p>
      <div class="tap-only"><label class="switch" for="tap-only"><input type="checkbox" id="tap-only" role="switch" aria-describedby="tap-only-help"${path.family?.tapOnly ? ' checked' : ''}><span class="switch-track" aria-hidden="true"></span><span>Answer by tapping only</span></label><p class="field-help" id="tap-only-help">For children who find keys or tilting hard: Pip never asks for a key, and every tap counts.</p></div>
      <div class="level-list">${lessons}</div>
      <div class="saved-actions"><button class="secondary" type="button" id="recommended-levels">Use the lesson’s recommendation for every lesson</button><button class="secondary" type="button" id="reset-settings">Reset game settings</button></div>
    </div>
  </section>`;
}

export function homePage(path: LearningPath): string {
  const theme = path.theme;
  return shell(
    path.title,
    `<section class="path-layout" aria-labelledby="path-title">
    <div class="path-intro"><h1 id="path-title" data-path-title>${escapeHtml(path.title)}</h1><p class="lead" data-path-description>${escapeHtml(path.description)}</p>
    <p class="audience">For ages 4–6, with a grown-up.</p>
    <a class="primary" href="/lessons/${path.activities[0]?.id}/">Start with ${escapeHtml(theme.guide.name)} <span aria-hidden="true">▶</span></a>
    <div class="discovery">${skyIslandsArt(theme)}</div>
    <p class="meet-pip">${spriteMarkup(theme, 'pip', 52, 'meet-pip-sprite')}<span><strong>Meet ${escapeHtml(theme.guide.name)},</strong> the World Wide Maze ball. ${escapeHtml(theme.guide.name)} reads every question aloud and helps when it’s tricky. Tap ${escapeHtml(theme.guide.name)} to hear it again.</span></p>
    <p class="small">Start anywhere. Pause whenever you like.</p></div>
    <div class="path-stops"><h2>Your first learning path</h2><p>Six things to try together across the ${escapeHtml(theme.name)}. The order is a suggestion.</p>
    <ol>${path.activities.map((activity, index) => `<li><a href="/lessons/${activity.id}/"><span class="stop-number">${index + 1}</span><span><strong>${escapeHtml(activity.title)}</strong><span class="stop-meta">${escapeHtml(roundSummary(activity))}</span><span>${escapeHtml(activity.objective)}</span></span><span class="stop-arrow" aria-hidden="true">↗</span></a></li>`).join('')}</ol></div>
  </section>
  <section id="personalize" class="parent-workspace" aria-labelledby="parent-heading">
    <div class="section-intro"><h2 id="parent-heading">Their interests. <br>Your own spin.</h2><p>The learning path is ready to use. Give its introductions a personal touch with an AI tool you choose, then review every change here.</p><p class="small">This version changes the story around each activity. ${escapeHtml(theme.guide.name)}, the pictures, rounds, questions, hints, and learning goals stay the same. Personalized introductions use your browser’s voice.</p></div>
    <div class="parent-controls">
      <p id="saved-state" class="save-state" role="status">Using the original learning path.</p>
      <form id="prompt-form"><label for="interests">What captures their imagination?</label><p class="field-help" id="interests-help">For example: space, trains, building things. No name or personal details needed.</p><textarea id="interests" name="interests" maxlength="500" rows="3" placeholder="They love space and exploring new planets." aria-describedby="interests-help" required></textarea><button class="primary" type="submit">Create an AI prompt</button></form>
      <div id="prompt-output" hidden><label for="ai-prompt">Copy this into your preferred AI tool</label><textarea id="ai-prompt" rows="7" readonly></textarea><button type="button" class="secondary" id="copy-prompt">Copy prompt</button><p class="small">No AI service is connected to this site. Only share information you choose.</p></div>
      <details class="import-panel"><summary>Bring back your AI draft</summary><form id="draft-form"><label for="draft-json">Paste the JSON response</label><textarea id="draft-json" name="draft" rows="7" maxlength="12000" spellcheck="false" required></textarea><button class="primary" type="submit">Review proposed changes</button></form></details>
      <p id="parent-feedback" role="status" aria-live="polite"></p>
      <section id="draft-review" hidden aria-labelledby="review-heading"><h3 id="review-heading" tabindex="-1">Review your family version</h3><p>Check that the story makes sense for your child. The teaching content remains the baseline.</p><div id="changes"></div><div class="button-row"><button class="primary" id="accept-draft" type="button">Use this family version</button><button class="secondary" id="discard-draft" type="button">Discard draft</button></div></section>
      <div class="saved-actions"><button class="secondary" type="button" id="download-path">Download learning HTML</button><button class="secondary" type="button" id="download-fork" hidden>Back up family version</button><button class="secondary" type="button" id="reset-fork" hidden>Restore original path</button></div>
      <p class="small">Your accepted version stays in this browser. Download a backup to keep it; there is no account or cloud sync yet.</p>
    </div>
  </section>
  ${gameSettingsHtml(path)}
  <section class="transparency"><h2>See what’s being learned.</h2><p>Every activity includes its goal, what each round checks, hints, the answer explained, and an idea to try away from the screen. The same information, and the ${escapeHtml(theme.name)} pictures, are embedded in the page for compatible games to read.</p><details><summary>About this starter material</summary><p>This is an early-math starter path, not a complete curriculum for ages 4–6. Activities are original examples informed by <a href="https://headstart.gov/school-readiness/article/math-preschool">Head Start’s preschool math guidance</a> and <a href="https://www.naeyc.org/node/2631">NAEYC’s playful math ideas</a>. Neither organization has reviewed or endorsed these activities. A six-year-old may need more challenge; choose by what your child is ready to explore.</p><p>${escapeHtml(theme.guide.name)}’s voice is generated ahead of time from our own script; nothing your child says or taps leaves this device. When a recording is unavailable, your browser’s voice reads the line instead.</p></details></section>`,
    path,
    '/src/home.ts',
  );
}

/** Grown-up notes: goal, interpretation, what every round checks (with its prompt, hints and answer). */
function parentNotesHtml(path: LearningPath, activity: Activity): string {
  return `<details class="parent-notes" id="parent-notes"><summary>For grown-ups: what this teaches</summary>
      <h2>The learning goal</h2><p data-learning-field="objective">${escapeHtml(activity.objective)}</p>
      <h3>What to notice</h3><p>${escapeHtml(activity.parentNote)}</p>
      <h3>In the game</h3><p id="game-level">${escapeHtml(gameLevelText(path, activity))}</p><p class="small"><a href="/#game-settings">Change the game level or answering</a></p>
      <h3>What each round checks</h3>
      <ol class="round-checks">${activity.rounds
        .map(
          (round, index) =>
            `<li data-learning-round="${round.id}" data-learning-kind="${round.kind}"><p class="round-check"><strong>${escapeHtml(roundCheck(activity, round, index))}</strong></p><p>Question: <span data-learning-field="prompt">${escapeHtml(round.prompt)}</span></p><p>Help, step by step:</p><ol class="hint-ladder">${round.hints.map((hint) => `<li data-learning-field="hint">${escapeHtml(hint)}</li>`).join('')}</ol><p>Answer: ${escapeHtml(answerLabel(round))}. <span data-learning-field="explanation">${escapeHtml(round.success)}</span></p></li>`,
        )
        .join('')}</ol>
      <h3>Try it away from the screen</h3><p data-learning-field="offline">${escapeHtml(activity.offlineActivity)}</p>
      <p class="small">One play-through is practice, not an assessment of mastery.</p>
    </details>`;
}

export function lessonPage(path: LearningPath, activity: Activity): string {
  const theme = path.theme;
  const index = path.activities.findIndex((item) => item.id === activity.id);
  const next = path.activities[index + 1];
  const first = activity.rounds[0] as Round;
  const hasIslands = activity.rounds.some((round) => round.kind !== 'choose');
  const nextLink = next
    ? `<a class="primary" id="next-activity" href="/lessons/${next.id}/">Next activity <span aria-hidden="true">▶</span></a>`
    : '<a class="primary" id="next-activity" href="/">Back to the learning path <span aria-hidden="true">▶</span></a>';
  const pip = escapeHtml(theme.guide.name);
  return shell(
    activity.title,
    `<div class="lesson-layout">
  <div class="lesson-bar"><a class="back" href="/">← <span>All activities</span></a><h1 class="lesson-title"><span class="lesson-count">${index + 1} of ${path.activities.length} · </span>${escapeHtml(activity.title)}</h1><button class="mute" id="mute" type="button" aria-pressed="false" aria-label="Mute ${pip}" title="Mute ${pip}" disabled>${MUTE_ICON}</button></div>
  <article class="activity" data-learning-activity="${activity.id}" data-learning-kinds="${[...new Set(activity.rounds.map((round) => round.kind))].join(' ')}">
    <section class="intro" id="intro">
      <button class="pip-start" id="pip-start" type="button" disabled>${spriteMarkup(theme, 'pip', 132, 'pip-sprite')}<span class="pip-start-label">Tap ${pip} to start</span></button>
      <p class="introduction" data-learning-field="introduction">${escapeHtml(activity.introduction)}</p>
    </section>
    <section class="stage" id="stage" data-learning-round="${first.id}" data-learning-kind="${first.kind}" aria-labelledby="prompt" hidden>
      <div class="prompt-row"><button class="pip-replay" id="replay" type="button" aria-label="Hear it again" title="Hear it again" disabled>${spriteMarkup(theme, 'pip', 44, 'pip-sprite')}</button><h2 class="prompt" id="prompt" tabindex="-1" data-learning-field="prompt">${spokenHtml(first.prompt)}</h2></div>
      <p class="input-hint" id="input-hint" hidden></p>
      ${sceneBlock(theme, activity, first, { orientation: 'wide', built: 0, enabled: false })}
      <p class="feedback" id="feedback" role="status" aria-live="polite"></p>
      <div class="controls" id="controls">
        <button class="primary next" id="next" type="button" hidden>Next <span aria-hidden="true">▶</span></button>
        <button class="primary" id="bonus-play" type="button" hidden>Play the bonus round</button>
        <button class="secondary" id="bonus-skip" type="button" hidden>Skip</button>
        <button class="secondary helper" id="hint" type="button" disabled>Help me</button>
        ${hasIslands ? '<button class="secondary helper" id="match" type="button" disabled>Match them up</button>' : ''}
      </div>
    </section>
    <section class="end-card" id="end" aria-labelledby="end-heading" hidden>
      <div class="end-bridge">${bridgeSvg(theme, activity)}</div>
      <h2 id="end-heading" tabindex="-1">You built the whole bridge!</h2>
      <p class="finale" id="finale">${spokenHtml(activity.finale)}</p>
      <div class="end-actions">${nextLink}<button class="secondary" id="again" type="button">Play again</button></div>
      <div class="offline"><h3>For grown-ups: try it away from the screen</h3><p>${escapeHtml(activity.offlineActivity)}</p></div>
    </section>
  </article>
  <p id="lesson-version" class="small lesson-version">Original learning path</p>
  ${parentNotesHtml(path, activity)}
  <nav class="lesson-nav" aria-label="Activity navigation"><a class="secondary" href="/">Choose another activity</a>${next ? `<a class="secondary" href="/lessons/${next.id}/">Skip to the next activity →</a>` : ''}</nav>
  <noscript><p class="small">Pip’s voice and the answer buttons need JavaScript. You can still read the question, look at the islands together, and open the grown-up notes.</p></noscript>
</div>`,
    path,
    '/src/lesson.ts',
    {
      bodyClass: 'lesson-page',
      // Without JavaScript the first round is shown straight away; the Pip start button has nothing to start.
      head: '<noscript><style>#stage[hidden]{display:block!important}.pip-start-label{display:none}.pip-start:disabled{opacity:1}</style></noscript>',
    },
  );
}

/**
 * A portable, non-executing document: readable text, the themed pictures as inline SVG, and the learning JSON
 * as the only script (inert). No `src=`, no external resources; a game reads it with `readLearningHtml`.
 */
export function portablePage(path: LearningPath, acceptedAt?: string): string {
  const theme = path.theme;
  const palette = theme.palette;
  const style = `body{font:18px/1.6 system-ui,sans-serif;color:${palette.ink};background:${palette.sky};max-width:820px;margin:32px auto;padding:0 20px}header{display:flex;gap:20px;align-items:center}header svg{flex:none}h1{margin:0;line-height:1.15}article{margin:56px 0;padding-top:24px;border-top:2px solid ${palette.islandEdge}}section{margin:32px 0}.scene svg{display:block;width:100%;height:auto}.prompt{font-size:22px;font-weight:700}details{margin:12px 0}summary{cursor:pointer;font-weight:600}li{margin:6px 0}.meta{color:#4b555f;font-size:15px}`;
  const header = `<header>${spriteMarkup(theme, 'pip', 72)}<div><h1>${escapeHtml(path.title)}</h1><p>${escapeHtml(path.description)}</p></div></header><p class="meta">With ${escapeHtml(theme.guide.name)} across the ${escapeHtml(theme.name)}. Baseline: ${escapeHtml(path.id)} ${escapeHtml(path.version)}. ${acceptedAt ? `Family introductions accepted ${escapeHtml(acceptedAt)}.` : 'Original version.'} Pilot material; educator review pending. For ages 4–6, with a grown-up.</p>`;
  const articles = path.activities
    .map((activity) => {
      const rounds = activity.rounds
        .map(
          (round, index) =>
            `<section data-learning-round="${round.id}" data-learning-kind="${round.kind}"><h3>Round ${index + 1}: ${escapeHtml(roundCheck(activity, round, index))}</h3><p class="prompt" data-learning-field="prompt">${escapeHtml(round.prompt)}</p><div class="scene">${sceneSvg(
              theme,
              round,
              {
                orientation: 'wide',
                planks: requiredRounds(activity),
                built: planksBuilt(activity, index),
                neutral: neutralLabels(activity),
              },
            )}</div><details><summary>Hints and answer</summary><ol>${round.hints.map((hint) => `<li data-learning-field="hint">${escapeHtml(hint)}</li>`).join('')}</ol><p><strong>Answer:</strong> ${escapeHtml(answerLabel(round))}. <span data-learning-field="explanation">${escapeHtml(round.success)}</span></p></details></section>`,
        )
        .join('');
      return `<article data-learning-activity="${activity.id}"><h2>${escapeHtml(activity.title)}</h2><p data-learning-field="introduction">${escapeHtml(activity.introduction)}</p><p><strong>Objective:</strong> <span data-learning-field="objective">${escapeHtml(activity.objective)}</span></p>${rounds}<p><strong>${escapeHtml(theme.guide.name)}:</strong> ${escapeHtml(activity.finale)}</p><details><summary>Parent notes</summary><p>${escapeHtml(activity.parentNote)}</p><p><strong>Away from the screen:</strong> ${escapeHtml(activity.offlineActivity)}</p><p>One play-through is practice, not an assessment of mastery.</p></details></article>`;
    })
    .join('');
  const chosen = path.family
    ? 'Chosen by a grown-up for this family.'
    : 'Each activity’s recommended level. A grown-up can change these in the parent area.';
  const levels = path.activities
    .map(
      (activity) =>
        `<li><strong>${escapeHtml(activity.title)}:</strong> ${escapeHtml(gameLevelText(path, activity).replace(/^In the game: /, ''))}</li>`,
    )
    .join('');
  const answering = path.family?.tapOnly
    ? 'Answering: tapping only (a grown-up setting).'
    : 'Answering: as each round invites (tapping, a key or tilting). A tap is always accepted after two gentle reminders.';
  const settings = `<section class="game-settings"><h2>Game settings</h2><p class="meta">How each activity plays in a compatible game. ${chosen}</p><ul>${levels}</ul><p>${escapeHtml(answering)}</p></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(path.title)}</title><style>${style}</style></head><body>${header}${settings}${articles}${learningScript(path)}</body></html>`;
}
