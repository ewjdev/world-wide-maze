import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../../../apps/education/node_modules/playwright/index.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const lessons = manifest.lessons.map(({ id }) =>
  JSON.parse(fs.readFileSync(path.join(root, 'lessons', id, 'lesson.json'), 'utf8')),
);
assert.equal(lessons.length, 10, 'Complete all ten lesson packs before final verification');
const screenshots = path.join(root, 'review-screenshots');
fs.mkdirSync(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
const url = new URL(`file://${path.join(root, 'index.html')}`).href;
const brokenImages = async () =>
  page
    .locator('img:visible')
    .evaluateAll((images) =>
      images.filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.src),
    );
const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
const ensureImages = async () => {
  await page
    .locator('img:visible')
    .evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
  assert.deepEqual(await brokenImages(), []);
};
try {
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  await ensureImages();
  assert.equal(await page.locator('.lesson-card').count(), 10);
  assert.equal(await overflow(), false);
  await page.screenshot({ path: path.join(screenshots, 'overview-desktop.png'), fullPage: true });
  let roundCount = 0;
  let acceptedAnswers = 0;
  let alternativeAnswers = 0;
  for (const lesson of lessons) {
    await page.getByRole('button', { name: `Review ${lesson.title}`, exact: true }).click();
    assert.equal(await page.locator('#lesson-title').textContent(), lesson.title);
    for (const [i, round] of lesson.rounds.entries()) {
      await page.locator('.round-tab').nth(i).click();
      await ensureImages();
      assert.equal(await page.locator('#question-prompt').textContent(), round.prompt);
      assert.equal(await page.locator('.choice').count(), round.choices.length);
      assert.equal(await overflow(), false);
      const incorrect = round.choices.find((choice) => !round.correctChoiceIds.includes(choice.id));
      if (incorrect) {
        await page.locator(`.choice[data-choice="${incorrect.id}"]`).click();
        assert.ok((await page.locator('#feedback').textContent()).includes(round.hints[0]));
        await page.locator('#reset-round').click();
      }
      for (const id of round.correctChoiceIds) {
        await page.locator(`.choice[data-choice="${id}"]`).click();
        assert.equal(await page.locator('#feedback').textContent(), round.success);
        acceptedAnswers++;
        if (round.correctChoiceIds.length > 1) alternativeAnswers++;
      }
      await page.locator('#reset-round').click();
      for (let h = 0; h < 3; h++) {
        await page.locator('#show-hint').click();
        assert.equal(await page.locator('#feedback').textContent(), round.hints[h]);
      }
      assert.equal(await page.locator('#show-hint').isDisabled(), true);
      await page.locator('#show-answer').click();
      assert.equal(await page.locator('.choice.correct').count(), round.correctChoiceIds.length);
      roundCount++;
    }
    await page.locator('.round-tab').nth(0).click();
    if (['rockets', 'letters', 'colors', 'weather'].includes(lesson.id))
      await page.screenshot({ path: path.join(screenshots, `${lesson.id}-desktop.png`), fullPage: true });
    await page.locator('#show-overview').click();
  }
  await page.getByRole('button', { name: `Review ${lessons[0].title}`, exact: true }).click();
  await page.locator('#review-decision').selectOption('revise');
  await page.locator('#review-notes').fill('Verification note: test browser storage and portable export.');
  await page.reload();
  assert.equal(await page.locator('#review-decision').inputValue(), 'revise');
  assert.equal(
    await page.locator('#review-notes').inputValue(),
    'Verification note: test browser storage and portable export.',
  );
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#export-notes').click();
  const download = await downloadEvent;
  const exportPath = path.join(screenshots, 'verified-notes-export.json');
  await download.saveAs(exportPath);
  const notes = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
  assert.equal(notes.reviews.length, 10);
  assert.equal(notes.reviews[0].decision, 'revise');
  await page.evaluate(() => localStorage.removeItem('wwm-lesson-review-2026-09-30'));
  await page.reload();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const lesson of lessons) {
      await page.goto(`${url}#${lesson.id}`);
      await ensureImages();
      assert.equal(await overflow(), false, `${lesson.id} overflows ${width}px`);
      assert.ok(await page.locator('#question-prompt').isVisible());
      assert.ok(await page.locator('#review-notes').isVisible());
    }
    if (width === 390) {
      await page.goto(`${url}#letters`);
      await ensureImages();
      await page.screenshot({ path: path.join(screenshots, 'letters-mobile.png'), fullPage: true });
      await page.locator('#show-overview').click();
      await ensureImages();
      await page.screenshot({ path: path.join(screenshots, 'overview-mobile.png'), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  const htmlEscape = (value) =>
    String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  for (let batch = 0; batch < 5; batch++) {
    const pairs = lessons
      .flatMap((lesson) => lesson.rounds.map((round, i) => ({ lesson, round, i })))
      .slice(batch * 10, batch * 10 + 10);
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#f8f8f8;color:#20262d;font:18px/1.4 Arial,sans-serif}h1{margin:0 0 20px;font-size:26px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}figure{margin:0;background:white;padding:16px;border-radius:12px;break-inside:avoid}h2{font-size:18px;margin:0 0 8px}img{width:100%;aspect-ratio:800/440;object-fit:contain}figcaption{font-size:17px;margin-top:10px}</style></head><body><h1>Question diagrams · Review sheet ${batch + 1} of 5</h1><div class="grid">${pairs.map(({ lesson, round, i }) => `<figure><h2>${htmlEscape(lesson.category)} · Question ${i + 1}</h2><img src="${new URL(`file://${path.join(root, 'lessons', lesson.id, round.scene)}`).href}" alt=""><figcaption>${htmlEscape(round.prompt)}</figcaption></figure>`).join('')}</div></body></html>`;
    await page.setContent(html);
    await page.locator('img').evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
    await page.screenshot({
      path: path.join(screenshots, `question-sheet-${batch + 1}.png`),
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  const report = {
    result: 'PASS',
    lessons: 10,
    questionScenes: roundCount,
    correctAnswersExercised: acceptedAnswers,
    acceptedAlternativeAnswers: alternativeAnswers,
    checks: [
      'all visible concept images and 50 SVGs decoded',
      'all question prompts and choices match content',
      'incorrect answer, all correct alternatives, hint ladder, answer reveal and reset',
      'browser notes persist after reload',
      '10-lesson notes export downloaded and parsed',
      '10 lessons fit desktop, 390px and 320px viewports',
      'no browser JavaScript errors',
    ],
    screenshots: fs.readdirSync(screenshots).filter((file) => file.endsWith('.png')),
    limitations: [
      'Static concept diagrams do not implement planned visual demonstrations.',
      'Browser voice not produced/reviewed narration.',
      'No game integration, educator validation, child playtest, or physical-device acceptance.',
    ],
  };
  fs.writeFileSync(path.join(root, 'verification-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
