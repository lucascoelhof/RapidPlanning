import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionStore } from '../../src/services/session-store';
import { STORAGE_KEYS, MAX_SESSIONS_STORED } from '../../src/constants';
import type { SessionRecord } from '../../src/app/types';

function mockStorage(): Record<string, string> {
  const store: Record<string, string> = {};
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    },
    writable: true,
    configurable: true,
  });
  return store;
}

describe('SessionStore', () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = mockStorage();
  });

  const sampleRecord = (id: string, ts: number): SessionRecord => ({
    playerData: { name: `user-${id}`, email: null, avatar: null },
    gameState: null,
    joinedAt: ts,
    lastUpdated: ts,
  });

  it('round-trips a record through save/get', () => {
    SessionStore.save('123456789', { name: 'Alice', email: null, avatar: null }, null);
    const got = SessionStore.get('123456789');
    expect(got?.playerData.name).toBe('Alice');
    expect(got?.joinedAt).toBeTypeOf('number');
  });

  it('returns null for unknown sessions', () => {
    expect(SessionStore.get('000000000')).toBeNull();
  });

  it('preserves existing playerData on partial update', () => {
    SessionStore.save('111111111', { name: 'Bob', email: null, avatar: null }, null);
    SessionStore.save('111111111', null, {
      selectedVote: '5',
      selectedReaction: null,
      votesRevealed: false,
      localPlayerVote: '5',
      timestamp: Date.now(),
    });
    const got = SessionStore.get('111111111');
    expect(got?.playerData.name).toBe('Bob');
    expect(got?.gameState?.selectedVote).toBe('5');
  });

  it('clears a single session', () => {
    SessionStore.save('222222222', { name: 'C', email: null, avatar: null }, null);
    SessionStore.clear('222222222');
    expect(SessionStore.get('222222222')).toBeNull();
  });

  it('enforces the LRU cap', () => {
    // Insert MAX + 5 sessions with ascending joinedAt.
    for (let i = 0; i < MAX_SESSIONS_STORED + 5; i++) {
      const id = String(100_000_000 + i).padStart(9, '0');
      store[STORAGE_KEYS.sessions] = JSON.stringify({
        ...SessionStore.readAll(),
        [id]: sampleRecord(id, i),
      });
    }
    // Now go through SessionStore.save so eviction runs.
    SessionStore.save('999999999', { name: 'new', email: null, avatar: null }, null);
    const all = SessionStore.readAll();
    expect(Object.keys(all).length).toBeLessThanOrEqual(MAX_SESSIONS_STORED);
  });

  it('fails open on corrupted JSON', () => {
    store[STORAGE_KEYS.sessions] = '{not json';
    expect(SessionStore.readAll()).toEqual({});
    expect(SessionStore.get('123456789')).toBeNull();
  });

  it('fails open on quota exceeded', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => SessionStore.save('333333333', { name: 'x', email: null, avatar: null }, null)).not.toThrow();
    Storage.prototype.setItem = original;
    spy.mockRestore();
  });
});
