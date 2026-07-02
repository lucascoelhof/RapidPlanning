import { describe, it, expect, beforeEach } from 'vitest';
import { GameStore } from '../../src/game/store';
import type { VoteValue } from '../../src/constants';

describe('GameStore — vote buffering before player_data', () => {
  let store: GameStore;

  beforeEach(() => {
    store = new GameStore();
    store.setLocalPeerId('me');
    store.upsertLocalPlayer({ name: 'Me', email: null, avatar: null });
  });

  it('holds a remote vote until the player is known, then applies it', () => {
    // Vote lands before player_data — must not be silently dropped.
    store.setRemoteVote('peer-a', '5' as VoteValue);
    expect(store.getSnapshot().players.map((p) => p.id)).toEqual(['me']);

    // player_data arrives — the held vote now belongs to a known player.
    store.upsertRemotePlayer('peer-a', { name: 'A', email: null, avatar: null });
    const peer = store.getSnapshot().players.find((p) => p.id === 'peer-a');
    expect(peer?.vote).toBe('5');
  });

  it('discards a held vote if the player is removed before being known', () => {
    store.setRemoteVote('peer-a', '5' as VoteValue);
    store.removePlayer('peer-a');
    store.upsertRemotePlayer('peer-a', { name: 'A', email: null, avatar: null });
    const peer = store.getSnapshot().players.find((p) => p.id === 'peer-a');
    expect(peer?.vote).toBeNull();
  });

  it('still updates a vote directly when the player is already known', () => {
    store.upsertRemotePlayer('peer-a', { name: 'A', email: null, avatar: null });
    store.setRemoteVote('peer-a', '13' as VoteValue);
    const peer = store.getSnapshot().players.find((p) => p.id === 'peer-a');
    expect(peer?.vote).toBe('13');
  });
});
