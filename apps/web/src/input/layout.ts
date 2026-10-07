/**
 * Gameplay-container measurement (plans/mobile-browser-game-execution.md §3). One observer per session owns
 * engine sizing: it coalesces changes to one callback per animation frame, skips unchanged and zero sizes and
 * never sends zero to the engine. A window resize alone is not a second writer; it only feeds this path
 * because the observed host fills the window.
 */

export interface Size {
  width: number;
  height: number;
}

export interface SizeObserverOptions {
  /** Positive, changed size, at most once per animation frame. */
  onSize: (size: Size) => void;
  /** The host collapsed to nothing (hidden, zero-size): release input and wait; nothing is sent to the engine. */
  onCollapse?: () => void;
}

/** Observe `el`; returns a disposer that disconnects and cancels scheduled work. */
export function observeSize(el: HTMLElement, opts: SizeObserverOptions): () => void {
  let last: Size | null = null;
  let raf = 0;
  let collapsed = false;
  const flush = () => {
    raf = 0;
    const width = el.clientWidth;
    const height = el.clientHeight;
    if (width <= 0 || height <= 0) {
      if (!collapsed) {
        collapsed = true;
        opts.onCollapse?.();
      }
      return; // retain the last positive engine size through a transient collapse
    }
    collapsed = false;
    if (last && last.width === width && last.height === height) return;
    last = { width, height };
    opts.onSize(last);
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(flush);
  };
  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(schedule);
    observer.observe(el);
  } else if (typeof addEventListener === 'function') {
    addEventListener('resize', schedule); // no ResizeObserver: the window is the best available signal
  }
  return () => {
    observer?.disconnect();
    if (!observer && typeof removeEventListener === 'function') removeEventListener('resize', schedule);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
}

/**
 * A real orientation change, independent of viewport height/aspect fluctuations: `screen.orientation` where
 * available, else the layout-orientation media query. Keyboard and browser-toolbar resizes are not orientation
 * signals. Returns a disposer.
 */
export function screenAngle(): number {
  const angle = typeof screen === 'undefined' ? undefined : screen.orientation?.angle;
  const legacy = typeof window === 'undefined' ? undefined : window.orientation;
  return typeof angle === 'number' ? angle : typeof legacy === 'number' ? legacy : 0;
}

export function watchOrientation(onChange: () => void): () => void {
  const o = typeof screen === 'undefined' ? undefined : (screen.orientation as ScreenOrientation | undefined);
  if (o) {
    o.addEventListener('change', onChange);
    return () => o.removeEventListener('change', onChange);
  }
  if (typeof window !== 'undefined' && typeof window.orientation === 'number') {
    window.addEventListener('orientationchange', onChange);
    return () => window.removeEventListener('orientationchange', onChange);
  }
  if (typeof matchMedia === 'function') {
    const mq = matchMedia('(orientation: portrait)');
    // The query flips only when width/height ordering flips; a toolbar or keyboard resize rarely does.
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }
  return () => {};
}
