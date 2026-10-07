import { MAX_TILT_ROLL } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { TiltInputSource } from '../src/sources/tilt.ts';

function source() {
  const input = new TiltInputSource({ frameYaw: () => 0.7 });
  input.calibrate([0, 0, -1]);
  return input;
}
function pointer(target: EventTarget, type: string, id = 1) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId: id, pointerType: 'touch' });
  target.dispatchEvent(event);
}
describe('local tilt tick input', () => {
  test('zeros are neutral, heading is irrelevant, screen rotation changes the steering frame', () => {
    const input = source();
    input.update({ alpha: null, beta: 0, gamma: 0 }, 0, 0);
    expect(input.peek(0)).toEqual({ tiltX: 0, tiltZ: 0, power: false, jump: false, frameYaw: 0.7 });
    input.reset();
    input.update({ alpha: 12, beta: 0, gamma: 10 }, 0, 1);
    const sample = input.peek(1);
    expect(sample.tiltX).toBeGreaterThan(0);
    expect(sample.power).toBe(true);
    input.reset();
    input.update({ alpha: 250, beta: 0, gamma: 10 }, 0, 2);
    expect(input.peek(2)).toEqual(sample);
    input.reset();
    input.update({ alpha: null, beta: 0, gamma: 10 }, 90, 3);
    expect(input.peek(3).tiltZ).toBeLessThan(0);
    expect(Math.abs(input.peek(3).tiltX)).toBeLessThan(1e-8);
    input.reset();
    input.update({ alpha: null, beta: 0, gamma: 80 }, 0, 4);
    expect(input.peek(4).tiltX).toBeLessThanOrEqual(MAX_TILT_ROLL);
  });
  test('only eligible ticks consume Jump, catch-up inserts a neutral tick and reset drops pending actions', () => {
    const input = source();
    const first = input.requestJump();
    input.completeJump(first);
    for (let n = 0; n < 10; n++) expect(input.peek(n).jump).toBe(true);
    expect(input.sample(10).jump).toBe(true);
    input.requestJump();
    expect(input.sample(11).jump).toBe(false);
    expect(input.sample(12).jump).toBe(true);
    expect(input.sample(13).jump).toBe(false);
    input.requestJump();
    input.reset();
    expect(input.sample(14).jump).toBe(false);
  });
  test('up then normal capture release before a tick retains exactly one completed quick tap', () => {
    const input = source();
    const surface = new EventTarget();
    input.attachSurface(surface, () => true);
    pointer(surface, 'pointerdown');
    pointer(surface, 'pointerdown', 2);
    expect(input.contactsActive).toBe(true);
    pointer(surface, 'pointerup');
    pointer(surface, 'lostpointercapture');
    expect(input.contactsActive).toBe(false);
    expect(input.sample(0).jump).toBe(true);
    expect(input.sample(1).jump).toBe(false);
    input.dispose();
  });
  test('active cancellation drops its tap, later cancellation cannot erase a coalesced completed tap', () => {
    const input = source();
    const surface = new EventTarget();
    const detach = input.attachSurface(surface, () => true);
    pointer(surface, 'pointerdown');
    pointer(surface, 'pointercancel');
    pointer(surface, 'lostpointercapture');
    expect(input.sample(0).jump).toBe(false);
    pointer(surface, 'pointerdown', 2);
    pointer(surface, 'pointerup', 2);
    pointer(surface, 'pointerdown', 3);
    pointer(surface, 'lostpointercapture', 3);
    expect(input.sample(1).jump).toBe(true);
    pointer(surface, 'pointerdown', 4);
    pointer(surface, 'pointerup', 4);
    detach();
    expect(input.sample(2).jump).toBe(false);
  });
  test('invalid readings neutralize steering and reset filters without changing the calibrated grip', () => {
    const input = source();
    input.update({ alpha: null, beta: 0, gamma: 12 }, 0, 0);
    expect(input.peek(0).power).toBe(true);
    expect(input.update({ alpha: null, beta: NaN, gamma: 0 }, 0, 10)).toBe(false);
    expect(input.peek(10).power).toBe(false);
    input.update({ alpha: null, beta: 0, gamma: 0 }, 0, 11);
    expect(input.peek(11).tiltX).toBe(0);
  });
});
