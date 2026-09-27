import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type Activity,
  baselinePath,
  choiceIds,
  type FamilySettings,
  numberWord,
  presentRound,
  type Round,
  readLearningHtml,
} from '@wwm/learning';
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const base = process.env.WWM_EDUCATION_E2E_BASE;
const shots = process.env.WWM_EDUCATION_SHOTS;
const compare = baselinePath.activities.find((activity) => activity.id === 'compare-groups') as Activity;
const countThree = baselinePath.activities.find((activity) => activity.id === 'count-three') as Activity;
const round = (id: string) => compare.rounds.find((candidate) => candidate.id === id) as Round;
const SETTINGS_KEY = 'wwm-learning:settings:v1';

/**
 * A deterministic stand-in for browser speech: every word boundary fires `delay` ms apart (15 by default),
 * then the line ends. The spoken texts are recorded on `window.__spoken`. Voice clips are blocked in these
 * tests (see `open`), so every line goes through this stub.
 */
function stubSpeech(delay = 15): void {
  const spoken: string[] = [];
  let timers: ReturnType<typeof setTimeout>[] = [];
  const stub = {
    speaking: false,
    pending: false,
    paused: false,
    speak(utterance: SpeechSynthesisUtterance) {
      spoken.push(utterance.text);
      const words = [...utterance.text.matchAll(/\S+/g)];
      utterance.onstart?.call(utterance, {} as SpeechSynthesisEvent);
      words.forEach((word, i) => {
        timers.push(
          setTimeout(
            () =>
              utterance.onboundary?.call(utterance, {
                name: 'word',
                charIndex: word.index ?? 0,
              } as SpeechSynthesisEvent),
            delay * i,
          ),
        );
      });
      timers.push(
        setTimeout(
          () => utterance.onend?.call(utterance, {} as SpeechSynthesisEvent),
          delay * words.length + 10,
        ),
      );
    },
    cancel() {
      for (const timer of timers) clearTimeout(timer);
      timers = [];
    },
    pause() {},
    resume() {},
    getVoices: () => [],
    addEventListener() {},
    removeEventListener() {},
  };
  Object.defineProperty(window, 'speechSynthesis', { value: stub, configurable: true });
  Object.defineProperty(window, '__spoken', { value: spoken });
}

/** No speech at all: the player falls back to silent, estimated timing. */
function removeSpeech(): void {
  Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true });
}

/** Record, in order, every choice mark and key badge that starts pulsing (`is-callout`) on `window.__callouts`. */
function recordCallouts(): void {
  const seen: string[] = [];
  Object.defineProperty(window, '__callouts', { value: seen });
  const observer = new MutationObserver((records) => {
    const batch = new Set<Element>();
    for (const record of records) {
      const node = record.target as Element;
      if (!node.classList.contains('is-callout') || record.oldValue?.split(/\s+/).includes('is-callout'))
        continue;
      if (batch.has(node)) continue;
      batch.add(node);
      const mark = node.getAttribute('data-choice-mark');
      const badge = node.getAttribute('data-key-badge');
      seen.push(mark !== null ? `mark:${mark}` : `badge:${badge}`);
    }
  });
  const start = () =>
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
      attributeOldValue: true,
    });
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function shot(page: Page, name: string): Promise<void> {
  if (!shots) return;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(shots, `${name}.png`), animations: 'disabled' });
}

async function start(page: Page): Promise<void> {
  await page.locator('#pip-start').click();
  await page.locator('#stage').waitFor({ state: 'visible' });
}

/** Tap (click) a choice. */
async function tap(page: Page, choice: string, force = false): Promise<void> {
  await page.locator(`#scene [data-answer="${choice}"]`).click({ force });
}

/** Answer the way the round invites: its key when key badges are showing, else a tap. */
async function answer(page: Page, choice: string, force = false): Promise<void> {
  if (await page.locator('#scene svg.show-keys').count()) {
    const key = await page.locator(`#scene [data-key-badge="${choice}"] text`).textContent();
    await page.keyboard.press(key ?? '');
  } else await tap(page, choice, force);
}

async function prompt(page: Page): Promise<string> {
  return (await page.locator('#prompt').textContent()) ?? '';
}

async function feedback(page: Page): Promise<string> {
  return (await page.locator('#feedback').textContent()) ?? '';
}

/**
 * What reached speech, in order. An immediate repeat is collapsed: when a clip fails, `createVoicePlayer` can
 * start the speech fallback twice for the same line (both the `play()` rejection and the `error` event fall
 * back; reported to the orchestrator, `packages/learning/src/voice.ts`).
 */
async function spoken(page: Page): Promise<string[]> {
  const all = await page.evaluate(() => [...(window as unknown as { __spoken: string[] }).__spoken]);
  return all.filter((text, i) => text !== all[i - 1]);
}

async function hasClass(page: Page, selector: string, className: string): Promise<boolean> {
  return page
    .locator(selector)
    .first()
    .evaluate((node, name) => node.classList.contains(name), className);
}

/** "One, two, three. Three gems.": how Pip counts an island. */
function countWords(count: number): string {
  const words = Array.from({ length: count }, (_, i) => (i === 0 ? 'One' : numberWord(i + 1)));
  const spoken = words.map((word, i) => `${word}${i === count - 1 ? '.' : ','}`).join(' ');
  const total = numberWord(count);
  return `${spoken} ${total.charAt(0).toUpperCase()}${total.slice(1)} gems\\.`;
}

/** Two seeds whose play-throughs show `target` differently (and, for compare rounds, swap the answer). */
function seedsThatDiffer(target: Round): [number, number] {
  const shown = (seed: number) => JSON.stringify(presentRound(target, seed));
  const first = 1;
  for (let seed = 2; seed < 500; seed++) if (shown(seed) !== shown(first)) return [first, seed];
  throw new Error('no differing seeds');
}

describe.skipIf(!base)('education browser acceptance', { timeout: 60_000 }, () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
    if (shots) await mkdir(shots, { recursive: true });
  });
  afterAll(async () => {
    await browser?.close();
  });

  async function open(
    options: Parameters<Browser['newContext']>[0] = {},
    speech: 'stub' | 'none' = 'stub',
    extra: { settings?: FamilySettings | string; speechDelay?: number; callouts?: boolean } = {},
  ): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
    const context = await browser.newContext(options);
    if (speech === 'stub') await context.addInitScript(stubSpeech, extra.speechDelay ?? 15);
    else await context.addInitScript(removeSpeech);
    if (extra.callouts) await context.addInitScript(recordCallouts);
    if (extra.settings !== undefined)
      await context.addInitScript(
        ([key, value]) => {
          if (!sessionStorage.getItem('settings-seeded')) {
            localStorage.setItem(key as string, value as string);
            sessionStorage.setItem('settings-seeded', '1');
          }
        },
        [SETTINGS_KEY, typeof extra.settings === 'string' ? extra.settings : JSON.stringify(extra.settings)],
      );
    // no voice clips in these tests: every line goes through the speech stub (or silent timing)
    await context.route('**/*.mp3', (route) => route.abort());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !/mp3|Failed to load resource/.test(message.text()))
        errors.push(message.text());
    });
    return { context, page, errors };
  }

  it('serves a readable lesson without JavaScript', async () => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`${base}/lessons/compare-groups/`);
    expect(await page.locator('[data-learning-field="introduction"]').first().textContent()).toBe(
      compare.introduction,
    );
    expect(await page.locator('#prompt').isVisible()).toBe(true);
    expect(await prompt(page)).toBe(compare.rounds[0]?.prompt);
    expect(await page.locator('#scene svg.wwm-scene').isVisible()).toBe(true);
    expect(await page.locator('#scene [data-answer="a"]').isDisabled()).toBe(true);
    await page.locator('.parent-notes summary').click();
    const notes = (await page.locator('.parent-notes').textContent()) ?? '';
    for (const item of compare.rounds) expect(notes).toContain(item.prompt);
    expect(notes).toContain('Trick: 3 spread out vs 5 bunched up');
    expect(notes).toContain('One play-through is practice, not an assessment of mastery.');
    expect(notes).toContain('In the game: Gated (recommended by the lesson).');
    expect(await page.locator('script#wwm-learning[type="application/json"]').count()).toBe(1);
    await context.close();
  });

  it('plays every lesson: wrong answer, hint, correct answer, locked success, Next', async () => {
    const { context, page, errors } = await open();
    for (const activity of baselinePath.activities) {
      await page.goto(`${base}/lessons/${activity.id}/?seed=0`);
      expect(await page.locator('#intro').isVisible()).toBe(true);
      await start(page);
      const first = activity.rounds[0] as Round;
      expect(await prompt(page)).toBe(first.prompt);
      const wrong = choiceIds(first).find((id) => id !== String(first.answer)) as string;
      await answer(page, wrong, true); // aria-disabled: Playwright would wait; a child can still tap
      expect(await feedback(page)).toContain(first.hints[0]);
      expect(await page.locator(`#scene [data-answer="${wrong}"]`).getAttribute('data-result')).toBe('retry');
      await page.locator('#hint').click();
      expect(await feedback(page)).toContain(first.hints[1]);
      expect(await page.locator('#next').isVisible()).toBe(false);
      await answer(page, String(first.answer));
      expect(await feedback(page)).toBe(first.success);
      expect(await hasClass(page, `[data-choice-mark="${first.answer}"]`, 'is-correct')).toBe(true);
      // locked: a later wrong tap changes nothing
      await tap(page, wrong, true); // aria-disabled: Playwright would wait; a child can still tap
      expect(await feedback(page)).toBe(first.success);
      expect(await hasClass(page, `[data-choice-mark="${wrong}"]`, 'is-retry')).toBe(false);
      expect(await hasClass(page, `[data-choice-mark="${first.answer}"]`, 'is-correct')).toBe(true);
      expect(await page.locator('#hint').isVisible()).toBe(false);
      await shot(page, `lesson-${activity.id}-correct`);
      await page.locator('#next').click();
      if (activity.rounds.length === 1) {
        expect(await page.locator('#end').isVisible()).toBe(true);
        expect(await page.locator('#end-heading').textContent()).toBe('You built the whole bridge!');
        expect(await page.locator('#end').textContent()).toContain(activity.offlineActivity);
        expect(await page.locator('#next-activity').isVisible()).toBe(true);
      } else expect(await prompt(page)).toBe(activity.rounds[1]?.prompt);
      const payload = JSON.parse((await page.locator('#wwm-learning').textContent()) ?? '{}');
      expect(payload.activities.find((item: { id: string }) => item.id === activity.id).objective).toBe(
        activity.objective,
      );
    }
    expect(errors).toEqual([]);
    await context.close();
  });

  /**
   * The reference lesson, start to finish, with the rounds as written (`?seed=0`). On the desktop the rounds
   * invite what the lesson declares (letter keys, arrows, a number key); the phone is a touch-only device, so
   * every round falls back to tapping.
   */
  async function playCompareGroups(
    device: 'desktop' | 'mobile',
    options: { bonus: 'play' | 'skip'; trickHelp: boolean },
  ): Promise<void> {
    const viewport = device === 'desktop' ? { width: 1440, height: 1000 } : { width: 390, height: 844 };
    const { context, page, errors } = await open(
      device === 'desktop' ? { viewport } : { viewport, hasTouch: true, isMobile: true },
    );
    await page.goto(`${base}/lessons/compare-groups/?seed=0`);
    await shot(page, `compare-groups-${device}-1-intro`);
    await start(page);
    expect(await page.locator('#scene').getAttribute('data-orientation')).toBe(
      device === 'mobile' ? 'tall' : 'wide',
    );
    await page.waitForFunction(
      () => new Set((window as unknown as { __spoken: string[] }).__spoken).size >= 3,
    );
    // the prompt, then the callout naming the choices in on-screen order
    expect((await spoken(page)).slice(1, 3)).toEqual([round('r1').prompt, 'Island A… or island B?']);
    await shot(page, `compare-groups-${device}-2-round1`);

    // r1 (tap): wrong, then the match tool, then right
    await tap(page, 'a');
    expect(await feedback(page)).toContain(round('r1').hints[0]);
    await shot(page, `compare-groups-${device}-3-wrong`);
    await page.locator('#match').click();
    await page.locator('[data-pair="1"].is-shown').waitFor({ state: 'attached' });
    await page.locator('[data-gem="b-3"].is-leftover').waitFor({ state: 'attached' });
    expect(await feedback(page)).toContain('Two left over!');
    await shot(page, `compare-groups-${device}-4-match`);
    await tap(page, 'b');
    expect(await feedback(page)).toBe(round('r1').success);
    expect(await page.locator('#scene [data-plank="0"]').count()).toBe(1);
    await page.locator('[data-pip].is-happy').waitFor({ state: 'attached' });
    await shot(page, `compare-groups-${device}-5-correct`);
    const next = await page.locator('#next').boundingBox();
    expect(next && next.y + next.height <= viewport.height).toBe(true);
    await page.locator('#next').click();

    // r2: close call (letter keys on the desktop; a phone taps)
    expect(await prompt(page)).toBe(round('r2').prompt);
    expect(await page.locator('#scene svg.show-keys').count()).toBe(device === 'desktop' ? 1 : 0);
    expect(await page.locator('#input-hint').isVisible()).toBe(device === 'desktop');
    if (device === 'mobile') {
      // touch only: no badges, no nudges, and Pip doesn't ask for a key
      await tap(page, 'a');
      expect(await feedback(page)).toBe(round('r2').success);
      expect(await spoken(page)).not.toContain('Press the letter!');
    } else {
      await answer(page, 'a');
      expect(await feedback(page)).toBe(round('r2').success);
    }
    await page.locator('#next').click();

    // r3: the trick
    expect(await prompt(page)).toBe(round('r3').prompt);
    await shot(page, `compare-groups-${device}-6-trick`);
    // the longest prompt still leaves the question, scene and help within one screen
    const promptBox = await page.locator('#prompt').boundingBox();
    const helpBox = await page.locator('#hint').boundingBox();
    expect(promptBox && promptBox.y >= 0).toBe(true);
    expect(helpBox && helpBox.y + helpBox.height <= viewport.height).toBe(true);
    if (options.trickHelp) {
      await page.locator('#match').click();
      await page.locator('[data-pair="2"].is-shown').waitFor({ state: 'attached' });
      await page.locator('[data-gem="b-4"].is-leftover').waitFor({ state: 'attached' });
    }
    await tap(page, 'b');
    await page.locator('#next').click();
    if (options.trickHelp) {
      // needing the match tool on the trick round brings its follow-up, which invites the arrow keys
      expect(await prompt(page)).toBe(round('r3b').prompt);
      expect(await page.locator('#input-hint').textContent()).toBe('Use ← →, then Enter');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      expect(await hasClass(page, '[data-choice-mark="b"]', 'is-focus')).toBe(true);
      await page.keyboard.press('Enter');
      expect(await page.locator('#scene [data-answer="b"]').getAttribute('data-result')).toBe('retry');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Enter');
      expect(await feedback(page)).toBe(round('r3b').success);
      await page.locator('#next').click();
    }

    // r4: same (the S key on the desktop)
    expect(await prompt(page)).toBe(round('r4').prompt);
    expect(await page.locator('#scene [data-answer="same"]').getAttribute('aria-label')).toMatch(/^Same/);
    if (device === 'desktop') expect(await page.locator('#input-hint').textContent()).toBe('Press A, S or B');
    await shot(page, `compare-groups-${device}-7-same`);
    await answer(page, 'same');
    expect(await feedback(page)).toBe(round('r4').success);
    expect(await page.locator('#scene [data-plank="3"]').count()).toBe(1);
    await page.locator('#next').click();

    // bonus offer
    expect(await prompt(page)).toBe('Bonus round!');
    expect(await page.locator('#bonus-play').isVisible()).toBe(true);
    expect(await page.locator('#bonus-skip').isVisible()).toBe(true);
    expect(await page.locator('#scene [data-answer="a"]').isDisabled()).toBe(true);
    await shot(page, `compare-groups-${device}-8-bonus-offer`);
    if (options.bonus === 'play') {
      await page.locator('#bonus-play').click();
      expect(await prompt(page)).toBe(round('r5').prompt);
      await tap(page, 'b');
      await page.locator('#next').click();
      // r5b: type the number
      expect(await prompt(page)).toBe(round('r5b').prompt);
      expect(await page.locator('#input-hint').textContent()).toBe('Type the number: 2, 3 or 4');
      await page.waitForFunction(() =>
        (window as unknown as { __spoken: string[] }).__spoken.includes('Type the number!'),
      );
      await page.keyboard.press('2');
      expect(await feedback(page)).toContain(round('r5b').hints[0]);
      await page.keyboard.press('3');
      expect(await feedback(page)).toBe(round('r5b').success);
      await page.locator('#next').click();
    } else await page.locator('#bonus-skip').click();

    expect(await page.locator('#end').isVisible()).toBe(true);
    expect(await page.locator('#stage').isVisible()).toBe(false);
    expect(await page.locator('#end-heading').textContent()).toBe('You built the whole bridge!');
    expect(await page.locator('#end').textContent()).toContain(compare.offlineActivity);
    expect(await page.locator('#next-activity').getAttribute('href')).toBe('/lessons/find-triangle/');
    await shot(page, `compare-groups-${device}-9-end`);
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.locator('#again').click();
    expect(await prompt(page)).toBe(round('r1').prompt);
    expect(await page.locator('#scene [data-plank="0"]').count()).toBe(0);
    expect(await page.locator('#scene [data-answer="b"]').getAttribute('aria-disabled')).toBeNull();
    expect(errors).toEqual([]);
    await context.close();
  }

  it('plays compare-groups on desktop: match tool on the trick round, then the bonus rounds', async () => {
    await playCompareGroups('desktop', { bonus: 'play', trickHelp: true });
  });

  it('plays compare-groups on a phone: no help on the trick round, bonus skipped', async () => {
    await playCompareGroups('mobile', { bonus: 'skip', trickHelp: false });
  });

  it('pulses each choice (and its key badge) as Pip names it, in order', async () => {
    const { context, page, errors } = await open({ viewport: { width: 1440, height: 900 } }, 'stub', {
      callouts: true,
    });
    await page.goto(`${base}/lessons/compare-groups/?seed=0`);
    await start(page);
    await page.waitForFunction(() => (window as unknown as { __callouts: string[] }).__callouts.length >= 4);
    const callouts = () =>
      page.evaluate(() => [...(window as unknown as { __callouts: string[] }).__callouts]);
    // each named choice pulses with its badge (the badge is hidden in a tap round, but still marked)
    expect(await callouts()).toEqual(['mark:a', 'badge:a', 'mark:b', 'badge:b']);
    await tap(page, 'b');
    await page.locator('#next').click();
    // r4 names three: island A, island B… or the same (on-screen order: A, Same, B)
    await answer(page, 'a');
    await page.locator('#next').click();
    await tap(page, 'b');
    await page.locator('#next').click();
    await page.evaluate(() => {
      (window as unknown as { __callouts: string[] }).__callouts.length = 0;
    });
    await page.locator('#replay').click();
    await page.waitForFunction(() => (window as unknown as { __callouts: string[] }).__callouts.length >= 6);
    expect((await callouts()).filter((entry) => entry.startsWith('mark:'))).toEqual([
      'mark:a',
      'mark:b',
      'mark:same',
    ]);
    // the pulse clears after about 600 ms
    await page.waitForFunction(() => !document.querySelector('#scene .is-callout'), undefined, {
      timeout: 2000,
    });
    expect(errors).toEqual([]);
    await context.close();
  });

  it('shuffles positions per play-through, still judges correctly, and replays a seed exactly', async () => {
    const r1 = round('r1');
    const [one, two] = seedsThatDiffer(r1);
    const shownOne = presentRound(r1, one);
    const shownTwo = presentRound(r1, two);
    expect(shownOne.answer).not.toBe(shownTwo.answer);
    const { context, page, errors } = await open();
    const labels = () =>
      page
        .locator('#scene [data-answer]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
    const seen: (string | null)[][] = [];
    for (const [seed, shown] of [
      [one, shownOne],
      [two, shownTwo],
    ] as const) {
      await page.goto(`${base}/lessons/compare-groups/?seed=${seed}`);
      expect(await page.locator('[data-learning-activity]').getAttribute('data-seed')).toBe(String(seed));
      await start(page);
      seen.push(await labels());
      if (shown.kind !== 'compare') throw new Error('compare expected');
      // the count line follows what's shown: island A's count is the shown island A
      await page.locator('#hint').click();
      await page.locator('#hint').click();
      await page.locator('#hint').click();
      // the worked example counts the shown island A first
      expect(await feedback(page)).toMatch(new RegExp(`^${countWords(shown.islands[0].count)}`));
      const wrong = shown.answer === 'a' ? 'b' : 'a';
      await tap(page, wrong);
      expect(await page.locator(`#scene [data-answer="${wrong}"]`).getAttribute('data-result')).toBe('retry');
      await tap(page, shown.answer);
      expect(await feedback(page)).toBe(r1.success);
    }
    expect(seen[0]).not.toEqual(seen[1]);
    // the same seed shows the same round again
    await page.goto(`${base}/lessons/compare-groups/?seed=${one}`);
    await start(page);
    expect(await labels()).toEqual(seen[0]);

    // choose rounds permute their options; "Play again" starts a new play-through with a new seed
    const choose = countThree.rounds[0] as Round;
    const [c1, c2] = seedsThatDiffer(choose);
    const order = async (seed: number) => {
      await page.goto(`${base}/lessons/count-three/?seed=${seed}`);
      await start(page);
      return page
        .locator('#scene [data-answer]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-answer')));
    };
    const first = await order(c1);
    expect(first).not.toEqual(await order(c2));
    await tap(page, 'three');
    await page.locator('#next').click();
    const before = await page.locator('[data-learning-activity]').getAttribute('data-seed');
    await page.locator('#again').click();
    const after = await page.locator('[data-learning-activity]').getAttribute('data-seed');
    expect(after).not.toBe(before);
    expect(Number(after)).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    await context.close();
  });

  it('a letter-key round: shows key badges, answers by key, nudges a tapper twice, then accepts', async () => {
    const { context, page, errors } = await open({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/lessons/compare-groups/?seed=0`);
    await start(page);
    await tap(page, 'b');
    await page.locator('#next').click();
    // r2 invites letter keys
    expect(await page.locator('#scene svg.show-keys').count()).toBe(1);
    expect(await page.locator('#input-hint').textContent()).toBe('Press A or B');
    expect(await page.locator('#scene [data-answer="a"]').getAttribute('aria-label')).toBe(
      'Island A: 5 gems. Key A',
    );
    await page.waitForFunction(() =>
      (window as unknown as { __spoken: string[] }).__spoken.includes('Press the letter!'),
    );
    const said = await spoken(page);
    expect(said.slice(-3)).toEqual([round('r2').prompt, 'Island A… or island B?', 'Press the letter!']);
    await shot(page, 'p22-key-badges');

    // tapping: two nudges (the badges flash), then the tap counts
    await tap(page, 'b');
    expect(await feedback(page)).toBe('Try pressing the letter! Island A… or island B?');
    expect(await hasClass(page, '[data-key-badge="a"]', 'is-nudge')).toBe(true);
    expect(await hasClass(page, '#input-hint', 'is-nudge')).toBe(true);
    expect(await page.locator('#scene [data-answer="b"]').getAttribute('data-result')).toBeNull();
    await shot(page, 'p22-nudge');
    await tap(page, 'b');
    expect(await feedback(page)).toContain('Try pressing the letter!');
    await tap(page, 'b');
    expect(await feedback(page)).toContain(round('r2').hints[0]);
    expect(await page.locator('#scene [data-answer="b"]').getAttribute('data-result')).toBe('retry');
    // the letter answers
    await page.keyboard.press('a');
    expect(await feedback(page)).toBe(round('r2').success);
    expect(await page.locator('#scene svg.show-keys').count()).toBe(0);
    await page.locator('#next').click();

    // a fresh round starts with fresh nudges; a keyboard or screen-reader press of the button always answers
    await tap(page, 'b'); // r3 invites tapping: accepted straight away
    await page.locator('#next').click();
    expect(await prompt(page)).toBe(round('r4').prompt);
    await page.locator('#scene [data-answer="same"]').focus();
    await page.keyboard.press('Enter');
    expect(await feedback(page)).toBe(round('r4').success);
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(errors).toEqual([]);
    await context.close();
  });

  it('a callout mid-pulse (screenshot, slow speech)', async () => {
    const { context, page } = await open({ viewport: { width: 1440, height: 900 } }, 'stub', {
      speechDelay: 400,
    });
    await page.goto(`${base}/lessons/compare-groups/?seed=0`);
    await start(page);
    await tap(page, 'b', true);
    await page.locator('#next').click();
    await page
      .locator('#scene [data-choice-mark="b"].is-callout')
      .waitFor({ state: 'attached', timeout: 15_000 });
    await shot(page, 'p22-callout-pulse');
    await context.close();
  });

  it('tap only: no badges, no key prompts and no nudges', async () => {
    const { context, page, errors } = await open({ viewport: { width: 1440, height: 900 } }, 'stub', {
      settings: { levels: {}, tapOnly: true },
    });
    await page.goto(`${base}/lessons/compare-groups/?seed=0`);
    await start(page);
    await tap(page, 'b');
    await page.locator('#next').click();
    expect(await prompt(page)).toBe(round('r2').prompt);
    expect(await page.locator('#scene svg.show-keys').count()).toBe(0);
    expect(await page.locator('#input-hint').isVisible()).toBe(false);
    expect(await page.locator('#scene [data-answer="a"]').getAttribute('aria-label')).toBe(
      'Island A: 5 gems',
    );
    // letter keys do nothing; the first tap answers
    await page.keyboard.press('a');
    expect(await feedback(page)).not.toBe(round('r2').success);
    await tap(page, 'a');
    expect(await feedback(page)).toBe(round('r2').success);
    expect(await spoken(page)).not.toContain('Press the letter!');
    expect(await spoken(page)).not.toContain('Try pressing the letter!');
    await page.locator('.parent-notes summary').click();
    expect(await page.locator('#game-level').textContent()).toContain('Answering: tapping only.');
    expect(errors).toEqual([]);
    await context.close();
  });

  it('shows Next within the first 390×844 viewport after success, without scrolling', async () => {
    const { context, page } = await open({ viewport: { width: 390, height: 844 } });
    for (const activity of baselinePath.activities) {
      await page.goto(`${base}/lessons/${activity.id}/`);
      await start(page);
      const first = activity.rounds[0] as Round;
      const seed = Number(await page.locator('[data-learning-activity]').getAttribute('data-seed'));
      await shot(page, `lesson-${activity.id}-mobile-round`);
      await answer(page, String(presentRound(first, seed).answer));
      const box = await page.locator('#next').boundingBox();
      expect(box, activity.id).not.toBeNull();
      await shot(page, `lesson-${activity.id}-mobile-correct`);
      expect((box?.y ?? 0) + (box?.height ?? 0), activity.id).toBeLessThanOrEqual(844);
      expect(await page.evaluate(() => window.scrollY), activity.id).toBe(0);
    }
    await context.close();
  });

  it('keeps every page within 390 px and desktop widths', async () => {
    for (const [name, width, height] of [
      ['desktop', 1440, 900],
      ['mobile', 390, 844],
    ] as const) {
      const { context, page } = await open({ viewport: { width, height } });
      await page.goto(`${base}/`);
      await page.evaluate(() => document.fonts.ready);
      expect(await noHorizontalScroll(page)).toBe(true);
      if (shots)
        await page.screenshot({
          path: join(shots, `home-${name}.png`),
          fullPage: true,
          animations: 'disabled',
        });
      for (const activity of baselinePath.activities) {
        await page.goto(`${base}/lessons/${activity.id}/`);
        expect(await noHorizontalScroll(page), activity.id).toBe(true);
        await start(page);
        expect(await noHorizontalScroll(page), activity.id).toBe(true);
        for (const button of await page.locator('#scene [data-answer]').all()) {
          const box = await button.boundingBox();
          expect(Math.min(box?.width ?? 0, box?.height ?? 0), activity.id).toBeGreaterThanOrEqual(44);
        }
      }
      await context.close();
    }
  });

  it('completes with voice clips blocked and no speech (silent timing still drives the cues)', async () => {
    const { context, page, errors } = await open({}, 'none');
    await page.goto(`${base}/lessons/compare-groups/?seed=0`);
    await start(page);
    await page.locator('#match').click();
    await page.locator('[data-pair="1"].is-shown').waitFor({ state: 'attached', timeout: 8000 });
    await tap(page, 'b');
    expect(await feedback(page)).toBe(round('r1').success);
    await page.goto(`${base}/lessons/count-three/`);
    await start(page);
    await tap(page, 'three');
    await page.locator('#next').click();
    expect(await page.locator('#end').isVisible()).toBe(true);
    expect(errors).toEqual([]);
    await context.close();
  });

  it('falls back to browser speech when clips are blocked, and remembers mute', async () => {
    const { context, page } = await open();
    await page.goto(`${base}/lessons/count-three/?seed=0`);
    await start(page);
    await page.waitForFunction(
      () => new Set((window as unknown as { __spoken: string[] }).__spoken).size >= 3,
    );
    const lesson = baselinePath.activities[0] as Activity;
    expect((await spoken(page)).slice(0, 3)).toEqual([
      lesson.introduction,
      lesson.rounds[0]?.prompt,
      'Group A, group B, or group C?',
    ]);
    await page.locator('#mute').click();
    expect(await page.locator('#mute').getAttribute('aria-pressed')).toBe('true');
    expect(await page.evaluate(() => localStorage.getItem('wwm-learning.muted'))).toBe('1');
    await page.reload();
    expect(await page.locator('#mute').getAttribute('aria-pressed')).toBe('true');
    await start(page);
    await page.locator('#replay').click();
    await page.waitForTimeout(300);
    // muted: nothing reaches speech, but the words are still highlighted as they would be spoken
    expect(await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.length)).toBe(0);
    await page.locator('#prompt .w.is-spoken').waitFor({ state: 'attached' });
    await page.locator('#mute').click();
    expect(await page.evaluate(() => localStorage.getItem('wwm-learning.muted'))).toBe('0');
    await context.close();
  });

  it('respects reduced motion: pairs, leftovers, the bridge, callouts and nudges still appear', async () => {
    const { context, page, errors } = await open({ reducedMotion: 'reduce' });
    await page.goto(`${base}/lessons/compare-groups/?seed=0`);
    await start(page);
    await page.locator('#match').click();
    await page.locator('[data-pair="1"].is-shown').waitFor({ state: 'attached' });
    await page.locator('[data-gem="b-2"].is-leftover').waitFor({ state: 'attached' });
    const motion = await page.evaluate(() => ({
      pair: getComputedStyle(document.querySelector('[data-pair="0"]') as Element).transitionDuration,
      leftover: getComputedStyle(document.querySelector('[data-gem="b-2"]') as Element).animationName,
      opacity: getComputedStyle(document.querySelector('[data-pair="0"]') as Element).opacity,
    }));
    expect(motion).toEqual({ pair: '0s', leftover: 'none', opacity: '1' });
    await tap(page, 'b');
    expect(await page.locator('#scene [data-plank="0"]').count()).toBe(1);
    await page.locator('[data-pip].is-happy').waitFor({ state: 'attached' });
    expect(await page.locator('#next').isVisible()).toBe(true);
    await page.locator('#next').click();
    // r2: a nudge highlights the badges without moving them
    await tap(page, 'a');
    await page.locator('#scene [data-key-badge="a"].is-nudge').waitFor({ state: 'attached' });
    const nudge = await page.evaluate(() => ({
      badge: getComputedStyle(document.querySelector('[data-key-badge="a"]') as Element).animationName,
      hint: getComputedStyle(document.querySelector('#input-hint') as Element).animationName,
    }));
    expect(nudge).toEqual({ badge: 'none', hint: 'none' });
    expect(errors).toEqual([]);
    await context.close();
  });

  it('keeps the family fork flow: review, accept, lessons, download, restore', async () => {
    const { context, page, errors } = await open({ acceptDownloads: true });
    await page.goto(`${base}/`);
    await page.locator('#interests').fill('Space explorers');
    await page.getByRole('button', { name: 'Create an AI prompt' }).click();
    const aiPrompt = await page.locator('#ai-prompt').inputValue();
    expect(aiPrompt).toContain('Space explorers');
    expect(aiPrompt).toContain(`"baselineVersion": "${baselinePath.version}"`);
    await page.locator('.import-panel summary').click();
    await page.locator('#draft-json').fill('{"title":"bad draft"}');
    await page.getByRole('button', { name: 'Review proposed changes' }).click();
    expect(await page.locator('#parent-feedback').textContent()).toContain('does not match');
    // a Phase 19 (baseline 1.0.0) draft still applies: introductions are keyed by activity id
    const draft = {
      baselineId: baselinePath.id,
      baselineVersion: '1.0.0',
      title: 'Space discoveries',
      description: 'Explore together.',
      introductions: baselinePath.activities.map((activity) => ({
        activityId: activity.id,
        text: `Mission ${activity.id}: Pip blasts off to a new planet.`,
      })),
    };
    await page.locator('#draft-json').fill(JSON.stringify(draft));
    await page.getByRole('button', { name: 'Review proposed changes' }).click();
    expect(await page.locator('[data-path-title]').textContent()).toBe(baselinePath.title);
    await page.getByRole('button', { name: 'Use this family version' }).click();
    await page.reload();
    expect(await page.locator('[data-path-title]').textContent()).toBe(draft.title);

    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download learning HTML' }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe('learning-path.html');
    const file = await download.path();
    const html = await readFile(file, 'utf8');
    expect(html.match(/<script/g)).toHaveLength(1);
    const portable = readLearningHtml(html);
    expect(portable.title).toBe(draft.title);
    expect(portable.provenance).toBe('parent-personalized-introductions');

    await page.goto(`${base}/lessons/compare-groups/`);
    const intro = draft.introductions[2]?.text as string;
    expect(await page.locator('#intro [data-learning-field="introduction"]').textContent()).toBe(intro);
    expect(await page.locator('#lesson-version').textContent()).toContain('family version');
    await start(page);
    expect(await feedback(page)).toContain(intro);
    // no clip matches a personalized line: browser speech reads it
    await page.waitForFunction(
      (text) => (window as unknown as { __spoken: string[] }).__spoken.includes(text),
      intro,
    );
    expect(JSON.parse((await page.locator('#wwm-learning').textContent()) ?? '{}').title).toBe(draft.title);

    // a game setting chosen with the family version survives restoring the original path
    await page.goto(`${base}/`);
    await page.locator('[data-activity="count-three"] summary').click();
    await page.locator('[data-activity="count-three"]').getByText('Explore', { exact: true }).click();
    await page.getByRole('button', { name: 'Restore original path' }).click();
    await page.reload();
    expect(await page.locator('[data-path-title]').textContent()).toBe(baselinePath.title);
    expect(await page.locator('[data-activity="count-three"] input[value="explore"]').isChecked()).toBe(true);
    expect(await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY)).toBe(
      JSON.stringify({ levels: { 'count-three': 'explore' }, tapOnly: false }),
    );
    expect(errors).toEqual([]);
    await context.close();
  });

  it('game settings: a level per lesson and tap-only persist, travel in the download, and show on the lesson', async () => {
    const { context, page, errors } = await open({
      acceptDownloads: true,
      viewport: { width: 1440, height: 900 },
    });
    await page.goto(`${base}/`);
    const block = page.locator('#game-settings');
    expect(await block.locator('fieldset').count()).toBe(baselinePath.activities.length);
    const compareSet = block.locator('[data-activity="compare-groups"]');
    expect(await compareSet.locator('[data-level-current]').textContent()).toBe(
      'Gated (recommended by the lesson)',
    );
    await compareSet.locator('summary').click();
    expect(await compareSet.locator('input[type="radio"]').count()).toBe(4);
    expect(await compareSet.locator('input[value="gated"]').isChecked()).toBe(true);
    expect(await compareSet.locator('label', { hasText: 'Gated' }).textContent()).toContain(
      '(recommended by the lesson)',
    );
    expect(await compareSet.textContent()).toContain(
      'Bridges and lifts stay locked until Pip’s question is answered.',
    );
    expect(await page.locator('#settings-state').textContent()).toBe(
      'Every lesson uses its recommended level.',
    );
    if (shots)
      await block.screenshot({ path: join(shots, 'p22-game-settings-desktop.png'), animations: 'disabled' });

    await compareSet.getByText('Missions', { exact: true }).click();
    expect(await page.locator('#settings-state').textContent()).toContain('plays at Missions');
    expect(await compareSet.locator('[data-level-current]').textContent()).toBe('Missions (your choice)');
    await page.getByRole('switch', { name: 'Answer by tapping only' }).check();
    await page.reload();
    expect(await compareSet.locator('input[value="mission"]').isChecked()).toBe(true);
    expect(await page.getByRole('switch', { name: 'Answer by tapping only' }).isChecked()).toBe(true);
    expect(
      JSON.parse((await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY)) ?? '{}'),
    ).toEqual({
      levels: { 'compare-groups': 'mission' },
      tapOnly: true,
    });
    expect(await page.locator('#settings-state').textContent()).toBe(
      '1 lesson plays at a level you chose. Answering by tapping only.',
    );
    // the page's own learning JSON carries the family choices
    expect(JSON.parse((await page.locator('#wwm-learning').textContent()) ?? '{}').family).toEqual({
      levels: { 'compare-groups': 'mission' },
      tapOnly: true,
    });

    // the download carries `family`, plus a readable Game settings section
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download learning HTML' }).click();
    const html = await readFile(await (await downloadEvent).path(), 'utf8');
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).not.toContain('src=');
    expect(readLearningHtml(html).family).toEqual({ levels: { 'compare-groups': 'mission' }, tapOnly: true });
    expect(html).toContain('<h2>Game settings</h2>');
    expect(html).toContain('<strong>Which has more?:</strong> Missions.');
    expect(html).toContain('Answering: tapping only (a grown-up setting).');

    // the lesson page's grown-up notes name the level
    await page.goto(`${base}/lessons/compare-groups/`);
    await page.locator('.parent-notes summary').click();
    expect(await page.locator('#game-level').textContent()).toMatch(
      /^In the game: Missions\. Bridges stay locked until Pip’s question is answered or mission is done\./,
    );

    // back to the recommendations (tap-only stays), then a full reset
    await page.goto(`${base}/`);
    await page.getByRole('button', { name: 'Use the lesson’s recommendation for every lesson' }).click();
    expect(await compareSet.locator('input[value="gated"]').isChecked()).toBe(true);
    expect(await page.getByRole('switch', { name: 'Answer by tapping only' }).isChecked()).toBe(true);
    await page.getByRole('button', { name: 'Reset game settings' }).click();
    expect(await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY)).toBeNull();
    expect(await page.getByRole('switch', { name: 'Answer by tapping only' }).isChecked()).toBe(false);
    expect(errors).toEqual([]);
    await context.close();
  });

  it('game settings on a phone, and bad saved settings are ignored with a warning', async () => {
    const { context, page } = await open({ viewport: { width: 390, height: 844 } }, 'stub', {
      settings: JSON.stringify({ levels: { 'compare-groups': 'no-such-level' }, tapOnly: true }),
    });
    await page.goto(`${base}/`);
    expect(await page.locator('#settings-state').textContent()).toContain('could not be loaded');
    expect(await page.locator('[data-activity="compare-groups"] input[value="gated"]').isChecked()).toBe(
      true,
    );
    expect(await page.getByRole('switch', { name: 'Answer by tapping only' }).isChecked()).toBe(false);
    expect(JSON.parse((await page.locator('#wwm-learning').textContent()) ?? '{}').family).toBeUndefined();
    expect(await noHorizontalScroll(page)).toBe(true);
    // the lesson ignores them too, and says so in the grown-up notes
    await page.goto(`${base}/lessons/compare-groups/`);
    await page.locator('.parent-notes summary').click();
    expect(await page.locator('#game-level').textContent()).toContain('could not be loaded');
    expect(await page.locator('#game-level').textContent()).toContain('In the game: Gated');
    await page.goto(`${base}/`);
    await page.getByRole('button', { name: 'Reset game settings' }).click();
    expect(await page.locator('#settings-state').textContent()).toContain('Game settings reset.');
    await page.locator('[data-activity="compare-groups"] summary').click();
    expect(await noHorizontalScroll(page)).toBe(true);
    if (shots)
      await page.locator('#game-settings').screenshot({
        path: join(shots, 'p22-game-settings-mobile.png'),
        animations: 'disabled',
        style: '.skip{display:none}',
      });
    await context.close();
  });

  it('wraps valid long family text and recovers from corrupt saved data', async () => {
    const { context, page } = await open({ viewport: { width: 390, height: 844 } });
    await page.goto(`${base}/`);
    await page.locator('.import-panel summary').click();
    const draft = {
      baselineId: baselinePath.id,
      baselineVersion: baselinePath.version,
      title: 'A'.repeat(80),
      description: 'B'.repeat(400),
      introductions: baselinePath.activities.map((activity) => ({
        activityId: activity.id,
        text: 'C'.repeat(400),
      })),
    };
    await page.locator('#draft-json').fill(JSON.stringify(draft));
    await page.getByRole('button', { name: 'Review proposed changes' }).click();
    await page.getByRole('button', { name: 'Use this family version' }).click();
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.goto(`${base}/lessons/compare-groups/`);
    expect(await noHorizontalScroll(page)).toBe(true);
    await start(page);
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.goto(`${base}/`);
    await page.evaluate(() => localStorage.setItem('wwm-learning:family-fork:v1', '{bad-json'));
    await page.reload();
    expect(await page.locator('[data-path-title]').textContent()).toBe(baselinePath.title);
    expect(await page.locator('#saved-state').textContent()).toContain('could not be loaded');
    await page.getByRole('button', { name: 'Restore original path' }).click();
    expect(await page.locator('#saved-state').textContent()).toContain('Using the original');
    await context.close();
  });

  it('voices the introduction and the first question in full after "Tap Pip to start" (no unlock cut-off)', async () => {
    // a real audio element this time: every clip is a 0.3 s silent WAV, so `ended` fires and the lines advance
    const rate = 8000;
    const samples = Math.round(rate * 0.3);
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(36 + samples * 2, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(rate, 24);
    wav.writeUInt32LE(rate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(samples * 2, 40);
    const context = await browser.newContext();
    await context.addInitScript(() => {
      const log: string[] = [];
      Object.defineProperty(window, '__media', { value: log });
      const proto = HTMLMediaElement.prototype;
      const play = proto.play;
      const pause = proto.pause;
      proto.play = function (this: HTMLMediaElement) {
        if (this.src.endsWith('.mp3')) log.push(`play ${this.src.split('/').pop()} muted=${this.muted}`);
        return play.call(this);
      };
      proto.pause = function (this: HTMLMediaElement) {
        if (this.src.endsWith('.mp3') && !this.ended) log.push(`pause ${this.src.split('/').pop()}`);
        return pause.call(this);
      };
    });
    await context.route('**/*.mp3', (route) =>
      route.fulfill({ status: 200, contentType: 'audio/wav', body: wav }),
    );
    const page = await context.newPage();
    await page.goto(`${base}/lessons/compare-groups/?seed=0`);
    await page.locator('#pip-start').click();
    const media = () => page.evaluate(() => (window as unknown as { __media: string[] }).__media);
    // intro, prompt, callout: three clips in a row, each starting only after the previous one ended
    await expect
      .poll(async () => (await media()).filter((entry) => entry.startsWith('play')).length, {
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(3);
    const log = await media();
    expect(log.filter((entry) => entry.includes('muted=true'))).toEqual([]);
    expect(log.filter((entry) => entry.startsWith('pause'))).toEqual([]);
    await context.close();
  });
});
