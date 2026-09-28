/**
 * Independent deterministic sensitivity matrix for Island Leap. Uses ordinary player inputs only.
 * All results are policy-specific feasibility observations, never a human success probability.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  advanceProgress,
  createProgress,
  createRaceSimulation,
  makeCompatibility,
  type RaceAttempt,
  type RaceCourse,
  type RaceInputSample,
  type RaceMechanics,
  RaceRecorder,
  replayRace,
} from '../packages/race/src/index.ts';
import { type BallState, PX_PER_METER, pointInPolygon, SIM_HZ } from '../packages/schema/src/index.ts';
import { levelToWorldY } from '../packages/schema/src/space.ts';

export type BalanceRoute = 'safe' | 'near' | 'far';
export type BalancePolicy = (tick: number, ball: BallState, mechanics: RaceMechanics) => RaceInputSample;
export type BalancePolicyFactory = (route: BalanceRoute, turbo: boolean) => BalancePolicy;
interface Scenario {
  id: string;
  description: string;
  headingDegrees?: number;
  inputScale?: number;
  durationTicks?: number;
  turboDelayTicks?: number;
  location?: 'decision' | 'launch';
  leadMeters?: number;
}
export const BALANCE_SCENARIOS: Scenario[] = [
  { id: 'clean', description: 'Unmodified closed-loop policy.' },
  {
    id: 'lip-left-6',
    description: 'Rotate requested heading -6 degrees for 0.5s starting 1.5m before the launch plane.',
    headingDegrees: -6,
    durationTicks: 60,
    location: 'launch',
    leadMeters: 1.5,
  },
  {
    id: 'lip-right-6',
    description: 'Rotate requested heading +6 degrees for 0.5s starting 1.5m before the launch plane.',
    headingDegrees: 6,
    durationTicks: 60,
    location: 'launch',
    leadMeters: 1.5,
  },
  {
    id: 'lip-left-12',
    description:
      'Rotate requested heading -12 degrees for 1s starting 1.5m before the launch plane; moderate steering error stress case.',
    headingDegrees: -12,
    durationTicks: 120,
    location: 'launch',
    leadMeters: 1.5,
  },
  {
    id: 'lip-right-12',
    description:
      'Rotate requested heading +12 degrees for 1s starting 1.5m before the launch plane; moderate steering error stress case.',
    headingDegrees: 12,
    durationTicks: 120,
    location: 'launch',
    leadMeters: 1.5,
  },
  {
    id: 'slower-entry',
    description: 'Reduce tilt to 85% for 1.5s beginning 10m before the launch plane.',
    inputScale: 0.85,
    durationTicks: 180,
    location: 'launch',
    leadMeters: 10,
  },
  {
    id: 'heading-left-3',
    description: 'Rotate requested heading -3 degrees for 0.25s near the route decision.',
    headingDegrees: -3,
    durationTicks: 30,
  },
  {
    id: 'heading-right-3',
    description: 'Rotate requested heading +3 degrees for 0.25s near the route decision.',
    headingDegrees: 3,
    durationTicks: 30,
  },
  {
    id: 'heading-left-6',
    description: 'Rotate requested heading -6 degrees for 0.5s near the route decision.',
    headingDegrees: -6,
    durationTicks: 60,
  },
  {
    id: 'heading-right-6',
    description: 'Rotate requested heading +6 degrees for 0.5s near the route decision.',
    headingDegrees: 6,
    durationTicks: 60,
  },
  {
    id: 'soft-approach',
    description: 'Reduce both tilt inputs to 85% for 0.5s near the route decision.',
    inputScale: 0.85,
    durationTicks: 60,
  },
  {
    id: 'hesitate',
    description: 'Release POWER for 0.1s near the route decision.',
    inputScale: 0,
    durationTicks: 12,
  },
  {
    id: 'turbo-late-100ms',
    description: 'Delay each requested turbo activation by 12 simulation ticks.',
    turboDelayTicks: 12,
  },
  {
    id: 'turbo-late-250ms',
    description: 'Delay each requested turbo activation by 30 simulation ticks.',
    turboDelayTicks: 30,
  },
  {
    id: 'heading-and-late',
    description: 'Combine +3 degree heading for 0.25s and a 100ms turbo delay.',
    headingDegrees: 3,
    durationTicks: 30,
    turboDelayTicks: 12,
  },
];
interface Evaluation {
  route: BalanceRoute;
  turboAllowed: boolean;
  scenario: string;
  outcome: 'legal-finish' | 'fall' | 'timeout';
  finishTick: number | null;
  seconds: number | null;
  observedSeconds: number;
  intendedRoute: boolean;
  firstLandingIsland: number | null;
  firstRewardedLandingIsland: number | null;
  launchCount: number;
  landingCount: number;
  turboCount: number;
  approachSpeedMps: number | null;
  disturbanceStartTick: number | null;
  firstFailureTick: number | null;
  finalPosition: number[];
  touchedIslandIds: number[];
}

/** Input perturbations are applied after the controller chooses a fresh response to current state. */
export async function evaluateBalanceRun(
  course: RaceCourse,
  route: BalanceRoute,
  turbo: boolean,
  scenario: Scenario,
  factory: BalancePolicyFactory,
): Promise<Evaluation> {
  const sim = await createRaceSimulation(course);
  const policy = factory(route, turbo);
  await sim.load(course.stage);
  let progress = createProgress();
  let started: number | null = null;
  let initialSpeed: number | null = null;
  let firstFailure: number | null = null;
  let firstLanding: number | null = null;
  let firstRewardedLanding: number | null = null;
  let firstFlightAirTicks = 0;
  let firstLandingResolved = false;
  let turboCount = 0;
  let scheduledTurbo: number | null = null;
  let previousTurbo = false;
  const touchedIslandIds: number[] = [];
  const decision =
    scenario.location === 'launch' && course.stunts?.launchPads[0]
      ? course.stunts.launchPads[0].gate
      : course.gates[0];
  try {
    for (let tick = 1; tick <= SIM_HZ * 100; tick++) {
      const before = sim.getBallState();
      const mechanics = sim.getMechanics();
      const input = { ...policy(tick, before, mechanics) };
      const distance =
        (before.pos[0] - decision.center[0]) * decision.normal[0] +
        (before.pos[2] - decision.center[2]) * decision.normal[1];
      if (scenario.durationTicks && started === null && distance >= -(scenario.leadMeters ?? 5)) {
        started = tick;
        initialSpeed = Math.hypot(before.vel[0], before.vel[2]);
      }
      if (started !== null && tick < started + (scenario.durationTicks ?? 0)) {
        input.frameYaw += ((scenario.headingDegrees ?? 0) * Math.PI) / 180;
        if (scenario.inputScale !== undefined) {
          input.tiltX *= scenario.inputScale;
          input.tiltZ *= scenario.inputScale;
          if (scenario.inputScale === 0) input.power = false;
        }
      }
      if (!turbo) input.turbo = false;
      const requested = !!input.turbo;
      if (scenario.turboDelayTicks) {
        if (requested && !previousTurbo && scheduledTurbo === null)
          scheduledTurbo = tick + scenario.turboDelayTicks;
        input.turbo = scheduledTurbo === tick;
        if (input.turbo) scheduledTurbo = null;
      }
      previousTurbo = requested;
      const result = sim.step(input);
      const current = sim.getMechanics();
      if (current.lastEvent === 'turbo') turboCount++;
      const landingIsland = () => {
        const p: [number, number] = [result.ball.pos[0] * PX_PER_METER, result.ball.pos[2] * PX_PER_METER];
        return (
          course.stage.islands.find(
            (i) =>
              pointInPolygon(p, i.contour, i.holes) &&
              Math.abs(result.ball.pos[1] - levelToWorldY(i.level) - 0.5) < 0.5,
          )?.id ?? null
        );
      };
      if (result.ball.grounded) {
        const id = landingIsland();
        if (id !== null && !touchedIslandIds.includes(id)) touchedIslandIds.push(id);
      }
      if (current.launches > 0 && !firstLandingResolved) {
        if (!result.ball.grounded) firstFlightAirTicks++;
        else if (firstFlightAirTicks > 0) {
          firstLanding = landingIsland();
          firstLandingResolved = true;
        }
      }
      if (current.lastEvent === 'landing' && firstRewardedLanding === null)
        firstRewardedLanding = landingIsland();
      const fell = result.events.some((e) => e.type === 'fell' || e.type === 'lost');
      progress = advanceProgress(progress, course.gates, {
        tick,
        previous: before.pos,
        current: result.ball.pos,
        fell,
      });
      if (fell) {
        firstFailure = tick;
        break;
      }
      if (progress.finishTick !== null) break;
    }
    const mechanics = sim.getMechanics();
    const intended =
      route === 'safe' ? mechanics.launches === 0 : firstLanding === (route === 'near' ? 2 : 3);
    return {
      route,
      turboAllowed: turbo,
      scenario: scenario.id,
      outcome:
        progress.finishTick !== null && !progress.reasons.length
          ? 'legal-finish'
          : firstFailure !== null
            ? 'fall'
            : 'timeout',
      finishTick: progress.finishTick,
      seconds: progress.finishTick === null ? null : progress.finishTick / SIM_HZ,
      observedSeconds: progress.tick / SIM_HZ,
      intendedRoute: intended,
      firstLandingIsland: firstLanding,
      firstRewardedLandingIsland: firstRewardedLanding,
      launchCount: mechanics.launches,
      landingCount: mechanics.landings,
      turboCount,
      approachSpeedMps: initialSpeed,
      disturbanceStartTick: started,
      firstFailureTick: firstFailure,
      finalPosition: sim.getBallState().pos,
      touchedIslandIds,
    };
  } finally {
    sim.dispose();
  }
}

export async function runBalanceMatrix(course: RaceCourse, factory: BalancePolicyFactory) {
  const runs: Evaluation[] = [];
  const repeats = [];
  for (const route of ['safe', 'near', 'far'] as const) {
    for (const turbo of [false, true]) {
      for (const scenario of BALANCE_SCENARIOS) {
        const run = await evaluateBalanceRun(course, route, turbo, scenario, factory);
        runs.push(run);
        if (scenario.id === 'clean') {
          const repeat = await evaluateBalanceRun(course, route, turbo, scenario, factory);
          const identical = JSON.stringify(run) === JSON.stringify(repeat);
          if (!identical) throw new Error(`Nondeterministic balance result: ${route}/${turbo}`);
          repeats.push({ route, turboAllowed: turbo, identical });
        }
      }
    }
  }
  const summary = (['safe', 'near', 'far'] as const).flatMap((route) =>
    [false, true].map((turbo) => {
      const group = runs.filter((r) => r.route === route && r.turboAllowed === turbo);
      const completed = group.filter((r) => r.outcome === 'legal-finish');
      const intended = completed.filter((r) => r.intendedRoute);
      const times = intended.map((r) => r.seconds as number).sort((a, b) => a - b);
      return {
        route,
        turboAllowed: turbo,
        runs: group.length,
        legalFinishes: completed.length,
        intendedFinishes: intended.length,
        falls: group.filter((r) => r.outcome === 'fall').length,
        timeouts: group.filter((r) => r.outcome === 'timeout').length,
        clean: group.find((r) => r.scenario === 'clean'),
        fastestIntendedSeconds: times[0] ?? null,
        slowestIntendedSeconds: times.at(-1) ?? null,
      };
    }),
  );
  const naive = [];
  for (const strategy of ['when-charged', 'at-lip'] as const) {
    const fixedFactory: BalancePolicyFactory = () => {
      let sent = false;
      return (_tick, ball, mechanics) => {
        const pad = course.stunts?.launchPads[0];
        const distance = pad
          ? (ball.pos[0] - pad.gate.center[0]) * pad.gate.normal[0] +
            (ball.pos[2] - pad.gate.center[2]) * pad.gate.normal[1]
          : 0;
        const trigger = !sent && mechanics.ready && (strategy === 'when-charged' || distance >= -2);
        if (trigger) sent = true;
        return { tiltX: 0, tiltZ: 0.436, frameYaw: -Math.PI / 2, power: true, jump: false, turbo: trigger };
      };
    };
    const evaluation = await evaluateBalanceRun(
      course,
      'far',
      true,
      {
        id: `hold-forward-${strategy}`,
        description: 'Constant world +X forward input, one turbo, no steering correction.',
      },
      fixedFactory,
    );
    if (evaluation.outcome === 'legal-finish')
      throw new Error(`Naive hold-forward strategy still completes: ${strategy}`);
    naive.push({ strategy, ...evaluation });
  }
  return {
    courseId: course.courseId,
    compatibility: makeCompatibility(course.courseId, true, course.physicsProfile),
    schema: 'wwm.race-balance/1',
    method:
      'Fixed-step real Rapier; shared closed-loop route policy observes current ball state each tick. Perturbations change ordinary tilt/yaw/POWER/turbo input only. No teleport or state injection. Each clean run repeated exactly.',
    limitations: [
      'A finite deterministic sensitivity matrix is not a human difficulty study or probability distribution.',
      'Closed-loop policies can correct disturbances faster than a human; failure can also reflect controller limitations.',
      'Decision perturbations begin 5m before the first shared gate. Launch-plane perturbations begin at the stated lead distance; on the safe route this is a different ground feature, not a jump.',
      'Turbo-delayed scenarios have no effective perturbation on policies that never request turbo; inspect turboCount.',
      'Route speed and turbo strategies are disclosed in the policy source; these are not globally optimal lines.',
      'Intended-route finish checks the first physical touchdown island after launch, independently of clean-landing rewards. Null denotes no identified island touchdown (for example a bridge contact); it does not prove a different branch.',
      'No route-dominance or balance-completion claim follows from this matrix alone.',
    ],
    naiveHoldForwardChecks: naive,
    scenarios: BALANCE_SCENARIOS,
    repeatChecks: repeats,
    summary,
    runs,
  };
}

/** A deliberately weak approach followed by an adaptive physical return from the lower catch. */
export function createCatchPolicy(
  course: RaceCourse,
  approachSpeed: number,
  brakeAtPx: number,
): BalancePolicy {
  const catchIsland = course.stage.islands.find((i) => i.id === 7);
  let caught = false;
  let waypoint = 0;
  const targets = [
    [1130, 325],
    [1080, 450],
    [1060, 470],
    [1100, 475],
    [1140, 518],
    [1195, 510],
    [1250, 535],
    [1375, 595],
    [1375, 730],
  ];
  return (_tick, ball) => {
    const px = ball.pos[0] * PX_PER_METER;
    const pz = ball.pos[2] * PX_PER_METER;
    if (
      catchIsland &&
      ball.grounded &&
      pointInPolygon([px, pz], catchIsland.contour, catchIsland.holes) &&
      Math.abs(ball.pos[1] - levelToWorldY(catchIsland.level) - 0.5) < 0.5
    )
      caught = true;
    if (!caught && px < brakeAtPx)
      return { tiltX: 0, tiltZ: 0.436, frameYaw: -Math.PI / 2, power: true, jump: false };
    let target = caught ? targets[waypoint] : [1130, 260];
    let dx = target[0] / PX_PER_METER - ball.pos[0];
    let dz = target[1] / PX_PER_METER - ball.pos[2];
    if (caught && Math.hypot(dx, dz) < 0.6 && waypoint < targets.length - 1) {
      waypoint++;
      target = targets[waypoint];
      dx = target[0] / PX_PER_METER - ball.pos[0];
      dz = target[1] / PX_PER_METER - ball.pos[2];
    }
    const distance = Math.hypot(dx, dz) || 1;
    const speed = Math.min(caught ? 4.5 : approachSpeed, distance * 2.8);
    const vx = (dx / distance) * speed,
      vz = (dz / distance) * speed;
    const tilt = (a: number) =>
      Math.asin(Math.max(-Math.sin(0.436), Math.min(Math.sin(0.436), a / ((46.3 * 5) / 7))));
    return {
      tiltX: tilt(4 * (vx - ball.vel[0]) + 1.2 * vx),
      tiltZ: tilt(-(4 * (vz - ball.vel[2]) + 1.2 * vz)),
      frameYaw: 0,
      power: true,
      jump: false,
    };
  };
}

export async function searchCatchRecovery(course: RaceCourse) {
  const candidates = [];
  let accepted: {
    approachSpeed: number;
    brakeAtPx: number;
    evaluation: Evaluation;
    inputs: RaceInputSample[];
  } | null = null;
  for (const approachSpeed of [6, 7, 8, 5, 4, 9]) {
    for (const brakeAtPx of [900, 960, 1000, 1040]) {
      const inputs: RaceInputSample[] = [];
      const policy = createCatchPolicy(course, approachSpeed, brakeAtPx);
      const evaluation = await evaluateBalanceRun(
        course,
        'near',
        false,
        {
          id: 'weak-launch-catch-return',
          description: 'Controlled weak approach, lower catch, adaptive ground return; no teleport.',
        },
        () => (tick, ball, mechanics) => {
          const input = policy(tick, ball, mechanics);
          inputs.push(input);
          return input;
        },
      );
      const caughtAndFinished =
        evaluation.outcome === 'legal-finish' &&
        evaluation.touchedIslandIds.includes(7) &&
        evaluation.touchedIslandIds.includes(4) &&
        evaluation.launchCount > 0;
      candidates.push({ approachSpeed, brakeAtPx, caughtAndFinished, evaluation });
      if (caughtAndFinished && !accepted) accepted = { approachSpeed, brakeAtPx, evaluation, inputs };
    }
  }
  return {
    method:
      'Bounded search of 24 normal-input approach/controller combinations. A recovery requires physical contact on lower catch island 7, return ground island 4, and ordered legal finish without fall/reset.',
    candidates,
    accepted,
  };
}

async function writeRecoveryArtifacts(
  course: RaceCourse,
  accepted: NonNullable<Awaited<ReturnType<typeof searchCatchRecovery>>['accepted']>,
  dir: string,
) {
  const sim = await createRaceSimulation(course);
  await sim.load(course.stage);
  const recorder = new RaceRecorder(undefined, true);
  let progress = createProgress();
  const trace: number[][] = [];
  const events: unknown[] = [];
  try {
    for (const [index, input] of accepted.inputs.entries()) {
      const previous = sim.getBallState();
      recorder.record(input);
      const result = sim.step(input);
      progress = advanceProgress(progress, course.gates, {
        tick: index + 1,
        previous: previous.pos,
        current: result.ball.pos,
        fell: result.events.some((event) => event.type === 'fell' || event.type === 'lost'),
      });
      trace.push([...result.ball.pos, ...result.ball.vel, Number(result.ball.grounded)]);
      const mechanic = sim.getMechanics().lastEvent;
      if (result.events.length || mechanic)
        events.push({ tick: index + 1, events: result.events, mechanic, pos: result.ball.pos });
    }
    if (progress.finishTick !== accepted.evaluation.finishTick || progress.reasons.length)
      throw new Error('Recovery trace did not finish cleanly');
    const attempt: RaceAttempt = {
      schema: 'wwm.race-attempt/1',
      id: 'island-leap-catch-return',
      createdAt: 0,
      compatibility: makeCompatibility(course.courseId, true, course.physicsProfile),
      inputSource: 'keyboard',
      outcome: 'finished',
      progress,
      recording: recorder.finish(),
    };
    const track = await replayRace(course, attempt);
    for (let i = 0; i < trace.length; i++)
      for (let axis = 0; axis < 3; axis++) {
        if (track.pos[(i + 1) * 3 + axis] !== Math.fround(trace[i][axis]))
          throw new Error(`Catch replay drift at tick ${i + 1}`);
      }
    const validation = {
      courseId: course.courseId,
      compatibility: attempt.compatibility,
      progress,
      mechanics: sim.getMechanics(),
      events,
      touchedIslandIds: accepted.evaluation.touchedIslandIds,
      approachSpeedMps: accepted.approachSpeed,
      brakeAtPx: accepted.brakeAtPx,
      replayVerified: true,
      resets: 0,
      method:
        'Weak launch, physical lower catch and connecting ramp, ordinary adaptive player inputs, ordered legal finish. Exact float32 pose replay in a second simulation. No reset, teleport, recovery event or physics injection.',
    };
    await writeFile(
      resolve(dir, 'recovery-inputs.json'),
      JSON.stringify({ courseId: course.courseId, inputs: accepted.inputs }),
    );
    await writeFile(
      resolve(dir, 'recovery-trace.json'),
      JSON.stringify({
        courseId: course.courseId,
        columns: ['x', 'y', 'z', 'vx', 'vy', 'vz', 'grounded'],
        ticks: trace,
      }),
    );
    await writeFile(resolve(dir, 'recovery-validation.json'), `${JSON.stringify(validation, null, 2)}\n`);
    return validation;
  } finally {
    sim.dispose();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(import.meta.dirname, '../fixtures/race/island-leap');
  const courseBytes = await readFile(resolve(dir, 'course.json'), 'utf8');
  const course: RaceCourse = JSON.parse(courseBytes);
  const policyBytes = await readFile(resolve(import.meta.dirname, 'race-stunt-policy.ts'), 'utf8');
  // Policy module is authored alongside course verification so all routes share the same controller.
  const { createRoutePolicy } = await import('./race-stunt-policy.ts');
  const report = await runBalanceMatrix(course, (route, turbo) => {
    const policy = createRoutePolicy(course, route, { targetSpeed: 11, turbo });
    return (tick, ball, mechanics) => policy({ tick, ball, mechanics });
  });
  const speedProfiles = [];
  for (const targetSpeed of [8, 12]) {
    const alternate = await runBalanceMatrix(course, (route, turbo) => {
      const policy = createRoutePolicy(course, route, { targetSpeed, turbo });
      return (tick, ball, mechanics) => policy({ tick, ball, mechanics });
    });
    speedProfiles.push({
      targetSpeedMps: targetSpeed,
      summary: alternate.summary,
      repeatChecks: alternate.repeatChecks,
      runs: alternate.runs,
    });
  }
  const catchRecovery = await searchCatchRecovery(course);
  if (!catchRecovery.accepted) throw new Error('No tested weak launch reaches lower catch and finishes');
  const recoveryProof = await writeRecoveryArtifacts(course, catchRecovery.accepted, dir);
  const artifact = {
    ...report,
    catchRecovery: {
      ...catchRecovery,
      accepted: {
        ...catchRecovery.accepted,
        inputs: undefined,
        inputsFile: 'recovery-inputs.json',
        validationFile: 'recovery-validation.json',
        traceFile: 'recovery-trace.json',
        replayVerified: recoveryProof.replayVerified,
      },
    },
    baselineTargetSpeedMps: 11,
    profileInterpretation:
      'Target speed is the closed-loop controller setting after its initial full-input cruise; it is not a clamped physical speed or a guaranteed launch entry speed. Each route uses the same setting and permits the same 26m/s turbo headroom. Baseline and alternate profiles use identical geometry.',
    sourceHashes: {
      courseFileSha256: createHash('sha256').update(courseBytes).digest('hex'),
      policyFileSha256: createHash('sha256').update(policyBytes).digest('hex'),
    },
    speedProfiles,
  };
  await writeFile(resolve(dir, 'balance-validation.json'), `${JSON.stringify(artifact, null, 2)}\n`);
  for (const item of report.summary) console.log(JSON.stringify(item));
}
