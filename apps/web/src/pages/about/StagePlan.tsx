/**
 * A generated stage drawn as a plan on paper: island outlines, bridges, items, start and goal. Real builder
 * output (fixtures/builder), not an illustration, so the hero shows the actual mechanism.
 */
import type { StageData, Vec2 } from '@wwm/schema';
import { useMemo } from 'react';

const ring = (pts: readonly Vec2[]) =>
  pts.length ? `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z` : '';
const line = (pts: readonly Vec2[]) =>
  pts.length ? `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}` : '';

function deck(a: Vec2, b: Vec2, w: number): string {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (w / 2);
  const ny = (dx / len) * (w / 2);
  return ring([
    [a[0] + nx, a[1] + ny],
    [b[0] + nx, b[1] + ny],
    [b[0] - nx, b[1] - ny],
    [a[0] - nx, a[1] - ny],
  ]);
}

export interface StagePlanProps {
  stage: StageData;
  /** Crop to the top `maxHeight` stage px. */
  maxHeight?: number;
  title: string;
  className?: string;
}

export function StagePlan({ stage, maxHeight, title, className }: StagePlanProps) {
  const h = Math.min(stage.size.height, maxHeight ?? Number.POSITIVE_INFINITY);
  const paths = useMemo(() => {
    const inView = (p: Vec2) => p[1] <= h + 40;
    return {
      islands: stage.islands
        .filter((i) => i.contour.some(inView))
        .map((i) => ({
          id: i.id,
          d: ring(i.contour) + i.holes.map(ring).join(''),
          rails: i.guardrails.map(line).join(''),
        })),
      bridges: stage.bridges
        .filter((b) => inView(b.a) || inView(b.b))
        .map((b) => ({ id: b.id, d: deck(b.a, b.b, b.width) })),
      elevators: stage.elevators
        .filter((e) => inView(e.a))
        .map((e) => ({ id: e.id, d: deck(e.a, e.b, e.width) })),
      small: stage.items.filter((i) => i.kind === 'small' && inView(i.pos)),
      large: stage.items.filter((i) => i.kind === 'large' && inView(i.pos)),
    };
  }, [stage, h]);
  const [sx, sy] = stage.start.pos;
  const [gx, gy] = stage.goal.pos;
  return (
    <svg
      className={className}
      viewBox={`-8 -8 ${stage.size.width + 16} ${h + 16}`}
      role="img"
      aria-label={title}
      preserveAspectRatio="xMidYMin meet"
    >
      <title>{title}</title>
      <g className="plan-islands">
        {paths.islands.map((i, k) => (
          <path key={i.id} d={i.d} fillRule="evenodd" style={{ ['--k' as string]: k }} />
        ))}
      </g>
      <g className="plan-rails">
        {paths.islands.map((i) => (
          <path key={i.id} d={i.rails} />
        ))}
      </g>
      <g className="plan-bridges">
        {paths.bridges.map((b) => (
          <path key={b.id} d={b.d} />
        ))}
      </g>
      <g className="plan-elevators">
        {paths.elevators.map((e) => (
          <path key={e.id} d={e.d} />
        ))}
      </g>
      <g className="plan-items">
        {paths.small.map((i) => (
          <circle key={i.id} cx={i.pos[0]} cy={i.pos[1]} r={2.6} />
        ))}
      </g>
      <g className="plan-large">
        {paths.large.map((i) => (
          <path key={i.id} d={`M${i.pos[0]},${i.pos[1] - 9}l9,9l-9,9l-9,-9z`} />
        ))}
      </g>
      {sy <= h ? (
        <g className="plan-start">
          <circle cx={sx} cy={sy} r={11} />
          <text x={sx} y={sy + 4.5}>
            S
          </text>
        </g>
      ) : null}
      {gy <= h ? (
        <g className="plan-goal">
          <circle cx={gx} cy={gy} r={11} />
          <text x={gx} y={gy + 4.5}>
            G
          </text>
        </g>
      ) : null}
    </svg>
  );
}
