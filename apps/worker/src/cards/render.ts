/// <reference path="./modules.d.ts" />
/**
 * Share cards in workerd (Phase 18): resvg (Rust, compiled to WASM) rasterises the card SVG to PNG.
 *
 * workerd can't compile WASM at runtime, so the `.wasm` is imported as a module wrangler precompiles at deploy
 * (CompiledWasm rule, as for Rapier). The fonts are Data modules (`rules` in wrangler.jsonc). Both are
 * initialised on the first render in an isolate, not at startup, so requests that don't render pay nothing.
 */
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import type { CardData } from './data.ts';
import { parseFont } from './font.ts';
import figtree600 from './fonts/figtree-600.ttf';
import figtree800 from './fonts/figtree-800.ttf';
import unbounded700 from './fonts/unbounded-700.ttf';
import unbounded900 from './fonts/unbounded-900.ttf';
import { type CardArt, type CardFonts, cardSvg } from './svg.ts';

let ready: Promise<{ fonts: CardFonts; buffers: Uint8Array[] }> | null = null;

function init() {
  ready ??= (async () => {
    await initWasm(resvgWasm);
    const buffers = [unbounded900, unbounded700, figtree600, figtree800].map((b) => new Uint8Array(b));
    const [display, bold, ui, uiBold] = buffers.map((b) => parseFont(b)) as [
      CardFonts['display'],
      CardFonts['bold'],
      CardFonts['ui'],
      CardFonts['uiBold'],
    ];
    return { fonts: { display, bold, ui, uiBold }, buffers };
  })();
  ready.catch(() => {
    ready = null;
  });
  return ready;
}

export interface Rendered {
  png: Uint8Array<ArrayBuffer>;
  /** Wall time of SVG build + rasterisation (CPU-bound, so ≈ CPU time). */
  ms: number;
}

export async function renderCard(data: CardData, art: CardArt, site: string): Promise<Rendered> {
  const { fonts, buffers } = await init();
  const t0 = performance.now();
  const svg = cardSvg(data, fonts, art, site);
  const r = new Resvg(svg, {
    fitTo: { mode: 'original' },
    font: { fontBuffers: buffers, loadSystemFonts: false, defaultFontFamily: fonts.ui.family },
  });
  try {
    const img = r.render();
    const png = img.asPng() as Uint8Array<ArrayBuffer>;
    img.free();
    return { png, ms: performance.now() - t0 };
  } finally {
    r.free();
  }
}
