import { defineConfig } from 'vitest/config';

// Vitest 4+ replaced `vitest.workspace.ts` with `test.projects`. Every workspace package is a project;
// a package may add its own `vitest.config.ts` (e.g. apps/web uses jsdom) and it is picked up automatically.
export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*', 'tools/*'],
    // Browser, WASM and SSR suites share this pool. Keep simultaneous cold imports
    // bounded so the default five-second assertions remain meaningful on local runs.
    maxWorkers: 4,
    passWithNoTests: true,
  },
});
