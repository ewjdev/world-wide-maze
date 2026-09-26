import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Activity, baselinePath, choiceIds, type Round, readLearningHtml } from '@wwm/learning';
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const base = process.env.WWM_EDUCATION_E2E_BASE;
const shots = process.env.WWM_EDUCATION_SHOTS;
const compare = baselinePath.activities.find((activity) => activity.id === 'compare-groups') as Activity;
const round = (id: string) => compare.rounds.find((candidate) => candidate.id === id) as Round;

/**
 * A deterministic stand-in for browser speech: every word boundary fires 15 ms apart, then the line ends. The
 * spoken texts are recorded on `window.__spoken`. (No voice clips are fetched in these tests.)
 */
function stubSpeech(): void {
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
            15 * i,
          ),
        );
      });
      timers.push(
        setTimeout(
          () => utterance.onend?.call(utterance, {} as SpeechSynthesisEvent),
          15 * words.length + 10,
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

async function answer(page: Page, choice: string, force = false): Promise<void> {
  await page.locator(`#scene [data-answer="${choice}"]`).click({ force });
}

async function prompt(page: Page): Promise<string> {
  return (await page.locator('#prompt').textContent()) ?? '';
}

async function feedback(page: Page): Promise<string> {
  return (await page.locator('#feedback').textContent()) ?? '';
}

async function hasClass(page: Page, selector: string, className: string): Promise<boolean> {
  return page
    .locator(selector)
    .first()
    .evaluate((node, name) => node.classList.contains(name), className);
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
  ): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
    const context = await browser.newContext(options);
    await context.addInitScript(speech === 'stub' ? stubSpeech : removeSpeech);
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
    expect(await page.locator('script#wwm-learning[type="application/json"]').count()).toBe(1);
    await context.close();
  });

  it('plays every lesson: wrong answer, hint, correct answer, locked success, Next', async () => {
    const { context, page, errors } = await open();
    for (const activity of baselinePath.activities) {
      await page.goto(`${base}/lessons/${activity.id}/`);
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
      await answer(page, wrong, true); // aria-disabled: Playwright would wait; a child can still tap
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

  /** The reference lesson, start to finish. */
  async function playCompareGroups(
    device: 'desktop' | 'mobile',
    options: { bonus: 'play' | 'skip'; trickHelp: boolean },
  ): Promise<void> {
    const viewport = device === 'desktop' ? { width: 1440, height: 1000 } : { width: 390, height: 844 };
    const { context, page, errors } = await open({ viewport });
    await page.goto(`${base}/lessons/compare-groups/`);
    await shot(page, `compare-groups-${device}-1-intro`);
    await start(page);
    expect(await page.locator('#scene').getAttribute('data-orientation')).toBe(
      device === 'mobile' ? 'tall' : 'wide',
    );
    await page.waitForFunction(() => (window as unknown as { __spoken: string[] }).__spoken.length >= 2);
    await shot(page, `compare-groups-${device}-2-round1`);

    // r1: wrong, then the match tool, then right
    await answer(page, 'a');
    expect(await feedback(page)).toContain(round('r1').hints[0]);
    await shot(page, `compare-groups-${device}-3-wrong`);
    await page.locator('#match').click();
    await page.locator('[data-pair="1"].is-shown').waitFor({ state: 'attached' });
    await page.locator('[data-gem="b-3"].is-leftover').waitFor({ state: 'attached' });
    expect(await feedback(page)).toContain('Two left over!');
    await shot(page, `compare-groups-${device}-4-match`);
    await answer(page, 'b');
    expect(await feedback(page)).toBe(round('r1').success);
    expect(await page.locator('#scene [data-plank="0"]').count()).toBe(1);
    await page.locator('[data-pip].is-happy').waitFor({ state: 'attached' });
    await shot(page, `compare-groups-${device}-5-correct`);
    const next = await page.locator('#next').boundingBox();
    expect(next && next.y + next.height <= viewport.height).toBe(true);
    await page.locator('#next').click();

    // r2: close call
    expect(await prompt(page)).toBe(round('r2').prompt);
    await answer(page, 'a');
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
    await answer(page, 'b');
    await page.locator('#next').click();
    if (options.trickHelp) {
      // needing the match tool on the trick round brings its follow-up
      expect(await prompt(page)).toBe(round('r3b').prompt);
      await answer(page, 'b');
      expect(await page.locator('#scene [data-answer="b"]').getAttribute('data-result')).toBe('retry');
      await answer(page, 'a');
      await page.locator('#next').click();
    }

    // r4: same
    expect(await prompt(page)).toBe(round('r4').prompt);
    expect(await page.locator('#scene [data-answer="same"]').getAttribute('aria-label')).toMatch(/^Same/);
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
      await answer(page, 'b');
      await page.locator('#next').click();
      expect(await prompt(page)).toBe(round('r5b').prompt);
      await answer(page, '2');
      expect(await feedback(page)).toContain(round('r5b').hints[0]);
      await answer(page, '3');
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

  it('shows Next within the first 390×844 viewport after success, without scrolling', async () => {
    const { context, page } = await open({ viewport: { width: 390, height: 844 } });
    for (const activity of baselinePath.activities) {
      await page.goto(`${base}/lessons/${activity.id}/`);
      await start(page);
      const first = activity.rounds[0] as Round;
      await answer(page, String(first.answer));
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
      ['desktop', 1440, 1000],
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
    await context.route('**/*.mp3', (route) => route.abort());
    await page.goto(`${base}/lessons/compare-groups/`);
    await start(page);
    await page.locator('#match').click();
    await page.locator('[data-pair="1"].is-shown').waitFor({ state: 'attached', timeout: 8000 });
    await answer(page, 'b');
    expect(await feedback(page)).toBe(round('r1').success);
    await page.goto(`${base}/lessons/count-three/`);
    await start(page);
    await answer(page, 'three');
    await page.locator('#next').click();
    expect(await page.locator('#end').isVisible()).toBe(true);
    expect(errors).toEqual([]);
    await context.close();
  });

  it('falls back to browser speech when clips are blocked, and remembers mute', async () => {
    const { context, page } = await open();
    await context.route('**/*.mp3', (route) => route.abort());
    await page.goto(`${base}/lessons/count-three/`);
    await start(page);
    await page.waitForFunction(() => (window as unknown as { __spoken: string[] }).__spoken.length >= 2);
    const spoken = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
    const lesson = baselinePath.activities[0] as Activity;
    expect(spoken.slice(0, 2)).toEqual([lesson.introduction, lesson.rounds[0]?.prompt]);
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

  it('respects reduced motion: pairs, leftovers and the bridge still appear', async () => {
    const { context, page, errors } = await open({ reducedMotion: 'reduce' });
    await page.goto(`${base}/lessons/compare-groups/`);
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
    await answer(page, 'b');
    expect(await page.locator('#scene [data-plank="0"]').count()).toBe(1);
    await page.locator('[data-pip].is-happy').waitFor({ state: 'attached' });
    expect(await page.locator('#next').isVisible()).toBe(true);
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
    expect(aiPrompt).toContain('"baselineVersion": "2.0.0"');
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
    expect(await feedback(page)).toBe(intro);
    // no clip matches a personalized line: browser speech reads it
    await page.waitForFunction(
      (text) => (window as unknown as { __spoken: string[] }).__spoken.includes(text),
      intro,
    );
    expect(JSON.parse((await page.locator('#wwm-learning').textContent()) ?? '{}').title).toBe(draft.title);

    await page.goto(`${base}/`);
    await page.getByRole('button', { name: 'Restore original path' }).click();
    await page.reload();
    expect(await page.locator('[data-path-title]').textContent()).toBe(baselinePath.title);
    expect(errors).toEqual([]);
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
});
