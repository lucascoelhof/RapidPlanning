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

describe('GameStore — identity dedup on refresh/rejoin', () => {
  let store: GameStore;

  beforeEach(() => {
    store = new GameStore();
    store.setLocalPeerId('me');
    store.upsertLocalPlayer({ name: 'Me', email: 'me@x', avatar: null });
  });

  it('evicts a stale row when the same email rejoins with a new peerId', () => {
    // harrison joins as peer-old
    store.upsertRemotePlayer('peer-old', { name: 'harrison', email: 'h@x', avatar: null });
    // harrison refreshes -> rejoins as peer-new with the same email
    store.upsertRemotePlayer('peer-new', { name: 'harrison', email: 'h@x', avatar: null });

    const ids = store.getSnapshot().players.map((p) => p.id);
    expect(ids).not.toContain('peer-old');
    expect(ids).toContain('peer-new');
    expect(ids.filter((id) => id !== 'me').length).toBe(1);
  });

  it('falls back to name for identity when email is null', () => {
    store.upsertRemotePlayer('p1', { name: 'harrison', email: null, avatar: null });
    store.upsertRemotePlayer('p2', { name: 'harrison', email: null, avatar: null });
    const ids = store.getSnapshot().players.map((p) => p.id);
    expect(ids).not.toContain('p1');
    expect(ids).toContain('p2');
  });

  it('preserves a held vote when the same user rejoins under a new peerId', () => {
    // Old connection had voted; vote arrives for the new peerId first.
    store.upsertRemotePlayer('peer-old', { name: 'harrison', email: 'h@x', avatar: null });
    store.setRemoteVote('peer-old', '8' as VoteValue);
    // Refresh: vote for the new id lands before player_data.
    store.setRemoteVote('peer-new', '8' as VoteValue);
    store.upsertRemotePlayer('peer-new', { name: 'harrison', email: 'h@x', avatar: null });

    const peer = store.getSnapshot().players.find((p) => p.id === 'peer-new');
    expect(peer?.vote).toBe('8');
  });

  it('never evicts the local player, even if the email matches', () => {
    // A remote claims our email (spoof / second tab) — local row must stay.
    store.upsertRemotePlayer('spoof', { name: 'Me', email: 'me@x', avatar: null });
    const ids = store.getSnapshot().players.map((p) => p.id);
    expect(ids).toContain('me');
    expect(ids).toContain('spoof');
  });

  it('does not collapse distinct users who share only a name when emails differ', () => {
    store.upsertRemotePlayer('p1', { name: 'Chris', email: 'chris@a', avatar: null });
    store.upsertRemotePlayer('p2', { name: 'Chris', email: 'chris@b', avatar: null });
    const ids = store.getSnapshot().players.map((p) => p.id);
    expect(ids).toContain('p1');
    expect(ids).toContain('p2');
  });
});
