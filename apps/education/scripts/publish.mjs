import { execFileSync } from 'node:child_process';
import { cp, readdir, readFile, rm, writeFile } from 'node:fs/promises';

// The game and teaching pages share one release and origin. Their asset directories stay separate.
const repo = new URL('../../../', import.meta.url);
execFileSync('pnpm', ['--filter', '@wwm/education', 'generate'], { cwd: repo, stdio: 'inherit' });
execFileSync('pnpm', ['--filter', '@wwm/education', 'exec', 'vite', 'build', '--base', '/learn/'], {
  cwd: repo,
  stdio: 'inherit',
});
const target = new URL('../../web/dist/learn/', import.meta.url);
await rm(target, { recursive: true, force: true });
await cp(new URL('../dist/', import.meta.url), target, { recursive: true });
for (const file of await readdir(target, { recursive: true })) {
  if (!file.endsWith('.html')) continue;
  const url = new URL(file, target);
  const html = await readFile(url, 'utf8');
  // Vite rebases scripts/styles; authored navigation and download links also need the mounted prefix.
  await writeFile(url, html.replace(/href="\/(?!\/|learn\/)([^"]*)"/g, 'href="/learn/$1"'));
}
console.log('Published learning pages and five lesson packs into apps/web/dist/learn/');
