import { spawnSync } from 'node:child_process';
import { cp, readFile } from 'node:fs/promises';

const result = spawnSync('pnpm', ['--filter', '@wwm/education', 'build'], {
  cwd: new URL('../../../', import.meta.url),
  stdio: 'inherit',
  env: { ...process.env, WWM_EDUCATION_BASE: '/education/' },
});
if (result.status !== 0) process.exit(result.status ?? 1);
const output = new URL('../dist/education/', import.meta.url);
await cp(new URL('../../education/dist/', import.meta.url), output, { recursive: true });
const lesson = await readFile(new URL('lessons/rocket-lab/index.html', output), 'utf8');
if (process.env.VITE_ROCKET_LAB_ENABLED === 'true' && !lesson.includes('data-learning-activity="rocket-lab"'))
  throw new Error('The deployed education artifact is missing Rocket Lab.');
for (const match of lesson.matchAll(/(?:src|href)="(\/education\/assets\/[^"#]+)"/g))
  await readFile(new URL(match[1].slice(1), new URL('../dist/', import.meta.url)));
console.log('Education artifact bundled under /education/.');
