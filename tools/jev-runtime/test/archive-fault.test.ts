import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, writeSync: vi.fn(actual.writeSync), fsyncSync: vi.fn(actual.fsyncSync) };
});

import { Archive } from '../src/archive.ts';

it('writes complete records across short writes and latches uncertainty after a failed fsync', async () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'jev-fault-'));
  const a = new Archive(dir);
  try {
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    vi.mocked(fs.writeSync).mockImplementationOnce(((
      fd: number,
      bytes: Buffer,
      offset: number,
      length: number,
    ) => actual.writeSync(fd, bytes, offset, Math.min(7, length))) as typeof fs.writeSync);
    const id = a.create('first-fork', 'jev', 0, null, 'jev-1.13.0');
    expect(a.events(id)).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(join(dir, 'runs', id, 'journal.ndjson'), 'utf8')).seq).toBe(1);
    vi.mocked(fs.fsyncSync).mockImplementationOnce(() => {
      throw new Error('Injected fsync failure');
    });
    expect(() => a.reserve(id, 'uncertain', 'decision-1', 'hash')).toThrow('Archive write failed');
    expect(() => a.append(id, 'status', { status: 'paused' })).toThrow('Archive write failed');
    a.close();
    const recovered = new Archive(dir);
    try {
      expect(recovered.reservations).toHaveLength(1);
      expect(recovered.events(id).find((e) => e.type === 'reservation')?.data.outcome).toBe('unknown');
    } finally {
      recovered.close();
    }
  } finally {
    a.close();
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  }
});
