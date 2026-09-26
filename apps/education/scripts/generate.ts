import { mkdir, writeFile } from 'node:fs/promises';
import { baselinePath } from '@wwm/learning';
import { homePage, lessonPage } from '../src/render.ts';

const root = new URL('../', import.meta.url);
await writeFile(new URL('index.html', root), homePage(baselinePath));
for (const activity of baselinePath.activities) {
  const directory = new URL(`lessons/${activity.id}/`, root);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('index.html', directory), lessonPage(baselinePath, activity));
}
