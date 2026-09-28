// Research only: no production import, wire-format or eligibility change.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

/** Proposal: exact Float64 fields + packed boolean flags; explicit rejection, never truncation. */
export class RecordingPrototype {
  constructor(capacity = 36_000) {
    this.capacity = capacity;
    this.values = new Float64Array(capacity * 3);
    this.flags = new Uint8Array(capacity);
    this.length = 0;
  }
  get byteLength() {
    return this.values.byteLength + this.flags.byteLength;
  }
  append(input) {
    if (this.length === this.capacity) return false;
    const i = this.length++;
    this.values.set([input.tiltX, input.tiltZ, input.frameYaw], i * 3);
    this.flags[i] = (input.power ? 1 : 0) | (input.jump ? 2 : 0);
    return true;
  }
  expand() {
    return Array.from({ length: this.length }, (_, i) => ({
      tiltX: this.values[i * 3],
      tiltZ: this.values[i * 3 + 1],
      frameYaw: this.values[i * 3 + 2],
      power: !!(this.flags[i] & 1),
      jump: !!(this.flags[i] & 2),
    }));
  }
  clear() {
    this.length = 0;
  }
}
function sample(i, scenario) {
  return scenario === 'idle'
    ? { tiltX: 0, tiltZ: 0, frameYaw: 0, power: false, jump: false }
    : {
        tiltX: Math.sin(i / 47) * 0.3,
        tiltZ: Math.cos(i / 61) * 0.4,
        frameYaw: Math.sin(i / 137),
        power: true,
        jump: i % 239 === 0,
      };
}
async function main() {
  assert.equal(typeof global.gc, 'function', 'Run node --expose-gc --import tsx infra/perf/recording-p2.mjs');
  const rows = [];
  for (const scenario of ['idle', 'active'])
    for (const ticks of [1394, 7200, 18000, 36000, 36001, 72000]) {
      global.gc();
      const before = process.memoryUsage().heapUsed;
      const t0 = performance.now();
      // Actual game shares one sampled object across ~2 simulation ticks at 60Hz/120Hz.
      let input;
      const inputs = Array.from({ length: ticks }, (_, i) => {
        if (i % 2 === 0) input = sample(i, scenario);
        return input;
      });
      const appendMs = performance.now() - t0;
      global.gc();
      const retainedHeapEstimate = process.memoryUsage().heapUsed - before;
      const start = performance.now();
      const serialized = JSON.stringify({
        physicsVersion: '0.2.0',
        inputs,
        timerStartTick: scenario === 'idle' ? ticks : 0,
      });
      const serializeMs = performance.now() - start;
      const prototype = new RecordingPrototype();
      let rejected = 0;
      for (const input of inputs) if (!prototype.append(input)) rejected++;
      const expanded = prototype.expand();
      assert.deepEqual(expanded, inputs.slice(0, 36000));
      const uniqueConsecutive = inputs.reduce(
        (n, input, i) => n + (i === 0 || JSON.stringify(input) !== JSON.stringify(inputs[i - 1]) ? 1 : 0),
        0,
      );
      rows.push({
        scenario,
        ticks,
        simSeconds: ticks / 120,
        appendMs,
        retainedHeapEstimate,
        serializeMs,
        jsonBytes: Buffer.byteLength(serialized),
        prototypeBytes: prototype.byteLength,
        prototypeTicks: prototype.length,
        rejected,
        uniqueConsecutive,
        exactWithinCapacity: true,
      });
    }
  const fixture = JSON.parse(await readFile('fixtures/replays/handmade-simple.keyboard.json', 'utf8'));
  const inputs = Array.isArray(fixture) ? fixture : fixture.inputs;
  const prototype = new RecordingPrototype();
  for (const input of inputs) assert(prototype.append(input));
  assert.deepEqual(prototype.expand(), inputs);
  const out = process.env.AUDIT_OUT ?? 'docs/launch/evidence/recording-p2';
  await mkdir(out, { recursive: true });
  await writeFile(
    `${out}/curves.json`,
    `${JSON.stringify({ date: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), node: process.version, hardware: os.cpus()[0]?.model, method: 'Node retained-heap estimates after GC, exact UTF8 JSON bytes; synthetic 60Hz object sampling shared across120Hz ticks. Not browser heap/peak allocation certification. Prototype only; rejected ticks never accepted as an exact run.', fixtureTicks: inputs.length, rows }, null, 2)}\n`,
  );
  console.log(`Recorded ${rows.length} curves; fixture ${inputs.length} samples round-trips exactly`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
