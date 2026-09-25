/// <reference path="./modules.d.ts" />
/**
 * The practice stage (our own handmade fixture, `fixtures/stages/handmade-simple.*`), drawn on the default site
 * card. Loaded with a dynamic import so only site-card renders pay for it (≈ 60 KB).
 */
import { parseStage } from '@wwm/schema';
import stageJson from '../../../../fixtures/stages/handmade-simple.json';
import texture from '../../../../fixtures/stages/handmade-simple.png';

export const PRACTICE_STAGE = parseStage(stageJson);
export const PRACTICE_TEXTURE = new Uint8Array(texture);
