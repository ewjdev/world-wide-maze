import { type Activity, type LearningPath, learningScript, type Token } from '@wwm/learning';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function tokensHtml(tokens: Token[]): string {
  return `<span class="tokens" aria-hidden="true">${tokens.map((token) => `<span class="shape ${token.shape} ${token.color}"></span>`).join('')}</span>`;
}

export function activityHtml(activity: Activity): string {
  return `<article class="activity" data-learning-activity="${activity.id}" data-learning-interaction="${activity.interaction}">
    <p class="introduction" data-learning-field="introduction">${escapeHtml(activity.introduction)}</p>
    <h1 data-learning-field="prompt">${escapeHtml(activity.prompt)}</h1>
    ${activity.stimulus.length ? `<div class="stimulus" aria-label="${escapeHtml(activity.stimulus.map((token) => `${token.color} ${token.shape}`).join(', '))}" role="img">${tokensHtml(activity.stimulus)}<span class="missing" aria-hidden="true">?</span></div>` : ''}
    <button class="listen secondary" type="button" data-listen>Listen to the question</button>
    <div class="choices">${activity.options.map((option, index) => `<button class="choice" type="button" data-answer="${option.id}" aria-label="${escapeHtml(option.label)}" disabled>${tokensHtml(option.tokens)}<span class="choice-name">${activity.domain === 'counting' || activity.domain === 'comparison' ? `Group ${String.fromCharCode(65 + index)}` : escapeHtml(option.label)}</span></button>`).join('')}</div>
    <p class="feedback" id="feedback" role="status" aria-live="polite">Take your time. You can try as often as you like.</p>
    <button class="secondary" data-hint type="button" disabled>Give me a hint</button>
    <details class="parent-notes"><summary>For grown-ups: what this teaches</summary>
      <h2>The learning goal</h2><p data-learning-field="objective">${escapeHtml(activity.objective)}</p>
      <h3>What to notice</h3><p>${escapeHtml(activity.parentNote)}</p>
      <h3>A little help</h3><p data-learning-field="hint">${escapeHtml(activity.hint)}</p>
      <h3>The answer, explained</h3><p data-learning-field="explanation">${escapeHtml(activity.explanation)}</p>
      <h3>Try it away from the screen</h3><p>${escapeHtml(activity.offlineActivity)}</p>
      <p class="small">One question is an invitation to practice, not an assessment of mastery.</p>
    </details>
  </article>`;
}

function shell(title: string, content: string, path: LearningPath, entry: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Explore a parent-guided learning path for ages 4–6. Play with counting, shapes and patterns, and see what each activity teaches."><meta name="theme-color" content="#f8f8f8"><title>${escapeHtml(title)} · WWM Learning</title></head>
<body>
<!-- THESIS: a visible learning path and a large, direct activity canvas. OWN-WORLD: inherited WWM Figtree/Unbounded, fog-white, blue/green/yellow/red geometry. STORY: choose, explore, understand, personalize. FIRST VIEWPORT: path introduction alongside six ordered stops; activities lead with the question and tangible shape choices. FORM: established WWM system, parent workspace and child activity canvas. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md -->
<a class="skip" href="#main">Skip to content</a>
<header class="site-header"><a class="wordmark" href="/"><span class="brand-shapes" aria-hidden="true"><i></i><i></i><i></i></span>WWM <span>Learning</span></a><nav aria-label="Main navigation"><a href="/">Learning path</a><a href="/#personalize">For parents</a></nav></header>
<main id="main">${content}</main>
<footer><p>Small discoveries. Shared adventures.</p><p>Original pilot material · Ages 4–6 · English</p><p class="small">Adult-guided practice. Educator review and family testing are still ahead.</p></footer>
${learningScript(path)}
<script type="module" src="${entry}"></script>
</body></html>`;
}

export function homePage(path: LearningPath): string {
  return shell(
    path.title,
    `<section class="path-layout" aria-labelledby="path-title">
    <div class="path-intro"><h1 id="path-title" data-path-title>${escapeHtml(path.title)}</h1><p class="lead" data-path-description>${escapeHtml(path.description)}</p>
    <p class="audience">For ages 4–6, with a grown-up.</p>
    <a class="primary" href="/lessons/${path.activities[0]?.id}/">Explore the first activity <span aria-hidden="true">↗</span></a>
    <div class="discovery" aria-hidden="true">${tokensHtml([
      { shape: 'circle', color: 'blue' },
      { shape: 'triangle', color: 'yellow' },
      { shape: 'square', color: 'green' },
    ])}</div>
    <p class="small">Start anywhere. Pause whenever you like.</p></div>
    <div class="path-stops"><h2>Your first learning path</h2><p>Six things to try together. The order is a suggestion.</p>
    <ol>${path.activities.map((activity, index) => `<li><a href="/lessons/${activity.id}/"><span class="stop-number">${index + 1}</span><span><strong>${escapeHtml(activity.title)}</strong><span>${escapeHtml(activity.objective)}</span></span><span class="stop-arrow" aria-hidden="true">↗</span></a></li>`).join('')}</ol></div>
  </section>
  <section id="personalize" class="parent-workspace" aria-labelledby="parent-heading">
    <div class="section-intro"><h2 id="parent-heading">Their interests. <br>Your own spin.</h2><p>The learning path is ready to use. Give its introductions a personal touch with an AI tool you choose, then review every change here.</p><p class="small">This first version changes the story around each activity. Pictures, questions, hints, and learning goals stay the same.</p></div>
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
  <section class="transparency"><h2>See what’s being learned.</h2><p>Every activity includes its goal, hints, answer explanation, and an idea to try away from the screen. The same information is embedded in the page for compatible games to read.</p><details><summary>About this starter material</summary><p>This is an early-math starter path, not a complete curriculum for ages 4–6. Activities are original examples informed by <a href="https://headstart.gov/school-readiness/article/math-preschool">Head Start’s preschool math guidance</a> and <a href="https://www.naeyc.org/node/2631">NAEYC’s playful math ideas</a>. Neither organization has reviewed or endorsed these activities. A six-year-old may need more challenge; choose by what your child is ready to explore.</p><p>Game connections and shared learner profiles are planned. These pages currently work as a standalone experience.</p></details></section>`,
    path,
    '/src/home.ts',
  );
}

export function lessonPage(path: LearningPath, activity: Activity): string {
  const index = path.activities.findIndex((item) => item.id === activity.id);
  const next = path.activities[index + 1];
  return shell(
    activity.title,
    `<div class="lesson-layout"><div class="lesson-heading"><a href="/">← All activities</a><span>${index + 1} of ${path.activities.length} · ${escapeHtml(activity.title)}</span></div><p id="lesson-version" class="small">Original learning path</p><div id="activity-root">${activityHtml(activity)}</div><nav class="lesson-nav" aria-label="Activity navigation"><a class="secondary" href="/">Choose another activity</a>${next ? `<a class="primary" href="/lessons/${next.id}/">Next activity →</a>` : '<a class="primary" href="/">Back to the learning path →</a>'}</nav><noscript><p>Interactive answers need JavaScript. You can still read the question, explore the choices, and open the grown-up notes together.</p></noscript></div>`,
    path,
    '/src/lesson.ts',
  );
}

/** A portable, non-executing document. All content is escaped; the data script is JSON only. */
export function portablePage(path: LearningPath, acceptedAt?: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(path.title)}</title><style>body{font:18px/1.6 system-ui;max-width:760px;margin:40px auto;padding:20px}article{margin:48px 0}li{margin:12px 0}</style></head><body><h1>${escapeHtml(path.title)}</h1><p>${escapeHtml(path.description)}</p><p>Baseline: ${path.id} ${path.version}. ${acceptedAt ? `Family introductions accepted ${escapeHtml(acceptedAt)}.` : 'Original version.'} Pilot material; educator review pending.</p>${path.activities.map((activity) => `<article data-learning-activity="${activity.id}" data-learning-interaction="single-choice"><h2>${escapeHtml(activity.title)}</h2><p>${escapeHtml(activity.introduction)}</p><h3>${escapeHtml(activity.prompt)}</h3><p>${activity.stimulus.map((token) => `${token.color} ${token.shape}`).join(', ')}</p><ul>${activity.options.map((option) => `<li data-learning-option="${option.id}">${escapeHtml(option.label)}</li>`).join('')}</ul><p><strong>Objective:</strong> ${escapeHtml(activity.objective)}</p><p><strong>Hint:</strong> ${escapeHtml(activity.hint)}</p><details><summary>Parent notes and answer</summary><p>${escapeHtml(activity.explanation)}</p><p>${escapeHtml(activity.parentNote)}</p><p>${escapeHtml(activity.offlineActivity)}</p></details></article>`).join('')}${learningScript(path)}</body></html>`;
}
