import '@fontsource-variable/figtree';
import '@fontsource-variable/unbounded';
import './style.css';
import {
  applyDraft,
  baselinePath,
  createPersonalizationPrompt,
  learningScript,
  type PersonalizationDraft,
  parseDraft,
} from '@wwm/learning';
import { escapeHtml, portablePage } from './render.ts';
import { download, element, FORK_KEY, readFork } from './storage.ts';

let current = readFork(baselinePath);
let pending: PersonalizationDraft | undefined;
const feedback = element('#parent-feedback');

function refresh(): void {
  current = readFork(baselinePath);
  element('[data-path-title]').textContent = current.path.title;
  element('[data-path-description]').textContent = current.path.description;
  element('#saved-state').textContent =
    current.warning ??
    (current.fork ? 'Your family version is saved in this browser.' : 'Using the original learning path.');
  element('#reset-fork').hidden = !current.fork && !current.warning;
  element('#download-fork').hidden = !current.fork;
  element('#wwm-learning').outerHTML = learningScript(current.path);
}
refresh();

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
