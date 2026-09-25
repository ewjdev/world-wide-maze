/**
 * Exact Euclidean distance transform on the cell grid (Felzenszwalb & Huttenlocher 2012).
 * For every land cell: distance (in cells, center to center) to the nearest water cell; outside the grid is water.
 * The distance from a cell center to the island *edge* is ≈ (d − 0.5) cells.
 */

const INF = 1e20;

function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s: number;
    for (;;) {
      const vk = v[k] as number;
      s = ((f[q] as number) + q * q - ((f[vk] as number) + vk * vk)) / (2 * q - 2 * vk);
      if (s <= (z[k] as number)) {
        k--;
        continue;
      }
      break;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while ((z[k + 1] as number) < q) k++;
    const vk = v[k] as number;
    d[q] = (q - vk) * (q - vk) + (f[vk] as number);
  }
}

/** Distance (cells) from each land cell to the nearest water cell; 0 for water. */
export function distanceTransform(mask: ArrayLike<number>, cols: number, rows: number): Float32Array {
  const W = cols + 2;
  const H = rows + 2;
  const g = new Float64Array(W * H);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const inside = r > 0 && c > 0 && r <= rows && c <= cols && mask[(r - 1) * cols + (c - 1)];
      g[r * W + c] = inside ? INF : 0;
    }
  }
  const n = Math.max(W, H);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let c = 0; c < W; c++) {
    for (let r = 0; r < H; r++) f[r] = g[r * W + c] as number;
    edt1d(f, H, d, v, z);
    for (let r = 0; r < H; r++) g[r * W + c] = d[r] as number;
  }
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) f[c] = g[r * W + c] as number;
    edt1d(f, W, d, v, z);
    for (let c = 0; c < W; c++) g[r * W + c] = d[c] as number;
  }
  const out = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) out[r * cols + c] = Math.sqrt(g[(r + 1) * W + (c + 1)] as number);
  return out;
}
