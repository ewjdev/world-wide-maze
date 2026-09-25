/** Real-browser `ControllerEnv` (kept apart from the session so the session stays testable in Node). */
import type { ControllerEnv } from './session.ts';

type OrientationWithLock = ScreenOrientation & { lock?: (o: string) => Promise<void> };

let hapticLabel: HTMLLabelElement | null = null;

/**
 * N: iOS Safari has no Vibration API, but since iOS 18 toggling a native `<input type="checkbox" switch>`
 * plays a system haptic tick. Best effort only (Apple may restrict it to user gestures).
 */
function iosHapticTick(): void {
  if (!hapticLabel) {
    hapticLabel = document.createElement('label');
    hapticLabel.setAttribute('aria-hidden', 'true');
    hapticLabel.style.cssText = 'position:fixed;left:-100px;top:-100px;opacity:0;pointer-events:none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    hapticLabel.appendChild(input);
    document.body.appendChild(hapticLabel);
  }
  hapticLabel.click();
}

const isIOS = () =>
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));

export function browserEnv(): ControllerEnv {
  const orientation = screen.orientation as OrientationWithLock | undefined;
  const DOE = (window as unknown as { DeviceOrientationEvent?: ControllerEnv['DeviceOrientationEvent'] })
    .DeviceOrientationEvent;
  return {
    origin: location.origin,
    now: () => performance.now(),
    requestAnimationFrame: (cb) => window.requestAnimationFrame(cb),
    cancelAnimationFrame: (id) => window.cancelAnimationFrame(id),
    sensorTarget: window,
    visibilityTarget: document,
    isVisible: () => document.visibilityState === 'visible',
    screenAngle: () =>
      orientation?.angle ?? (typeof window.orientation === 'number' ? (window.orientation as number) : 0),
    ...(orientation ? { orientationTarget: orientation } : {}),
    ...(DOE ? { DeviceOrientationEvent: DOE } : {}),
    storage: (() => {
      try {
        return window.sessionStorage;
      } catch {
        return null;
      }
    })(),
    vibrate: (p) => (typeof navigator.vibrate === 'function' ? navigator.vibrate(p) : false),
    ...(isIOS() ? { iosHapticTick } : {}),
    requestWakeLock: async () => {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<unknown> } })
        .wakeLock;
      if (wl) await wl.request('screen');
    },
    requestFullscreenAndLock: async () => {
      if (isIOS()) return; // iPhone Safari has no element fullscreen; portrait lock is advised instead
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen)
        await el.requestFullscreen({ navigationUI: 'hide' });
      await orientation?.lock?.('portrait');
    },
    log: (...args) => console.info(...args),
  };
}
