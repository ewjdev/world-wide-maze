/**
 * `extractPage` runs INSIDE the captured page (via `page.evaluate`). It must stay fully self-contained:
 * no imports, no references to module scope, no helpers declared outside the function body. The only
 * allowed import is `import type` (erased at compile time). test/extract.test.ts checks the default
 * constants below against @wwm/schema.
 *
 * Always invoke it through `pageExpression(extractPage, opts)` (see page-expr.ts) rather than passing the
 * function object to `page.evaluate`: bundlers (tsx, wrangler/esbuild with keepNames) inject a `__name`
 * helper into function bodies, and the expression wrapper defines a no-op shim for it.
 *
 * Algorithm:
 * 1. Text-owner pre-pass: every non-blank text node is owned by its nearest ancestor whose `display` is not
 *    inline (so `<p>a <b>b</b> <a>c</a></p>` → all three runs belong to the `<p>`).
 * 2. Walk the element tree (plus open shadow roots). Skip display:none / opacity:0 subtrees and
 *    visibility:hidden elements. Clip rects to overflow-clipping ancestors and to the page; drop anything
 *    below `minArea`. Classify `kind` from tag, ARIA role and ad-ish class/id hints. Plain layout wrappers
 *    (no own text, no background/border/shadow) are not emitted.
 * 3. Per-line text rects: `Range.getClientRects()` per owned text node, then fragments on the same visual
 *    line are merged and rects fully contained in another are dropped.
 * 4. A `text` element fully contained in its nearest emitted `text` ancestor is merged into it.
 */
import type { CaptureBundle, DomElement, ElementKind, Rect } from '@wwm/schema';

export type ExtractedPage = Omit<CaptureBundle, 'screenshot' | 'captureId' | 'capturedAt'>;

export interface ExtractOptions {
  /** Page height cap in px. Default 6000 (MAX_PAGE_HEIGHT_PX). */
  maxPageHeight?: number;
  /** Elements smaller than this area (px²) are skipped. Default 16. */
  minArea?: number;
  /** Hard cap on emitted elements (document order). Default 6000. */
  maxElements?: number;
  /** Max characters of `text`. Default 120 (contract). */
  maxTextLength?: number;
}

export function extractPage(options: ExtractOptions = {}): ExtractedPage {
  const MAX_H = options.maxPageHeight ?? 6000;
  const MIN_AREA = options.minArea ?? 16;
  const MAX_ELEMENTS = options.maxElements ?? 6000;
  const MAX_TEXT = options.maxTextLength ?? 120;

  const doc = document;
  const root = doc.documentElement;
  const body = doc.body ?? root;
  const sx = window.scrollX;
  const sy = window.scrollY;

  // Width is capped to the viewport: the screenshot is viewport-wide, so horizontal overflow is off-texture.
  const pageW = Math.min(Math.max(root.scrollWidth, body.scrollWidth, root.clientWidth), window.innerWidth);
  const fullH = Math.max(root.scrollHeight, body.scrollHeight, root.clientHeight);
  const pageH = Math.min(fullH, MAX_H);

  const styleCache = new Map<Element, CSSStyleDeclaration>();
  const style = (el: Element): CSSStyleDeclaration => {
    let s = styleCache.get(el);
    if (!s) {
      s = getComputedStyle(el);
      styleCache.set(el, s);
    }
    return s;
  };
  const isInlineDisplay = (d: string) => d === 'inline' || d === 'contents' || d.startsWith('ruby');
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  const cut = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s);

  // ---- link targets (contracts §10.1) ------------------------------------------------------------
  // Absolute http(s) only, no credentials, ≤ 2048 chars, normalized exactly like `normalizeUrl` in
  // capture.ts (inlined: this function runs in the page). Same-page anchors (`#…`, or the page itself) are
  // dropped, as are `javascript:`, `mailto:` and other schemes.
  const pageNoHash = (() => {
    try {
      const u = new URL(location.href);
      u.hash = '';
      return u.toString();
    } catch {
      return location.href;
    }
  })();
  const hrefOf = (el: Element): string | undefined => {
    const a = el.closest('a[href]');
    if (!a) return undefined;
    const raw = (a as HTMLAnchorElement).href;
    if (typeof raw !== 'string' || !raw) return undefined;
    let u: URL;
    try {
      u = new URL(raw, location.href);
    } catch {
      return undefined;
    }
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) return undefined;
    u.hash = '';
    if (u.toString() === pageNoHash) return undefined;
    u.hostname = u.hostname.toLowerCase();
    if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443'))
      u.port = '';
    const drop = [...u.searchParams.keys()].filter((k) =>
      /^(utm_.*|fbclid|gclid|mc_cid|mc_eid|ref_src)$/i.test(k),
    );
    for (const k of drop) u.searchParams.delete(k);
    u.searchParams.sort();
    const out = u.toString();
    return out.length <= 2048 ? out : undefined;
  };

  // ---- colors ----------------------------------------------------------------------------------
  let colorCtx: CanvasRenderingContext2D | null = null;
  const toHex = (css: string): string | undefined => {
    if (!css || css === 'transparent') return undefined;
    const m = css.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
    let r: number;
    let g: number;
    let b: number;
    let a = 1;
    if (m) {
      r = Number(m[1]);
      g = Number(m[2]);
      b = Number(m[3]);
      if (m[4] !== undefined) a = m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
    } else {
      // Modern color spaces (oklch(), color(display-p3 …)): let canvas convert to sRGB.
      if (!colorCtx) {
        const c = doc.createElement('canvas');
        c.width = 1;
        c.height = 1;
        colorCtx = c.getContext('2d', { willReadFrequently: true });
      }
      if (!colorCtx) return undefined;
      colorCtx.clearRect(0, 0, 1, 1);
      colorCtx.fillStyle = '#000';
      colorCtx.fillStyle = css;
      colorCtx.fillRect(0, 0, 1, 1);
      const d = colorCtx.getImageData(0, 0, 1, 1).data;
      r = d[0] ?? 0;
      g = d[1] ?? 0;
      b = d[2] ?? 0;
      a = (d[3] ?? 0) / 255;
    }
    if (a < 0.05) return undefined;
    const h = (n: number) =>
      Math.max(0, Math.min(255, Math.round(n)))
        .toString(16)
        .padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  };

  // ---- geometry --------------------------------------------------------------------------------
  interface Box {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }
  const EMPTY: Box = { x0: 0, y0: 0, x1: 0, y1: 0 };
  const PAGE: Box = { x0: 0, y0: 0, x1: pageW, y1: pageH };
  const toBox = (r: DOMRectReadOnly): Box => ({
    x0: r.left + sx,
    y0: r.top + sy,
    x1: r.right + sx,
    y1: r.bottom + sy,
  });
  const clip = (a: Box, b: Box): Box | null => {
    const x0 = Math.max(a.x0, b.x0);
    const y0 = Math.max(a.y0, b.y0);
    const x1 = Math.min(a.x1, b.x1);
    const y1 = Math.min(a.y1, b.y1);
    return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
  };
  const round = (n: number) => Math.round(n * 100) / 100;
  const toRect = (b: Box): Rect => ({
    x: round(b.x0),
    y: round(b.y0),
    w: round(b.x1 - b.x0),
    h: round(b.y1 - b.y0),
  });
  const contains = (outer: Box, inner: Box, tol = 1) =>
    inner.x0 >= outer.x0 - tol &&
    inner.y0 >= outer.y0 - tol &&
    inner.x1 <= outer.x1 + tol &&
    inner.y1 <= outer.y1 + tol;

  // ---- 1. text-owner pre-pass ------------------------------------------------------------------
  const NON_TEXT_SCOPES = 'script,style,noscript,template,svg,select,textarea,object,video,canvas,iframe';
  const ownedText = new Map<Element, Text[]>();
  const ownerElOf = new Map<Text, Element>();
  {
    const tw = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode() as Text | null; n; n = tw.nextNode() as Text | null) {
      if (!n.data.trim()) continue;
      const parent = n.parentElement;
      if (!parent || parent.closest(NON_TEXT_SCOPES)) continue;
      const vis = style(parent).visibility;
      if (vis === 'hidden' || vis === 'collapse') continue;
      let el: Element | null = parent;
      while (el && el !== body && isInlineDisplay(style(el).display)) el = el.parentElement;
      if (!el) continue;
      ownerElOf.set(n, el);
      const list = ownedText.get(el);
      if (list) list.push(n);
      else ownedText.set(el, [n]);
    }
  }

  // ---- classification --------------------------------------------------------------------------
  const SKIP_TAGS = new Set([
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'TEMPLATE',
    'HEAD',
    'META',
    'LINK',
    'TITLE',
    'BR',
    'WBR',
    'SOURCE',
    'TRACK',
    'OPTION',
    'OPTGROUP',
    'DATALIST',
    'PARAM',
    'AREA',
    'MAP',
  ]);
  // Leaves: emitted as a whole, children not walked.
  const LEAF_TAGS = new Set([
    'IMG',
    'SVG',
    'VIDEO',
    'CANVAS',
    'IFRAME',
    'INPUT',
    'TEXTAREA',
    'SELECT',
    'OBJECT',
    'EMBED',
    'PICTURE',
    'BUTTON',
  ]);
  const AD_RE =
    /(^|[\s_-])(ad|ads|adv|advert|advertisement|adsbygoogle|adslot|ad-slot|ad-container|sponsor|sponsored|promoted|dfp|gpt-ad|taboola|outbrain|banner-ad)($|[\s_-])/i;
  const AD_SRC_RE =
    /doubleclick\.net|googlesyndication|adservice|amazon-adsystem|taboola|outbrain|adnxs|criteo/i;

  const kindOf = (el: Element, tag: string, hasText: boolean, visualBox: boolean): ElementKind | null => {
    const role = el.getAttribute('role');
    const hint = `${el.getAttribute('class') ?? ''} ${el.id ?? ''}`;
    if (AD_RE.test(hint) || el.hasAttribute('data-ad-slot') || el.hasAttribute('data-ad')) return 'adlike';
    if (tag === 'IFRAME') {
      const src = el.getAttribute('src') ?? '';
      return AD_SRC_RE.test(src) || AD_RE.test(el.getAttribute('name') ?? '') ? 'adlike' : 'block';
    }
    if (tag === 'NAV' || role === 'navigation') return 'nav';
    if (tag === 'HEADER' || role === 'banner') return 'header';
    if (tag === 'FOOTER' || role === 'contentinfo') return 'footer';
    if (/^H[1-6]$/.test(tag) || role === 'heading') return 'heading';
    if (tag === 'VIDEO') return 'video';
    if (tag === 'CANVAS') return 'canvas';
    if (
      tag === 'IMG' ||
      tag === 'SVG' ||
      tag === 'PICTURE' ||
      tag === 'OBJECT' ||
      tag === 'EMBED' ||
      role === 'img'
    )
      return 'image';
    if (tag === 'BUTTON' || role === 'button' || role === 'tab' || role === 'menuitem') return 'button';
    if (tag === 'INPUT') {
      const t = (el.getAttribute('type') ?? 'text').toLowerCase();
      if (t === 'hidden') return null;
      return t === 'button' || t === 'submit' || t === 'reset' || t === 'image' ? 'button' : 'input';
    }
    if (
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      role === 'textbox' ||
      role === 'searchbox' ||
      role === 'combobox'
    )
      return 'input';
    if ((tag === 'A' && el.hasAttribute('href')) || role === 'link') return 'link';
    if (hasText) return 'text';
    if (visualBox) return 'block';
    return null;
  };

  // ---- 2. walk ---------------------------------------------------------------------------------
  interface Rec {
    kind: ElementKind;
    box: Box;
    lines: Box[];
    bg?: string;
    depth: number;
    z: number;
    fixed: boolean;
    text?: string;
    fontSize?: number;
    href?: string;
    parent: Rec | null; // nearest emitted ancestor
    dropped: boolean;
  }
  const recs: Rec[] = [];
  const recOf = new Map<Element, Rec>();

  interface Ctx {
    depth: number;
    clip: Box;
    fixed: boolean;
    z: number;
    parentRec: Rec | null;
  }

  const walk = (el: Element, ctx: Ctx): void => {
    if (recs.length >= MAX_ELEMENTS) return;
    const tag = el.tagName.toUpperCase();
    if (SKIP_TAGS.has(tag)) return;
    const cs = style(el);
    if (cs.display === 'none' || cs.contentVisibility === 'hidden') return;
    if (Number(cs.opacity) === 0) return;

    const pos = cs.position;
    const fixed = ctx.fixed || pos === 'fixed' || pos === 'sticky';
    const zi = cs.zIndex === 'auto' ? Number.NaN : Number(cs.zIndex);
    const z = pos !== 'static' && !Number.isNaN(zi) ? zi : ctx.z;
    const hidden = cs.visibility === 'hidden' || cs.visibility === 'collapse';
    const isRootish = el === root || el === body;

    const raw = el.getBoundingClientRect();
    let box: Box | null = null;
    if (raw.width > 0 && raw.height > 0) {
      const b = toBox(raw);
      box = fixed ? clip(b, PAGE) : clip(clip(b, ctx.clip) ?? EMPTY, PAGE);
    }

    const owned = ownedText.get(el);
    const bg = toHex(cs.backgroundColor);
    const hasBgImage = cs.backgroundImage !== 'none' && cs.backgroundImage !== '';
    const hasBorder =
      (Number.parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') ||
      (Number.parseFloat(cs.borderLeftWidth) > 0 && cs.borderLeftStyle !== 'none');
    const visualBox = !!bg || hasBgImage || hasBorder || cs.boxShadow !== 'none';
    const isLeaf = LEAF_TAGS.has(tag);

    let rec: Rec | null = null;
    if (!hidden && !isRootish && box && (box.x1 - box.x0) * (box.y1 - box.y0) >= MIN_AREA) {
      let kind = kindOf(el, tag, !!owned, visualBox);
      // A background-image element with no text reads as an image.
      if (kind === 'block' && /url\(/.test(cs.backgroundImage) && !el.textContent?.trim()) kind = 'image';
      // Inline elements only surface when semantic (link/button/image/input…); plain spans stay in their owner.
      if (kind && isInlineDisplay(cs.display) && (kind === 'text' || kind === 'block')) kind = null;
      if (kind) {
        rec = { kind, box, lines: [], depth: ctx.depth, z, fixed, parent: ctx.parentRec, dropped: false };
        if (bg) rec.bg = bg;
        if (kind === 'link' || kind === 'button') {
          const href = hrefOf(el);
          if (href) rec.href = href;
        }
        const label =
          kind === 'image'
            ? (el.getAttribute('alt') ?? el.getAttribute('aria-label') ?? '')
            : kind === 'input'
              ? (el.getAttribute('placeholder') ?? el.getAttribute('aria-label') ?? '')
              : kind === 'text' && owned
                ? owned.map((t) => t.data).join(' ')
                : (el.textContent ?? '');
        const t = clean(label);
        if (t) {
          rec.text = cut(t);
          const fs = Number.parseFloat(cs.fontSize);
          if (fs > 0) rec.fontSize = round(fs);
        }
        recs.push(rec);
        recOf.set(el, rec);
      }
    }
    if (isLeaf) return;

    let childClip = ctx.clip;
    if (!fixed && !isRootish && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible')) {
      childClip = clip(ctx.clip, toBox(raw)) ?? EMPTY;
    }
    const next: Ctx = { depth: ctx.depth + 1, clip: childClip, fixed, z, parentRec: rec ?? ctx.parentRec };
    for (const child of Array.from(el.children)) walk(child, next);
    const sr = (el as HTMLElement).shadowRoot; // open shadow roots only
    if (sr) for (const child of Array.from(sr.children)) walk(child, next);
  };

  walk(root, { depth: 0, clip: PAGE, fixed: false, z: 0, parentRec: null });

  // ---- 3. per-line text rects ------------------------------------------------------------------
  const range = doc.createRange();
  const LINE_OWNER_SKIP = new Set<ElementKind>(['image', 'input', 'video', 'canvas']);
  for (const [n, ownerEl] of ownerElOf) {
    // Nearest emitted record at or above the owner element (a button owns its whole subtree).
    let el: Element | null = n.parentElement?.closest('button') ?? ownerEl;
    let owner: Rec | undefined;
    while (el) {
      const r = recOf.get(el);
      if (r && !LINE_OWNER_SKIP.has(r.kind)) {
        owner = r;
        break;
      }
      el = el.parentElement;
    }
    if (!owner) continue;
    range.selectNodeContents(n);
    for (const r of Array.from(range.getClientRects())) {
      if (r.width < 1 || r.height < 1) continue;
      const b = clip(toBox(r), owner.box);
      if (b) owner.lines.push(b);
    }
  }

  const mergeLines = (lines: Box[], fontSize: number): Box[] => {
    const sorted = lines.slice().sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    const out: Box[] = [];
    const gap = Math.max(4, fontSize);
    for (const l of sorted) {
      const last = out[out.length - 1];
      if (last) {
        const overlapY = Math.min(last.y1, l.y1) - Math.max(last.y0, l.y0);
        const minH = Math.min(last.y1 - last.y0, l.y1 - l.y0);
        if (overlapY >= minH * 0.5 && l.x0 <= last.x1 + gap && l.x1 >= last.x0 - gap) {
          last.x0 = Math.min(last.x0, l.x0);
          last.y0 = Math.min(last.y0, l.y0);
          last.x1 = Math.max(last.x1, l.x1);
          last.y1 = Math.max(last.y1, l.y1);
          continue;
        }
      }
      out.push({ ...l });
    }
    return out.filter(
      (l, i) => !out.some((o, j) => j !== i && contains(o, l, 0) && (j < i || !contains(l, o, 0))),
    );
  };

  // ---- 4. merge contained text elements into their text parent ---------------------------------
  for (const r of recs) {
    if (r.kind !== 'text') continue;
    let p = r.parent;
    while (p?.dropped) p = p.parent;
    if (p && p.kind === 'text' && p.fixed === r.fixed && contains(p.box, r.box)) {
      p.lines.push(...r.lines);
      if (r.text && (!p.text || p.text.length < MAX_TEXT)) p.text = cut(clean(`${p.text ?? ''} ${r.text}`));
      if (!p.fontSize && r.fontSize) p.fontSize = r.fontSize;
      r.dropped = true;
    }
  }

  const elements: DomElement[] = [];
  for (const r of recs) {
    if (r.dropped) continue;
    const e: DomElement = {
      id: elements.length,
      kind: r.kind,
      rect: toRect(r.box),
      depth: r.depth,
      z: r.z,
      fixed: r.fixed,
    };
    // Contract v0.2.7 (CCR-12-3): ≤ 200 line boxes per element (literal: this function runs in the page).
    if (r.lines.length > 0)
      e.lines = mergeLines(r.lines, r.fontSize ?? 16)
        .slice(0, 200)
        .map(toRect);
    if (r.bg) e.bg = r.bg;
    if (r.text) e.text = r.text;
    if (r.fontSize) e.fontSize = r.fontSize;
    if (r.href) e.href = r.href;
    elements.push(e);
  }

  const pageBg = toHex(style(body).backgroundColor) ?? toHex(style(root).backgroundColor) ?? '#ffffff';
  let url = location.href;
  try {
    const u = new URL(location.href);
    u.hash = '';
    url = u.toString();
  } catch {
    // keep location.href
  }

  return {
    schema: 'wwm.capture/1',
    url,
    title: clean(doc.title ?? '').slice(0, 512), // contract v0.2.7: title ≤ 512
    viewport: { width: window.innerWidth, height: window.innerHeight },
    page: { width: pageW, height: pageH },
    backgroundColor: pageBg,
    elements,
  };
}
