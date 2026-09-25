/**
 * Regenerate the site-select thumbnails (apps/web/public/thumbs/<slug>.webp) from fixtures/captures:
 * the top of each screenshot at 16:10, box-downscaled to 480×300, encoded with `cwebp` (falls back to PNG).
 *
 *   node apps/web/scripts/thumbs.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, listCaptureSlugs, loadCapture } from '@wwm/stage-builder/node';

const OUT = fileURLToPath(new URL('../public/thumbs/', import.meta.url));
const W = 480;
const H = 300;
mkdirSync(OUT, { recursive: true });

for (const slug of listCaptureSlugs()) {
  const { image } = loadCapture(slug);
  const srcW = image.width;
  const srcH = Math.min(image.height, Math.round((srcW * H) / W));
  const out = new Uint8ClampedArray(W * H * 4);
  const sx = srcW / W;
  const sy = srcH / H;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let yy = Math.floor(y * sy); yy < Math.min(srcH, Math.floor((y + 1) * sy)); yy++) {
        for (let xx = Math.floor(x * sx); xx < Math.min(srcW, Math.floor((x + 1) * sx)); xx++) {
          const i = (yy * srcW + xx) * 4;
          for (let c = 0; c < 4; c++) acc[c] = (acc[c] as number) + (image.data[i + c] as number);
          n++;
        }
      }
      const o = (y * W + x) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = Math.round((acc[c] as number) / Math.max(1, n));
    }
  }
  const png = encodePng({ width: W, height: H, data: out });
  const tmp = join(tmpdir(), `wwm-thumb-${slug}.png`);
  writeFileSync(tmp, png);
  try {
    execFileSync('cwebp', ['-quiet', '-q', '78', tmp, '-o', join(OUT, `${slug}.webp`)]);
    console.log(`thumbs/${slug}.webp`);
  } catch {
    writeFileSync(join(OUT, `${slug}.png`), png);
    console.log(`thumbs/${slug}.png (cwebp missing)`);
  }
  rmSync(tmp, { force: true });
}
