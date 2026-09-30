import { mkdir, writeFile } from 'node:fs/promises';
import { baselinePath } from '@wwm/learning';
import { homePage, lessonPage } from '../src/render.ts';
import { rocketPage } from '../src/rocket-render.ts';

const enabled = process.env.VITE_ROCKET_LAB_ENABLED === 'true';
const base = process.env.WWM_EDUCATION_BASE ?? '/';
const prefix = (html: string) => (base === '/' ? html : html.replace(/href="\/(?!play\/)/g, `href="${base}`));
const root = new URL('../', import.meta.url);
await writeFile(
  new URL('index.html', root),
  prefix(
    homePage(baselinePath).replace(
      '</main>',
      `${enabled ? '<section class="section-intro"><h2>Discover with Pip</h2><p>Try a balloon experiment and discover the rocket’s push.</p><a class="primary" href="/lessons/rocket-lab/">Pip’s Rocket Lab</a></section>' : ''}</main>`,
    ),
  ),
);
for (const activity of baselinePath.activities) {
  const directory = new URL(`lessons/${activity.id}/`, root);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('index.html', directory), prefix(lessonPage(baselinePath, activity)));
}

const rocketDirectory = new URL('lessons/rocket-lab/', root);
await mkdir(rocketDirectory, { recursive: true });
await writeFile(
  new URL('index.html', rocketDirectory),
  prefix(
    enabled
      ? rocketPage()
      : '<!doctype html><html lang="en"><head><title>Rocket Lab unavailable</title></head><body><main><h1>Rocket Lab is not available in this build.</h1><a href="/">All activities</a></main></body></html>',
  ),
);
