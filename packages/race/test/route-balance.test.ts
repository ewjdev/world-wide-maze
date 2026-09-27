import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { type BalancePolicyFactory, evaluateBalanceRun } from '../../../scripts/race-stunt-balance.ts';
import { createRoutePolicy } from '../../../scripts/race-stunt-policy.ts';
import type { RaceCourse, RaceInputSample } from '../src/index.ts';

const fixture = (name: string) => new URL(`../../../fixtures/race/island-leap/${name}`, import.meta.url);
const courseBytes = readFileSync(fixture('course.json'), 'utf8');
const course: RaceCourse = JSON.parse(courseBytes);
const policyBytes = readFileSync(new URL('../../../scripts/race-stunt-policy.ts', import.meta.url), 'utf8');
const policy: BalancePolicyFactory = (route, turbo) => {
  const driver = createRoutePolicy(course, route, { targetSpeed: 11, turbo });
  return (tick, ball, mechanics) => driver({ tick, ball, mechanics });
};
const clean = { id: 'clean', description: 'Unmodified adaptive route policy.' };

describe('Island Leap route-balance acceptance', () => {
  test('all three intended routes finish comparably with equal target-speed and turbo access', async () => {
    const results = await Promise.all(
      (['safe', 'near', 'far'] as const).map((route) =>
        evaluateBalanceRun(course, route, true, clean, policy),
      ),
    );
    for (const result of results) {
      expect(result.outcome).toBe('legal-finish');
      expect(result.intendedRoute).toBe(true);
      expect(result.turboCount).toBe(1);
    }
    const times = results.map((result) => result.seconds as number);
    expect(Math.max(...times) - Math.min(...times)).toBeLessThan(2);
    expect(results[1].launchCount).toBe(2);
    expect(results[1].landingCount).toBe(2);
  });
  test('with no stored turbo, the near policy finishes while the far policy cannot finish its intended route', async () => {
    const near = await evaluateBalanceRun(course, 'near', false, clean, policy);
    const far = await evaluateBalanceRun(course, 'far', false, clean, policy);
    expect(near.outcome).toBe('legal-finish');
    expect(near.intendedRoute).toBe(true);
    expect(far.outcome !== 'legal-finish' || !far.intendedRoute).toBe(true);
  });
  test('constant forward plus one charged turbo cannot complete the shared turning exit', async () => {
    const fixed: BalancePolicyFactory = () => {
      let sent = false;
      return (_tick, _ball, mechanics) => {
        const turbo = mechanics.ready && !sent;
        if (turbo) sent = true;
        return { tiltX: 0, tiltZ: 0.436, frameYaw: -Math.PI / 2, power: true, jump: false, turbo };
      };
    };
    const result = await evaluateBalanceRun(course, 'far', true, clean, fixed);
    expect(result.outcome).not.toBe('legal-finish');
    expect(result.turboCount).toBe(1);
  });
  test('published matrix identifies its exact course/policy and proves a physical catch-to-finish recovery', async () => {
    const report = JSON.parse(readFileSync(fixture('balance-validation.json'), 'utf8'));
    expect(report.courseId).toBe(course.courseId);
    expect(report.sourceHashes.courseFileSha256).toBe(createHash('sha256').update(courseBytes).digest('hex'));
    expect(report.sourceHashes.policyFileSha256).toBe(createHash('sha256').update(policyBytes).digest('hex'));
    const recovery = report.catchRecovery.accepted;
    expect(recovery).not.toBeNull();
    const saved = JSON.parse(readFileSync(fixture(recovery.inputsFile), 'utf8'));
    expect(saved.courseId).toBe(course.courseId);
    const inputs = saved.inputs as RaceInputSample[];
    const result = await evaluateBalanceRun(
      course,
      'near',
      false,
      { id: 'weak-launch-catch-return', description: 'Recorded physical recovery.' },
      () => (tick) => inputs[tick - 1] ?? { tiltX: 0, tiltZ: 0, frameYaw: 0, power: false, jump: false },
    );
    expect(result.outcome).toBe('legal-finish');
    expect(result.touchedIslandIds).toContain(7);
    expect(result.touchedIslandIds).toContain(4);
    expect(result.launchCount).toBeGreaterThan(0);
    expect(result.finishTick).toBe(recovery.evaluation.finishTick);
  });
});
