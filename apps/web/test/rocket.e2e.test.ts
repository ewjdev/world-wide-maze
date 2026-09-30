/** Built two-app review artifact, under the actual static-asset CSP. No live API writes. */
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rocketPortableHtml } from '../../education/src/rocket-render.ts';
import { SPA_SECURITY_HEADERS } from '../../worker/src/security.ts';
import { browserEnv, CHROMIUM_ARGS, CI_HOOKS } from './browser-env.ts';

const base = process.env.WWM_ROCKET_E2E_BASE;
const shots = process.env.WWM_ROCKET_SHOTS;
type Debug = {
  tick: number;
  timer: { running: boolean };
  learning: {
    gate: { round: string; solved: boolean } | null;
    binding: { locks: { kind: string; open: boolean }[]; steps: { portalId: number | null }[] };
  };
};
describe.skipIf(!base)('Rocket Lab built artifact', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ args: CHROMIUM_ARGS });
  });
  afterAll(async () => {
    await browser?.close();
  });
  async function open(path: string, width = 1280, height = 900, reduced = false) {
    const ctx = await browser.newContext({
      viewport: { width, height },
      reducedMotion: reduced ? 'reduce' : 'no-preference',
      acceptDownloads: true,
    });
    await browserEnv(ctx);
    await ctx.addInitScript((ci) => {
      Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true });
      localStorage.setItem('wwm.howtoSeen', '1');
      localStorage.setItem('wwm.tutorialDone', '1');
      localStorage.setItem('wwm-learning.muted', '1');
      localStorage.setItem('wwm-learning:family-fork:v1', 'preserve-my-family-draft');
      Object.assign(window, {
        __WWM_TEST__: { ...ci, skipIntro: true, noAutoPause: true, timeScale: 2, learningSeed: 0 },
      });
    }, CI_HOOKS);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && /Content Security|Refused to/.test(m.text())) errors.push(m.text());
    });
    await page.route('**/*.mp3', (r) => r.abort());
    await page.route('**/api/**', (r) =>
      r.fulfill({ status: 503, contentType: 'application/json', body: '{"code":"UNAVAILABLE"}' }),
    );
    await page.route('**/*', async (route) => {
      const req = route.request();
      if (req.resourceType() !== 'document') return route.fallback();
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), ...SPA_SECURITY_HEADERS } });
    });
    await page.goto(`${base}${path}`);
    return { page, ctx, errors };
  }
  const shot = async (page: Page, name: string) => {
    if (shots) {
      await mkdir(shots, { recursive: true });
      await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true, animations: 'disabled' });
    }
  };
  const ready = (page: Page) =>
    page.waitForFunction(() => !document.querySelector('#stage')?.getAttribute('data-effect'), undefined, {
      timeout: 45000,
    });
  const dbg = (page: Page) =>
    page.evaluate(() => (window as unknown as { __wwmGame: { debugState(): Debug } }).__wwmGame.debugState());
  const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  it('delivers a real standalone document and its own compiled assets', async () => {
    const res = await fetch(`${base}/education/lessons/rocket-lab/`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('data-learning-activity="rocket-lab"');
    expect(html).not.toContain('<div id="root">');
    const urls = [...html.matchAll(/(?:src|href)="(\/education\/assets\/[^"]+)"/g)].map((m) => m[1]!);
    expect(urls.length).toBeGreaterThan(1);
    for (const url of urls) {
      const r = await fetch(`${base}${url}`);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).not.toContain('text/html');
    }
  });
  it('teaches, replays, helps, explains four predictions, skips space and restarts', async () => {
    const { page, ctx, errors } = await open('/education/lessons/rocket-lab/');
    expect(await page.getByRole('button', { name: 'Unmute Pip' }).count()).toBe(1);
    await page.getByRole('button', { name: 'Tap Pip to start' }).click();
    expect(await page.locator('#stage').getAttribute('data-effect')).toBe('intro');
    expect(await page.locator('[data-answer]').first().isDisabled()).toBe(true);
    await page.getByRole('button', { name: 'Watch or hear it again' }).click();
    await shot(page, 'standalone-intro');
    await ready(page);
    await shot(page, 'standalone-balloon');
    await page.locator('[data-answer="triangle"]').click();
    expect(await page.locator('#feedback').textContent()).toContain('opening');
    await page.getByRole('button', { name: 'Help me' }).click();
    await ready(page);
    for (const [i, answer] of ['circle', 'triangle', 'stay', 'star'].entries()) {
      expect(await page.locator('#stage').getAttribute('data-learning-round')).toBe(`r${i + 1}`);
      if (i === 3) await shot(page, 'standalone-upright-rocket');
      await page.locator(`[data-answer="${answer}"]`).click();
      expect(await page.locator('#stage').getAttribute('data-effect')).toBe('explain');
      expect(await page.locator('#stage').getAttribute('data-solved')).toBe('false');
      await page.keyboard.press('Enter');
      expect(await page.locator('#stage').getAttribute('data-learning-round')).toBe(`r${i + 1}`);
      await ready(page);
      expect(await page.locator('#stage').getAttribute('data-solved')).toBe('true');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await shot(page, 'standalone-finish');
    expect(await page.locator('#end').isVisible()).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('wwm-learning:family-fork:v1'))).toBe(
      'preserve-my-family-draft',
    );
    const download = page.waitForEvent('download');
    await page.getByText('For grown-ups: the learning idea', { exact: true }).click();
    await page.getByRole('button', { name: 'Download learning HTML' }).click();
    const path = await (await download).path();
    expect(path).not.toBeNull();
    const html = await readFile(path!, 'utf8');
    expect(html).toContain('Watch the push: before and after');
    expect(html).not.toContain('type="module"');
    await page.getByRole('button', { name: 'Try it again' }).click();
    expect(await page.locator('#intro').isVisible()).toBe(true);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 180000);
  it('fits 320px, supports keyboard and reduced-motion space and finish', async () => {
    const { page, ctx, errors } = await open('/education/lessons/rocket-lab/', 320, 740, true);
    await page.getByRole('button', { name: 'Tap Pip to start' }).click();
    await ready(page);
    await shot(page, 'standalone-mobile-balloon');
    expect(await overflow(page)).toBe(false);
    for (const [i, index] of [0, 1, 1, 0].entries()) {
      await page.keyboard.press('ArrowRight');
      if (index) await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Enter');
      await ready(page);
      if (i === 3) await shot(page, 'standalone-mobile-rocket');
      const boxes = await page
        .locator('[data-answer]')
        .evaluateAll((es) => es.map((e) => e.getBoundingClientRect().height));
      expect(Math.min(...boxes)).toBeGreaterThanOrEqual(44);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Try it in space', exact: true }).click();
    await shot(page, 'standalone-mobile-space');
    expect(await overflow(page)).toBe(false);
    await page.locator('[data-answer="triangle"]').click();
    await ready(page);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    expect(await page.locator('#end').isVisible()).toBe(true);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 150000);
  it('rolls a real marble into Pip, waits for explanation, and completes every maze checkpoint', async () => {
    const { page, ctx, errors } = await open('/play/practice?learn=rocket-lab', 1280, 900);
    await page.waitForFunction(() => document.body.dataset.phase === 'play', undefined, { timeout: 60000 });
    const first = (await dbg(page)).learning.binding.steps.find((s) => s.portalId !== null)?.portalId;
    expect(first).not.toBeUndefined();
    expect(
      await page.evaluate(
        (id) =>
          (
            window as unknown as { __wwmGame: { debugRollIntoPortal(id: number, m: number): boolean } }
          ).__wwmGame.debugRollIntoPortal(id!, 4),
        first,
      ),
    ).toBe(true);
    await page.waitForSelector('[data-testid="learning-gate"]', { timeout: 15000 });
    await shot(page, 'game-intro');
    const tick = (await dbg(page)).tick;
    expect((await dbg(page)).timer.running).toBe(false);
    await page.waitForFunction(
      () => document.querySelector('[data-testid="lgate-prompt"]')?.textContent?.startsWith('Air comes out'),
      undefined,
      { timeout: 45000 },
    );
    await shot(page, 'game-balloon');
    for (const [i, answer] of ['circle', 'triangle', 'stay', 'star'].entries()) {
      await page.waitForSelector(`[data-testid="lgate-card"][data-round="r${i + 1}"]`);
      if (i === 3) await shot(page, 'game-upright-rocket');
      await page.locator(`[data-testid="lgate-choice-${answer}"]`).click();
      expect((await dbg(page)).learning.gate?.solved).toBe(false);
      expect((await dbg(page)).learning.binding.locks.find((l) => l.kind === 'goal')?.open).toBe(false);
      if (i === 0) {
        await page.getByTestId('lgate-later').click();
        await page.evaluate(() =>
          (
            window as unknown as { __wwmGame: { learning: { open(id: number): boolean } } }
          ).__wwmGame.learning.open(-1),
        );
      }
      await page.waitForFunction(
        () => document.querySelector('[data-testid="lgate-card"]')?.getAttribute('data-solved') === 'true',
        undefined,
        { timeout: 45000 },
      );
      if (i === 0) expect((await dbg(page)).tick).toBeGreaterThanOrEqual(tick);
      await page.getByTestId('lgate-rollon').click();
      if (i < 3)
        await page.evaluate(() =>
          (
            window as unknown as { __wwmGame: { learning: { open(id: number): boolean } } }
          ).__wwmGame.learning.open(-1),
        );
    }
    expect((await dbg(page)).learning.binding.locks.find((l) => l.kind === 'goal')?.open).toBe(true);
    await page.getByTestId('lgate-bonus-skip').click();
    expect(await page.getByTestId('lgate-card').textContent()).toContain('rocket gets pushed');
    await page.waitForSelector('[data-testid="learning-gate"][data-mode="done"]');
    await shot(page, 'game-finish');
    expect(errors).toEqual([]);
    await ctx.close();
  }, 180000);
  it('imports the portable file and keeps the mobile game lesson usable', async () => {
    const { page, ctx, errors } = await open('/');
    await page.waitForSelector('[data-testid="start"]:not([disabled])', { timeout: 60000 });
    await page.getByTestId('start').click();
    await page.waitForFunction(() => document.body.dataset.phase === 'pairing');
    await page.getByTestId('play-keyboard').click();
    await page.waitForFunction(() => document.body.dataset.phase === 'select');
    await page.setInputFiles('[data-testid="learning-file"]', {
      name: 'pip-rocket-lab.html',
      mimeType: 'text/html',
      buffer: Buffer.from(rocketPortableHtml()),
    });
    await page.waitForSelector('[data-testid="learning-lesson"]');
    expect(await page.getByTestId('learning-lesson').textContent()).toContain('Rocket Lab');
    await page.getByTestId('site-practice').click();
    await page.waitForFunction(() => document.body.dataset.phase === 'play', undefined, { timeout: 60000 });
    await page.evaluate(() =>
      (
        window as unknown as { __wwmGame: { learning: { open(id: number): boolean } } }
      ).__wwmGame.learning.open(-1),
    );
    await page.waitForSelector('[data-testid="learning-gate"]');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="lgate-prompt"]')?.textContent?.startsWith('Air comes out'),
      undefined,
      { timeout: 45000 },
    );
    expect(await overflow(page)).toBe(false);
    await shot(page, 'game-mobile-balloon');
    const hit = await page.getByTestId('lgate-choice-circle').boundingBox();
    expect(hit?.height).toBeGreaterThanOrEqual(44);
    await page.getByTestId('lgate-choice-circle').click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="lgate-card"]')?.getAttribute('data-solved') === 'true',
      undefined,
      { timeout: 45000 },
    );
    expect((await dbg(page)).learning.binding.locks.find((l) => l.kind === 'goal')?.open).toBe(false);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120000);
});
