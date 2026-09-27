/** Package the public download on every web build so the page cannot ship without its ZIP. */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExtension } from './build.ts';

const infra = JSON.parse(
  readFileSync(new URL('../../../infra/cloudflare.config.json', import.meta.url), 'utf8'),
) as { domain: string };
if (!infra.domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(infra.domain)) {
  throw new Error('A production domain is required for the downloadable extension');
}
// Deliberately ignore WWM_GAME_ORIGIN: the public ZIP must never point at a dev server.
const release = await buildExtension({ origin: `https://${infra.domain}` });
if (!release.zip) throw new Error('Extension build did not produce a ZIP');
const downloads = fileURLToPath(new URL('../../web/public/downloads/', import.meta.url));
mkdirSync(downloads, { recursive: true });
const name = basename(release.zip);
const sha256 = createHash('sha256').update(readFileSync(release.zip)).digest('hex');
copyFileSync(release.zip, join(downloads, name));
writeFileSync(join(downloads, `${name}.sha256`), `${sha256}  ${name}\n`);
console.log(`Public extension: /downloads/${name} → ${release.origin} (SHA-256 ${sha256})`);
