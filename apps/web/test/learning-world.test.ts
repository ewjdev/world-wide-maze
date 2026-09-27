import { bridgeBuilders, parseLessonWorldManifest } from '@wwm/learning';
import { parseStage } from '@wwm/schema';
import { describe, expect, it } from 'vitest';
import manifestJson from '../../../fixtures/learning/bridge-builders/binding.json' with { type: 'json' };
import stageJson from '../../../fixtures/learning/bridge-builders/stage.json' with { type: 'json' };
import { bindLesson } from '../src/learning/world.ts';

const stage = parseStage(stageJson);
const manifest = parseLessonWorldManifest(manifestJson);

describe('lesson world binding', () => {
  it('binds every authored bridge target and connector to the frozen stage', async () => {
    expect(await bindLesson(bridgeBuilders, stage, manifest)).toEqual({ ok: true, manifest });
  });

  it('rejects a changed stage and an incomplete binding', async () => {
    const changed = structuredClone(stage);
    changed.start.pos = [110, 170];
    const mismatch = await bindLesson(bridgeBuilders, changed, manifest);
    expect(mismatch.ok).toBe(false);
    const incomplete = structuredClone(manifest);
    delete incomplete.targets['repair-1'];
    const result = await bindLesson(bridgeBuilders, stage, incomplete);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons).toContain('Missing target repair-1.');
  });
});
