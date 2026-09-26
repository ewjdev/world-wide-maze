import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { baselinePath } from '@wwm/learning';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const base = process.env.WWM_EDUCATION_E2E_BASE;
const shots = process.env.WWM_EDUCATION_SHOTS;
describe.skipIf(!base)('education browser acceptance', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
    if (shots) await mkdir(shots, { recursive: true });
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('serves readable lessons without JavaScript', async () => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`${base}/lessons/count-three/`);
    expect(await page.locator('h1').textContent()).toContain('three circles');
    await page.locator('.parent-notes summary').click();
    expect(await page.locator('[data-learning-field="objective"]').isVisible()).toBe(true);
    expect(await page.locator('#wwm-learning').count()).toBe(1);
    expect(await page.locator('[data-answer="three"]').isDisabled()).toBe(true);
    await context.close();
  });

  it('supports every activity, hints, retry, and navigation', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const activity of baselinePath.activities) {
      await page.goto(`${base}/lessons/${activity.id}/`);
      const wrong = activity.options.find((option) => option.id !== activity.answerId);
      await page.locator(`[data-answer="${wrong?.id}"]`).click();
      expect(await page.locator('#feedback').textContent()).toContain('Let’s look again');
      await page.locator('[data-hint]').click();
      expect(await page.locator('#feedback').textContent()).toBe(activity.hint);
      await page.locator(`[data-answer="${activity.answerId}"]`).click();
      expect(await page.locator('#feedback').textContent()).toBe(activity.explanation);
      const payload = JSON.parse((await page.locator('#wwm-learning').textContent()) ?? '{}');
      expect(payload.activities.find((item: { id: string }) => item.id === activity.id).objective).toBe(
        activity.objective,
      );
    }
    expect(errors).toEqual([]);
    await context.close();
  });

  it('requires review, persists a family version, exports, and restores the baseline', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(`${base}/`);
    await page.locator('#interests').fill('Space explorers');
    await page.getByRole('button', { name: 'Create an AI prompt' }).click();
    expect(await page.locator('#ai-prompt').inputValue()).toContain('Space explorers');
    await page.locator('.import-panel summary').click();
    await page.locator('#draft-json').fill('{"title":"bad draft"}');
    await page.getByRole('button', { name: 'Review proposed changes' }).click();
    expect(await page.locator('#parent-feedback').textContent()).toContain('does not match');
    const draft = {
      baselineId: baselinePath.id,
      baselineVersion: baselinePath.version,
      title: 'Space discoveries',
      description: 'Explore together.',
      introductions: baselinePath.activities.map((activity) => ({
        activityId: activity.id,
        text: 'Imagine a mission to a new planet.',
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
    await page.goto(`${base}/lessons/count-three/`);
    expect(await page.locator('[data-learning-field="introduction"]').textContent()).toBe(
      draft.introductions[0]?.text,
    );
    expect(JSON.parse((await page.locator('#wwm-learning').textContent()) ?? '{}').title).toBe(draft.title);
    await page.goto(`${base}/`);
    await page.getByRole('button', { name: 'Restore original path' }).click();
    await page.reload();
    expect(await page.locator('[data-path-title]').textContent()).toBe(baselinePath.title);
    await context.close();
  });

  it('keeps mobile and desktop pages within the viewport', async () => {
    for (const [name, width, height] of [
      ['desktop', 1440, 1100],
      ['mobile', 390, 844],
    ] as const) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      for (const [route, label] of [
        ['/', 'path'],
        ['/lessons/finish-pattern/', 'activity'],
      ] as const) {
        await page.goto(`${base}${route}`);
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
          true,
        );
        if (shots)
          await page.screenshot({
            path: join(shots, `${name}-${label}.png`),
            fullPage: true,
            animations: 'disabled',
          });
      }
      await context.close();
    }
  });

  it('wraps valid long family text and recovers from corrupt saved data', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(`${base}/`);
    await page.locator('.import-panel summary').click();
    const draft = {
      baselineId: baselinePath.id,
      baselineVersion: baselinePath.version,
      title: 'A'.repeat(80),
      description: 'B'.repeat(400),
      introductions: baselinePath.activities.map((activity) => ({
        activityId: activity.id,
        text: 'Explore together.',
      })),
    };
    await page.locator('#draft-json').fill(JSON.stringify(draft));
    await page.getByRole('button', { name: 'Review proposed changes' }).click();
    await page.getByRole('button', { name: 'Use this family version' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => localStorage.setItem('wwm-learning:family-fork:v1', '{bad-json'));
    await page.reload();
    expect(await page.locator('[data-path-title]').textContent()).toBe(baselinePath.title);
    expect(await page.locator('#saved-state').textContent()).toContain('could not be loaded');
    await page.getByRole('button', { name: 'Restore original path' }).click();
    expect(await page.locator('#saved-state').textContent()).toContain('Using the original');
    await context.close();
  });
});
