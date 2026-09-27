import '@fontsource-variable/figtree';
import '@fontsource-variable/unbounded';
import '@wwm/learning/scene.css';
import './style.css';
import {
  applyDraft,
  baselinePath,
  createPersonalizationPrompt,
  defaultLevelId,
  type FamilySettings,
  learningScript,
  type PersonalizationDraft,
  parseDraft,
  resolveLevel,
} from '@wwm/learning';
import { escapeHtml, levelChoiceText, portablePage } from './render.ts';
import { download, element, FORK_KEY, readFamily, writeSettings } from './storage.ts';

let current = readFamily(baselinePath);
let pending: PersonalizationDraft | undefined;
const feedback = element('#parent-feedback');
const settingsState = element('#settings-state');
const tapOnly = element<HTMLInputElement>('#tap-only');

/** The Game settings block, from what this browser has saved (or the lessons' recommendations). */
function showSettings(message?: string): void {
  for (const activity of current.path.activities) {
    const chosen = resolveLevel(current.path, activity).id;
    for (const input of document.querySelectorAll<HTMLInputElement>(
      `input[name="level-${CSS.escape(activity.id)}"]`,
    ))
      input.checked = input.value === chosen;
    const summary = document.querySelector(
      `[data-activity="${CSS.escape(activity.id)}"] [data-level-current]`,
    );
    if (summary) summary.textContent = levelChoiceText(current.path, activity);
  }
  tapOnly.checked = current.settings?.tapOnly ?? false;
  element('#reset-settings').hidden = !current.settings && !current.settingsWarning;
  if (message) {
    settingsState.textContent = message;
    return;
  }
  if (current.settingsWarning) {
    settingsState.textContent = current.settingsWarning;
    return;
  }
  const changed = Object.keys(current.settings?.levels ?? {}).length;
  const levels =
    changed === 0
      ? 'Every lesson uses its recommended level.'
      : `${changed} ${changed === 1 ? 'lesson plays' : 'lessons play'} at a level you chose.`;
  settingsState.textContent = `${levels}${current.settings?.tapOnly ? ' Answering by tapping only.' : ''}`;
}

function refresh(settingsMessage?: string): void {
  current = readFamily(baselinePath);
  element('[data-path-title]').textContent = current.path.title;
  element('[data-path-description]').textContent = current.path.description;
  element('#saved-state').textContent =
    current.warning ??
    (current.fork ? 'Your family version is saved in this browser.' : 'Using the original learning path.');
  element('#reset-fork').hidden = !current.fork && !current.warning;
  element('#download-fork').hidden = !current.fork;
  element('#wwm-learning').outerHTML = learningScript(current.path);
  showSettings(settingsMessage);
}
refresh();

// ── game settings (Phase 22): stored apart from the family version, so restoring the original keeps them ───

function saveSettings(settings: FamilySettings | null, message: string): void {
  try {
    // nothing left to remember: forget the record rather than store the recommendations
    writeSettings(settings && (Object.keys(settings.levels).length || settings.tapOnly) ? settings : null);
    refresh(message);
  } catch {
    showSettings('This browser could not save your game settings. Try allowing browser storage.');
  }
}

element('.level-list').addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement;
  const activity = current.path.activities.find((candidate) => input.name === `level-${candidate.id}`);
  if (!activity || !input.checked) return;
  const levels = { ...(current.settings?.levels ?? {}) };
  if (input.value === defaultLevelId(activity)) delete levels[activity.id];
  else levels[activity.id] = input.value;
  const label = input.closest('label')?.querySelector('strong')?.textContent ?? input.value;
  saveSettings(
    { levels, tapOnly: current.settings?.tapOnly ?? false },
    `Saved. “${activity.title}” plays at ${label} in the game.`,
  );
});
tapOnly.addEventListener('change', () => {
  saveSettings(
    { levels: { ...(current.settings?.levels ?? {}) }, tapOnly: tapOnly.checked },
    tapOnly.checked
      ? 'Saved. Every lesson is answered by tapping; Pip won’t ask for keys.'
      : 'Saved. Pip may invite a key or the arrows again in some rounds.',
  );
});
element('#recommended-levels').addEventListener('click', () => {
  saveSettings(
    { levels: {}, tapOnly: current.settings?.tapOnly ?? false },
    'Every lesson now uses its recommended level.',
  );
});
element('#reset-settings').addEventListener('click', () => {
  saveSettings(
    null,
    'Game settings reset. Every lesson uses its recommended level, with every way to answer.',
  );
});

element<HTMLFormElement>('#prompt-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const interests = element<HTMLTextAreaElement>('#interests').value.trim();
  if (!interests) {
    feedback.textContent = 'Add an interest to personalize the introductions.';
    return;
  }
  element<HTMLTextAreaElement>('#ai-prompt').value = createPersonalizationPrompt(baselinePath, interests);
  element('#prompt-output').hidden = false;
  element('#ai-prompt').focus();
});

element('#copy-prompt').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(element<HTMLTextAreaElement>('#ai-prompt').value);
    feedback.textContent = 'Prompt copied. Bring the JSON response back below.';
  } catch {
    element<HTMLTextAreaElement>('#ai-prompt').select();
    feedback.textContent = 'Select and copy the prompt manually; clipboard access is unavailable.';
  }
});

element<HTMLFormElement>('#draft-form').addEventListener('submit', (event) => {
  event.preventDefault();
  pending = undefined;
  element('#draft-review').hidden = true;
  try {
    const raw = element<HTMLTextAreaElement>('#draft-json').value.trim();
    if (raw.length > 12000) throw new Error('Draft too large');
    const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const draft = parseDraft(JSON.parse(json), baselinePath);
    const proposed = applyDraft(baselinePath, draft);
    const changes = [
      { label: 'Path title', before: current.path.title, after: proposed.title },
      { label: 'Path introduction', before: current.path.description, after: proposed.description },
      ...proposed.activities.map((activity, index) => ({
        label: activity.title,
        before: current.path.activities[index]?.introduction ?? '',
        after: activity.introduction,
      })),
    ];
    element('#changes').innerHTML = changes
      .map(
        (change) =>
          `<div class="change"><h4>${escapeHtml(change.label)}</h4><p><strong>Current</strong> ${escapeHtml(change.before)}</p><p><strong>Proposed</strong> ${escapeHtml(change.after)}</p></div>`,
      )
      .join('');
    pending = draft;
    element('#draft-review').hidden = false;
    element('#review-heading').focus();
    feedback.textContent = 'Draft validated. Nothing changes until you accept it.';
  } catch {
    feedback.textContent =
      'This draft does not match the template. Keep the baseline ID and version, include all six introductions once, and remove extra fields. You can copy a fresh prompt above.';
  }
});

element('#accept-draft').addEventListener('click', () => {
  if (!pending) return;
  try {
    localStorage.setItem(FORK_KEY, JSON.stringify({ draft: pending, acceptedAt: new Date().toISOString() }));
    pending = undefined;
    element('#draft-review').hidden = true;
    refresh();
    feedback.textContent = 'Family version saved. Open any activity to try its new introduction.';
  } catch {
    feedback.textContent =
      'This browser could not save your version. Keep your JSON response and try again with browser storage enabled.';
  }
});

element('#discard-draft').addEventListener('click', () => {
  pending = undefined;
  element('#draft-review').hidden = true;
  feedback.textContent = 'Draft discarded. Your current path has not changed.';
});
element('#reset-fork').addEventListener('click', () => {
  try {
    localStorage.removeItem(FORK_KEY);
    pending = undefined;
    element('#draft-review').hidden = true;
    refresh();
    feedback.textContent = 'Original path restored. Your pasted draft remains available below.';
  } catch {
    feedback.textContent = 'This browser could not clear its saved version. Try allowing browser storage.';
  }
});
element('#download-path').addEventListener('click', () =>
  download('learning-path.html', portablePage(current.path, current.fork?.acceptedAt), 'text/html'),
);
element('#download-fork').addEventListener('click', () => {
  if (current.fork)
    download('family-version.json', JSON.stringify(current.fork.draft, null, 2), 'application/json');
});
