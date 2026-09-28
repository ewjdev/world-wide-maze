import { buildRoll, buildSfx } from './synthesis.ts';

// One message, ownership-transferred PCM. The manager terminates this worker on completion/error/dispose.
self.onmessage = () => {
  const sfx = buildSfx();
  const roll = buildRoll();
  self.postMessage(
    { sfx, roll },
    { transfer: [...Object.values(sfx).map((data) => data.buffer), roll.buffer] },
  );
};
