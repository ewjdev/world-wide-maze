/** Explicit operator-only recovery; retains damaged bytes and never silently resets spending. */
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  truncateSync,
  unlinkSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const pilot = process.argv[2];
if (!pilot || !/^[-a-zA-Z0-9_]{1,64}$/.test(pilot) || !process.argv.includes('--confirm'))
  throw new Error(
    'Usage: pnpm jev:recover <pilot-id> --confirm. Stop the server first. Damaged tails are retained.',
  );
const dir = resolve(root, 'local/jev', pilot),
  lock = join(dir, 'process.lock');
if (existsSync(lock)) {
  const pid = JSON.parse(readFileSync(lock, 'utf8')).pid;
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
    else throw e;
  }
  if (alive) throw new Error('Archive owner is still alive; stop that process first');
  unlinkSync(lock);
}
const files = [
  join(dir, 'attempts.ndjson'),
  ...readdirSync(join(dir, 'runs')).map((id) => join(dir, 'runs', id, 'journal.ndjson')),
];
for (const path of files) {
  if (!existsSync(path)) continue;
  const bytes = readFileSync(path);
  const end = bytes.lastIndexOf(10) + 1;
  // Refuse interior corruption. Only an incomplete final record can be truncated.
  for (const line of bytes.subarray(0, end).toString('utf8').split('\n').filter(Boolean)) JSON.parse(line);
  if (end < bytes.length) {
    const backup = `${path}.damaged-${Date.now()}`;
    copyFileSync(path, backup);
    truncateSync(path, end);
    appendFileSync(
      join(dir, 'recoveries.ndjson'),
      JSON.stringify({
        at: new Date().toISOString(),
        file: path,
        backup,
        retainedBytes: end,
        removedTailBytes: bytes.length - end,
      }) + '\n',
    );
    console.info(`Retained damaged bytes at ${backup}`);
  }
}
console.info('Recovery complete. Restart the same pilot ID; reservations remain counted.');
