/**
 * Functions injected into the captured tab with `chrome.scripting.executeScript({ func })`. Like
 * `@wwm/capture-script`'s `extractPage`, each must be SELF-CONTAINED: Chrome serializes the function's source,
 * so it may not reference anything outside its own body. They run in the extension's isolated world, so
 * the page's own scripts can't see or tamper with them, but they share the DOM.
 *
 * Marks left on the page (all removed by `pageRestore`):
 * - `<style data-wwm-ext="freeze">`: pauses animations and transitions, and turns off smooth scrolling.
 * - `data-wwm-ext-hidden` on fixed/sticky elements hidden after the first frame.
 */

export interface PageMetrics {
  url: string;
  title: string;
  /** Viewport (CSS px), including any classic scrollbar. */
  innerWidth: number;
  innerHeight: number;
  /** Viewport without the scrollbar. */
  clientWidth: number;
  scrollX: number;
  scrollY: number;
  scrollHeight: number;
  devicePixelRatio: number;
}

/**
 * Freeze motion, load lazy content by scrolling through the page once (bounded), and return the metrics.
 * Scroll-through mirrors the capture service's `scrollThrough` so below-the-fold images exist before extraction.
 */
export async function pagePrepare(opts: { maxHeight: number; stepDelayMs: number }): Promise<PageMetrics> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const root = document.documentElement;
  const sx = window.scrollX;
  const sy = window.scrollY;
  if (!document.querySelector('style[data-wwm-ext="freeze"]')) {
    const s = document.createElement('style');
    s.setAttribute('data-wwm-ext', 'freeze');
    s.textContent =
      '*,*::before,*::after{animation-play-state:paused!important;transition:none!important;caret-color:transparent!important}' +
      'html,body{scroll-behavior:auto!important}';
    (document.head ?? root).appendChild(s);
  }
  for (const img of Array.from(document.querySelectorAll('img[loading="lazy"]')))
    img.setAttribute('loading', 'eager');
  const step = Math.max(200, Math.floor(window.innerHeight * 0.9));
  const end = Math.min(Math.max(root.scrollHeight, document.body?.scrollHeight ?? 0), opts.maxHeight);
  for (let y = 0; y < end; y += step) {
    window.scrollTo(0, y);
    await sleep(opts.stepDelayMs);
  }
  window.scrollTo(0, 0);
  // fonts and the images that just started loading, bounded
  const pending = Array.from(document.images)
    .filter((i) => !i.complete)
    .map(
      (i) =>
        new Promise((r) => {
          i.addEventListener('load', r, { once: true });
          i.addEventListener('error', r, { once: true });
        }),
    );
  await Promise.race([Promise.all([document.fonts?.ready, ...pending]), sleep(2500)]);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return {
    url: location.href,
    title: document.title,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    clientWidth: root.clientWidth,
    scrollX: sx,
    scrollY: sy,
    scrollHeight: Math.max(root.scrollHeight, document.body?.scrollHeight ?? 0),
    devicePixelRatio: window.devicePixelRatio,
  };
}

/** Scroll to `y`, wait for two frames (paint), and return where the page actually is. */
export async function pageScrollTo(y: number): Promise<number> {
  window.scrollTo(0, y);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise((r) => setTimeout(r, 60));
  return window.scrollY;
}

/**
 * Hide fixed and sticky elements (after the first frame, so a site header appears once, at the top, the way
 * the capture service records it). Returns how many were hidden.
 */
export function pageHideFixed(): number {
  let n = 0;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
    const p = getComputedStyle(el).position;
    if (p === 'fixed' || p === 'sticky') {
      el.setAttribute('data-wwm-ext-hidden', el.style.getPropertyValue('visibility') || '-');
      el.style.setProperty('visibility', 'hidden', 'important');
      n++;
    }
  }
  return n;
}

/** Undo everything: unhide, unfreeze, scroll back to where the player was. */
export function pageRestore(pos: { x: number; y: number }): boolean {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-wwm-ext-hidden]'))) {
    const prev = el.getAttribute('data-wwm-ext-hidden');
    el.style.removeProperty('visibility');
    if (prev && prev !== '-') el.style.setProperty('visibility', prev);
    el.removeAttribute('data-wwm-ext-hidden');
  }
  document.querySelector('style[data-wwm-ext="freeze"]')?.remove();
  window.scrollTo(pos.x, pos.y);
  return true;
}

/**
 * Runs in the GAME tab (isolated world): wait for the receiver's `wwm:ready`, post the capture to the page
 * (contracts §10.2, same window, same origin), and resolve with the receiver's answer.
 */
export function pageDeliver(p: {
  origin: string;
  bundle: unknown;
  mime: 'image/png' | 'image/webp';
  imageBase64: string;
  timeoutMs: number;
}): Promise<{ ok: boolean; reason: string }> {
  return new Promise((resolve) => {
    if (location.origin !== p.origin || location.pathname !== '/play/local') {
      resolve({ ok: false, reason: `the game tab is at ${location.origin}${location.pathname}` });
      return;
    }
    const bin = atob(p.imageBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    let sent = false;
    const done = (r: { ok: boolean; reason: string }) => {
      removeEventListener('message', on);
      clearTimeout(timer);
      resolve(r);
    };
    const on = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== location.origin) return;
      const t = (e.data as { type?: string } | null)?.type;
      if (t === 'wwm:ready' && !sent) {
        sent = true;
        const msg = {
          type: 'wwm:capture',
          version: 1,
          bundle: p.bundle,
          image: { mime: p.mime, bytes: bytes.buffer },
        };
        window.postMessage(msg, location.origin, [bytes.buffer]);
      } else if (t === 'wwm:ack') done({ ok: true, reason: '' });
      else if (t === 'wwm:reject')
        done({ ok: false, reason: String((e.data as { reason?: string }).reason ?? 'rejected') });
    };
    addEventListener('message', on);
    const timer = setTimeout(() => done({ ok: false, reason: 'the game page did not answer' }), p.timeoutMs);
  });
}
