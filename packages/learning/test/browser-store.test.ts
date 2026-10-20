import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createBrowserStore,
  evidenceId,
  type LearningEvidence,
  newProfileId,
  type Profile,
  type ProgressStore,
} from '../src/index.ts';

let names = 0;
const stores: string[] = [];
/** A fresh database per test. */
function fresh(): { store: ProgressStore; name: string } {
  const name = `wwm-test-${names++}`;
  stores.push(name);
  return { store: createBrowserStore(name), name };
}
afterEach(() => {
  for (const name of stores.splice(0)) indexedDB.deleteDatabase(name);
});

const mia: Profile = { id: newProfileId(), nickname: 'Mia', avatar: 'pip-blue' };
const leo: Profile = { id: newProfileId(), nickname: 'Leo', avatar: 'pip-green', ageBand: 5 };

let clock = Date.parse('2026-10-19T17:00:00.000Z');
function event(profile: string, over: Partial<LearningEvidence> = {}): LearningEvidence {
  clock += 61_000;
  const now = clock;
  return {
    v: 1,
    id: evidenceId(now),
    profile,
    at: new Date(Math.floor(now / 60_000) * 60_000).toISOString(),
    activity: 'compare-groups',
    objective: 'compare-groups',
    round: 'fresh-1',
    item: (now.toString(16) + 'b'.repeat(32)).slice(0, 32),
    source: 'generator',
    fresh: true,
    outcome: 'first-try',
    helpLevel: 0,
    surface: 'lesson',
    input: 'tap',
    duration: 'lt30s',
    ...over,
  };
}

describe('browser progress store', () => {
  it('saves, lists, renames and validates profiles', async () => {
    const { store } = fresh();
    expect(await store.listProfiles()).toEqual([]);
    await store.saveProfile(mia);
    await store.saveProfile(leo);
    await store.saveProfile({ ...mia, nickname: 'Mimi', avatar: 'pip-red' });
    const listed = await store.listProfiles();
    expect(listed).toHaveLength(2);
    expect(listed).toContainEqual({ ...mia, nickname: 'Mimi', avatar: 'pip-red' });
    expect(listed).toContainEqual(leo);
    await expect(store.saveProfile({ ...mia, nickname: 'Mia <b>' })).rejects.toThrow();
    await expect(store.saveProfile({ ...mia, avatar: 'pip-purple' } as unknown as Profile)).rejects.toThrow();
  });

  it('remembers the active profile and the device token across store instances', async () => {
    const { store, name } = fresh();
    expect(await store.activeProfile()).toBeNull();
    expect(await store.deviceToken()).toBeNull();
    await store.setActiveProfile(mia.id);
    await store.setDeviceToken('token-123');
    const again = createBrowserStore(name);
    expect(await again.activeProfile()).toBe(mia.id);
    expect(await again.deviceToken()).toBe('token-123');
    await again.setActiveProfile(null);
    await again.setDeviceToken(null);
    expect(await again.activeProfile()).toBeNull();
    expect(await again.deviceToken()).toBeNull();
  });

  it('appends evidence with its outbox entry, idempotently by id', async () => {
    const { store } = fresh();
    await store.saveProfile(mia);
    const first = event(mia.id);
    const second = event(mia.id, { item: 'c'.repeat(32), outcome: 'after-retry', helpLevel: 2 });
    await store.appendEvidence(second);
    await store.appendEvidence(first);
    await store.appendEvidence(first);
    // oldest first (ids are UUIDv7), each once
    expect(await store.events(mia.id)).toEqual([first, second]);
    expect(await store.outbox(10)).toEqual([first, second]);
    expect(await store.outbox(1)).toEqual([first]);
    expect(await store.outbox(0)).toEqual([]);
    expect(await store.seenItems(mia.id)).toEqual(new Set([first.item, second.item]));
    expect(await store.seenItems(leo.id)).toEqual(new Set());

    // a synced event leaves the outbox and stays recorded; appending it again doesn't re-queue it
    await store.markSynced([first.id, 'not-in-the-outbox']);
    expect(await store.outbox(10)).toEqual([second]);
    await store.appendEvidence(first);
    expect(await store.outbox(10)).toEqual([second]);
    expect(await store.events(mia.id)).toEqual([first, second]);
  });

  it('rejects evidence that does not match the schema, writing nothing', async () => {
    const { store } = fresh();
    const bad = { ...event(mia.id), note: 'Mia was great' } as LearningEvidence;
    await expect(store.appendEvidence(bad)).rejects.toThrow();
    await expect(store.appendEvidence({ ...event(mia.id), helpLevel: 4 })).rejects.toThrow();
    expect(await store.events(mia.id)).toEqual([]);
    expect(await store.outbox(10)).toEqual([]);
  });

  it('deletes a profile with all of its events and outbox entries, and only those', async () => {
    const { store } = fresh();
    await store.saveProfile(mia);
    await store.saveProfile(leo);
    await store.setActiveProfile(mia.id);
    const mine = [event(mia.id), event(mia.id), event(mia.id)];
    const theirs = [event(leo.id), event(leo.id)];
    for (const item of [...mine, ...theirs]) await store.appendEvidence(item);
    await store.markSynced([mine[0]?.id ?? '']);
    await store.deleteProfile(mia.id);
    expect(await store.listProfiles()).toEqual([leo]);
    expect(await store.events(mia.id)).toEqual([]);
    expect(await store.seenItems(mia.id)).toEqual(new Set());
    expect(await store.outbox(100)).toEqual(theirs);
    expect(await store.exportAll()).toEqual({ profiles: [leo], events: theirs });
    // the deleted child is no longer the one playing
    expect(await store.activeProfile()).toBeNull();
    // deleting another profile leaves the active one alone
    await store.setActiveProfile(leo.id);
    await store.deleteProfile('no-such-profile-id');
    expect(await store.activeProfile()).toBe(leo.id);
  });

  it('exports everything and clears everything', async () => {
    const { store, name } = fresh();
    await store.saveProfile(mia);
    await store.saveProfile(leo);
    const a = event(mia.id);
    const b = event(leo.id);
    await store.appendEvidence(a);
    await store.appendEvidence(b);
    await store.setActiveProfile(leo.id);
    await store.setDeviceToken('token-123');
    const all = await store.exportAll();
    expect(all.profiles).toHaveLength(2);
    expect(all.events).toEqual([a, b]);
    await store.clear();
    const again = createBrowserStore(name);
    expect(await again.listProfiles()).toEqual([]);
    expect(await again.exportAll()).toEqual({ profiles: [], events: [] });
    expect(await again.outbox(100)).toEqual([]);
    expect(await again.activeProfile()).toBeNull();
    expect(await again.deviceToken()).toBeNull();
  });

  it('rejects every call when IndexedDB is unavailable (private browsing), and recovers when it returns', async () => {
    const original = globalThis.indexedDB;
    const name = `wwm-test-${names++}`;
    stores.push(name);
    const store = createBrowserStore(name);
    Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true });
    try {
      await expect(store.listProfiles()).rejects.toThrow('IndexedDB is unavailable.');
      await expect(store.appendEvidence(event(mia.id))).rejects.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', { value: original, configurable: true });
    }
    expect(await store.listProfiles()).toEqual([]);
  });
});
