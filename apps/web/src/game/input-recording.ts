import type { InputSample, VersionedReplay } from '@wwm/schema';

const CHUNK_RUNS = 1024;
const BYTES_PER_RUN = 3 * Float64Array.BYTES_PER_ELEMENT + Uint32Array.BYTES_PER_ELEMENT + 1;
const MAX_RUN_TICKS = 0xffffffff;
interface Chunk {
  values: Float64Array;
  counts: Uint32Array;
  flags: Uint8Array;
}

/** Lossless consecutive-value runs. No tick limit or change to the public replay format. */
export class InputRecording {
  #chunks: Chunk[] = [];
  #length = 0;
  #runs = 0;
  readonly #maxRunTicks: number;

  /** Smaller storage-run boundaries can exercise overflow splitting without billions of test ticks. */
  constructor(maxRunTicks = MAX_RUN_TICKS) {
    if (!Number.isInteger(maxRunTicks) || maxRunTicks < 1 || maxRunTicks > MAX_RUN_TICKS)
      throw new RangeError('invalid storage run length');
    this.#maxRunTicks = maxRunTicks;
  }

  get length(): number {
    return this.#length;
  }

  /** Backing-store bytes; excludes small chunk/view headers and exported object arrays. */
  get byteLength(): number {
    return this.#chunks.length * CHUNK_RUNS * BYTES_PER_RUN;
  }

  append(input: InputSample): void {
    const flags = (input.power ? 1 : 0) | (input.jump ? 2 : 0);
    let chunk = this.#chunks[this.#chunks.length - 1];
    const previous = (this.#runs - 1) % CHUNK_RUNS;
    if (
      chunk &&
      (chunk.counts[previous] as number) < this.#maxRunTicks &&
      chunk.flags[previous] === flags &&
      Object.is(chunk.values[previous * 3], input.tiltX) &&
      Object.is(chunk.values[previous * 3 + 1], input.tiltZ) &&
      Object.is(chunk.values[previous * 3 + 2], input.frameYaw)
    ) {
      chunk.counts[previous] = (chunk.counts[previous] as number) + 1;
      this.#length++;
      return;
    }
    const offset = this.#runs % CHUNK_RUNS;
    if (offset === 0) {
      const buffer = new ArrayBuffer(CHUNK_RUNS * BYTES_PER_RUN);
      chunk = {
        values: new Float64Array(buffer, 0, CHUNK_RUNS * 3),
        counts: new Uint32Array(buffer, CHUNK_RUNS * 3 * Float64Array.BYTES_PER_ELEMENT, CHUNK_RUNS),
        flags: new Uint8Array(
          buffer,
          CHUNK_RUNS * (3 * Float64Array.BYTES_PER_ELEMENT + Uint32Array.BYTES_PER_ELEMENT),
          CHUNK_RUNS,
        ),
      };
      this.#chunks.push(chunk);
    }
    const target = chunk as Chunk;
    target.values[offset * 3] = input.tiltX;
    target.values[offset * 3 + 1] = input.tiltZ;
    target.values[offset * 3 + 2] = input.frameYaw;
    target.counts[offset] = 1;
    target.flags[offset] = flags;
    this.#runs++;
    this.#length++;
  }

  clear(): void {
    this.#chunks = [];
    this.#length = 0;
    this.#runs = 0;
  }

  /** Export an independent snapshot only at an existing debug/replay/submission boundary. */
  toArray(): InputSample[] {
    const inputs: InputSample[] = new Array(this.#length);
    let tick = 0;
    for (let run = 0; run < this.#runs; run++) {
      const chunk = this.#chunks[Math.floor(run / CHUNK_RUNS)] as Chunk;
      const offset = run % CHUNK_RUNS;
      const flags = chunk.flags[offset] as number;
      const sample = {
        tiltX: chunk.values[offset * 3] as number,
        tiltZ: chunk.values[offset * 3 + 1] as number,
        frameYaw: chunk.values[offset * 3 + 2] as number,
        power: (flags & 1) !== 0,
        jump: (flags & 2) !== 0,
      };
      const end = tick + (chunk.counts[offset] as number);
      while (tick < end) inputs[tick++] = sample;
    }
    return inputs;
  }

  toReplay(physicsVersion: string, timerStartTick?: number): VersionedReplay {
    return {
      physicsVersion,
      inputs: this.toArray(),
      ...(timerStartTick !== undefined ? { timerStartTick } : {}),
    };
  }
}

/** Owns a completed attempt. Materialize once for actual submission, then release compact storage. */
export class SavedRecording {
  #compact: InputRecording | null;
  #materialized: VersionedReplay | null = null;
  readonly #physicsVersion: string;
  readonly #timerStartTick: number | undefined;

  constructor(recording: InputRecording, physicsVersion: string, timerStartTick?: number) {
    this.#compact = recording;
    this.#physicsVersion = physicsVersion;
    this.#timerStartTick = timerStartTick;
  }

  get byteLength(): number {
    return this.#compact?.byteLength ?? 0;
  }

  /** Debug snapshots never expose the stored replay's mutable objects. */
  snapshot(): VersionedReplay {
    if (this.#compact) return this.#compact.toReplay(this.#physicsVersion, this.#timerStartTick);
    const replay = this.#materialized as VersionedReplay;
    const inputs: InputSample[] = new Array(replay.inputs.length);
    for (let i = 0; i < inputs.length; i++) {
      const input = replay.inputs[i] as InputSample;
      inputs[i] = i > 0 && input === replay.inputs[i - 1] ? (inputs[i - 1] as InputSample) : { ...input };
    }
    return { ...replay, inputs };
  }

  forSubmission(): VersionedReplay {
    if (!this.#materialized) {
      const compact = this.#compact as InputRecording;
      this.#materialized = compact.toReplay(this.#physicsVersion, this.#timerStartTick);
      compact.clear();
      this.#compact = null;
    }
    return this.#materialized;
  }
}
