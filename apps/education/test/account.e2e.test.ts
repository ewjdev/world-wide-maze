/**
 * Phase 31 M3 browser acceptance for the family account pages, end to end against the real Worker in workerd
 * (wrangler's test harness, local D1 + Durable Objects + the development mock mailbox) behind this app's Vite
 * dev server (which proxies /api, as `pnpm dev:education` does):
 *
 *   grown-up signs in through the emailed link (mock mailbox) → adds a passkey (Chromium's virtual
 *   authenticator) → signs out and back in with it → shows a pairing code + QR → a second browser context (the
 *   child's tablet) opens the QR link and links itself → the tablet sends practice → the grown-up sees it, the
 *   device list, the export; revoking the tablet stops it; typed-confirmation delete removes the family.
 *
 * Runs whenever Playwright's Chromium is installed (as the game e2e does); skipped otherwise.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  evidenceId,
  type FamilyExport,
  type LearningEvidence,
  newProfileId,
  type Profile,
} from '@wwm/learning';
import { type Browser, chromium, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_CHROMIUM = existsSync(chromium.executablePath()) || !!process.env.CI;
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const WORKER_CONFIG = fileURLToPath(new URL('../../worker/wrangler.jsonc', import.meta.url));
const PORT = 5293;
const BASE = `http://localhost:${PORT}`;

type Harness = ReturnType<typeof import('wrangler').createTestHarness>;
/** `WWM_ACCOUNT_SHOTS=/tmp/dir` saves screenshots of each state (reviewed by hand, not committed). */
const SHOTS = process.env.WWM_ACCOUNT_SHOTS;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

/** The paired device's bearer token, read the way the app keeps it: in the progress store's `meta`. */
async function readDeviceToken(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('wwm-learning-progress');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const get = open.result.transaction('meta').objectStore('meta').get('deviceToken');
      get.onsuccess = () => resolve((get.result as string | undefined) ?? null);
      get.onerror = () => reject(get.error);
    };
  });
}

describe.skipIf(!HAS_CHROMIUM)('family account pages (Chromium + workerd)', { timeout: 120_000 }, () => {
  let harness: Harness;
  let server: ViteDevServer;
  let browser: Browser;
  const problems: string[] = [];

  function watch(page: Page, who: string) {
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`${who} [error] ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`${who} [pageerror] ${e.message}`));
  }

  beforeAll(async () => {
    execFileSync('node', ['--experimental-strip-types', 'scripts/generate.ts'], {
      cwd: ROOT,
      stdio: 'ignore',
    });
    const { createTestHarness } = await import('wrangler');
    harness = createTestHarness();
    await harness.update({
      workers: [
        {
          configPath: WORKER_CONFIG,
          vars: { LEARNING_ACCOUNTS: 'on', LEARNING_ORIGIN: BASE, LEARNING_RP_ID: 'localhost' },
        },
      ],
    });
    const { url } = await harness.listen();
    await harness.getWorker().applyD1Migrations('LEARNING_DB');
    process.env.WWM_API_URL = url.toString().replace(/\/$/, '');
    server = await createServer({
      root: ROOT,
      configFile: `${ROOT}vite.config.ts`,
      logLevel: 'error',
      server: { port: PORT, strictPort: true, host: '127.0.0.1' },
    });
    await server.listen();
    browser = await chromium.launch();
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    await harness?.close();
  });

  /** Read the development mock mailbox through the app's own /api proxy. */
  async function signInLink(page: Page, email: string): Promise<string> {
    for (let i = 0; i < 100; i++) {
      const messages = (
        await page.evaluate(
          async (to) =>
            (await (await fetch(`/api/learning/dev/mailbox?to=${encodeURIComponent(to)}`)).json()) as {
              messages: { text: string }[];
            },
          email,
        )
      ).messages;
      const link = /(http\S+\/learn\/account\/verify#token=[A-Za-z0-9_-]+)/.exec(
        messages.at(-1)?.text ?? '',
      )?.[1];
      if (link) return link;
      await page.waitForTimeout(50);
    }
    throw new Error('no sign-in email');
  }

  it('signs in by email, adds a passkey, pairs a child device, syncs, exports, revokes and deletes', async () => {
    const parentContext = await browser.newContext({ acceptDownloads: true });
    const parent = await parentContext.newPage();
    watch(parent, 'parent');
    const email = `grown-up-${Date.now()}@example.org`;

    // ── sign in by email with consent ──
    await parent.goto(`${BASE}/account/`);
    await expect
      .poll(() => parent.textContent('#account-status'), { timeout: 15_000 })
      .toBe('Not signed in.');
    await shot(parent, 'account-signed-out');
    await parent.fill('#email', email);
    await parent.check('#consent');
    await parent.click('#email-submit');
    await expect.poll(() => parent.textContent('#email-feedback'), { timeout: 15_000 }).toContain('Check');
    const link = await signInLink(parent, email);
    expect(link.startsWith(`${BASE}/learn/account/verify#token=`)).toBe(true);
    await parent.goto(link);
    await parent.waitForURL(`${BASE}/account/`);
    await expect
      .poll(() => parent.textContent('#account-status'), { timeout: 15_000 })
      .toBe('Signed in as the family’s grown-up.');
    // the token never stays in the address bar or history
    expect(parent.url()).not.toContain('token');

    // ── passkey: add, sign out, sign back in with it ──
    const cdp = await parentContext.newCDPSession(parent);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await parent.click('#add-passkey');
    await expect
      .poll(() => parent.textContent('#passkey-feedback'), { timeout: 15_000 })
      .toContain('Passkey added');
    await expect
      .poll(() => parent.textContent('#passkey-state'), { timeout: 15_000 })
      .toContain('One passkey');
    await parent.click('#sign-out');
    await expect
      .poll(() => parent.textContent('#account-status'), { timeout: 15_000 })
      .toBe('Not signed in.');
    await parent.click('#passkey-login');
    await expect
      .poll(() => parent.textContent('#account-status'), { timeout: 15_000 })
      .toBe('Signed in as the family’s grown-up.');

    // a child profile for the tablet's practice (M2's Progress page makes these; here through the same API)
    const child: Profile = { id: newProfileId(), nickname: 'Robin', avatar: 'pip-green' };
    expect(
      await parent.evaluate(
        async (body) =>
          (
            await fetch('/api/learning/profiles', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            })
          ).status,
        child,
      ),
    ).toBe(201);

    // ── pairing code + QR ──
    await parent.click('#make-code');
    await expect
      .poll(() => parent.textContent('#pair-code-text'), { timeout: 15_000 })
      .toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const code = (await parent.textContent('#pair-code-text')) ?? '';
    const qrText = await parent.getAttribute('#pair-qr svg', 'data-text');
    expect(qrText).toBe(`${BASE}/account/#pair=${code}`);
    expect(await parent.locator('#pair-qr svg path').getAttribute('d')).toMatch(/^M\d+ \d+h1v1h-1z/);
    await expect
      .poll(() => parent.textContent('#pair-expiry'), { timeout: 15_000 })
      .toContain('10 more minutes');
    await shot(parent, 'account-pair-code');

    // ── the child's tablet: a separate browser context opens the QR link ──
    const tabletContext = await browser.newContext();
    const tablet = await tabletContext.newPage();
    watch(tablet, 'tablet');
    await tablet.goto(qrText as string);
    await expect.poll(() => tablet.inputValue('#pair-code'), { timeout: 15_000 }).toBe(code);
    expect(tablet.url()).not.toContain('pair=');
    await tablet.fill('#device-label', 'Kitchen tablet');
    await tablet.click('#claim-form button[type="submit"]');
    await expect
      .poll(() => tablet.textContent('#account-status'), { timeout: 15_000 })
      .toBe('This is a child’s device.');
    expect(await tablet.textContent('#device-linked-text')).toContain('Kitchen tablet');
    await shot(tablet, 'account-device-linked');

    // the tablet sends practice with its bearer token, which pairing saved in the progress store
    let t = Date.now() - 3 * 60_000;
    const events: LearningEvidence[] = [0, 1, 2].map(() => {
      t += 60_000;
      return {
        v: 1,
        id: evidenceId(t),
        profile: child.id,
        at: new Date(Math.floor(t / 60_000) * 60_000).toISOString(),
        activity: 'compare-groups',
        objective: 'compare-groups',
        round: 'warm-up',
        item: 'c'.repeat(32),
        source: 'lesson',
        fresh: true,
        outcome: 'first-try',
        helpLevel: 0,
        surface: 'lesson',
        input: 'tap',
        duration: 'lt30s',
      };
    });
    const token = await tablet.evaluate(readDeviceToken);
    expect(token).toMatch(/\S{20,}/);
    const sent = await tablet.evaluate(
      async ([batch, token]) => {
        const res = await fetch('/api/learning/events', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ events: batch }),
        });
        return res.json();
      },
      [events, token] as const,
    );
    expect(sent).toEqual({ accepted: 3, duplicate: 0, rejected: [] });
    // a device can't read progress
    expect(
      await tablet.evaluate(async (token) => {
        return (await fetch('/api/learning/events', { headers: { authorization: `Bearer ${token}` } }))
          .status;
      }, token),
    ).toBe(401);

    // ── the grown-up sees the practice, the device, and can export everything ──
    const seen = await parent.evaluate(
      async () => ((await (await fetch('/api/learning/events')).json()) as { events: unknown[] }).events,
    );
    expect(seen).toEqual(events);
    await parent.reload();
    await expect
      .poll(() => parent.textContent('#device-list'), { timeout: 15_000 })
      .toContain('Kitchen tablet');
    await parent.setViewportSize({ width: 390, height: 844 });
    await shot(parent, 'account-signed-in-mobile');
    await parent.setViewportSize({ width: 1280, height: 720 });
    const [download] = await Promise.all([parent.waitForEvent('download'), parent.click('#export')]);
    const exported = JSON.parse(await readFile((await download.path()) as string, 'utf8')) as FamilyExport;
    expect(exported.family.email).toBe(email);
    expect(exported.profiles).toEqual([child]);
    expect(exported.devices.map((d) => d.label)).toEqual(['Kitchen tablet']);
    expect(exported.events).toEqual(events);

    // ── revoke the tablet: its token stops working at once ──
    await parent.click('#device-list button');
    await expect
      .poll(() => parent.textContent('#devices-feedback'), { timeout: 15_000 })
      .toContain('can no longer send practice');
    await tablet.reload();
    await expect
      .poll(() => tablet.textContent('#account-status'), { timeout: 15_000 })
      .toBe('Not signed in.');

    // ── delete the family with typed confirmation ──
    await parent.click('#delete-panel summary');
    expect(await parent.isDisabled('#delete-family')).toBe(true);
    await parent.fill('#delete-confirm', 'delete');
    expect(await parent.isDisabled('#delete-family')).toBe(true);
    await parent.fill('#delete-confirm', 'DELETE');
    await parent.click('#delete-family');
    await expect
      .poll(() => parent.textContent('#account-status'), { timeout: 15_000 })
      .toContain('has been deleted');
    expect(await parent.evaluate(async () => (await fetch('/api/learning/session')).json())).toEqual({
      signedIn: false,
    });

    expect(problems.filter((p) => !/401|Unauthorized|status of 4\d\d/.test(p))).toEqual([]);
    await tabletContext.close();
    await parentContext.close();
  });

  it('a used or broken link explains itself', async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE}/learn/account/verify#token=${'x'.repeat(43)}`);
    await expect
      .poll(() => page.textContent('#verify-status'), { timeout: 15_000 })
      .toContain('expired or was already used');
    expect(page.url()).not.toContain('token');
    expect(await page.isVisible('#verify-continue')).toBe(true);
    await page.close();
  });
});
