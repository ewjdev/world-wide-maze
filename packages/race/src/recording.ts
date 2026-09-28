import type { RaceInputSample, RaceRecording, RaceRecovery } from './types.ts';

export const RACE_INPUT_BYTES = 25;
export const MAX_RECORDING_TICKS = 72_000;
export const MAX_RECORDING_BYTES = 8 * 1024 * 1024;
export const MAX_RECOVERIES = 4096;
const RECOVERY_BYTES = 32;
const CHUNK_SAMPLES = 1024;

/** Binary chunks bound resident input memory; no unbounded object-per-tick history. */
export class RaceRecorder {
  private chunks: Uint8Array[] = [];
  private count = 0;
  private capped = false;
  private recoveryEvents: RaceRecovery[] = [];
  private limits: { ticks: number; bytes: number };
  private stunts: boolean;
  constructor(limits = { ticks: MAX_RECORDING_TICKS, bytes: MAX_RECORDING_BYTES }, stunts = false) {
    this.limits = limits;
    this.stunts = stunts;
    if (
      !Number.isInteger(limits.ticks) ||
      limits.ticks < 0 ||
      limits.ticks > MAX_RECORDING_TICKS ||
      !Number.isInteger(limits.bytes) ||
      limits.bytes < 0 ||
      limits.bytes > MAX_RECORDING_BYTES
    )
      throw new Error('Invalid recording limits');
  }
  get ticks(): number {
    return this.count;
  }
  get truncated(): boolean {
    return this.capped;
  }
  private fits(samples: number, events: number): boolean {
    return (
      samples <= this.limits.ticks &&
      samples * RACE_INPUT_BYTES + events * RECOVERY_BYTES <= this.limits.bytes &&
      events <= MAX_RECOVERIES
    );
  }
  record(input: RaceInputSample): boolean {
    if (this.capped) return false;
    if (!this.fits(this.count + 1, this.recoveryEvents.length)) {
      this.capped = true;
      return false;
    }
    if (![input.tiltX, input.tiltZ, input.frameYaw].every(Number.isFinite))
      throw new Error('Nonfinite Race input');
    const index = this.count % CHUNK_SAMPLES;
    if (index === 0)
      this.chunks.push(
        new Uint8Array(Math.min(CHUNK_SAMPLES, this.limits.ticks - this.count) * RACE_INPUT_BYTES),
      );
    const chunk = this.chunks[this.chunks.length - 1];
    const view = new DataView(chunk.buffer, index * RACE_INPUT_BYTES, RACE_INPUT_BYTES);
    view.setFloat64(0, input.tiltX, true);
    view.setFloat64(8, input.tiltZ, true);
    view.setFloat64(16, input.frameYaw, true);
    view.setUint8(24, Number(input.power) | (Number(input.jump) << 1) | (this.stunts && input.turbo ? 4 : 0));
    this.count++;
    return true;
  }
  recover(event: RaceRecovery): boolean {
    if (this.capped) return false;
    if (event.beforeTick !== this.count + 1 || !event.destination.every(Number.isFinite))
      throw new Error('Recovery must precede next recorded step');
    const replacesPending = this.recoveryEvents.at(-1)?.beforeTick === event.beforeTick;
    if (!this.fits(this.count + 1, this.recoveryEvents.length + Number(!replacesPending))) {
      this.capped = true;
      return false;
    }
    // Multiple resets before a step have no intermediate physical travel; retain only the final one.
    if (replacesPending) this.recoveryEvents.pop();
    this.recoveryEvents.push({ ...event, destination: [...event.destination] });
    return true;
  }
  finish(): RaceRecording {
    const bytes = new Uint8Array(this.count * RACE_INPUT_BYTES);
    let offset = 0;
    for (const chunk of this.chunks) {
      const length = Math.min(chunk.length, bytes.length - offset);
      bytes.set(chunk.subarray(0, length), offset);
      offset += length;
    }
    return {
      format: this.stunts ? 'wwm.race-input/2' : 'wwm.race-input/1',
      data: bytes.buffer,
      ticks: this.count,
      truncated: this.capped,
      recoveries: this.recoveryEvents
        .filter((e) => e.beforeTick <= this.count)
        .map((e) => ({ ...e, destination: [...e.destination] })),
    };
  }
}
export function inputAt(recording: RaceRecording, index: number): RaceInputSample {
  if (!Number.isInteger(index) || index < 0 || index >= recording.ticks)
    throw new Error('Input index out of bounds');
  const v = new DataView(recording.data, index * RACE_INPUT_BYTES, RACE_INPUT_BYTES);
  const flags = v.getUint8(24);
  return {
    tiltX: v.getFloat64(0, true),
    tiltZ: v.getFloat64(8, true),
    frameYaw: v.getFloat64(16, true),
    power: !!(flags & 1),
    jump: !!(flags & 2),
    ...(recording.format === 'wwm.race-input/2' ? { turbo: !!(flags & 4) } : {}),
  };
}
export function validateRecording(value: unknown): value is RaceRecording {
  if (!value || typeof value !== 'object') return false;
  const r = value as RaceRecording;
  if (
    !['wwm.race-input/1', 'wwm.race-input/2'].includes(r.format) ||
    !(r.data instanceof ArrayBuffer) ||
    !Number.isInteger(r.ticks) ||
    r.ticks < 0 ||
    r.ticks > MAX_RECORDING_TICKS ||
    r.data.byteLength !== r.ticks * RACE_INPUT_BYTES ||
    typeof r.truncated !== 'boolean' ||
    !Array.isArray(r.recoveries) ||
    r.recoveries.length > MAX_RECOVERIES ||
    r.data.byteLength + r.recoveries.length * RECOVERY_BYTES > MAX_RECORDING_BYTES
  )
    return false;
  let last = 0;
  for (const event of r.recoveries) {
    if (
      !event ||
      !Number.isInteger(event.beforeTick) ||
      event.beforeTick <= last ||
      event.beforeTick > r.ticks ||
      !Array.isArray(event.destination) ||
      event.destination.length !== 2 ||
      !event.destination.every(Number.isFinite) ||
      !['fall', 'recovery'].includes(event.reason)
    )
      return false;
    last = event.beforeTick;
  }
  for (let i = 0; i < r.ticks; i++) {
    const input = inputAt(r, i);
    if (
      ![input.tiltX, input.tiltZ, input.frameYaw].every(Number.isFinite) ||
      new DataView(r.data).getUint8(i * RACE_INPUT_BYTES + 24) > (r.format === 'wwm.race-input/2' ? 7 : 3)
    )
      return false;
  }
  return true;
}
