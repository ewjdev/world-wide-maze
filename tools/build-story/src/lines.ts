/** Lines of code per workspace package, from the files git tracks (`git ls-files`). */
import type { PackageLines } from './types.ts';

const CODE = /\.(ts|tsx|mts|js|mjs|css|html|sql)$/;
const TEST = /(^|\/)(test|tests|e2e)\/|\.test\.[a-z]+$|\.spec\.[a-z]+$/;
/** Generated or vendored files that aren't anyone's writing. */
const SKIP = /(^|\/)(fixtures|node_modules)\/|worker-configuration\.d\.ts$|pnpm-lock\.yaml$/;

export const packageOf = (path: string) => /^((?:apps|packages|tools)\/[^/]+)\//.exec(path)?.[1] ?? null;

export const countLines = (text: string) =>
  text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;

/** `files` are repo-relative paths with their contents (only the code files need contents). */
export function linesByPackage(files: { path: string; text: string }[]): PackageLines[] {
  const by = new Map<string, PackageLines>();
  for (const f of files) {
    const dir = packageOf(f.path);
    if (!dir || !CODE.test(f.path) || SKIP.test(f.path)) continue;
    const row = by.get(dir) ?? { dir, files: 0, sourceLines: 0, testLines: 0 };
    row.files++;
    if (TEST.test(f.path)) row.testLines += countLines(f.text);
    else row.sourceLines += countLines(f.text);
    by.set(dir, row);
  }
  return [...by.values()].sort((a, b) => b.sourceLines + b.testLines - (a.sourceLines + a.testLines));
}

export const isCountable = (path: string) => !!packageOf(path) && CODE.test(path) && !SKIP.test(path);
