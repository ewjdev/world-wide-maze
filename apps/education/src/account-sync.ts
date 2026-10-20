/**
 * The family account, as the rest of the education app uses it (Phase 31 M3). M2's Progress page calls these;
 * every function is safe without an account (it falls back to this device's own records) and never throws for
 * "not signed in", "offline" or "accounts are off here".
 *
 *   mountAccountSlot(slot, store)   fills the Progress page's `#account-slot` ("Sign in to keep progress across
 *                                   devices", or who is signed in) and syncs once when signed in
 *   syncNow(store)                  uploads missing local profiles (parent), pulls the family's profiles, sends
 *                                   the outbox
 *   progressProfiles(store)         this device's profiles plus the family's (signed-in parent or linked device)
 *   progressEvents(store, profile)  a signed-in parent: the family's events from the server merged with this
 *                                   device's unsent ones; otherwise this device's events
 *   pushProfile / removeProfile     mirror a profile edit or deletion to the family's records (parent only)
 */
import {
  createSyncClient,
  LearningApiError,
  type LearningEvidence,
  type Profile,
  type ProgressStore,
  type SessionResponse,
  type SyncResult,
  syncOutbox,
} from '@wwm/learning';
import { readDeviceToken } from './account-store.ts';

export const learningApi = createSyncClient({ deviceToken: readDeviceToken });

/** Where the account page lives, under the app's base (`/` in dev, `/learn/` when published). */
export function accountUrl(hash = ''): string {
  return `${import.meta.env.BASE_URL}account/${hash}`;
}

/** The current session, or null when accounts are unavailable here or the network is down. */
export async function accountSession(): Promise<SessionResponse | null> {
  try {
    return await learningApi.session();
  } catch {
    return null;
  }
}

const byId = <T extends { id: string }>(items: T[]) => new Map(items.map((item) => [item.id, item]));

/**
 * Bring this device and the family's records together. Returns null when there is nothing to sync with (no
 * account, accounts off, offline before the first request, or no store on this device).
 */
export async function syncNow(
  store: ProgressStore | null,
  session?: SessionResponse | null,
): Promise<(SyncResult & { profiles: number }) | null> {
  if (!store) return null;
  const current = session === undefined ? await accountSession() : session;
  if (!current?.signedIn || !current.family) return null;
  try {
    const local = await store.listProfiles();
    const remote = byId(current.family.profiles);
    let uploaded = 0;
    if (current.as === 'parent') {
      // Each local child goes up with its own id, so the evidence already recorded keeps pointing at it.
      for (const profile of local)
        if (!remote.has(profile.id)) {
          await learningApi.saveProfile(profile);
          uploaded++;
        }
    }
    const here = byId(local);
    for (const profile of current.family.profiles)
      if (!here.has(profile.id)) await store.saveProfile(profile);
    const result = await syncOutbox(store, learningApi);
    return { ...result, profiles: uploaded };
  } catch (e) {
    if (e instanceof LearningApiError)
      return { status: 'error', accepted: 0, duplicate: 0, rejected: [], profiles: 0 };
    throw e;
  }
}

/** This device's children plus the family's (when signed in), sorted by nickname. */
export async function progressProfiles(store: ProgressStore | null): Promise<Profile[]> {
  const local = store ? await store.listProfiles() : [];
  const session = await accountSession();
  const merged = byId(local);
  for (const profile of session?.family?.profiles ?? [])
    if (!merged.has(profile.id)) merged.set(profile.id, profile);
  return [...merged.values()].sort(
    (x, y) => x.nickname.localeCompare(y.nickname) || x.id.localeCompare(y.id),
  );
}

/**
 * The events the Progress page should show for one child. A signed-in parent sees every device's events (from
 * the server) plus anything this device hasn't sent yet; otherwise, this device's own events.
 */
export async function progressEvents(
  store: ProgressStore | null,
  profile: string,
): Promise<LearningEvidence[]> {
  const local = store ? await store.events(profile) : [];
  const session = await accountSession();
  if (session?.as !== 'parent') return local;
  try {
    const merged = byId(await learningApi.allEvents(profile));
    for (const event of local) if (!merged.has(event.id)) merged.set(event.id, event);
    return [...merged.values()].sort((x, y) => x.at.localeCompare(y.at) || x.id.localeCompare(y.id));
  } catch {
    return local;
  }
}

/** Mirror a new or edited profile to the family's records (signed-in parent only; otherwise a no-op). */
export async function pushProfile(profile: Profile): Promise<boolean> {
  const session = await accountSession();
  if (session?.as !== 'parent') return false;
  try {
    await learningApi.saveProfile(profile);
    return true;
  } catch {
    return false;
  }
}

/** Delete a profile (and its events) from the family's records too (signed-in parent only). */
export async function removeProfile(id: string): Promise<boolean> {
  const session = await accountSession();
  if (session?.as !== 'parent') return false;
  try {
    await learningApi.deleteProfile(id);
    return true;
  } catch (e) {
    return e instanceof LearningApiError && e.code === 'LEARNING_NOT_FOUND';
  }
}

function paragraph(text: string, className?: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.textContent = text;
  if (className) p.className = className;
  return p;
}
function link(text: string, href: string, className = 'secondary'): HTMLAnchorElement {
  const a = document.createElement('a');
  a.textContent = text;
  a.href = href;
  a.className = className;
  return a;
}

/**
 * Fill the Progress page's account slot. Stays hidden where accounts are off. When signed in, syncs this
 * device once and calls `onSynced` (so the page can redraw with the family's events).
 */
export async function mountAccountSlot(
  slot: HTMLElement,
  store: ProgressStore | null,
  onSynced?: (result: Awaited<ReturnType<typeof syncNow>>) => void,
): Promise<void> {
  const session = await accountSession();
  slot.replaceChildren();
  if (!session) {
    slot.hidden = true;
    return;
  }
  slot.hidden = false;
  if (!session.signedIn) {
    slot.append(
      paragraph('Sign in to keep progress across devices.', 'account-slot-title'),
      paragraph(
        'A free family account keeps each child’s practice when they play on another tablet or phone. Optional.',
        'field-help',
      ),
      link('Sign in or create a family account', accountUrl()),
    );
    return;
  }
  const status = paragraph(
    session.as === 'parent'
      ? 'Signed in. Progress here includes practice from all your family’s devices.'
      : `This device is linked to your family${session.device ? ` as “${session.device.label}”` : ''}.`,
    'account-slot-title',
  );
  const detail = paragraph('Sending this device’s practice…', 'field-help');
  slot.append(status, detail, link('Family account', accountUrl()));
  const result = await syncNow(store, session).catch(() => null);
  detail.textContent = !result
    ? store
      ? 'Couldn’t reach your family’s records just now. Practice stays on this device and is sent later.'
      : 'This browser isn’t saving practice, so there is nothing to send from here.'
    : result.status === 'done'
      ? 'Up to date.'
      : 'Some practice is still waiting to be sent. It stays on this device until then.';
  onSynced?.(result);
}
