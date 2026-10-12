import { guidedLearningScript, requiredRounds, rocketPath, sceneSvg, spriteMarkup } from '@wwm/learning';
import { escapeHtml, portablePage, sceneBlock } from './render.ts';

export function rocketPage(): string {
  const activity = rocketPath.activities[0];
  if (!activity) throw new Error('Rocket lesson is missing.');
  const p = rocketPath.theme;
  const round = activity.rounds[0];
  if (!round) throw new Error('Rocket round is missing.');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f8f8f8"><title>Pip’s Rocket Lab · WWM Learning</title></head><body class="lesson-page rocket-page">
<!-- THESIS: predict a push after seeing its cause. OWN-WORLD: WWM daylight, Figtree/Unbounded, geometric markers and silver Pip. STORY: watch air escape, reverse the opening, predict and transfer to a rocket. FIRST VIEWPORT: Pip beside the question, a large experiment, two illustrated choices and immediate help below. FORM: a focused lesson canvas extending the existing learning surface. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md -->
<main class="lesson-layout"><div class="lesson-bar"><a class="back" href="/">← All activities</a><h1 class="lesson-title">Pip’s Rocket Lab</h1><button id="mute" class="secondary" type="button" aria-pressed="false">Mute Pip</button></div>
<article class="activity" data-learning-activity="rocket-lab"><section id="intro" class="intro"><button class="pip-start" id="pip-start" type="button">${spriteMarkup(p, 'pip', 132)}<span class="pip-start-label">Tap Pip to start</span></button><p>Let some air out. Predict the push!</p><p class="small">Four discoveries together. One optional trip to space.</p></section>
<section id="stage" class="stage" aria-labelledby="prompt" hidden><div class="prompt-row"><button id="replay" class="pip-replay" type="button" aria-label="Watch or hear it again">${spriteMarkup(p, 'pip', 52)}</button><h2 id="prompt" class="prompt" tabindex="-1"></h2></div>${sceneBlock(p, activity, round, { orientation: 'wide', built: 0, enabled: false })}<p id="feedback" class="feedback" role="status" aria-live="polite"></p><div id="controls" class="controls"><button id="next" class="primary next" type="button" hidden>Continue</button><button id="hint" class="secondary helper" type="button">Help me</button><button id="bonus-play" class="primary" type="button" hidden>Try it in space</button><button id="bonus-skip" class="secondary" type="button" hidden>Finish</button></div><p id="experiment-status" class="small" role="status"></p></section>
<section id="end" class="end-card" aria-labelledby="end-heading" hidden>${spriteMarkup(p, 'pip', 94)}<h2 id="end-heading" tabindex="-1">You discovered the push!</h2><p id="finale">${escapeHtml(activity.finale)}</p><div class="end-actions"><button id="again" class="primary" type="button">Try it again</button><a class="secondary" href="/play/practice?learn=rocket-lab">Try it in the maze</a></div><div class="offline"><h3>For grown-ups: try a real balloon</h3><p>${escapeHtml(activity.offlineActivity)}</p></div></section></article>
<details class="rocket-notes"><summary>For grown-ups: the learning idea</summary><p>${escapeHtml(activity.parentNote)}</p><p>The pale puffs stand for invisible air. Every prediction starts from rest. The level string guides our balloon; real rockets do not need strings or nearby air.</p><button id="download-rocket" class="secondary" type="button">Download learning HTML</button><p class="small">A review pilot. Child and educator feedback is still needed.</p></details><noscript><p>${escapeHtml(activity.introduction)} ${escapeHtml(activity.demonstration?.text ?? '')}</p>${sceneSvg(p, round, { orientation: 'wide', planks: requiredRounds(activity), built: 0 })}<p>Read the explanation together, or enable JavaScript to try the predictions.</p></noscript></main>${guidedLearningScript(rocketPath)}<script type="module" src="/src/rocket.ts"></script></body></html>`;
}

export function rocketPortableHtml(): string {
  return portablePage(rocketPath).replace(
    '</body>',
    `<section><h2>Watch the push: before and after</h2>${rocketPath.activities[0]?.rounds.map((round) => `<h3>${escapeHtml(round.prompt)}</h3><p>Before: starts still.</p>${sceneSvg(rocketPath.theme, round, { orientation: 'wide', planks: 4, built: 0 })}<p>After: ${escapeHtml(round.success)}</p>${sceneSvg(rocketPath.theme, round, { orientation: 'wide', planks: 4, built: 0, experiment: 'after' })}`).join('') ?? ''}</section></body>`,
  );
}
