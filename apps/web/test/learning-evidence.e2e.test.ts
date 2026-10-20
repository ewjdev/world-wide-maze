/**
 * Phase 31 M5 end-to-end: the maze records the same learning evidence as the lesson page (Vite dev server +
 * Chromium, `/api` mocked, Pip silent).
 *
 *  1. One child on the device: no picker; solving Pip gates (a written round by keyboard after a retry, a fresh
 *     example by tap) writes `surface: 'maze'` events to the device store, which the Progress page's renderer
 *     (apps/education `childHtml` over `objectiveProgress`) reads. The stage then times up: the run stays unranked
 *     and the events don't change.
 *  2. No children: the lesson plays, fresh examples included, and nothing is recorded.
 *  3. Two children, desktop and 390 px mobile: the picture-only picker shows while the maze builds; a child picks by
 *     keyboard (desktop) or tap (mobile), events go to them, and a new tab asks again. No request carries a
 *     nickname or profile id.
 *
 * Profiles are seeded with the real `createBrowserStore` (imported through the dev server), the same store the
 * lesson page and Progress use on this origin. `WWM_M5_SHOTS=1` also writes the picker screenshots to
 * docs/build-log/assets/phase-31/. Needs Playwright Chromium; skipped locally without it, required in CI.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  baselinePath,
  evidenceSchema,
  type LearningEvidence,
  objectiveProgress,
  type Profile,
} from '@wwm/learning';
import { type Browser, type BrowserContext, chromium, type Page, type Route } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { browserEnv, CHROMIUM_ARGS, CI_HOOKS } from './browser-env.ts';

const HAS_CHROMIUM = existsSync(chromium.executablePath()) || !!process.env.CI;
const WEB_ROOT = fileURLToPath(new URL('../', import.meta.url));
const STORE_MODULE = fileURLToPath(
  new URL('../../../packages/learning/src/browser-store.ts', import.meta.url),
);
const SHOTS =
  process.env.WWM_M5_SHOTS === '1'
    ? fileURLToPath(new URL('../../../docs/build-log/assets/phase-31/', import.meta.url))
    : null;

const MIA: Profile = { id: 'mia-000000000000000a', nickname: 'Mia', avatar: 'pip-green' };
const LEO: Profile = { id: 'leo-000000000000000b', nickname: 'Leo', avatar: 'pip-orange' };

type Dbg = {
  phase: string;
  learningRun: boolean;
  learning: {
    rounds: string[];
    fresh: string[];
    player: 'none' | 'chosen' | 'asking';
    evidence: { saved: number; unsaved: number };
    gate: { round: string; solved: boolean } | null;
    binding: { steps: { index: number; portalId: number | null }[] } | null;
  };
};

describe.skipIf(!HAS_CHROMIUM)('maze evidence e2e (Chromium, mocked /api)', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let base = '';
  const problems: string[] = [];

  beforeAll(async () => {
    process.env.WWM_API_URL = 'http://127.0.0.1:9'; // nothing listens: every /api call is routed below
    server = await createServer({
      root: WEB_ROOT,
      configFile: `${WEB_ROOT}vite.config.ts`,
      logLevel: 'error',
      server: { port: 5298, strictPort: false, host: '127.0.0.1' },
    });
    await server.listen();
    base = (server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5298/').replace(/\/$/, '');
    browser = await chromium.launch({ args: CHROMIUM_ARGS });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  /** Everything the page sends (URL and body), to prove no nickname or profile id leaves the device. */
  const sent: string[] = [];

  async function context(viewport = { width: 1280, height: 720 }): Promise<BrowserContext> {
    const ctx = await browser.newContext({ viewport });
    await browserEnv(ctx);
    await ctx.addInitScript((ci) => {
      localStorage.setItem('wwm.howtoSeen', '1');
      localStorage.setItem('wwm.tutorialDone', '1');
      // silent Pip: no browser speech (the player falls back to estimated cue timing)
      Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true });
      (window as unknown as { __WWM_TEST__: unknown }).__WWM_TEST__ = {
        ...ci,
        skipIntro: true,
        noAutoPause: true,
        timeScale: 2,
        learningSeed: 0,
      };
    }, CI_HOOKS);
    await ctx.route('**/*.mp3', (route) => route.abort());
    await ctx.route('**/api/**', (route: Route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":"UNAVAILABLE"}' }),
    );
    // a blank same-origin page to seed the device store from
    await ctx.route('**/__seed', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>seed</title>' }),
    );
    ctx.on('request', (req) => sent.push(`${req.url()} ${req.postData() ?? ''}`));
    return ctx;
  }

  async function page(ctx: BrowserContext): Promise<Page> {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
    return p;
  }

  /**
   * Run `body` in the page with `store` = the real `createBrowserStore()` (imported through the dev server). The
   * script is a string so the test runner doesn't rewrite its dynamic import.
   */
  const withStore = <T>(p: Page, body: string, arg: unknown = null) =>
    p.evaluate(
      `(async (arg) => { const { createBrowserStore } = await import(${JSON.stringify(`/@fs${STORE_MODULE}`)}); const store = createBrowserStore(); ${body} })(${JSON.stringify(arg)})`,
    ) as Promise<T>;

  /** Add children to this origin's device store. */
  async function seed(ctx: BrowserContext, profiles: Profile[]): Promise<void> {
    const p = await page(ctx);
    await p.goto(`${base}/__seed`);
    await withStore(p, 'for (const profile of arg) await store.saveProfile(profile);', profiles);
    await p.close();
  }

  /** Everything in this origin's device store, read with the same module. */
  const exportAll = (p: Page) =>
    withStore<{ profiles: Profile[]; events: LearningEvidence[] }>(p, 'return store.exportAll();');

  const waitPhase = (p: Page, want: string, timeout = 60_000) =>
    p.waitForFunction((w) => document.body.dataset.phase === w, want, { timeout });
  const state = (p: Page) =>
    p.evaluate(() => {
      const d = (window as unknown as { __wwmGame: { debugState(): unknown } }).__wwmGame.debugState();
      return { ...(d as object), engine: null } as unknown as Dbg;
    });
  const roll = (p: Page, id: number) =>
    p.evaluate(
      (i) =>
        (
          window as unknown as { __wwmGame: { debugRollIntoPortal(id: number, m: number): boolean } }
        ).__wwmGame.debugRollIntoPortal(i, 4),
      id,
    );
  const gateAnswer = (p: Page) =>
    p.evaluate(() =>
      String(
        (
          window as unknown as {
            __wwmGame: { learning: { getView(): { gate: { round: { answer: unknown } } | null } } };
          }
        ).__wwmGame.learning.getView().gate?.round.answer,
      ),
    );
  const portalOf = async (p: Page, step: number) => {
    const id = (await state(p)).learning.binding?.steps.find((s) => s.index === step)?.portalId;
    if (id === null || id === undefined) throw new Error(`step ${step} has no gate`);
    return id;
  };
  const saved = (p: Page, n: number) =>
    expect.poll(async () => (await state(p)).learning.evidence.saved, { timeout: 10_000 }).toBe(n);

  /** Roll into step `step`'s gate, answer it right by tap, and roll on. */
  async function solveByTap(p: Page, step: number, round: string) {
    expect(await roll(p, await portalOf(p, step))).toBe(true);
    await p.waitForSelector(`[data-testid="lgate-card"][data-round="${round}"]`, { timeout: 15_000 });
    await p.click(`[data-testid="lgate-choice-${await gateAnswer(p)}"]`);
    await expect.poll(async () => (await state(p)).learning.gate?.solved, { timeout: 5_000 }).toBe(true);
    await p.click('[data-testid="lgate-rollon"]');
    await p.waitForSelector('[data-testid="learning-gate"]', { state: 'detached' });
  }

  async function shot(p: Page, name: string) {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    await p.waitForTimeout(600); // the fade-in
    await p.screenshot({ path: `${SHOTS}${name}.png` });
  }

  test('one child: gates record maze evidence that Progress reads; time-up and score leave it alone', async () => {
    const ctx = await context();
    await seed(ctx, [MIA]);
    const p = await page(ctx);
    await p.goto(`${base}/play/practice?learn=compare-groups`);
    await waitPhase(p, 'play');
    expect(await p.locator('[data-testid="learning-picker"]').count()).toBe(0);
    let s = await state(p);
    expect(s.learning.player).toBe('chosen');
    expect(s.learning.rounds).toEqual(['r1', 'r2', 'r3', 'r3b', 'r4', 'fresh-1', 'fresh-2', 'r5', 'r5b']);
    expect(s.learningRun).toBe(true); // unranked, as every learning run

    // gate 1 (r1): wrong, then right, by the keyboard's arrows and Enter
    expect(await roll(p, await portalOf(p, 0))).toBe(true);
    await p.waitForSelector('[data-testid="lgate-card"][data-round="r1"]', { timeout: 15_000 });
    await p.keyboard.press('ArrowLeft');
    await p.keyboard.press('Enter');
    await expect.poll(async () => (await state(p)).learning.gate?.solved, { timeout: 5_000 }).toBe(false);
    await p.keyboard.press('ArrowRight');
    await p.keyboard.press('Enter');
    await expect.poll(async () => (await state(p)).learning.gate?.solved, { timeout: 5_000 }).toBe(true);
    await p.keyboard.press('Enter');
    await p.waitForSelector('[data-testid="learning-gate"]', { state: 'detached' });
    // gate 5: the first fresh example, by tap
    await solveByTap(p, 4, 'fresh-1');
    await saved(p, 2);

    const { profiles, events } = await exportAll(p);
    expect(profiles).toEqual([MIA]);
    const byRound = Object.fromEntries(events.map((e) => [evidenceSchema.parse(e).round, e]));
    expect(Object.keys(byRound).sort()).toEqual(['fresh-1', 'r1']);
    expect(byRound.r1).toMatchObject({
      profile: MIA.id,
      activity: 'compare-groups',
      objective: 'compare-groups',
      source: 'lesson',
      surface: 'maze',
      input: 'arrows',
      outcome: 'after-retry',
      helpLevel: 1,
    });
    expect(byRound['fresh-1']).toMatchObject({
      source: 'generator',
      fresh: true,
      surface: 'maze',
      input: 'tap',
      outcome: 'first-try',
    });

    // the Progress page's model and renderer read them like lesson-page events
    const objectives = baselinePath.objectives?.map((o) => o.id) ?? [];
    const progress = objectiveProgress(events, objectives, { timeZone: 'UTC' });
    expect(progress.find((x) => x.objective === 'compare-groups')).toMatchObject({
      state: 'practising',
      rounds: 2,
    });
    const render = (await import(
      /* @vite-ignore */ new URL('../../education/src/progress-render.ts', import.meta.url).href
    )) as {
      childHtml: (
        path: typeof baselinePath,
        profile: Profile,
        progress: ReturnType<typeof objectiveProgress>,
        options: { timeZone?: string; picker: boolean },
      ) => string;
      STATE_COPY: Record<string, string>;
    };
    const html = render.childHtml(baselinePath, MIA, progress, { timeZone: 'UTC', picker: false });
    expect(html).toContain('Mia');
    expect(html).toContain(render.STATE_COPY.practising);
    expect(html).toContain('Which has more?');

    // the stage times up (time, score and the result screen): the evidence is exactly as it was
    await p.evaluate(() =>
      (window as unknown as { __wwmGame: { debugSetTimeLeft(s: number): void } }).__wwmGame.debugSetTimeLeft(
        0.5,
      ),
    );
    await p.waitForFunction(() => !['play', 'falling'].includes(document.body.dataset.phase ?? ''), null, {
      timeout: 20_000,
    });
    await p.waitForTimeout(800);
    s = await state(p);
    expect(s.learningRun).toBe(true);
    expect((await exportAll(p)).events).toEqual(events);
    await ctx.close();
    expect(problems).toEqual([]);
  }, 180_000);

  test('no children: the lesson plays with its fresh examples and nothing is recorded', async () => {
    const ctx = await context();
    const p = await page(ctx);
    await p.goto(`${base}/play/practice?learn=compare-groups`);
    await waitPhase(p, 'play');
    expect(await p.locator('[data-testid="learning-picker"]').count()).toBe(0);
    const s = await state(p);
    expect(s.learning.player).toBe('none');
    expect(s.learning.fresh).toEqual(['fresh-1', 'fresh-2']);
    await solveByTap(p, 0, 'r1');
    await solveByTap(p, 4, 'fresh-1');
    await p.waitForTimeout(500);
    expect((await state(p)).learning.evidence).toEqual({ saved: 0, unsaved: 0 });
    expect(await exportAll(p)).toEqual({ profiles: [], events: [] });
    await ctx.close();
    expect(problems).toEqual([]);
  }, 180_000);

  for (const mobile of [false, true]) {
    test(`two children (${mobile ? '390 px mobile' : 'desktop'}): the picker asks while the maze builds`, async () => {
      const ctx = await context(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
      await seed(ctx, [MIA, LEO]);
      const p = await page(ctx);
      await p.goto(`${base}/play/practice?learn=compare-groups`);
      await p.waitForSelector('[data-testid="learning-picker"]', { timeout: 60_000 });
      // the maze waits for the pick
      expect(await p.evaluate(() => document.body.dataset.phase)).toBe('building');
      const picks = p.locator('[data-testid="learning-pick"]');
      expect(await picks.count()).toBe(2);
      // picture-only: Pip avatars, named for assistive technology by nickname (sorted by nickname)
      expect(await picks.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual([
        'Leo',
        'Mia',
      ]);
      expect(await picks.evaluateAll((els) => els.map((e) => e.getAttribute('data-avatar')))).toEqual([
        'pip-orange',
        'pip-green',
      ]);
      expect(await p.locator('[data-testid="learning-pick"] svg.avatar').count()).toBe(2);
      expect(await p.getByRole('dialog', { name: 'Who’s playing?' }).count()).toBe(1);
      // big targets
      for (const box of await picks.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON())))
        expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(120);
      // the first Pip has focus
      expect(await p.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Leo');
      await shot(p, `m5-picker-${mobile ? 'mobile' : 'desktop'}`);

      if (mobile) await picks.nth(1).click();
      else {
        await p.keyboard.press('ArrowRight');
        expect(await p.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Mia');
        await p.keyboard.press('Enter');
      }
      await waitPhase(p, 'play');
      expect(await p.locator('[data-testid="learning-picker"]').count()).toBe(0);
      expect(await p.evaluate((k) => sessionStorage.getItem(k), 'wwm-learning.picked')).toBe(MIA.id);
      await solveByTap(p, 0, 'r1');
      await saved(p, 1);
      const { events } = await exportAll(p);
      expect(events.map((e) => [e.profile, e.round, e.surface])).toEqual([[MIA.id, 'r1', 'maze']]);

      // a new tab asks again (the pick is remembered per tab, as on the lesson page)
      const other = await page(ctx);
      await other.goto(`${base}/play/practice?learn=compare-groups`);
      await other.waitForSelector('[data-testid="learning-picker"]', { timeout: 60_000 });
      await other.close();

      // nothing the page sent carries a nickname or a profile id
      for (const request of sent)
        for (const secret of [MIA.id, LEO.id, 'Mia', 'Leo']) expect(request).not.toContain(secret);
      await ctx.close();
      expect(problems).toEqual([]);
    }, 180_000);
  }

  test('the loader’s grown-up line: who practice is saved for, and a held switch that asks again', async () => {
    const ctx = await context();
    await seed(ctx, [MIA, LEO]);
    const p = await page(ctx);
    await p.goto(`${base}/`);
    await p.waitForSelector('[data-testid="start"]:not([disabled])', { timeout: 60_000 });
    await p.click('[data-testid="start"]');
    await waitPhase(p, 'pairing');
    await p.click('[data-testid="play-keyboard"]');
    await waitPhase(p, 'select');
    await p.click('[data-testid="learning-builtin"]');
    // nobody picked in this tab yet: no line, and no picker until play starts
    await p.waitForSelector('[data-testid="learning-level"]');
    expect(await p.locator('[data-testid="learning-player"]').count()).toBe(0);
    expect(await p.locator('[data-testid="learning-picker"]').count()).toBe(0);
    await p.click('[data-testid="site-practice"]');
    await p.waitForSelector('[data-testid="learning-picker"]', { timeout: 60_000 });
    await p.locator('[data-testid="learning-pick"][aria-label="Leo"]').click();
    await waitPhase(p, 'play');
    // back on the select screen: the line names Leo, and a quick tap on the switch does nothing
    await p.keyboard.press('Escape');
    await waitPhase(p, 'paused');
    // the pause menu's "another site": back to the select screen (a new game for the lesson)
    await p.evaluate(() => {
      const g = (
        window as unknown as {
          __wwmGame: { askConfirm(kind: 'search'): void; confirm(yes: boolean): void };
        }
      ).__wwmGame;
      g.askConfirm('search');
      g.confirm(true);
    });
    await waitPhase(p, 'select');
    await p.waitForSelector('[data-testid="learning-player"]');
    expect(await p.textContent('[data-testid="learning-player"]')).toContain(
      'Saving practice for Leo on this device.',
    );
    await p.click('[data-testid="learning-switch"]');
    expect(await p.locator('[data-testid="learning-picker"]').count()).toBe(0);
    // held for 2 s: the picker, now
    const box = await p.locator('[data-testid="learning-switch"]').boundingBox();
    if (!box) throw new Error('no switch');
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.down();
    await p.waitForTimeout(3000); // the 2 s hold, with room for a busy CI main thread
    await p.mouse.up();
    await p.waitForSelector('[data-testid="learning-picker"]');
    await p.locator('[data-testid="learning-pick"][aria-label="Mia"]').click();
    await expect
      .poll(() => p.textContent('[data-testid="learning-player"]'), { timeout: 5_000 })
      .toContain('Saving practice for Mia on this device.');
    expect(await p.evaluate((k) => sessionStorage.getItem(k), 'wwm-learning.picked')).toBe(MIA.id);
    await ctx.close();
    expect(problems).toEqual([]);
  }, 180_000);
});
