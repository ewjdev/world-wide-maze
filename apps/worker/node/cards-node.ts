/**
 * Share cards in Node (Phase 18): the same fonts, SVG and resvg WASM as the Worker, for tests and the sample
 * renders in docs/build-log/assets/share-cards/ (`pnpm --filter @wwm/worker cards:samples`).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import type { StageData } from '@wwm/schema';
import { stageArt } from '../src/cards/art.ts';
import type { CardData } from '../src/cards/data.ts';
import { parseFont } from '../src/cards/font.ts';
import { encodePng, pngCropThumb, pngSize, toBase64 } from '../src/cards/png.ts';
import { type CardArt, type CardFonts, cardSvg } from '../src/cards/svg.ts';

const fontsDir = fileURLToPath(new URL('../src/cards/fonts/', import.meta.url));
export const FONT_FILES = ['unbounded-900', 'unbounded-700', 'figtree-600', 'figtree-800'] as const;
export const fontBytes = FONT_FILES.map((f) => new Uint8Array(readFileSync(`${fontsDir}${f}.ttf`)));

export function nodeFonts(): CardFonts {
  const [display, bold, ui, uiBold] = fontBytes.map((b) => parseFont(b));
  return { display, bold, ui, uiBold } as CardFonts;
}

let ready: Promise<void> | null = null;
export function initResvg(): Promise<void> {
  const require = createRequire(import.meta.url);
  ready ??= initWasm(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
  return ready;
}

export async function renderNode(data: CardData, art: CardArt, site = 'wwm.ewj.dev', width?: number) {
  await initResvg();
  const svg = cardSvg(data, nodeFonts(), art, site);
  const t0 = performance.now();
  const r = new Resvg(svg, {
    fitTo: width ? { mode: 'width', value: width } : { mode: 'original' },
    font: { fontBuffers: fontBytes, loadSystemFonts: false, defaultFontFamily: 'Figtree SemiBold' },
  });
  const img = r.render();
  const png = img.asPng();
  const out = { png, width: img.width, height: img.height, ms: performance.now() - t0, svg };
  img.free();
  r.free();
  return out;
}

/** Island art for a builder golden, textured with the matching slice of the capture screenshot. */
export async function fixtureArt(stage: StageData, screenshotPng: Uint8Array | null): Promise<CardArt> {
  const art: CardArt = { stage: stageArt(stage) };
  if (screenshotPng && pngSize(screenshotPng)) {
    const { y, height } = stage.source.slice;
    const k = Math.max(1, Math.round(stage.size.width / 560));
    const thumb = await pngCropThumb(screenshotPng, y, y + height, k);
    art.texture = {
      href: `data:image/png;base64,${toBase64(await encodePng(thumb))}`,
      width: thumb.width,
      height: thumb.height,
    };
  }
  return art;
}
