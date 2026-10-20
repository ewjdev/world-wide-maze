/**
 * The grown-ups' Progress page (Phase 31 M2): static HTML from scripts/generate.ts, plus the pieces
 * `progress.ts` renders from this device's store. Everything here is plain language about practice: one state
 * per objective, the last day it was practised, and something to try together. Never a score, percentage or
 * ranking.
 */
import {
  type Activity,
  AVATARS,
  type LearningPath,
  type ObjectiveProgress,
  type Profile,
  type ProgressState,
  type Theme,
} from '@wwm/learning';
import { holdButtonHtml } from './hold.ts';
import { AVATAR_LOOKS, type Avatar, avatarSvg } from './profiles.ts';
import { escapeHtml, shell } from './render.ts';

/** The parent copy for each state (plan §3; drafts pending educator review). */
export const STATE_COPY: Record<ProgressState, string> = {
  'not-started': 'Not tried yet',
  practising: 'Practising',
  'with-help': 'Getting there with help',
  'got-it': 'Got it on new examples',
};
/** What each state means, in the same plain words the rules use (evidence.ts, PROGRESS_RULES). */
export const STATE_MEANING: Record<ProgressState, string> = {
  'not-started': 'No rounds saved for this yet.',
  practising: 'Played, and the latest round went smoothly.',
  'with-help':
    'The latest round needed another try, the strategy or the worked example. That’s normal: help is part of learning.',
  'got-it': 'Solved new examples on the first try, with at most a nudge, on two different days.',
};
export const PRACTICE_NOTE = 'This shows practice, not a test or a grade.';
export const NICKNAME_HELP = 'A nickname is enough; please don’t use your child’s full name.';
export const DEVICE_ONLY = 'Saved on this device only.';
/** The JSON download's format marker. */
export const DEVICE_EXPORT_FORMAT = 'wwm-learning-device-export/1';

/** A lesson is listening practice when a round has a spoken word model to listen to (Spanish, spelling). */
export function isListening(activity: Activity): boolean {
  return activity.rounds.some((round) => round.practice);
}

/** "19 October 2026", on the family's calendar. */
export function practisedOn(at: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(new Date(at));
}

/** The activity that practises an objective (the first one on the path). */
function activityFor(path: LearningPath, objective: string): Activity | undefined {
  return path.activities.find((activity) => (activity.objectives ?? [activity.id]).includes(objective));
}

/** Pip colour choices for a form: picture radio cards, each with its colour name visible. */
export function avatarChoicesHtml(theme: Theme, name: string, checked: Avatar, legend: string): string {
  const options = AVATARS.map((avatar) => {
    const id = `${name}-${avatar}`;
    return `<label class="avatar-option" for="${escapeHtml(id)}"><input type="radio" id="${escapeHtml(id)}" name="${escapeHtml(name)}" value="${avatar}"${avatar === checked ? ' checked' : ''}>${avatarSvg(theme, avatar, 44)}<span>${AVATAR_LOOKS[avatar].name}</span></label>`;
  }).join('');
  return `<fieldset class="avatar-choices"><legend>${escapeHtml(legend)}</legend><div class="avatar-grid">${options}</div></fieldset>`;
}

/** One objective a child has practised: what it is, its state in words, when, and an idea for away from the screen. */
function objectiveRow(path: LearningPath, item: ObjectiveProgress, timeZone?: string): string {
  const activity = activityFor(path, item.objective);
  const statement = path.objectives?.find((objective) => objective.id === item.objective)?.statement;
  const title = activity?.title ?? item.objective;
  const link = activity
    ? `<a href="/lessons/${escapeHtml(activity.id)}/">${escapeHtml(title)}</a>`
    : escapeHtml(title);
  const listening = activity && isListening(activity) ? '<span class="tag">Listening practice</span>' : '';
  const when = item.lastAt
    ? `<p class="objective-when">Last practised ${escapeHtml(practisedOn(item.lastAt, timeZone))}</p>`
    : '';
  const offline = activity
    ? `<details class="try-together"><summary>Try together</summary><p>${escapeHtml(activity.offlineActivity)}</p></details>`
    : '';
  return `<li class="objective" data-objective="${escapeHtml(item.objective)}" data-state="${item.state}"><div class="objective-main"><h3>${link}</h3>${listening}${statement ? `<p class="objective-statement">${escapeHtml(statement)}</p>` : ''}</div><div class="objective-status"><p class="state" data-state="${item.state}">${STATE_COPY[item.state]}</p>${when}</div>${offline}</li>`;
}

/**
 * One child's section: what they practised (most recent first), the rest under "Not tried yet", and the
 * grown-up's edit and delete controls.
 */
export function childHtml(
  path: LearningPath,
  profile: Profile,
  progress: readonly ObjectiveProgress[],
  options: { timeZone?: string; picker: boolean },
): string {
  const id = escapeHtml(profile.id);
  const name = escapeHtml(profile.nickname);
  const practised = progress
    .filter((item) => item.state !== 'not-started')
    .sort((x, y) => (y.lastAt ?? '').localeCompare(x.lastAt ?? ''));
  const untried = progress.filter((item) => item.state === 'not-started');
  const last = practised[0]?.lastAt;
  const summary = last
    ? `Last practised ${escapeHtml(practisedOn(last, options.timeZone))}.`
    : options.picker
      ? `No practice saved yet. At the start of a lesson, ${name} taps their Pip.`
      : `No practice saved yet. Lessons on this device save practice for ${name}.`;
  const list = practised.length
    ? `<ul class="objectives">${practised.map((item) => objectiveRow(path, item, options.timeZone)).join('')}</ul>`
    : '';
  const notTried = untried.length
    ? `<details class="not-tried"${practised.length ? '' : ' open'}><summary>Not tried yet (${untried.length})</summary><ul>${untried
        .map((item) => {
          const activity = activityFor(path, item.objective);
          return `<li data-objective="${escapeHtml(item.objective)}" data-state="not-started">${activity ? `<a href="/lessons/${escapeHtml(activity.id)}/">${escapeHtml(activity.title)}</a>` : escapeHtml(item.objective)}${activity && isListening(activity) ? ' <span class="tag">Listening practice</span>' : ''}</li>`;
        })
        .join('')}</ul></details>`
    : '';
  return `<section class="child" data-profile="${id}" aria-labelledby="child-${id}">
    <div class="child-head">${avatarSvg(path.theme, profile.avatar, 56)}<div><h2 id="child-${id}">${name}</h2><p class="child-summary">${summary}</p></div></div>
    ${list}${notTried}
    <details class="child-edit"><summary>Change name or Pip</summary>
      <form class="profile-form" data-edit="${id}" novalidate>
        <label for="nickname-${id}">Nickname</label><p class="field-help" id="nickname-help-${id}">${escapeHtml(NICKNAME_HELP)}</p>
        <input type="text" id="nickname-${id}" name="nickname" maxlength="24" autocomplete="off" value="${name}" aria-describedby="nickname-help-${id} nickname-error-${id}" required>
        <p class="field-error" id="nickname-error-${id}" role="alert"></p>
        ${avatarChoicesHtml(path.theme, `avatar-${profile.id}`, profile.avatar, `${profile.nickname}’s Pip`)}
        <div class="button-row"><button class="primary" type="submit">Save changes</button><button class="secondary danger" type="button" data-delete="${id}">Delete ${name}</button></div>
        <div class="confirm" data-confirm="${id}" hidden><p>Delete ${name} and all of ${name}’s practice on this device? This can’t be undone.</p><div class="button-row"><button class="primary danger" type="button" data-confirm-delete="${id}">Delete ${name}</button><button class="secondary" type="button" data-cancel-delete="${id}">Keep ${name}</button></div></div>
      </form>
    </details>
  </section>`;
}

/** The meaning of each state, for grown-ups, plus what "listening practice" means. */
function stateKeyHtml(): string {
  const states = (Object.keys(STATE_COPY) as ProgressState[])
    .map(
      (state) =>
        `<div><dt><span class="state" data-state="${state}">${STATE_COPY[state]}</span></dt><dd>${escapeHtml(STATE_MEANING[state])}</dd></div>`,
    )
    .join('');
  return `<details class="state-key"><summary>What these mean</summary><dl>${states}<div><dt><span class="tag">Listening practice</span></dt><dd>Your child hears a word and taps a picture or letter. Saying it aloud is optional and is never recorded, so these rounds show listening, not speaking.</dd></div></dl><p class="small">The rules are a first draft and still need an educator’s review. Fresh examples are new pictures Pip draws for each play-through, so “Got it” means your child solved ones they hadn’t seen before.</p></details>`;
}

export function progressPage(path: LearningPath): string {
  return shell(
    'Progress',
    `<div class="progress-layout">
  <section class="progress-intro" aria-labelledby="progress-title">
    <h1 id="progress-title">Progress</h1>
    <p class="lead">What each child has practised in these lessons, in plain words, with something to try together next.</p>
    <p class="practice-note">${escapeHtml(PRACTICE_NOTE)} One play-through is practice, not mastery. There are no scores here.</p>
  </section>
  <div class="progress-gate" id="progress-gate">
    <p>Progress is for grown-ups.</p>
    ${holdButtonHtml('open-progress', 'Open Progress', 'secondary')}
  </div>
  <noscript><p class="small">Progress needs JavaScript: it reads what this browser saved.</p></noscript>
  <div class="progress-area" id="progress-area" hidden>
    <p class="save-state" id="device-status" role="status">${DEVICE_ONLY}</p>
    <!-- M3 SLOT: "Sign in to keep progress across devices" mounts here (apps/education/src/account*.ts). M2 leaves it empty. -->
    <div class="account-slot" id="account-slot" data-slot="account" hidden></div>
    <div class="progress-unavailable" id="progress-unavailable" hidden><h2>This browser isn’t saving progress</h2><p>It may be a private window, or site storage may be turned off. Lessons still work; nothing is saved. To keep practice, open the lessons in a normal window.</p></div>
    <div id="progress-content">
      <div id="children" class="children"></div>
      ${stateKeyHtml()}
      <details class="add-child" id="add-child-panel">
        <summary>Add a child</summary>
        <form id="add-child" class="profile-form" novalidate>
          <label for="new-nickname">Nickname</label><p class="field-help" id="new-nickname-help">${escapeHtml(NICKNAME_HELP)}</p>
          <input type="text" id="new-nickname" name="nickname" maxlength="24" autocomplete="off" aria-describedby="new-nickname-help new-nickname-error" required>
          <p class="field-error" id="new-nickname-error" role="alert"></p>
          ${avatarChoicesHtml(path.theme, 'new-avatar', 'pip-blue', 'Their Pip')}
          <p class="field-help">Children pick their Pip by picture at the start of a lesson when there’s more than one child.</p>
          <button class="primary" type="submit">Add child</button>
        </form>
      </details>
      <section class="device-data" aria-labelledby="device-heading">
        <h2 id="device-heading">On this device</h2>
        <p>Practice is kept in this browser only. Nothing is sent anywhere, and there is no account.</p>
        <div class="button-row"><button class="secondary" type="button" id="download-progress">Download progress (JSON)</button><button class="secondary danger" type="button" id="delete-progress">Delete progress on this device</button></div>
        <div class="confirm" id="delete-progress-confirm" hidden><p>Delete every child and all their practice in this browser? This can’t be undone. Download a copy first if you want to keep it.</p><div class="button-row"><button class="primary danger" type="button" id="confirm-delete-progress">Delete everything</button><button class="secondary" type="button" id="cancel-delete-progress">Keep it</button></div></div>
        <p class="device-feedback" id="device-feedback" role="status" aria-live="polite"></p>
      </section>
    </div>
  </div>
</div>`,
    path,
    '/src/progress.ts',
    { bodyClass: 'progress-page' },
  );
}
