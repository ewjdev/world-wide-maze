// Regenerates src/scene.css from SCENE_CSS (scene.ts), the single source: `pnpm --filter @wwm/learning scene-css`.
import { writeFileSync } from 'node:fs';
import { SCENE_CSS } from '../src/scene.ts';

writeFileSync(new URL('../src/scene.css', import.meta.url), `${SCENE_CSS}\n`);
