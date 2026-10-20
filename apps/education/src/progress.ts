/**
 * The grown-ups' Progress page (Phase 31 M2), behind the press-and-hold gate: each child's practice from this
 * device's store as one plain-language state per objective, profile management, a JSON download and deletion.
 * Nothing about a child leaves the device without a family account. The page asks the Worker whether one is
 * signed in; if so, `#account-slot` syncs (Phase 31 M3).
 */
import '@fontsource-variable/figtree';
import '@fontsource-variable/unbounded';
import '@wwm/learning/scene.css';
import './style.css';
import {
  AVATARS,
  baselinePath,
  newProfileId,
  objectiveProgress,
  type Profile,
  profileSchema,
  type SessionResponse,
} from '@wwm/learning';
import {
  accountSession,
  mountAccountSlot,
  progressEvents,
  pushProfile,
  removeProfile,
} from './account-sync.ts';
import { holdToActivate } from './hold.ts';
import { type Avatar, type DeviceProgress, openProgress, pickedThisVisit, rememberPick } from './profiles.ts';
import { childHtml, DEVICE_EXPORT_FORMAT, DEVICE_ONLY } from './progress-render.ts';
import { download, element, readFamily } from './storage.ts';

/** The gate opens once per visit (tab): a grown-up who held it doesn't hold again on reload. */
const OPEN_KEY = 'wwm-learning.progress-open';
const path = readFamily(baselinePath).path;
const objectives = (path.objectives ?? path.activities.map((activity) => ({ id: activity.id }))).map(
  (objective) => objective.id,
);
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const gate = element('#progress-gate');
const area = element('#progress-area');
const children = element('#children');
const addPanel = element<HTMLDetailsElement>('#add-child-panel');
const addForm = element<HTMLFormElement>('#add-child');
const deviceFeedback = element('#device-feedback');
let progress: DeviceProgress | null = null;
let profiles: Profile[] = [];

/** The family account, when signed in or linked (Phase 31 M3); null keeps everything on this device. */
let session: SessionResponse | null = null;
const byName = (x: Profile, y: Profile) => x.nickname.localeCompare(y.nickname) || x.id.localeCompare(y.id);

/** A friendly message for a nickname the profile schema rejects. */
function nicknameProblem(nickname: string): string | null {
  const trimmed = nickname.trim();
  if (!trimmed) return 'Add a nickname.';
  if (trimmed.length > 24) return 'Use 24 characters or fewer.';
  const result = profileSchema.shape.nickname.safeParse(trimmed);
  return result.success ? null : 'Use letters, spaces, apostrophes and hyphens only.';
}

/** The first Pip colour no child has yet (so a new child gets a distinct one by default). */
function freeAvatar(): Avatar {
  return AVATARS.find((avatar) => !profiles.some((profile) => profile.avatar === avatar)) ?? AVATARS[0];
}

function selectAvatar(form: HTMLFormElement, name: string, avatar: Avatar): void {
  for (const input of form.querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(name)}"]`))
    input.checked = input.value === avatar;
}

function readForm(form: HTMLFormElement, avatarName: string): { nickname: string; avatar: Avatar } {
  const nickname = form.querySelector<HTMLInputElement>('input[name="nickname"]')?.value ?? '';
  const avatar = form.querySelector<HTMLInputElement>(
    `input[name="${CSS.escape(avatarName)}"]:checked`,
  )?.value;
  return {
    nickname: nickname.trim(),
    avatar: (AVATARS as readonly string[]).includes(avatar ?? '') ? (avatar as Avatar) : freeAvatar(),
  };
}

function showError(form: HTMLFormElement, message: string | null): void {
  const input = form.querySelector<HTMLInputElement>('input[name="nickname"]');
  const error = form.querySelector<HTMLElement>('.field-error');
  if (error) error.textContent = message ?? '';
  input?.setAttribute('aria-invalid', String(!!message));
  if (message) input?.focus();
}

async function render(message?: string): Promise<void> {
  if (!progress) return;
  const store = progress.store;
  try {
    profiles = (await store.listProfiles()).sort(byName);
    const sections = await Promise.all(
      profiles.map(async (profile) =>
        childHtml(
          path,
          profile,
          objectiveProgress(await progressEvents(store, profile.id, session), objectives, { timeZone }),
          {
            timeZone,
            picker: profiles.length > 1,
          },
        ),
      ),
    );
    children.innerHTML = sections.join('');
    children.hidden = !profiles.length;
    addPanel.open = !profiles.length;
    selectAvatar(addForm, 'new-avatar', freeAvatar());
    element<HTMLButtonElement>('#download-progress').disabled = !profiles.length;
    const saved =
      session?.as === 'parent'
        ? 'Saved on this device and in your family account.'
        : session?.as === 'device'
          ? 'Saved on this device and sent to your family account.'
          : DEVICE_ONLY;
    element('#device-status').textContent = profiles.length
      ? saved
      : `${saved} No children added yet: add a nickname below to start saving practice. Lessons work without one, and then nothing is saved.`;
    if (message !== undefined) deviceFeedback.textContent = message;
  } catch {
    unavailable();
  }
}

function unavailable(): void {
  progress = null;
  element('#progress-unavailable').hidden = false;
  element('#progress-content').hidden = true;
  element('#device-status').hidden = true;
}

async function open(): Promise<void> {
  gate.hidden = true;
  area.hidden = false;
  try {
    sessionStorage.setItem(OPEN_KEY, '1');
  } catch {
    // storage unavailable: the gate shows again next visit
  }
  progress = await openProgress();
  if (!progress) {
    unavailable();
    return;
  }
  session = await accountSession();
  await render();
  element<HTMLHeadingElement>('#progress-title').scrollIntoView({ block: 'nearest' });
  // Signed in: sync once, then redraw with every device's practice.
  void mountAccountSlot(element('#account-slot'), progress.store, () => void render());
}

// ── adding, editing and deleting children ─────────────────────────────────────────────────────────────────

addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!progress) return;
  const { nickname, avatar } = readForm(addForm, 'new-avatar');
  const problem = nicknameProblem(nickname);
  showError(addForm, problem);
  if (problem) return;
  try {
    const profile = { id: newProfileId(), nickname, avatar };
    await progress.store.saveProfile(profile);
    void pushProfile(profile);
    addForm.reset();
    await render(`Added ${nickname}. Practice in lessons on this device is now saved for ${nickname}.`);
  } catch {
    showError(
      addForm,
      'This browser couldn’t save the child. Try again, or check that site storage is allowed.',
    );
  }
});

children.addEventListener('submit', async (event) => {
  const form = event.target as HTMLFormElement;
  const id = form.dataset.edit;
  const profile = profiles.find((candidate) => candidate.id === id);
  if (!profile || !progress) return;
  event.preventDefault();
  const { nickname, avatar } = readForm(form, `avatar-${profile.id}`);
  const problem = nicknameProblem(nickname);
  showError(form, problem);
  if (problem) return;
  try {
    await progress.store.saveProfile({ ...profile, nickname, avatar });
    void pushProfile({ ...profile, nickname, avatar });
    await render(`Saved ${nickname}’s changes.`);
  } catch {
    showError(form, 'This browser couldn’t save the change. Try again.');
  }
});

children.addEventListener('click', async (event) => {
  const target = event.target as Element;
  const button = target.closest<HTMLButtonElement>(
    '[data-delete], [data-confirm-delete], [data-cancel-delete]',
  );
  if (!button || !progress) return;
  const id = button.dataset.delete ?? button.dataset.confirmDelete ?? button.dataset.cancelDelete ?? '';
  const confirm = children.querySelector<HTMLElement>(`[data-confirm="${CSS.escape(id)}"]`);
  const profile = profiles.find((candidate) => candidate.id === id);
  if (!confirm || !profile) return;
  if (button.dataset.delete !== undefined) {
    confirm.hidden = false;
    confirm.querySelector<HTMLButtonElement>('[data-cancel-delete]')?.focus();
  } else if (button.dataset.cancelDelete !== undefined) {
    confirm.hidden = true;
    children.querySelector<HTMLButtonElement>(`[data-delete="${CSS.escape(id)}"]`)?.focus();
  } else {
    try {
      await progress.store.deleteProfile(id);
      void removeProfile(id);
      if (pickedThisVisit() === id) rememberPick(null);
      await render(`Deleted ${profile.nickname} and their practice from this device.`);
      deviceFeedback.focus();
    } catch {
      deviceFeedback.textContent = 'This browser couldn’t delete that. Try again.';
    }
  }
});

// ── the whole device: download and delete ─────────────────────────────────────────────────────────────────

element('#download-progress').addEventListener('click', async () => {
  if (!progress) return;
  try {
    const all = await progress.store.exportAll();
    const file = {
      format: DEVICE_EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      savedOn: 'this device only',
      ...all,
    };
    download('wwm-learning-progress.json', JSON.stringify(file, null, 2), 'application/json');
    deviceFeedback.textContent =
      'Downloaded. The file holds nicknames, Pip colours and practice rounds; keep it private.';
  } catch {
    deviceFeedback.textContent = 'This browser couldn’t read the saved progress.';
  }
});

const confirmAll = element('#delete-progress-confirm');
element('#delete-progress').addEventListener('click', () => {
  confirmAll.hidden = false;
  element('#cancel-delete-progress').focus();
});
element('#cancel-delete-progress').addEventListener('click', () => {
  confirmAll.hidden = true;
  element('#delete-progress').focus();
});
element('#confirm-delete-progress').addEventListener('click', async () => {
  if (!progress) return;
  try {
    await progress.store.clear();
    rememberPick(null);
    confirmAll.hidden = true;
    await render('Deleted every child and all practice saved on this device.');
    deviceFeedback.focus();
  } catch {
    deviceFeedback.textContent = 'This browser couldn’t delete the saved progress. Try again.';
  }
});

// ── the grown-up gate ─────────────────────────────────────────────────────────────────────────────────────

deviceFeedback.tabIndex = -1;
let wasOpen = false;
try {
  wasOpen = sessionStorage.getItem(OPEN_KEY) === '1';
} catch {
  wasOpen = false;
}
if (wasOpen) void open();
else holdToActivate(element<HTMLButtonElement>('#open-progress'), () => void open());
