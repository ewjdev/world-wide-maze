/**
 * Step 4: binary morphology on the cell grid (1 = land). Rectangular (separable) structuring elements, so
 * axis-aligned page blocks stay rectangular (2013 islands are mostly rounded rectangles).
 * Together, close → fill holes → open reproduce 2013's `dilate → GaussianBlur → threshold` clumping.
 * Outside the grid counts as land for erosion (borders don't eat islands) and as water for dilation.
 */

function pass1d(
  src: Uint8Array,
  dst: Uint8Array,
  cols: number,
  rows: number,
  radius: number,
  horizontal: boolean,
  erode: boolean,
): void {
  const len = horizontal ? cols : rows;
  const lines = horizontal ? rows : cols;
  const step = horizontal ? 1 : cols;
  const lineStep = horizontal ? cols : 1;
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    // count of "hits" (land for dilate, water for erode) in window [i-radius, i+radius]
    let count = 0;
    const hit = (i: number) => {
      const v = src[base + i * step] as number;
      return erode ? (v === 0 ? 1 : 0) : v !== 0 ? 1 : 0;
    };
    for (let i = 0; i <= Math.min(radius, len - 1); i++) count += hit(i);
    for (let i = 0; i < len; i++) {
      const on = erode ? count === 0 : count > 0;
      dst[base + i * step] = on ? 1 : 0;
      const outI = i - radius;
      const inI = i + radius + 1;
      if (outI >= 0) count -= hit(outI);
      if (inI < len) count += hit(inI);
    }
  }
}

/** Dilate with a (2rx+1)×(2ry+1) rectangle. */
export function dilate(mask: Uint8Array, cols: number, rows: number, rx: number, ry = rx): Uint8Array {
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  if (rx > 0) pass1d(mask, tmp, cols, rows, rx, true, false);
  else tmp.set(mask);
  if (ry > 0) pass1d(tmp, out, cols, rows, ry, false, false);
  else out.set(tmp);
  return out;
}

/** Erode with a (2rx+1)×(2ry+1) rectangle. */
export function erode(mask: Uint8Array, cols: number, rows: number, rx: number, ry = rx): Uint8Array {
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  if (rx > 0) pass1d(mask, tmp, cols, rows, rx, true, true);
  else tmp.set(mask);
  if (ry > 0) pass1d(tmp, out, cols, rows, ry, false, true);
  else out.set(tmp);
  return out;
}

/** Closing (dilate then erode): bridges small gaps. */
export function close(mask: Uint8Array, cols: number, rows: number, rx: number, ry = rx): Uint8Array {
  return erode(dilate(mask, cols, rows, rx, ry), cols, rows, rx, ry);
}

/** Opening (erode then dilate): removes features thinner than 2r+1 cells. */
export function open(mask: Uint8Array, cols: number, rows: number, rx: number, ry = rx): Uint8Array {
  return dilate(erode(mask, cols, rows, rx, ry), cols, rows, rx, ry);
}

/**
 * Fill enclosed water regions (4-connected, not touching the grid border) of at most `maxCells` cells.
 * Returns a new mask.
 */
export function fillHoles(mask: Uint8Array, cols: number, rows: number, maxCells: number): Uint8Array {
  const out = mask.slice();
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  const region: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] || seen[start]) continue;
    region.length = 0;
    let touchesBorder = false;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop() as number;
      region.push(i);
      const c = i % cols;
      const r = (i - c) / cols;
      if (c === 0 || r === 0 || c === cols - 1 || r === rows - 1) touchesBorder = true;
      if (c > 0 && !mask[i - 1] && !seen[i - 1]) {
        seen[i - 1] = 1;
        stack.push(i - 1);
      }
      if (c < cols - 1 && !mask[i + 1] && !seen[i + 1]) {
        seen[i + 1] = 1;
        stack.push(i + 1);
      }
      if (r > 0 && !mask[i - cols] && !seen[i - cols]) {
        seen[i - cols] = 1;
        stack.push(i - cols);
      }
      if (r < rows - 1 && !mask[i + cols] && !seen[i + cols]) {
        seen[i + cols] = 1;
        stack.push(i + cols);
      }
    }
    if (!touchesBorder && region.length <= maxCells) for (const i of region) out[i] = 1;
  }
  return out;
}

/** Element-wise OR into a new mask. */
export function or(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] || b[i] ? 1 : 0;
  return out;
}
