import type { InputSample, StageData } from '@wwm/schema';
import { recordGhostTrack } from './ghost-track.ts';

// Same one-job/transfer/terminate pattern as Race PR #17. Keep this classic replay's
// deterministic physics path independent of the Race course/attempt contract.
self.onmessage = async (event: MessageEvent<{ stage: StageData; inputs: InputSample[] }>) => {
  try {
    const track = await recordGhostTrack(event.data.stage, event.data.inputs);
    self.postMessage({ track }, { transfer: [track.pos.buffer, track.quat.buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Ghost preparation failed' });
  }
};
