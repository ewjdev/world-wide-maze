import type { SimulationOptions } from '@wwm/physics';
import type { RaceCourse } from './types.ts';

/** Untrusted course JSON must never select an unknown physics policy. */
export function racePhysicsOptions(profile: RaceCourse['physicsProfile']): SimulationOptions {
  if (profile === undefined) return {};
  if (profile === 'elevation-v1') return { raceElevation: true };
  throw new Error('Unknown Race physics profile');
}
