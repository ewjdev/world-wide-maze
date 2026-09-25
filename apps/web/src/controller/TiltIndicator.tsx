/**
 * Tilt indicator: a ring with three coloured target dots at the centre and a marker for the current tilt
 * (E: 2013 "ring with 3 coloured dots", calibration "match dots"). The ring radius is 2× the tilt limit
 * (R), so the marker sits halfway out at the limit, where "Too tilted!" starts.
 */
export interface TiltIndicatorProps {
  /** Normalized tilt, ±1 = the clamp limit per axis. */
  x: number;
  z: number;
  size?: number;
  /** 0..1 calibration hold progress (draws an arc), or null. */
  progress?: number | null;
  warn?: boolean;
}

export function TiltIndicator({ x, z, size = 220, progress = null, warn = false }: TiltIndicatorProps) {
  const R = 90;
  const clampR = (v: number) => Math.max(-2, Math.min(2, v));
  // Screen space: +x right, forward tilt (+z) moves the marker up.
  const mx = (clampR(x) * R) / 2;
  const my = (-clampR(z) * R) / 2;
  const arc =
    progress != null && progress > 0 ? describeArc(0, 0, R + 8, 0, Math.min(359.9, progress * 360)) : null;
  return (
    <svg
      className="wwmc-indicator"
      width={size}
      height={size}
      viewBox="-110 -110 220 220"
      role="img"
      aria-label={`tilt x ${x.toFixed(2)}, z ${z.toFixed(2)}`}
      data-testid="tilt-indicator"
      data-x={x.toFixed(3)}
      data-z={z.toFixed(3)}
    >
      <circle r={R} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={3} />
      <circle
        r={R / 2}
        fill="none"
        stroke={warn ? '#ff5a5a' : 'currentColor'}
        strokeOpacity={0.25}
        strokeDasharray="4 6"
      />
      <line x1={-R} x2={R} y1={0} y2={0} stroke="currentColor" strokeOpacity={0.12} />
      <line y1={-R} y2={R} x1={0} x2={0} stroke="currentColor" strokeOpacity={0.12} />
      {arc && <path d={arc} fill="none" stroke="#5cf2c4" strokeWidth={5} strokeLinecap="round" />}
      <circle cx={0} cy={-6} r={4.5} fill="#ff5a8a" />
      <circle cx={-5.2} cy={3} r={4.5} fill="#5cc8ff" />
      <circle cx={5.2} cy={3} r={4.5} fill="#ffd25c" />
      <circle cx={mx} cy={my} r={13} fill="none" stroke={warn ? '#ff5a5a' : '#ffffff'} strokeWidth={4} />
    </svg>
  );
}

function describeArc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => {
    const rad = ((a - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const;
  };
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}
