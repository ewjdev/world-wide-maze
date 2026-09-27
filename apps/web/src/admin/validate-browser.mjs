/** Synthetic UI validation only. Start Vite, then run: node apps/web/src/admin/validate-browser.mjs
 * Optional: ADMIN_TEST_URL=http://localhost:5198 ADMIN_SCREENSHOT_DIR=/tmp/wwm-admin-validation
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.ADMIN_TEST_URL || 'http://localhost:5198';
const output = process.env.ADMIN_SCREENSHOT_DIR || '/tmp/wwm-admin-validation';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const failures = [];
page.on('pageerror', (error) => failures.push(error.message));
let mode = 'ready';
const mutations = [];
let imageRequests = 0;
const run = {
  runId: 'review-fixture',
  submittedUrl: 'https://example.com/learning',
  url: 'https://example.com/learning',
  host: 'example.com',
  title: 'Learning garden — synthetic review fixture',
  status: 'pending_review',
  reason: 'Provider unavailable; review required.',
  createdAt: '2026-09-26T12:00:00Z',
  artifactsAvailable: true,
  curated: false,
  refreshRequested: false,
  provider: 'unconfigured',
  policyVersion: 'human-review-v1',
  captureId: 'capture-fixture',
  screenshotUrl: '/api/admin/evidence/capture-fixture/screenshot',
  stages: [],
  textures: [{ slice: 0, evidenceUrl: '/api/admin/evidence/capture-fixture/texture-0' }],
  rules: [
    {
      scope: 'domain',
      target: 'example.com',
      blocked: true,
      reason: 'Synthetic rule for validation',
      updatedAt: '2026-09-26T12:00:00Z',
    },
  ],
  events: [
    {
      id: 'event-1',
      actor: 'test-operator@example.com',
      action: 'pending_review',
      reason: 'Provider unavailable; review required.',
      createdAt: '2026-09-26T12:00:00Z',
    },
  ],
};
await page.route('**/api/admin/**', async (route) => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  if (mode === 'unauthorized' || mode === 'unconfigured')
    return route.fulfill({ status: mode === 'unauthorized' ? 401 : 503, json: { error: mode } });
  if (request.method() === 'POST') {
    mutations.push({ path, body: request.postDataJSON() });
    if (mode === 'action-error')
      return route.fulfill({
        status: 409,
        json: { error: 'The run changed. Reload and review its current state.' },
      });
    if (path.endsWith('/decision')) run.status = request.postDataJSON().status;
    return route.fulfill({ json: { ok: true } });
  }
  if (path.includes('/evidence/')) {
    imageRequests += 1;
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="320"><rect width="800" height="320" fill="#efece4"/><text x="32" y="80" font-family="sans-serif" font-size="32" fill="#16181d">Owned test site</text><text x="32" y="135" font-family="sans-serif" font-size="20" fill="#353a44">Synthetic capture evidence for UI validation</text></svg>',
    });
  }
  if (path.endsWith('/rules')) return route.fulfill({ json: { items: run.rules } });
  if (path.endsWith('/attempts'))
    return route.fulfill({
      json: {
        items: [
          {
            jobId: 'failed-job',
            url: 'https://example.org/failed',
            status: 'failed',
            reason: 'Capture timed out',
            runId: null,
            updatedAt: '2026-09-26T12:00:00Z',
          },
        ],
        nextCursor: null,
      },
    });
  if (path.includes('/catalog')) {
    if (mode === 'loading') await new Promise((resolve) => setTimeout(resolve, 500));
    return route.fulfill({ json: { items: [run], nextCursor: 'page-2' } });
  }
  return route.fulfill({ json: run });
});
try {
  mode = 'loading';
  await page.goto(`${base}/admin`);
  await page.getByText('Loading catalog…', { exact: true }).waitFor();
  await page.getByRole('button', { name: /Learning garden/ }).waitFor();
  mode = 'ready';
  await page.getByRole('button', { name: 'Manage URL and domain policy' }).click();
  await page.getByLabel('Rule target').fill('https://never-captured.example/');
  await page.getByLabel('Rule reason').fill('Prevent first capture');
  const ruleForm = page.getByRole('form', { name: 'Set URL or domain rule' });
  assert.equal(await ruleForm.getByRole('button', { name: 'Confirm rule change' }).isDisabled(), true);
  await ruleForm.getByRole('checkbox').check();
  await ruleForm.getByRole('button', { name: 'Confirm rule change' }).click();
  await page.getByText('Blocked https://never-captured.example/.', { exact: true }).waitFor();
  assert.deepEqual(mutations.pop(), {
    path: '/api/admin/rules',
    body: {
      scope: 'url',
      target: 'https://never-captured.example/',
      blocked: true,
      reason: 'Prevent first capture',
    },
  });
  await page.getByRole('button', { name: 'Hide URL and domain policy' }).click();
  await page.getByRole('button', { name: 'Inspect capture attempts' }).click();
  await page.getByText('Capture timed out', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Hide capture attempts' }).click();
  await page.getByRole('button', { name: /Learning garden/ }).click();
  await page.getByRole('heading', { name: 'Capture evidence' }).waitFor();
  assert.equal(imageRequests, 0, 'Evidence must not load before disclosure');
  await page.getByText('Show screenshot and 1 slice previews').click();
  await page.getByAltText('Full capture of example.com').waitFor();
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });
  await page.getByRole('button', { name: 'Remove artifacts', exact: true }).click();
  const confirm = page.getByRole('button', { name: 'Confirm remove artifacts' });
  assert.equal(await confirm.isDisabled(), true);
  await page.getByLabel('Reason for this action').fill('Synthetic removal check');
  assert.equal(await confirm.isDisabled(), true, 'A reason alone cannot remove content');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(mutations.length, 0, 'Opening and cancelling must never mutate');
  await page.getByRole('button', { name: 'Block run', exact: true }).click();
  await page.getByLabel('Reason for this action').fill('Synthetic block check');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirm block run' }).click();
  await page.getByText('Block run: saved for example.com.').waitFor();
  assert.deepEqual(mutations[0], {
    path: '/api/admin/runs/review-fixture/decision',
    body: { status: 'blocked', reason: 'Synthetic block check' },
  });
  mode = 'action-error';
  await page.getByRole('button', { name: 'Approve run', exact: true }).click();
  await page.getByLabel('Reason for this action').fill('Synthetic error check');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirm approve run' }).click();
  await page.getByRole('alert').filter({ hasText: 'The run changed' }).waitFor();
  assert.equal(await page.getByLabel('Reason for this action').inputValue(), 'Synthetic error check');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  mode = 'ready';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'Mobile must not overflow horizontally',
  );
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByText('Page 2', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await page.getByText('Page 1', { exact: true }).waitFor();
  mode = 'unauthorized';
  await page.reload();
  await page.getByRole('alert').filter({ hasText: 'Operator access required' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Approve run', exact: true }).count(), 0);
  mode = 'unconfigured';
  await page.getByRole('button', { name: 'Retry catalog' }).click();
  await page.getByRole('alert').filter({ hasText: 'Administration is unavailable' }).waitFor();
  assert.deepEqual(failures, []);
  console.log(
    JSON.stringify({
      result: 'passed',
      checks: [
        'loading',
        'evidence disclosure',
        'desktop and mobile',
        'no horizontal overflow',
        'reason and confirmation',
        'cancel without mutation',
        'decision request and response',
        'action failure recovery',
        'pagination',
        'rules before first capture',
        'failed attempts',
        'unauthorized',
        'unconfigured',
      ],
      screenshots: output,
    }),
  );
} finally {
  await browser.close();
}
