/**
 * Page preparation before extraction/screenshot. Each helper takes a minimal Playwright-like page
 * (`PageLike`, just `evaluate(expression)`), so the same code runs with `playwright` locally and with
 * `@cloudflare/playwright` in the Worker (Phase 07).
 *
 * The in-page bodies below are self-contained functions (no outer references) evaluated through
 * `pageExpression`.
 */
import { pageExpression } from './page-expr.ts';

export interface PageLike {
  evaluate(expression: string): Promise<unknown>;
}

/** Consent-banner "reject"/"accept" buttons, most privacy-preserving first. Order matters. */
export const COOKIE_BUTTON_SELECTORS: readonly string[] = [
  '#onetrust-reject-all-handler',
  '#CybotCookiebotDialogBodyButtonDecline',
  '#didomi-notice-disagree-button',
  '.qc-cmp2-summary-buttons button[mode="secondary"]',
  'button[aria-label="Reject all" i]',
  'button[aria-label="Decline" i]',
  '.fc-cta-do-not-consent',
  '[data-testid="uc-deny-all-button"]',
  '#truste-consent-required',
  '.cky-btn-reject',
  '.govuk-cookie-banner button[value="reject"]',
  '#onetrust-accept-btn-handler',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '#didomi-notice-agree-button',
  '.fc-cta-consent',
  '[data-testid="uc-accept-all-button"]',
  '.cc-dismiss',
  '.cky-btn-accept',
  '#L2AGLb',
];

/** Consent/overlay containers removed outright if still present after clicking. */
export const COOKIE_CONTAINER_SELECTORS: readonly string[] = [
  '#onetrust-consent-sdk',
  '#CybotCookiebotDialog',
  '#didomi-host',
  '.qc-cmp2-container',
  '.fc-consent-root',
  '#usercentrics-root',
  '#truste-consent-track',
  '.cc-window',
  '.cky-consent-container',
  '#cookie-banner',
  '#cookie-notice',
  '#cookieConsent',
  '[id^="sp_message_container"]',
  '[aria-label="cookieconsent" i]',
  '.govuk-cookie-banner',
];

/**
 * Fallback when no known selector matched: inside elements whose id/class/aria-label mentions
 * cookies/consent, click a button whose text reads like "Reject/Decline (all/additional) (cookies)", else
 * one reading like "Accept/Agree/OK", then remove that consent container.
 */
export const COOKIE_TEXT_FALLBACK = {
  container: 'cookie|consent|gdpr|privacy-banner|cmp',
  reject: '^(reject|decline|deny|refuse)( all| additional| optional| non-essential)?( cookies)?$',
  accept: '^(accept|agree|allow|ok|okay|got it|i agree)( all| additional)?( cookies)?$',
};

/** Click the first visible consent button, then remove known consent containers. Returns what it did. */
export async function dismissCookieBanners(
  page: PageLike,
): Promise<{ clicked: string | null; removed: number }> {
  return (await page.evaluate(
    pageExpression(
      (a: {
        buttons: readonly string[];
        containers: readonly string[];
        text: { container: string; reject: string; accept: string };
      }) => {
        let clicked: string | null = null;
        for (const sel of a.buttons) {
          let el: HTMLElement | null = null;
          try {
            el = document.querySelector<HTMLElement>(sel);
          } catch {
            continue;
          }
          if (el && el.offsetParent !== null) {
            el.click();
            clicked = sel;
            break;
          }
        }
        let removed = 0;
        if (!clicked) {
          const containerRe = new RegExp(a.text.container, 'i');
          const isConsent = (el: Element | null): Element | null => {
            for (let e = el; e && e !== document.body; e = e.parentElement) {
              const hint = `${e.id} ${e.getAttribute('class') ?? ''} ${e.getAttribute('aria-label') ?? ''}`;
              if (containerRe.test(hint)) return e;
            }
            return null;
          };
          const candidates = Array.from(
            document.querySelectorAll<HTMLElement>('button, [role="button"], a'),
          ).filter((b) => b.offsetParent !== null && isConsent(b));
          for (const pattern of [a.text.reject, a.text.accept]) {
            const re = new RegExp(pattern, 'i');
            const b = candidates.find((c) => re.test((c.textContent ?? '').replace(/\s+/g, ' ').trim()));
            if (b) {
              b.click();
              clicked = `text:${(b.textContent ?? '').trim()}`;
              const box = isConsent(b);
              if (box?.isConnected) {
                box.remove();
                removed++;
              }
              break;
            }
          }
        }
        for (const sel of a.containers) {
          try {
            for (const el of Array.from(document.querySelectorAll(sel))) {
              el.remove();
              removed++;
            }
          } catch {
            // invalid selector in this engine; ignore
          }
        }
        // Undo common scroll locks set by consent managers.
        for (const el of [document.documentElement, document.body]) {
          if (el && getComputedStyle(el).overflow === 'hidden')
            el.style.setProperty('overflow', 'visible', 'important');
        }
        return { clicked, removed };
      },
      {
        buttons: COOKIE_BUTTON_SELECTORS,
        containers: COOKIE_CONTAINER_SELECTORS,
        text: COOKIE_TEXT_FALLBACK,
      },
    ),
  )) as { clicked: string | null; removed: number };
}

/** Stop CSS animations/transitions, caret blink and smooth scrolling; pause every video (poster frame). */
export async function freezeMotion(page: PageLike): Promise<void> {
  await page.evaluate(
    pageExpression(() => {
      const s = document.createElement('style');
      s.setAttribute('data-wwm', 'freeze');
      s.textContent = `*,*::before,*::after{animation-play-state:paused!important;animation-delay:-0.0001s!important;
        animation-duration:0s!important;transition:none!important;caret-color:transparent!important;
        scroll-behavior:auto!important}`;
      document.head.appendChild(s);
      for (const v of Array.from(document.querySelectorAll('video'))) {
        try {
          v.pause();
          v.currentTime = 0;
        } catch {
          // ignore
        }
      }
      for (const a of document.getAnimations?.() ?? []) {
        try {
          a.finish();
        } catch {
          a.pause();
        }
      }
    }),
  );
}

/**
 * Scroll through the page in viewport steps to trigger lazy loading, then back to the top. Also forces
 * `loading="lazy"` images to eager. Stops at `maxHeight`.
 */
export async function scrollThrough(
  page: PageLike,
  opts: { maxHeight?: number; stepDelayMs?: number; settleMs?: number } = {},
): Promise<void> {
  await page.evaluate(
    pageExpression(
      async (o: { maxHeight: number; stepDelayMs: number; settleMs: number }) => {
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        for (const img of Array.from(document.querySelectorAll('img[loading="lazy"]')))
          img.setAttribute('loading', 'eager');
        const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
        for (let y = 0; y < Math.min(document.documentElement.scrollHeight, o.maxHeight); y += step) {
          window.scrollTo(0, y);
          await sleep(o.stepDelayMs);
        }
        window.scrollTo(0, 0);
        await sleep(o.settleMs);
      },
      {
        maxHeight: opts.maxHeight ?? 6000,
        stepDelayMs: opts.stepDelayMs ?? 120,
        settleMs: opts.settleMs ?? 400,
      },
    ),
  );
}

/** Wait for web fonts and for images currently in the document to finish decoding (bounded). */
export async function waitForAssets(page: PageLike, timeoutMs = 5000): Promise<void> {
  await page.evaluate(
    pageExpression(async (t: number) => {
      const timeout = new Promise((r) => setTimeout(r, t));
      const imgs = Array.from(document.images)
        .filter((i) => !i.complete)
        .map(
          (i) =>
            new Promise((r) => {
              i.addEventListener('load', r, { once: true });
              i.addEventListener('error', r, { once: true });
            }),
        );
      await Promise.race([Promise.all([document.fonts?.ready, ...imgs]), timeout]);
    }, timeoutMs),
  );
}

/**
 * Hide fixed/sticky elements (visibility:hidden, marked `data-wwm-hidden`). Call this AFTER `extractPage`
 * so they are recorded once (with `fixed: true`) but don't paint into, or repeat across, the full-page
 * screenshot. Returns how many elements were hidden.
 */
export async function hideFixedElements(page: PageLike): Promise<number> {
  return (await page.evaluate(
    pageExpression(() => {
      let n = 0;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        const p = getComputedStyle(el).position;
        if (p === 'fixed' || p === 'sticky') {
          el.style.setProperty('visibility', 'hidden', 'important');
          el.setAttribute('data-wwm-hidden', '');
          n++;
        }
      }
      return n;
    }),
  )) as number;
}

export interface PrepareOptions {
  maxHeight?: number;
  /** Skip the lazy-load scroll (tests, static pages). */
  skipScroll?: boolean;
}

export interface PrepareReport {
  cookie: { clicked: string | null; removed: number };
}

/**
 * Full preparation sequence: dismiss consent banners → freeze motion → scroll through for lazy loads →
 * back to top → wait for fonts/images → freeze again (for anything that started late).
 * Does NOT hide fixed elements; call `hideFixedElements` after extraction.
 */
export async function preparePage(page: PageLike, opts: PrepareOptions = {}): Promise<PrepareReport> {
  const cookie = await dismissCookieBanners(page);
  await freezeMotion(page);
  if (!opts.skipScroll)
    await scrollThrough(page, opts.maxHeight === undefined ? {} : { maxHeight: opts.maxHeight });
  await waitForAssets(page);
  await freezeMotion(page);
  return { cookie };
}
