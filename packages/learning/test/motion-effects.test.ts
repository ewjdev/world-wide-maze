import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MotionScene } from '../src/motion.ts';
import { runMotionEffect } from '../src/motion-effects.ts';

function surface() {
  const events = new EventTarget();
  const attrs = new Map<string, string>();
  const body = new Map<string, string>();
  const gas = new Map<string, string>();
  const node = (values: Map<string, string>) => ({
    setAttribute: (k: string, v: string) => values.set(k, v),
  });
  const document = Object.assign(events, {
    hidden: false,
    defaultView: {
      performance,
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (cb: (n: number) => void) => setTimeout(() => cb(performance.now()), 16),
      cancelAnimationFrame: clearTimeout,
    },
  });
  const root = {
    ownerDocument: document,
    querySelector: (q: string) => node(q.includes('body') ? body : gas),
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    removeAttribute: (k: string) => attrs.delete(k),
  } as unknown as Element;
  const visible = (hidden: boolean) => {
    document.hidden = hidden;
    events.dispatchEvent(new Event('visibilitychange'));
  };
  return { root, body, gas, attrs, visible };
}
const balloon: MotionScene = {
  apparatus: 'balloon',
  setting: 'level-string',
  exhaust: 'right',
  startsStill: true,
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe('finite motion, narration and visibility ownership', () => {
  it('moves vehicle opposite escaping gas and completes once', () => {
    const s = surface();
    const complete = vi.fn();
    runMotionEffect(s.root, balloon, complete);
    vi.advanceTimersByTime(2300);
    expect(s.body.get('transform')).toBe('translate(-150 0)');
    expect(s.gas.get('transform')).toBe('translate(82.5 0)');
    expect(complete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(complete).toHaveBeenCalledTimes(1);
    s.visible(true);
    s.visible(false);
    vi.advanceTimersByTime(5000);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it('provides still before and after frames with reduced motion', () => {
    const s = surface();
    const complete = vi.fn();
    runMotionEffect(s.root, balloon, complete, true);
    expect(s.body.get('transform')).toBe('translate(0 0)');
    vi.advanceTimersByTime(700);
    expect(s.body.get('transform')).toBe('translate(-150 0)');
    vi.advanceTimersByTime(2100);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it('does not complete unseen work, restarts on return and cancels on disposal', () => {
    const s = surface();
    const complete = vi.fn();
    const dispose = runMotionEffect(s.root, balloon, complete, true);
    vi.advanceTimersByTime(1000);
    s.visible(true);
    vi.advanceTimersByTime(10000);
    expect(complete).not.toHaveBeenCalled();
    s.visible(false);
    expect(s.body.get('transform')).toBe('translate(0 0)');
    vi.advanceTimersByTime(1000);
    dispose();
    vi.advanceTimersByTime(10000);
    expect(complete).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('waits for slower narration but bounds a failed provider with a readable silent explanation', () => {
    const s = surface();
    const complete = vi.fn();
    let ready = false;
    runMotionEffect(s.root, balloon, complete, true, 2800, () => ready);
    vi.advanceTimersByTime(5000);
    expect(complete).not.toHaveBeenCalled();
    ready = true;
    vi.advanceTimersByTime(100);
    expect(complete).toHaveBeenCalledTimes(1);
    runMotionEffect(s.root, balloon, complete, true, 2800, () => false);
    vi.advanceTimersByTime(32800);
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
