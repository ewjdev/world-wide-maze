import { mkdir, writeFile } from 'node:fs/promises';
import { baselinePath, preschoolActivities } from '@wwm/learning';
import { progressPage } from '../src/progress-render.ts';
import { homePage, lessonPage, portablePage } from '../src/render.ts';

const root = new URL('../', import.meta.url);
await writeFile(new URL('index.html', root), homePage(baselinePath));
await mkdir(new URL('progress/', root), { recursive: true });
await writeFile(new URL('progress/index.html', root), progressPage(baselinePath));
for (const activity of baselinePath.activities) {
  const directory = new URL(`lessons/${activity.id}/`, root);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('index.html', directory), lessonPage(baselinePath, activity));
}

const packs = new URL('public/lesson-packs/', root);
await mkdir(packs, { recursive: true });
for (const activity of preschoolActivities) {
  // One activity per file makes the game's default selection load the lesson on the label.
  await writeFile(
    new URL(`${activity.id}.html`, packs),
    portablePage({
      ...baselinePath,
      title: activity.title,
      activities: [activity],
      voice: undefined,
      description: activity.objective,
    }),
  );
}
