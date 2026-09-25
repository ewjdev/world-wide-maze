/** QR code as inline SVG (uqr encodes; we draw one path, so no innerHTML). */
import { useMemo } from 'react';
import { encode } from 'uqr';

export function QrCode({ text, size = 200, label }: { text: string; size?: number; label?: string }) {
  const { d, n } = useMemo(() => {
    const qr = encode(text, { ecc: 'M', border: 2 });
    let path = '';
    qr.data.forEach((row, y) => {
      row.forEach((on, x) => {
        if (on) path += `M${x} ${y}h1v1h-1z`;
      });
    });
    return { d: path, n: qr.size };
  }, [text]);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${n} ${n}`}
      role="img"
      aria-label={label ?? text}
      data-testid="pair-qr"
      data-text={text}
      shapeRendering="crispEdges"
    >
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
