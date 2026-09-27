import type { TilePlan } from '../geom/tiling.ts';

/** Own only the cropped/downscaled bitmaps; the caller retains its original source image. */
export async function makeStageImages(img: TexImageSource, plan: TilePlan) {
  if (plan.tiles.length === 1 && plan.downscale === 1) return { images: [img], dispose() {} };
  const owned: ImageBitmap[] = [];
  const dispose = () => {
    for (const image of owned.splice(0)) image.close();
  };
  try {
    const iw = (img as { width: number }).width;
    for (const tile of plan.tiles) {
      owned.push(
        await createImageBitmap(
          img as ImageBitmapSource,
          0,
          Math.round(tile.row0 / plan.downscale),
          iw,
          Math.round((tile.row1 - tile.row0) / plan.downscale),
          { resizeWidth: plan.width, resizeHeight: tile.row1 - tile.row0 },
        ),
      );
    }
    return { images: [...owned] as TexImageSource[], dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
