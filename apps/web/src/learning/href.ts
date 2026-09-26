/**
 * Phase 20 M4b (N): a Pip gate is a stage portal whose href uses the `wwm-learning:` scheme, e.g.
 * `wwm-learning:compare-groups/2#4f9fd6` (activity, gate number, the theme's gate colour). The engine draws such a
 * portal as a Pip gate in that colour (`isLearningHref` in packages/engine/src/world/portals.ts, same prefix, a
 * parity test keeps them equal), and the game never treats it as a link: no travel, no journey stop, no telemetry.
 */
export const LEARNING_HREF = 'wwm-learning:';

export function isLearningHref(href: string): boolean {
  return href.startsWith(LEARNING_HREF);
}

export function learningHref(activityId: string, gate: number, gateColor: string): string {
  const color = /^#[0-9a-f]{6}$/i.test(gateColor) ? gateColor.toLowerCase() : '';
  return `${LEARNING_HREF}${activityId}/${gate}${color}`;
}

/** The gate number (1-based) of a learning href, or null. */
export function gateNumber(href: string): number | null {
  const m = /^wwm-learning:[a-z][a-z0-9-]*\/(\d+)(?:#[0-9a-f]{6})?$/i.exec(href);
  return m ? Number(m[1]) : null;
}
