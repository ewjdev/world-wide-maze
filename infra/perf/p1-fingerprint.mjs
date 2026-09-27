/** Stable runtime content fingerprint; docs/evidence-only commits do not invalidate native measurements. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function runtimeFingerprint(root = fileURLToPath(new URL('../../', import.meta.url))) {
  const paths = execFileSync(
    'git',
    [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      'apps/web/src',
      'packages',
      'fixtures',
      'pnpm-lock.yaml',
      'apps/web/vite.config.ts',
      'apps/web/package.json',
      'package.json',
      'tsconfig.base.json',
    ],
    { cwd: root, encoding: 'utf8' },
  )
    .split('\0')
    .filter(
      (path) =>
        path &&
        existsSync(resolve(root, path)) &&
        (!path.startsWith('packages/') || /^packages\/[^/]+\/(src\/|package\.json$)/.test(path)) &&
        !/\.(test|spec)\.[cm]?[jt]sx?$/.test(path),
    );
  const hash = createHash('sha256');
  for (const path of [...new Set(paths)].sort()) {
    hash.update(path);
    hash.update('\0');
    hash.update(readFileSync(resolve(root, path)));
    hash.update('\0');
  }
  return { version: 1, algorithm: 'sha256', sha256: hash.digest('hex'), files: new Set(paths).size };
}
