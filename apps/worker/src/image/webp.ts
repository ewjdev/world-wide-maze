/** Width/height of a WebP (VP8, VP8L or VP8X container), or null if the bytes aren't WebP. */
export function webpSize(b: Uint8Array): { width: number; height: number } | null {
  const tag = (o: number) => String.fromCharCode(...b.subarray(o, o + 4));
  if (b.byteLength < 30 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return null;
  const chunk = tag(12);
  const le16 = (o: number) => (b[o] as number) | ((b[o + 1] as number) << 8);
  const le24 = (o: number) => le16(o) | ((b[o + 2] as number) << 16);
  if (chunk === 'VP8X') return { width: le24(24) + 1, height: le24(27) + 1 };
  if (chunk === 'VP8 ') return { width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits =
      ((b[21] as number) |
        ((b[22] as number) << 8) |
        ((b[23] as number) << 16) |
        ((b[24] as number) << 24)) >>>
      0;
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}
