/**
 * Share cards (Phase 18): just enough of a TrueType parser to lay text out before resvg draws it.
 *
 * resvg shapes and draws the text itself (with kerning); the layout only needs advance widths (to fit, wrap and
 * truncate) and glyph coverage (a title with characters the subset fonts lack falls back to the host name).
 * Advances ignore kerning, so measured widths are a slight over-estimate: text never overflows its box.
 * Pure (no Worker types), so Node tests use it on the same font bytes.
 */

export interface FontMetrics {
  /** Family name as resvg sees it (name ID 1). */
  family: string;
  unitsPerEm: number;
  ascender: number;
  descender: number;
  capHeight: number;
  /** Advance width in font units, or null when the font has no glyph for the code point. */
  advance(cp: number): number | null;
}

const tag = (v: DataView, o: number) =>
  String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

export function parseFont(bytes: Uint8Array): FontMetrics {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numTables = v.getUint16(4);
  const tables = new Map<string, number>();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    tables.set(tag(v, rec), v.getUint32(rec + 8));
  }
  const need = (t: string) => {
    const o = tables.get(t);
    if (o === undefined) throw new Error(`font: missing ${t} table`);
    return o;
  };
  const head = need('head');
  const hhea = need('hhea');
  const hmtx = need('hmtx');
  const cmap = need('cmap');
  const unitsPerEm = v.getUint16(head + 18);
  const ascender = v.getInt16(hhea + 4);
  const descender = v.getInt16(hhea + 6);
  const numHMetrics = v.getUint16(hhea + 34);
  const os2 = tables.get('OS/2');
  const capHeight =
    os2 !== undefined && v.getUint16(os2) >= 2 ? v.getInt16(os2 + 88) : Math.round(ascender * 0.7);

  // cmap → code point → glyph id (format 12 preferred, else format 4).
  const glyphOf = new Map<number, number>();
  const nSub = v.getUint16(cmap + 2);
  let f4: number | null = null;
  let f12: number | null = null;
  for (let i = 0; i < nSub; i++) {
    const rec = cmap + 4 + i * 8;
    const platform = v.getUint16(rec);
    const encoding = v.getUint16(rec + 2);
    const off = cmap + v.getUint32(rec + 4);
    const format = v.getUint16(off);
    if (format === 12 && (platform === 3 || platform === 0)) f12 = off;
    if (format === 4 && ((platform === 3 && encoding === 1) || platform === 0)) f4 ??= off;
  }
  if (f12 !== null) {
    const n = v.getUint32(f12 + 12);
    for (let i = 0; i < n; i++) {
      const g = f12 + 16 + i * 12;
      const start = v.getUint32(g);
      const end = v.getUint32(g + 4);
      const gid = v.getUint32(g + 8);
      for (let cp = start; cp <= end && cp - start < 0x10000; cp++) glyphOf.set(cp, gid + (cp - start));
    }
  } else if (f4 !== null) {
    const segX2 = v.getUint16(f4 + 6);
    const ends = f4 + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = v.getUint16(ends + s * 2);
      const start = v.getUint16(starts + s * 2);
      const delta = v.getInt16(deltas + s * 2);
      const rangeOff = v.getUint16(ranges + s * 2);
      for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
        let gid: number;
        if (rangeOff === 0) gid = (cp + delta) & 0xffff;
        else {
          const at = ranges + s * 2 + rangeOff + (cp - start) * 2;
          gid = v.getUint16(at);
          if (gid !== 0) gid = (gid + delta) & 0xffff;
        }
        if (gid !== 0) glyphOf.set(cp, gid);
      }
    }
  } else throw new Error('font: no usable cmap');

  const advanceOf = (gid: number) => v.getUint16(hmtx + Math.min(gid, numHMetrics - 1) * 4);

  // Family name (name ID 1, Windows Unicode) for resvg's font-family matching.
  let family = '';
  const name = tables.get('name');
  if (name !== undefined) {
    const count = v.getUint16(name + 2);
    const strings = name + v.getUint16(name + 4);
    for (let i = 0; i < count; i++) {
      const r = name + 6 + i * 12;
      if (v.getUint16(r) !== 3 || v.getUint16(r + 6) !== 1) continue;
      const len = v.getUint16(r + 8);
      const off = strings + v.getUint16(r + 10);
      let s = '';
      for (let k = 0; k < len; k += 2) s += String.fromCharCode(v.getUint16(off + k));
      family = s;
      break;
    }
  }

  return {
    family,
    unitsPerEm,
    ascender,
    descender,
    capHeight,
    advance(cp) {
      const gid = glyphOf.get(cp);
      return gid === undefined ? null : advanceOf(gid);
    },
  };
}
