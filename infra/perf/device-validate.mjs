/** Integrity checks only: exit3 is complete data awaiting physical/manual acceptance, never certification. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateDevice } from './device-data.mjs';
import { runtimeFingerprint } from './p1-fingerprint.mjs';
export function validateFile(path, manifestPath) {
  const report = JSON.parse(readFileSync(path, 'utf8'));
  const collector = Buffer.concat(
    ['device-collector.mjs', 'device-data.mjs', 'device-panel.html'].map((name) =>
      readFileSync(new URL(name, import.meta.url)),
    ),
  );
  const expected = {
    runtimeSHA256: runtimeFingerprint().sha256,
    collectorSHA256: createHash('sha256').update(collector).digest('hex'),
  };
  if (manifestPath) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (
      manifest.schemaVersion !== 1 ||
      !/^[a-f0-9]{64}$/.test(manifest.runtimeFingerprint?.sha256 ?? '') ||
      !Array.isArray(manifest.assets) ||
      !manifest.assets.length
    )
      throw new Error('Invalid expected build manifest');
    expected.runtimeSHA256 = manifest.runtimeFingerprint.sha256;
    expected.assetManifestSHA256 = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  }
  return validateDevice(report, expected);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2])
    throw new Error('Usage: node infra/perf/device-validate.mjs report.json [performance-build.json]');
  const result = validateFile(process.argv[2], process.argv[3]);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.exitCode;
}
