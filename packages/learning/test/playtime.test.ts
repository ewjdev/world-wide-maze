import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authorizePlaytime,
  checkpointPlaytime,
  decodePlaytime,
  notePlaytime,
  PLAYTIME_KEY,
  playtimeBlocked,
  playtimeView,
  stopPlaytime,
} from '../src/playtime.ts';

describe('caregiver playtime', () => {
  let data: Map<string, string>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T12:00:00Z'));
    data = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
    });
    vi.stubGlobal('window', { dispatchEvent: () => true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('shares one absolute deadline across reads, pauses, refresh and both consumers', async () => {
    await authorizePlaytime('4286', 5);
    const deadline = playtimeView().record?.endsAt;
    vi.advanceTimersByTime(240000);
    expect(playtimeView().phase).toBe('closing');
    checkpointPlaytime();
    expect(decodePlaytime(data.get(PLAYTIME_KEY) ?? null, Date.now()).record?.endsAt).toBe(deadline);
    vi.advanceTimersByTime(60000);
    expect(playtimeBlocked()).toBe(true);
    checkpointPlaytime();
    vi.setSystemTime(new Date('2026-10-30T12:00:00Z'));
    expect(playtimeBlocked()).toBe(true);
  });
  it('requires the original PIN to restart and starts a clean recap', async () => {
    await authorizePlaytime('4286', 5);
    notePlaytime('Counted together');
    stopPlaytime();
    await expect(authorizePlaytime('0000', 15)).rejects.toThrow('PIN');
    expect(playtimeBlocked()).toBe(true);
    await authorizePlaytime('4286', 10);
    expect(playtimeView().phase).toBe('playing');
    expect(playtimeView().record?.accomplishments).toEqual([]);
  });
  it('accepts early stopping without answers and preserves partial accomplishments', async () => {
    await authorizePlaytime('4286', 5);
    notePlaytime('Practised counting');
    notePlaytime('Practised counting');
    stopPlaytime();
    expect(playtimeView().record?.accomplishments).toEqual(['Practised counting']);
    expect(playtimeBlocked()).toBe(true);
  });
  it('does not permit corrupted records or unavailable storage', async () => {
    data.set(PLAYTIME_KEY, '{}');
    expect(playtimeBlocked()).toBe(true);
    await expect(authorizePlaytime('4286', 5)).rejects.toThrow('could not be read');
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw Error('denied');
      },
    });
    expect(playtimeBlocked()).toBe(true);
  });
  it('is opt-in and rejects invalid budgets', async () => {
    expect(playtimeView().phase).toBe('off');
    await expect(authorizePlaytime('4286', 60)).rejects.toThrow();
    expect(playtimeView().phase).toBe('off');
  });
});
