import { randomBytes } from 'node:crypto';
import {
  canonical,
  type Frame,
  LIMITS,
  MODEL,
  modelPayload,
  parseAnswer,
  type Receipt,
} from '../../../packages/maze-agent/src/contracts.ts';
import { baseline } from '../../../packages/maze-agent/src/exploration.ts';
import { type Archive, hash } from './archive.ts';
import { ChunkSchema, Command, CreateSchema, DecideSchema, FrameSchema } from './validation.ts';

interface Owner {
  token: string;
  documentId: string;
  epoch: number;
  heartbeat: number;
}
export class JevService {
  owners = new Map<string, Owner>();
  busy = false;
  constructor(
    readonly archive: Archive,
    readonly key: string | undefined,
    readonly fetcher: typeof fetch = fetch,
  ) {}
  availability() {
    return {
      available: !!this.key,
      model: MODEL,
      attempts: this.archive.reservations.length,
      limit: LIMITS.pilotAttempts,
      archiveBytes: this.archive.bytes(),
      archiveLimit: LIMITS.pilotBytes,
    };
  }
  create(value: unknown) {
    const v = CreateSchema.parse(value);
    if (v.parentRunId) this.archive.events(v.parentRunId);
    const id = this.archive.create(
      v.fixture,
      v.policy,
      v.orderSeed,
      v.parentRunId ?? null,
      v.policy === 'jev' ? MODEL : null,
    );
    const owner = randomBytes(24).toString('hex');
    this.owners.set(id, { token: hash(owner), documentId: v.documentId, epoch: 0, heartbeat: Date.now() });
    return { id, owner, summary: this.archive.summary(id) };
  }
  private authorize(id: string, v: { owner: string; documentId: string; epoch: number }, allowEnd = false) {
    const o = this.owners.get(id);
    if (!o || o.token !== hash(v.owner)) throw new Error('Run ownership unavailable');
    if (
      ['finished', 'failed', 'stopped', 'interrupted'].includes(this.archive.summary(id).status) &&
      !allowEnd
    )
      throw new Error('Run is terminal');
    if (o.documentId !== v.documentId) {
      if (['finished', 'failed', 'stopped', 'interrupted'].includes(this.archive.summary(id).status))
        throw new Error('Run is terminal');
      this.archive.append(id, 'status', {
        status: 'interrupted',
        reason: 'Page refreshed; start a linked run',
      });
      this.owners.delete(id);
      throw new Error('Previous document interrupted');
    }
    if (v.epoch < o.epoch) throw new Error('Stale run epoch');
    o.epoch = v.epoch;
    o.heartbeat = Date.now();
    if (
      !allowEnd &&
      ['finished', 'failed', 'stopped', 'interrupted'].includes(this.archive.summary(id).status)
    )
      throw new Error('Run is terminal');
    return o;
  }
  sweep() {
    for (const [id, o] of this.owners) {
      if (this.archive.summary(id).status === 'running' && Date.now() - o.heartbeat > 30000) {
        this.archive.append(id, 'status', { status: 'interrupted', reason: 'Owner disconnected' });
        this.owners.delete(id);
      }
    }
  }
  command(id: string, value: unknown) {
    const v = Command.parse(value);
    this.authorize(id, v, v.type === 'discard' || v.type === 'heartbeat');
    if (!['status', 'discard', 'heartbeat', 'outcome', 'chunk'].includes(v.type))
      this.archive.capacity(id, 1024 * 1024);
    const events = this.archive.events(id);
    if (v.type === 'heartbeat') return { ok: true };
    if (v.type === 'frame') {
      const frame = FrameSchema.parse(v.data);
      const old = events.find((e) => e.type === 'frame' && (e.data.frame as Frame).id === frame.id);
      if (old) {
        if (hash(old.data.frame) !== hash(frame)) throw new Error('Frame identity conflict');
        return { ok: true };
      }
      if (
        frame.tick !== this.archive.summary(id).tick ||
        events.filter((e) => e.type === 'frame').length >= LIMITS.actions
      )
        throw new Error('Frame tick/action limit mismatch');
      if (new Set(frame.candidates.map((c) => c.id)).size !== frame.candidates.length)
        throw new Error('Duplicate options');
      this.archive.append(id, 'frame', { frame });
    } else if (v.type === 'chunk') {
      const chunk = ChunkSchema.parse(v.data);
      const chunks = events.filter((e) => e.type === 'chunk');
      const old = chunks.find((e) => (e.data.chunk as { sequence: number }).sequence === chunk.sequence);
      if (old) {
        if (hash(old.data.chunk) !== hash(chunk)) throw new Error('Chunk identity conflict');
        return { ok: true };
      }
      if (
        chunk.sequence !== chunks.length ||
        chunk.from !== this.archive.summary(id).tick ||
        chunk.to !== chunk.from + chunk.inputs.length ||
        chunk.digest !== hash(chunk.ball) ||
        chunk.events.some((e) => e.tick <= chunk.from || e.tick > chunk.to)
      )
        throw new Error('Invalid recording prefix');
      const active = events.findLast((e) => e.type === 'action');
      if (!active || events.some((e) => e.type === 'outcome' && e.data.attemptId === active.data.attemptId))
        throw new Error('No authorized active action');
      const recordingBytes = chunks.reduce((n, e) => n + Buffer.byteLength(JSON.stringify(e.data.chunk)), 0);
      if (recordingBytes + Buffer.byteLength(JSON.stringify(chunk)) > LIMITS.recording)
        throw new Error('Recording limit reached');
      this.archive.capacity(id, 65536 + Buffer.byteLength(JSON.stringify(chunk)));
      this.archive.append(id, 'chunk', { chunk });
    } else if (v.type === 'status') {
      const data = v.data as { status: string; reason?: string };
      if (
        !['running', 'paused', 'finished', 'failed', 'stopped'].includes(data?.status) ||
        typeof (data.reason ?? '') !== 'string' ||
        (data.reason ?? '').length > 300
      )
        throw new Error('Invalid status');
      if (
        data.status === 'finished' &&
        !events.some(
          (e) =>
            e.type === 'chunk' &&
            (e.data.chunk as { events: { event: { type: string } }[] }).events.some(
              (x) => x.event.type === 'goal',
            ),
        )
      )
        throw new Error('Completion requires recorded goal sensor evidence');
      this.archive.append(id, 'status', { status: data.status, reason: data.reason ?? null });
    } else if (v.type === 'action') {
      const data = v.data as { attemptId: string };
      const receipt = events.find(
        (e) => e.type === 'receipt' && (e.data.receipt as Receipt).attemptId === data?.attemptId,
      );
      if (
        !receipt ||
        (receipt.data.receipt as Receipt).status !== 'accepted' ||
        receipt.data.epoch !== v.epoch
      )
        throw new Error('No current accepted decision');
      if (events.some((e) => e.type === 'action' && e.data.attemptId === data.attemptId))
        throw new Error('Action already authorized');
      const previous = events.findLast((e) => e.type === 'action');
      if (
        this.archive.summary(id).status !== 'running' ||
        (previous &&
          !events.some((e) => e.type === 'outcome' && e.data.attemptId === previous.data.attemptId))
      )
        throw new Error('Action still active or run paused');
      const f = events.find(
        (e) =>
          e.type === 'frame' && (e.data.frame as Frame).id === (receipt.data.receipt as Receipt).decisionId,
      )?.data.frame as Frame;
      if (f.tick !== this.archive.summary(id).tick) throw new Error('Decision no longer at current position');
      if (events.some((e) => e.type === 'discard' && e.data.attemptId === data.attemptId))
        throw new Error('Decision was discarded');
      this.archive.append(id, 'action', {
        attemptId: data.attemptId,
        tick: this.archive.summary(id).tick,
        epoch: v.epoch,
      });
    } else if (v.type === 'outcome') {
      const data = v.data as { attemptId: string; outcome: string; tick: number };
      if (
        !events.some((e) => e.type === 'action' && e.data.attemptId === data?.attemptId) ||
        !['arrived', 'goal', 'fell', 'stuck', 'timeout'].includes(data.outcome) ||
        data.tick !== this.archive.summary(id).tick
      )
        throw new Error('Invalid action outcome');
      const old = events.find((e) => e.type === 'outcome' && e.data.attemptId === data.attemptId);
      if (old) {
        if (hash(old.data) !== hash(data)) throw new Error('Outcome identity conflict');
        return { ok: true };
      }
      this.archive.append(id, 'outcome', {
        attemptId: data.attemptId,
        outcome: data.outcome,
        tick: data.tick,
      });
    } else if (v.type === 'discard') {
      const data = v.data as { attemptId: string; reason: string };
      if (typeof data?.attemptId !== 'string' || typeof data.reason !== 'string' || data.reason.length > 200)
        throw new Error('Invalid discard');
      this.archive.append(id, 'discard', { attemptId: data.attemptId, reason: data.reason });
    }
    return { ok: true, summary: this.archive.summary(id) };
  }
  async decide(id: string, value: unknown) {
    const v = DecideSchema.parse(value);
    const owner = this.authorize(id, v);
    if (this.archive.summary(id).status !== 'running') throw new Error('Run is not running');
    const events = this.archive.events(id);
    const f = events.find((e) => e.type === 'frame' && (e.data.frame as Frame).id === v.decisionId)?.data
      .frame as Frame | undefined;
    if (!f) throw new Error('Unknown decision');
    if (f.tick !== this.archive.summary(id).tick) throw new Error('Decision no longer at current position');
    const old = events.find(
      (e) => e.type === 'receipt' && (e.data.receipt as Receipt).attemptId === v.attemptId,
    );
    if (old) {
      if ((old.data.receipt as Receipt).decisionId !== v.decisionId || old.data.epoch !== v.epoch)
        throw new Error('Attempt identity conflict');
      return old.data.receipt as Receipt;
    }
    if (events.some((e) => e.type === 'attempt-error' && e.data.attemptId === v.attemptId))
      throw new Error('Attempt failed; use a new attempt ID');
    if (this.busy) throw new Error('Provider busy; retry when the previous request ends');
    this.archive.capacity(id);
    const s = this.archive.summary(id);
    const source =
      f.candidates.length === 1 ? (f.candidates[0].id === 'finish' ? 'forced-goal' : 'forced') : s.policy;
    const started = performance.now();
    let receipt: Receipt = {
      attemptId: v.attemptId,
      decisionId: v.decisionId,
      source,
      choice: '',
      probabilities: null,
      confidence: null,
      model: null,
      usage: null,
      latencyMs: 0,
      status: 'accepted',
    };
    const payload = { ...modelPayload(f), model: MODEL };
    if (Buffer.byteLength(canonical(payload)) > LIMITS.payload)
      throw new Error('Decision payload exceeds limit');
    this.archive.append(id, 'request', {
      attemptId: v.attemptId,
      decisionId: v.decisionId,
      epoch: v.epoch,
      source,
      payload: source === 'jev' ? payload : null,
      payloadHash: hash(payload),
    });
    try {
      if (source === 'jev') {
        if (!this.key) throw new Error('TypeSafe key is not configured. Baseline exploration is available.');
        this.archive.reserve(id, v.attemptId, v.decisionId, hash(payload));
        this.busy = true;
        const response = await this.fetcher('https://api.typesafe.ai/v1/systemone', {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5000),
        });
        const reader = response.body?.getReader();
        let raw = '';
        let count = 0;
        if (reader) {
          const decoder = new TextDecoder();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            count += value.length;
            if (count > LIMITS.response) {
              await reader.cancel();
              this.archive.append(id, 'provider-response', {
                attemptId: v.attemptId,
                status: response.status,
                body: raw.replaceAll(this.key, '[redacted]').slice(0, 2048),
                truncated: true,
              });
              throw new Error('Provider response too large');
            }
            raw += decoder.decode(value, { stream: true });
          }
        }
        const safe = raw.replaceAll(this.key, '[redacted]');
        this.archive.append(id, 'provider-response', {
          attemptId: v.attemptId,
          status: response.status,
          body: safe,
          requestId: response.headers.get('x-request-id'),
        });
        if (!response.ok) throw new Error(`TypeSafe returned HTTP ${response.status}`);
        receipt = { ...receipt, ...parseAnswer(JSON.parse(safe), f) };
      } else
        receipt.choice =
          source === 'scripted'
            ? (f.candidates.find((c) => c.traversals === 0)?.id ?? baseline(f))
            : baseline(f);
      receipt.latencyMs = performance.now() - started;
      if (
        owner.epoch !== v.epoch ||
        this.owners.get(id) !== owner ||
        this.archive.summary(id).status !== 'running'
      )
        receipt.status = 'discarded';
      this.archive.append(id, 'receipt', { receipt, epoch: v.epoch });
      return receipt;
    } catch (e) {
      const message = (e instanceof Error ? e.message : 'Decision failed').replaceAll(
        this.key || '__no_key__',
        '[redacted]',
      );
      this.archive.append(id, 'attempt-error', {
        attemptId: v.attemptId,
        decisionId: v.decisionId,
        epoch: v.epoch,
        message: message.slice(0, 250),
        outcome: this.archive.reservations.some((r) => r.runId === id && r.attemptId === v.attemptId)
          ? 'unknown-or-error'
          : 'not-dispatched',
      });
      throw new Error(message);
    } finally {
      if (source === 'jev') this.busy = false;
    }
  }
}
