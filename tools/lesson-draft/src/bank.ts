/**
 * `pnpm learning:bank import <file.json>`: bring a bank approved in the lesson-draft workbench into
 * `@wwm/learning` (see bank-import.ts and docs/education/lesson-drafts.md). `check` validates without writing.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baselinePath } from '@wwm/learning';
import { BankImportError, checkBank, type Formatter, importBank } from './bank-import.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const learningSrc = join(root, 'packages/learning/src');
const [command, input] = process.argv.slice(2);

/** Biome with the repo's settings, reading the source from stdin. */
const biome: Formatter = (source, file) =>
  execFileSync(join(root, 'node_modules/.bin/biome'), ['format', `--stdin-file-path=${file}`], {
    cwd: root,
    input: source,
    encoding: 'utf8',
  });

if ((command !== 'import' && command !== 'check') || !input) {
  console.error('usage: pnpm learning:bank import|check <file.json>');
  process.exit(2);
}
try {
  // pnpm runs root scripts from the repo root; INIT_CWD is where the operator typed the command.
  const file = resolve(process.env.INIT_CWD ?? process.cwd(), input);
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (command === 'check') {
    const { file: bank, flags } = checkBank(value, baselinePath);
    console.log(`ok: ${bank.items.length} items for "${bank.objective}"`);
    for (const flag of flags) console.log(`review: ${flag}`);
  } else {
    const result = importBank(value, { learningSrc, path: baselinePath, format: biome });
    console.log(
      `${result.status}: ${result.items} items for "${result.objective}" → ${result.file.slice(root.length + 1)}`,
    );
    for (const flag of result.flags) console.log(`review: ${flag}`);
    if (result.status === 'written')
      console.log('Next: run `pnpm check`, review the diff, commit and open a pull request.');
  }
} catch (error) {
  console.error(error instanceof BankImportError ? error.message : `error: ${(error as Error).message}`);
  process.exit(1);
}
