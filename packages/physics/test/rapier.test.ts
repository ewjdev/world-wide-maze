/**
 * 05b: `loadRapier({ wasmModule })` — Rapier from a precompiled WebAssembly.Module, for runtimes that forbid
 * compiling WASM from bytes (Cloudflare workerd). Emulated here by making `WebAssembly.instantiate(bytes)` throw
 * like workerd does. (Vitest isolates modules per file, so this file gets a fresh, uninitialised Rapier.)
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { loadRapier } from '../src/rapier.ts';
import { createSimulation } from '../src/simulation.ts';
import { HANDMADE } from './helpers/stages.ts';

const require = createRequire(import.meta.url);
const distDir = dirname(require.resolve('@dimforge/rapier3d-deterministic-compat'));
const wasmBytes = readFileSync(join(distDir, 'rapier_wasm3d_bg.wasm'));

type Instantiate = (src: unknown, imports?: WebAssembly.Imports) => Promise<unknown>;
const wasm = WebAssembly as unknown as { instantiate: Instantiate };
const original = wasm.instantiate;
let byteCalls = 0;

beforeAll(() => {
  wasm.instantiate = (src, imports) => {
    if (src instanceof ArrayBuffer || ArrayBuffer.isView(src)) {
      byteCalls++;
      return Promise.reject(
        new Error('WebAssembly.instantiate(): Wasm code generation disallowed by embedder'),
      );
    }
    return original.call(WebAssembly, src, imports);
  };
});
afterAll(() => {
  wasm.instantiate = original;
});

test('the shipped .wasm is byte-identical to the inlined copy (same binary → same determinism)', () => {
  const mjs = readFileSync(join(distDir, 'rapier.mjs'), 'utf8');
  const b64 = /"([A-Za-z0-9+/]{100000,}={0,2})"/.exec(mjs)?.[1];
  expect(b64, 'inlined base64 WASM not found').toBeTruthy();
  const inlined = Buffer.from(b64 as string, 'base64');
  const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
  expect(sha(inlined)).toBe(sha(wasmBytes));
});

test('without a module, loading fails like workerd (and the failure is not cached)', async () => {
  await expect(loadRapier()).rejects.toThrow(/code generation disallowed/);
  expect(byteCalls).toBe(1);
});

test('with a precompiled module, Rapier initialises and the simulation runs', async () => {
  // Node may compile; workerd gets this module from wrangler's CompiledWasm rule instead.
  const wasmModule = new WebAssembly.Module(wasmBytes);
  const R = await loadRapier({ wasmModule });
  expect(typeof R.World).toBe('function');
  expect(byteCalls).toBe(1); // the bytes path was never taken again
  expect(wasm.instantiate).not.toBe(original); // our workerd emulation is back in place (scope restored)
  // later calls (createSimulation → loadRapier()) reuse the initialised instance
  const sim = await createSimulation();
  await sim.load(HANDMADE);
  const r = sim.step({ tiltX: 0, tiltZ: 0, frameYaw: 0, power: false, jump: false });
  expect(r.ball.pos.every(Number.isFinite)).toBe(true);
  sim.dispose();
});
