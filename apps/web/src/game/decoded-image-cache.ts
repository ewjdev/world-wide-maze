import type { RGBAImage } from '@wwm/schema';

/** Retained decoded RGBA only; a single in-flight decode/build is accounted separately. */
export const DECODED_IMAGE_BUDGET = 32 * 1024 * 1024;

export class DecodedImageCache {
  readonly #entries = new Map<string, RGBAImage>();
  #bytes = 0;
  #hits = 0;
  #misses = 0;
  #evictions = 0;
  #oversized = 0;

  constructor(readonly budgetBytes = DECODED_IMAGE_BUDGET) {
    if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 0) throw new Error('invalid image cache budget');
  }

  get(key: string): RGBAImage | undefined {
    const image = this.#entries.get(key);
    if (!image) {
      this.#misses++;
      return undefined;
    }
    this.#hits++;
    this.#entries.delete(key);
    this.#entries.set(key, image);
    return image;
  }

  set(key: string, image: RGBAImage): void {
    const previous = this.#entries.get(key);
    if (previous) {
      this.#bytes -= previous.data.buffer.byteLength;
      this.#entries.delete(key);
    }
    const bytes = image.data.buffer.byteLength;
    // An oversized image is usable for this build, but never retained after it.
    if (bytes > this.budgetBytes) {
      this.#oversized++;
      return;
    }
    while (this.#bytes + bytes > this.budgetBytes) {
      const oldest = this.#entries.entries().next().value;
      if (!oldest) break;
      this.#entries.delete(oldest[0]);
      this.#bytes -= oldest[1].data.buffer.byteLength;
      this.#evictions++;
    }
    this.#entries.set(key, image);
    this.#bytes += bytes;
  }

  get stats() {
    return {
      budgetBytes: this.budgetBytes,
      retainedBytes: this.#bytes,
      entries: this.#entries.size,
      hits: this.#hits,
      misses: this.#misses,
      evictions: this.#evictions,
      oversized: this.#oversized,
    };
  }
}
