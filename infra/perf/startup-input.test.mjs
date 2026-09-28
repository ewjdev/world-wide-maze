/** Exercise the actual collector listeners without importing its browser/server side effects. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./startup-p2.mjs', import.meta.url), 'utf8');
const instrumentStart = source.indexOf('function instrument({ muted }) {');
const instrumentEnd = source.indexOf('\nfunction summarizeProfile(', instrumentStart);
assert.ok(instrumentStart >= 0 && instrumentEnd > instrumentStart, 'Collector instrumentation must exist');
const validationStart = source.indexOf('          const observed = run.observations;');
const validationEnd = source.indexOf('\n        } finally {', validationStart);
assert.ok(validationStart >= 0 && validationEnd > validationStart, 'Collector acceptance must exist');

function harness() {
  const target = new EventTarget();
  const window = {};
  let now = 0;
  let pendingFrames = [];
  let unlocks = 0;
  vm.runInNewContext(`${source.slice(instrumentStart, instrumentEnd)}\ninstrument({ muted: false });`, {
    window,
    localStorage: { setItem() {} },
    performance: { now: () => now },
    PerformanceObserver: class {
      observe() {}
    },
    requestAnimationFrame: (callback) => pendingFrames.push(callback),
    addEventListener: target.addEventListener.bind(target),
  });
  window.__wwmGame = {
    mount() {},
    audio: {
      unlock() {
        unlocks++;
      },
      setRoll() {},
    },
    subscribe() {},
    getView: () => ({ phase: 'play' }),
  };
  // Same registration order and unlock triggers as Game.mount(): instrumentation first.
  for (const type of ['keydown', 'pointerdown'])
    target.addEventListener(type, () => window.__wwmGame.audio.unlock(), { capture: true });
  return {
    probe: window.__startup,
    unlocks: () => unlocks,
    at(value) {
      now = value;
    },
    dispatch(type, properties = {}) {
      const event = new Event(type, { cancelable: true });
      for (const [key, value] of Object.entries({ isTrusted: true, ...properties }))
        Object.defineProperty(event, key, { value });
      target.dispatchEvent(event);
      return event;
    },
    frame(at) {
      now = at;
      const callbacks = pendingFrames;
      pendingFrames = [];
      for (const callback of callbacks) callback(at);
    },
  };
}

function validate(observations) {
  vm.runInNewContext(source.slice(validationStart, validationEnd), { run: { observations } });
}

function completePair(h) {
  for (const start of [100, 200]) {
    h.at(start);
    h.probe.armedInput = true;
    h.dispatch('keydown', { code: 'Space', repeat: false });
    h.frame(start + 16);
    h.dispatch('keyup', { code: 'Space' });
    h.probe.releases++;
  }
  return h.probe;
}

test('unarmed pointer and keys cannot reach downstream audio, and logs omit typed content', () => {
  const h = harness();
  for (const [type, properties] of [
    ['pointerdown', { pointerType: 'mouse' }],
    ['keydown', { code: 'KeyQ', key: 'private typed content' }],
    ['keydown', { code: 'Space', key: ' ' }],
  ])
    assert.equal(h.dispatch(type, properties).defaultPrevented, true);
  assert.equal(h.unlocks(), 0);
  assert.equal(h.probe.inputs.length, 0);
  assert.deepEqual(
    Array.from(h.probe.gestures, (g) => g.category),
    ['pointer', 'other-key', 'space'],
  );
  for (const gesture of h.probe.gestures) {
    assert.deepEqual(Object.keys(gesture).sort(), ['allowed', 'at', 'category', 'shot', 'trusted', 'type']);
    assert.equal(gesture.allowed, false);
    assert.equal(gesture.shot, null);
  }
  assert.ok(!JSON.stringify(h.probe.gestures).includes('private typed content'));
});

test('each armed Space follows production listeners once and retains measured timing', () => {
  const h = harness();
  h.at(100);
  h.probe.armedInput = true;
  assert.equal(h.dispatch('keydown', { code: 'Space', repeat: false }).defaultPrevented, false);
  assert.equal(h.probe.armedInput, false);
  assert.equal(h.unlocks(), 1);
  assert.equal(h.probe.inputs.length, 1);
  assert.equal(h.probe.inputs[0].nextFrame, undefined);
  h.frame(116);
  assert.equal(h.probe.inputs[0].start, 100);
  assert.equal(h.probe.inputs[0].nextFrame, 116);
  assert.equal(h.probe.inputs[0].trusted, true);
  h.at(200);
  h.probe.armedInput = true;
  h.dispatch('keydown', { code: 'Space', repeat: false });
  h.frame(217);
  assert.equal(h.unlocks(), 2);
  assert.deepEqual(
    Array.from(h.probe.gestures, (g) => g.shot),
    [0, 1],
  );
  assert.equal(h.probe.spans.filter((s) => s.name === 'audio.unlock').length, 2);
});

test('repeat and unrelated events do not consume an arm; subsequent unarmed Space is blocked', () => {
  const h = harness();
  h.probe.armedInput = true;
  for (const [type, properties] of [
    ['keydown', { code: 'Space', repeat: true }],
    ['keydown', { code: 'KeyQ' }],
    ['pointerdown', {}],
  ]) {
    assert.equal(h.dispatch(type, properties).defaultPrevented, true);
    assert.equal(h.probe.armedInput, true);
  }
  assert.equal(h.unlocks(), 0);
  h.dispatch('keydown', { code: 'Space', repeat: false });
  assert.equal(h.unlocks(), 1);
  assert.equal(h.dispatch('keydown', { code: 'Space', repeat: false }).defaultPrevented, true);
  assert.equal(h.unlocks(), 1);
  assert.equal(h.probe.inputs.length, 1);
});

test('acceptance permits isolated unrelated gestures outside both measured windows', () => {
  const h = harness();
  h.at(20);
  h.dispatch('pointerdown');
  h.dispatch('keydown', { code: 'KeyQ' });
  assert.doesNotThrow(() => validate(completePair(h)));
});

test('acceptance rejects an unconsumed arm, missing release, or missing admitted press', () => {
  for (const mutate of [
    (p) => {
      p.armedInput = true;
    },
    (p) => {
      p.releases = 1;
    },
    (p) => {
      p.gestures.pop();
    },
  ]) {
    const probe = completePair(harness());
    mutate(probe);
    assert.throws(() => validate(probe), /did not complete two press\/release pairs/);
  }
});

test('acceptance rejects suppressed Space even outside measured windows', () => {
  const h = harness();
  h.at(10);
  h.dispatch('keydown', { code: 'Space', repeat: false });
  assert.throws(() => validate(completePair(h)), /Desktop input interfered/);
});

test('acceptance rejects any suppressed gesture within either timing window including boundaries', () => {
  for (const at of [100, 108, 116, 200, 208, 216]) {
    const h = harness();
    completePair(h);
    h.at(at);
    h.dispatch('pointerdown');
    assert.throws(() => validate(h.probe), /Desktop input interfered/);
  }
});
