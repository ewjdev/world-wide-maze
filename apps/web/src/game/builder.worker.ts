/** Offline stage construction. Cache decoded screenshots within a fixed byte budget. */
import type { RGBAImage } from '@wwm/schema';
import { type BuilderMessage, type BuildReply, createBuilderService } from './builder-service.ts';

interface WorkerScope {
  onmessage: ((e: MessageEvent<BuilderMessage>) => void) | null;
  postMessage(m: BuildReply): void;
}
const scope = self as unknown as WorkerScope;

async function decode(url: string, signal: AbortSignal): Promise<RGBAImage> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`screenshot ${response.status}`);
  const blob = await response.blob();
  signal.throwIfAborted();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  let canvas: OffscreenCanvas | undefined;
  try {
    signal.throwIfAborted();
    canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2d context unavailable');
    context.drawImage(bmp, 0, 0);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return { width: image.width, height: image.height, data: image.data };
  } finally {
    bmp.close();
    // Release canvas backing storage promptly; the returned RGBA owns its own bytes.
    if (canvas) canvas.width = canvas.height = 0;
  }
}

const receive = createBuilderService(decode, (reply) => scope.postMessage(reply));
scope.onmessage = (event) => receive(event.data);
