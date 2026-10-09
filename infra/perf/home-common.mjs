import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyServedBuild } from './p1-build.mjs';
import { runtimeFingerprint } from './p1-fingerprint.mjs';

export function prepareOutput() {
  if (!process.env.AUDIT_OUT) throw new Error('Set AUDIT_OUT to a fresh evidence directory.');
  const out = resolve(process.env.AUDIT_OUT);
  mkdirSync(out, { recursive: true });
  return out;
}

export async function verifyHomeBuild(base) {
  const expected = process.env.AUDIT_BASELINE_RECORD
    ? JSON.parse(readFileSync(process.env.AUDIT_BASELINE_RECORD, 'utf8')).runtimeFingerprint
    : runtimeFingerprint();
  return verifyServedBuild(base, expected);
}

export function stats(values) {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return { n: 0, mean: null, p50: null, p95: null, p99: null, max: null };
  return {
    n: s.length,
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    p50: s[Math.floor(s.length * 0.5)],
    p95: s[Math.floor(s.length * 0.95)],
    p99: s[Math.floor(s.length * 0.99)],
    max: s.at(-1),
  };
}
