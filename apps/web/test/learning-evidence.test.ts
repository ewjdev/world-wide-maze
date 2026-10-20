/**
 * Phase 31 M5: the maze records the same learning evidence as the lesson page. Who's playing (players.ts, the M2
 * rules), fresh examples drawn by `expandActivity` for the child playing, one `LearningEvidence` per solved gate
 * round with `surface: 'maze'` and the real input, the picker, failing soft without IndexedDB, and the proof that
 * falls, respawns, items, missions, locks, overrides, maze time and score never produce or change evidence.
 *
 * The store is the real `createBrowserStore` over fake-indexeddb, the same code the lesson page and Progress use.
 */
import { readFileSync } from 'node:fs';
import {
  type Activity,
  AVATARS,
  baselinePath,
  createBrowserStore,
  evidenceSchema,
  type LearningEvidence,
  type LearningPath,
  objectiveProgress,
  type Profile,
  type ProgressStore,
  parseLearningPath,
} from '@wwm/learning';
import type { StageData } from '@wwm/schema';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { avatarSvg } from '../src/learning/avatars.ts';
import { LearningGates } from '../src/learning/gates.ts';
import { type LoadedLesson, lessonFromBaseline } from '../src/learning/load.ts';
import { MAX_STEP_SPOTS } from '../src/learning/locks.ts';
import { choosePlayer, listPlayers, PICKED_KEY } from '../src/learning/players.ts';

const HANDMADE = JSON.parse(
  readFileSync(new URL('../../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
) as StageData;

class MemoryStorage {
  #m = new Map<string, string>();
  getItem(k: string) {
    return this.#m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.#m.set(k, String(v));
  }
  removeItem(k: string) {
    this.#m.delete(k);
  }
  clear() {
    this.#m.clear();
  }
}

const ANA: Profile = { id: 'ana-0000000000000001', nickname: 'Ana', avatar: 'pip-teal' };
const BO: Profile = { id: 'bo-00000000000000002', nickname: 'Bo', avatar: 'pip-yellow' };
const AT = Date.UTC(2026, 9, 19, 17, 30, 12);

let session: MemoryStorage;
/** A fresh, empty IndexedDB for this origin. */
function freshIdb() {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
}
beforeEach(() => {
  freshIdb();
  session = new MemoryStorage();
  vi.stubGlobal('sessionStorage', session);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const silent = () => ({
  play: async () => {},
  stop: () => {},
  unlock: () => {},
  preload: () => {},
  sourceFor: () => 'silent' as const,
});

async function storeWith(...profiles: Profile[]): Promise<ProgressStore> {
  const store = createBrowserStore();
  for (const p of profiles) await store.saveProfile(p);
  return store;
}

function game(
  store: ProgressStore | null,
  opts: {
    lesson?: LoadedLesson;
    level?: string;
    muted?: boolean;
    greet?: (t: string) => void;
    /** The wall clock follows `tick` (default: pinned at AT, so maze time can't show in `at`). */
    wallTicks?: boolean;
  } = {},
) {
  let clock = 0;
  const g = new LearningGates({
    muted: () => opts.muted ?? true,
    onClose: () => {},
    voice: silent,
    seed: () => 0,
    now: () => clock,
    clock: () => (opts.wallTicks ? AT + clock : AT),
    store: () => store,
    device: () => ({ keyboard: true, tilt: true }),
    ...(opts.greet ? { greet: opts.greet } : {}),
  });
  g.use(opts.lesson ?? lessonFromBaseline('compare-groups'));
  if (opts.level) g.setLevel(opts.level);
  const tick = (ms: number) => {
    clock += ms;
  };
  /** What the game does once the stage is built: decorate it and make it ready. */
  const build = () => {
    const stage = g.decorate(HANDMADE);
    g.stageReady(stage);
    return stage;
  };
  const portalOf = (step: number) => {
    const id = g.debug().binding?.steps.find((s) => s.index === step)?.portalId;
    if (id === null || id === undefined) throw new Error(`step ${step} has no gate`);
    return id;
  };
  const answer = () => String(g.getView().gate?.round.answer);
  return { g, tick, build, portalOf, answer };
}

const strip = ({ id: _id, ...rest }: LearningEvidence) => rest;
/** Events in play order (their ids share the pinned clock's millisecond, so they don't sort by time here). */
const ORDER = ['r1', 'r2', 'r3', 'r3b', 'r4', 'fresh-1', 'fresh-2', 'r5', 'r5b'];
const inPlayOrder = (events: LearningEvidence[]) =>
  [...events].sort((x, y) => ORDER.indexOf(x.round) - ORDER.indexOf(y.round));

describe('who’s playing (players.ts, the lesson page’s rules)', () => {
  test('no store or no children: nobody plays and nothing is asked', async () => {
    expect(await choosePlayer(null)).toEqual({ kind: 'none' });
    expect(await choosePlayer(await storeWith())).toEqual({ kind: 'none' });
  });

  test('a store that never answers counts as none after the timeout', async () => {
    const stuck = { listProfiles: () => new Promise<Profile[]>(() => {}) } as unknown as ProgressStore;
    expect(await listPlayers(stuck, 10)).toBeNull();
    expect(await choosePlayer(stuck, { timeoutMs: 10 })).toEqual({ kind: 'none' });
  });

  test('one child is chosen silently and made active', async () => {
    const store = await storeWith(ANA);
    expect(await choosePlayer(store)).toMatchObject({ kind: 'player', player: ANA });
    await vi.waitFor(async () => expect(await store.activeProfile()).toBe(ANA.id));
  });

  test('two children: the picker, unless one was picked in this tab and is the active profile', async () => {
    const store = await storeWith(BO, ANA);
    const ask = await choosePlayer(store);
    expect(ask).toEqual({ kind: 'ask', profiles: [ANA, BO] }); // by nickname
    session.setItem(PICKED_KEY, BO.id);
    expect((await choosePlayer(store)).kind).toBe('ask'); // picked here, but another child is active
    await store.setActiveProfile(BO.id);
    expect(await choosePlayer(store)).toMatchObject({ kind: 'player', player: BO });
    expect((await choosePlayer(store, { again: true })).kind).toBe('ask');
  });

  test('avatars are drawn exactly as the lesson page draws them (the port matches apps/education)', async () => {
    const education = (await import(
      /* @vite-ignore */ new URL('../../education/src/profiles.ts', import.meta.url).href
    )) as { avatarSvg: typeof avatarSvg };
    for (const avatar of AVATARS)
      for (const size of [26, 112])
        expect(avatarSvg(baselinePath.theme, avatar, size)).toBe(
          education.avatarSvg(baselinePath.theme, avatar, size),
        );
  });
});

describe('fresh examples in the maze', () => {
  test('rounds levels gain the fresh rounds; the gates, locks and HUD follow', async () => {
    const { g, build } = game(await storeWith());
    expect(g.debug().rounds).toEqual(['r1', 'r2', 'r3', 'r3b', 'r4', 'r5', 'r5b']); // before the draw
    await g.ready();
    expect(g.debug().rounds).toEqual(['r1', 'r2', 'r3', 'r3b', 'r4', 'fresh-1', 'fresh-2', 'r5', 'r5b']);
    expect(g.debug().fresh).toEqual(['fresh-1', 'fresh-2']);
    build();
    const steps = g.debug().binding?.steps ?? [];
    // 6 required rounds: within the 8 gate spots, so every one gets a gate
    expect(steps.map((s) => [s.kind, s.portalId !== null])).toEqual(
      Array.from({ length: 6 }, () => ['round', true]),
    );
    expect(steps.length).toBeLessThanOrEqual(MAX_STEP_SPOTS);
    expect(g.getView().steps).toHaveLength(6);
    expect(g.needsStartCard()).toBe(false);
  });

  test('an explicit step list (the mission level) leaves the fresh rounds out, by design', async () => {
    const { g, build } = game(await storeWith(), { level: 'mission' });
    await g.ready();
    build();
    expect(g.debug().rounds).toContain('fresh-1');
    const rounds = g.debug().binding?.steps.filter((s) => s.kind === 'round') ?? [];
    expect(rounds).toHaveLength(4);
  });

  test('a fresh round plays like any other round on its gate', async () => {
    const { g, build, portalOf, answer } = game(await storeWith());
    await g.ready();
    build();
    expect(g.open(portalOf(4))).toBe(true);
    expect(g.getView().gate?.round.id).toBe('fresh-1');
    expect(g.getView().gate?.round.prompt).toBeTruthy();
    g.answer(answer());
    expect(g.getView().gate?.state.solved).toBe(true);
  });

  test('a new play-through draws again, preferring items this child hasn’t met', async () => {
    const store = await storeWith(ANA);
    const { g, build, portalOf, answer } = game(store);
    await g.ready();
    build();
    const first = g.lesson?.activity.rounds.filter((r) => r.id.startsWith('fresh-'));
    for (const step of [4, 5]) {
      g.open(portalOf(step));
      g.answer(answer());
      g.proceed();
    }
    await g.settled();
    g.resetProgress(); // a new game
    await g.ready();
    const second = g.lesson?.activity.rounds.filter((r) => r.id.startsWith('fresh-'));
    expect(second).toHaveLength(2);
    expect(JSON.stringify(second)).not.toBe(JSON.stringify(first));
    const events = await store.events(ANA.id);
    const seen = new Set(events.map((e) => e.item));
    build();
    g.open(portalOf(4));
    g.answer(answer());
    await g.settled();
    const fresh = (await store.events(ANA.id)).filter((e) => !seen.has(e.item));
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({ round: 'fresh-1', fresh: true, source: 'generator' });
  });

  test('more required steps than gate spots: the overflow rounds are asked on the stage-start card', async () => {
    // 8 written required rounds + 2 fresh = 10 steps for 8 gate spots
    const path = structuredClone(baselinePath) as LearningPath;
    const a = path.activities.find((x) => x.id === 'compare-groups') as Activity;
    const base = a.rounds.filter((r) => ['r1', 'r2', 'r3', 'r4'].includes(r.id));
    a.rounds = [...base, ...base.map((r, i) => ({ ...r, id: `c${i + 5}` }))];
    const parsed = parseLearningPath(path);
    const lesson = {
      path: parsed,
      activity: parsed.activities.find((x) => x.id === 'compare-groups') as Activity,
      source: { kind: 'baseline' as const },
    };
    const store = await storeWith(ANA);
    const { g, build, answer } = game(store, { lesson, level: 'explore' });
    await g.ready();
    build();
    const steps = g.debug().binding?.steps ?? [];
    expect(steps).toHaveLength(10);
    expect(steps.filter((s) => s.portalId !== null)).toHaveLength(MAX_STEP_SPOTS);
    expect(g.needsStartCard()).toBe(true);
    // the start card asks the first round without a gate: a fresh round
    expect(g.open(-1)).toBe(true);
    expect(g.getView().gate?.round.id).toBe('fresh-1');
    g.answer(answer());
    await g.settled();
    expect(await store.events(ANA.id)).toEqual([
      expect.objectContaining({ round: 'fresh-1', source: 'generator', surface: 'maze' }),
    ]);
  });
});

describe('evidence from the maze', () => {
  test('one child: each solved gate round is one maze event, with the real input and the card time', async () => {
    const store = await storeWith(ANA);
    // a moving wall clock, so the Progress model sees the rounds in the order they were played
    const { g, build, portalOf, answer, tick } = game(store, { wallTicks: true });
    await g.ready();
    expect(g.getView()).toMatchObject({ picker: null, player: { nickname: 'Ana' }, canSwitch: false });
    build();
    // gate 1 (r1): wrong by the arrows, the match tool, then right by the arrows, 12 s on the card
    g.open(portalOf(0));
    tick(5_000);
    g.answer('a', 'arrows');
    g.match();
    tick(7_000);
    g.answer('b', 'arrows');
    g.proceed();
    tick(90_000); // rolling around the maze: not card time
    // gate 2 (r2): a letter key, first try
    g.open(portalOf(1));
    tick(2_000);
    g.key({ code: 'KeyA', target: null, repeat: false, preventDefault() {} } as unknown as KeyboardEvent);
    g.proceed();
    // gate 5 (fresh-1): a phone's JUMP on the tilt cursor
    tick(30_000);
    g.open(portalOf(4));
    const choice = g.getView().gate?.choices.indexOf(answer()) ?? 0;
    for (let i = 0; i <= choice; i++) {
      g.input(1, false, 'phone', 1_000_000 + i * 2000);
      g.input(0, false, 'phone', 1_000_500 + i * 2000);
    }
    g.input(0, true, 'phone', 1_100_000);
    expect(g.getView().gate?.state.solved).toBe(true);
    await g.settled();
    const events = await store.events(ANA.id);
    expect(events.map((e) => evidenceSchema.parse(e))).toHaveLength(3);
    const [r1, r2, f1] = inPlayOrder(events);
    expect(r1).toMatchObject({
      profile: ANA.id,
      activity: 'compare-groups',
      objective: 'compare-groups',
      round: 'r1',
      source: 'lesson',
      fresh: true,
      outcome: 'after-retry',
      helpLevel: 2,
      surface: 'maze',
      input: 'arrows',
      duration: 'lt30s',
      at: '2026-10-19T17:30:00.000Z',
    });
    expect(r2).toMatchObject({ round: 'r2', outcome: 'first-try', helpLevel: 0, input: 'letter-key' });
    expect(r2?.duration).toBe('lt10s');
    expect(f1).toMatchObject({ round: 'fresh-1', source: 'generator', fresh: true, input: 'tilt' });
    // the item is the content hash the lesson page records for the same round
    expect(r1?.item).toMatch(/^[a-f0-9]{32}$/);
    // and the outbox holds them for a later sync
    expect(await store.outbox(10)).toHaveLength(3);
    // the Progress page's model reads them
    const progress = objectiveProgress(events, ['compare-groups'], { timeZone: 'UTC' });
    expect(progress[0]).toMatchObject({ objective: 'compare-groups', rounds: 3, state: 'practising' });
    expect(g.debug().evidence).toEqual({ saved: 3, unsaved: 0 });
  });

  test('a tap and a number key are recorded as such; follow-ups and the bonus count as rounds', async () => {
    const store = await storeWith(ANA);
    const { g, build, portalOf, answer } = game(store);
    await g.ready();
    build();
    g.open(portalOf(2)); // r3: needs the strategy, so its follow-up r3b comes next on the same card
    g.hint();
    g.hint();
    g.tap(answer());
    expect(g.getView().gate?.next).toBe('follow-up');
    g.proceed();
    expect(g.getView().gate?.round.id).toBe('r3b');
    const digit = g.getView().gate?.choices.indexOf(answer()) ?? 0;
    // a number key the round doesn't invite: Pip nudges twice, then takes it
    for (let i = 0; i < 3; i++)
      g.key({
        code: `Digit${digit + 1}`,
        target: null,
        repeat: false,
        preventDefault() {},
      } as unknown as KeyboardEvent);
    expect(g.getView().gate?.state.solved).toBe(true);
    await g.settled();
    const events = inPlayOrder(await store.events(ANA.id));
    expect(events.map((e) => [e.round, e.input, e.helpLevel])).toEqual([
      ['r3', 'tap', 2],
      ['r3b', 'number-key', 0],
    ]);
  });

  test('zero children: the lesson plays (fresh rounds too) and nothing is recorded', async () => {
    const store = await storeWith();
    const { g, build, portalOf, answer } = game(store);
    await g.ready();
    expect(g.getView()).toMatchObject({ picker: null, player: null, canSwitch: false });
    build();
    for (const step of [0, 4]) {
      g.open(portalOf(step));
      g.answer(answer());
      g.proceed();
    }
    await g.settled();
    expect(await store.exportAll()).toEqual({ profiles: [], events: [] });
    expect(g.debug().player).toBe('none');
  });

  test('no IndexedDB, or a store that fails: play goes on and nothing breaks', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const { g, build, portalOf, answer } = game(createBrowserStore());
    await g.ready();
    build();
    g.open(portalOf(0));
    g.answer(answer());
    expect(g.getView().gate?.state.solved).toBe(true);
    await g.settled();
    expect(g.debug().evidence).toEqual({ saved: 0, unsaved: 0 });

    freshIdb();
    const real = await storeWith(ANA);
    const failing: ProgressStore = { ...real, appendEvidence: () => Promise.reject(new Error('quota')) };
    const second = game(failing);
    await second.g.ready();
    second.build();
    second.g.open(second.portalOf(0));
    second.g.answer(second.answer());
    second.g.proceed();
    await second.g.settled();
    expect(second.g.debug().evidence).toEqual({ saved: 0, unsaved: 1 });
    expect(second.g.isOpen).toBe(false);
  });

  test('without Web Crypto the written rounds play and nothing is recorded (as on the lesson page)', async () => {
    const store = await storeWith(ANA);
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const { g, build, portalOf, answer } = game(store);
    await g.ready();
    expect(g.debug().rounds).not.toContain('fresh-1');
    build();
    g.open(portalOf(0));
    g.answer(answer());
    await g.settled();
    vi.unstubAllGlobals();
    freshIdb();
    expect(g.debug().evidence).toEqual({ saved: 0, unsaved: 0 });
  });
});

describe('falls, respawns, items, missions, locks, overrides, time and score never make evidence', () => {
  /** Play gates 1, 2 and 5 the same way; `maze` may do anything the game does between and around them. */
  async function play(maze: (g: LearningGates, tick: (ms: number) => void, stage: StageData) => void) {
    freshIdb();
    const store = await storeWith(ANA);
    const { g, build, portalOf, answer, tick } = game(store);
    await g.ready();
    const stage = build();
    for (const [step, wrong] of [
      [0, 'a'],
      [1, null],
      [4, null],
    ] as const) {
      maze(g, tick, stage);
      g.open(portalOf(step));
      tick(3_000);
      if (wrong) g.answer(wrong);
      tick(3_000);
      g.answer(answer());
      g.proceed();
      maze(g, tick, stage);
    }
    await g.settled();
    return inPlayOrder(await store.events(ANA.id)).map(strip);
  }

  test('the same rounds give the same events, whatever happens in the maze', async () => {
    const quiet = await play(() => {});
    const busy = await play((g, tick, stage) => {
      for (const item of HANDMADE.items) g.item(item.id); // gems and score
      g.island(3); // a hop past a closed lock: the region guard sends the ball back
      g.guard(2);
      g.locked(0); // pressing a closed lock
      g.stageReady(stage); // a fall and respawn, or a retry: the stage is made ready again
      tick(250_000); // maze time, including a timer running out
    });
    expect(quiet).toHaveLength(3);
    expect(busy).toEqual(quiet);
  });

  test('a mission completing, an unsolved gate closed with “Later” and the grown-up override record nothing', async () => {
    const store = await storeWith(ANA);
    const { g, build, portalOf, answer } = game(store, {
      lesson: lessonFromBaseline('count-three'),
      level: 'mission',
    });
    await g.ready();
    build();
    // the collect post, then its gems: the mission completes and opens its lock
    g.post(portalOf(0));
    for (const item of [0, 1, 2]) g.item(item);
    expect(g.debug().done).toEqual([0]);
    // the round's gate: closed unsolved ("Later"), then the override opens what it kept shut
    g.open(portalOf(1));
    g.skip();
    expect(g.overrideNext()).toBe(true);
    await g.settled();
    expect(await store.events(ANA.id)).toEqual([]);
    // solving the round itself is the one event
    g.open(portalOf(1));
    g.answer(answer());
    await g.settled();
    expect((await store.events(ANA.id)).map((e) => e.round)).toEqual(['r1']);
  });

  test('evidence is made in one place only: a solved answer on the gate card', () => {
    const source = readFileSync(new URL('../src/learning/gates.ts', import.meta.url), 'utf8');
    expect(source.match(/roundEvidence\(/g)).toHaveLength(1);
    const calls = [...source.matchAll(/this\.#record\(/g)];
    expect(calls).toHaveLength(1);
    const answer = source.indexOf('  answer(choice: string');
    const next = source.indexOf('\n  }\n', answer);
    expect(calls[0]?.index).toBeGreaterThan(answer);
    expect(calls[0]?.index).toBeLessThan(next);
    // nothing about falls, spares, score or the stage timer is read by the lesson side (code, not comments)
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\b(fell|lost|spares|score|timer|timeLeft|remains)\b/i);
  });
});

describe('the picker', () => {
  test('two children: ready() waits for a tap; the pick is greeted, remembered and recorded for', async () => {
    const store = await storeWith(ANA, BO);
    const greet = vi.fn();
    const { g, build, portalOf, answer } = game(store, { muted: false, greet });
    let ready = false;
    const waiting = g.ready().then(() => {
      ready = true;
    });
    await vi.waitFor(() => expect(g.getView().picker).not.toBeNull());
    const picker = g.getView().picker;
    expect(picker?.profiles.map((p) => [p.nickname, p.avatar])).toEqual([
      ['Ana', 'pip-teal'],
      ['Bo', 'pip-yellow'],
    ]);
    expect(g.debug().player).toBe('asking');
    await new Promise((r) => setTimeout(r, 20));
    expect(ready).toBe(false);
    g.pick('nobody'); // not a child here: ignored
    expect(g.getView().picker).not.toBeNull();
    g.pick(BO.id);
    await waiting;
    expect(greet).toHaveBeenCalledWith('Hi, Bo!');
    expect(g.getView()).toMatchObject({ picker: null, player: { nickname: 'Bo' }, canSwitch: true });
    expect(session.getItem(PICKED_KEY)).toBe(BO.id);
    await vi.waitFor(async () => expect(await store.activeProfile()).toBe(BO.id));
    build();
    g.open(portalOf(0));
    g.answer(answer());
    await g.settled();
    expect((await store.events(BO.id)).map((e) => e.round)).toEqual(['r1']);
    expect(await store.events(ANA.id)).toEqual([]);

    // the next game in this tab doesn't ask again
    g.abort();
    g.resetProgress();
    await g.ready();
    expect(g.getView().picker).toBeNull();

    // a grown-up's switch asks again, and starts a new play-through for the child picked
    g.switchPlayer();
    await vi.waitFor(() => expect(g.getView().picker).not.toBeNull());
    g.pick(ANA.id);
    await g.ready();
    expect(g.getView().player).toMatchObject({ nickname: 'Ana' });
    expect(session.getItem(PICKED_KEY)).toBe(ANA.id);
  });

  test('muted: the nickname isn’t spoken; removing the lesson closes the picker', async () => {
    const store = await storeWith(ANA, BO);
    const greet = vi.fn();
    const { g } = game(store, { muted: true, greet });
    const waiting = g.ready();
    await vi.waitFor(() => expect(g.getView().picker).not.toBeNull());
    g.clear();
    await waiting;
    expect(g.getView().picker).toBeNull();
    expect(greet).not.toHaveBeenCalled();

    const again = game(store, { muted: true, greet });
    const ready = again.g.ready();
    await vi.waitFor(() => expect(again.g.getView().picker).not.toBeNull());
    again.g.pick(ANA.id);
    await ready;
    expect(greet).not.toHaveBeenCalled();
  });

  test('a lesson shows who practice is saved for as soon as it loads, when no picker is needed', async () => {
    const one = game(await storeWith(ANA));
    await vi.waitFor(() => expect(one.g.getView().player).toMatchObject({ nickname: 'Ana' }));
    freshIdb();
    const two = game(await storeWith(ANA, BO));
    await vi.waitFor(() => expect(two.g.getView().canSwitch).toBe(true));
    expect(two.g.getView().player).toBeNull();
    expect(two.g.getView().picker).toBeNull(); // the picker waits for play to start
  });
});
