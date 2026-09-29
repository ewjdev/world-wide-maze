import { describe, expect, test } from 'vitest';
import { preferTouch, touchCapable } from '../src/input/capability.ts';
import { mobileControlsEnabled } from '../src/input/flags.ts';

describe('mobile controls flag', () => {
  test('production requires an explicit true; development defaults on unless false', () => {
    expect(mobileControlsEnabled({})).toBe(false);
    expect(mobileControlsEnabled({ VITE_MOBILE_CONTROLS_ENABLED: 'false' })).toBe(false);
    expect(mobileControlsEnabled({ VITE_MOBILE_CONTROLS_ENABLED: 'true' })).toBe(true);
    expect(mobileControlsEnabled({ VITE_MOBILE_CONTROLS_ENABLED: '1' })).toBe(false);
    expect(mobileControlsEnabled({ DEV: true })).toBe(true);
    expect(mobileControlsEnabled({ DEV: true, VITE_MOBILE_CONTROLS_ENABLED: 'false' })).toBe(false);
  });
});

describe('touch capability', () => {
  const phone = { enabled: true, coarse: true, touchPoints: 5 };
  test('a phone-class device prefers touch; capability alone (a hybrid laptop) does not', () => {
    expect(preferTouch(phone)).toBe(true);
    expect(preferTouch({ enabled: true, coarse: false, touchPoints: 10 })).toBe(false);
    expect(touchCapable({ enabled: true, coarse: false, touchPoints: 10 })).toBe(true);
    expect(touchCapable({ enabled: true, touchPoints: 0 })).toBe(false);
  });
  test('an explicit saved choice wins over the coarse-pointer heuristic, both ways', () => {
    expect(preferTouch({ enabled: true, coarse: false, touchPoints: 10, preference: 'touch' })).toBe(true);
    expect(preferTouch({ ...phone, preference: 'keyboard' })).toBe(false);
    expect(preferTouch({ ...phone, preference: 'garbage' })).toBe(true);
  });
  test('a disabled flag beats a stale saved preference and every heuristic', () => {
    expect(preferTouch({ ...phone, enabled: false, preference: 'touch' })).toBe(false);
    expect(touchCapable({ ...phone, enabled: false })).toBe(false);
  });
});
