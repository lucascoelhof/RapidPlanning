import { Emitter } from '../utils/emitter';
import type { Player, VotingSummary, SessionPhase } from '../app/types';
import type { Reaction, VoteValue } from '../constants';
import { buildVotingSummary } from '../game/consensus';
import { REACTION_DURATION_MS, TIMING } from '../constants';

/**
 * The single source of truth for game state. The UI subscribes to `change`
 * and re-renders from `state`. No other module holds vote/reaction/player
 * data — this replaces the scattered `selectedVote` / `votesRevealed` /
 * `players` flags that lived across the legacy UIManager + GameManager.
 *
 * Mutations are methods on the store so they're easy to reason about and
 * test. Every mutation emits a single `change` event with the new snapshot.
 */

export interface StoreSnapshot {
  sessionId: string | null;
  phase: SessionPhase;
  players: Player[];
  localPlayer: Player | null;
  votesRevealed: boolean;
  /** The local player's currently selected vote card (UI selection state). */
  selectedVote: VoteValue | null;
  /** The local player's currently selected reaction (UI selection state). */
  selectedReaction: Reaction | null;
}

interface StoreEvents {
  change: [snapshot: StoreSnapshot];
  /** Fired when votes are revealed (auto or manual) — drives stats render. */
  votesRevealed: [];
  /** Fired when the local reaction auto-expires (UI clears selection). */
  reactionExpired: [];
  /** Fired when all players have voted (drives auto-reveal). */
  votingComplete: [];
}

export class GameStore extends Emitter<StoreEvents> {
  private sessionId: string | null = null;
  private phase: SessionPhase = 'idle';
  private players = new Map<string, Player>();
  private _localPeerId: string | null = null;
  private votesRevealed = false;
  private selectedVote: VoteValue | null = null;
  private selectedReaction: Reaction | null = null;
  private reactionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /**
   * Votes that arrived from a peer before their `player_data` did. Held until
   * the player is upserted, then applied — without this a vote landing first
   * was silently dropped (ordering between two independent messages isn't
   * guaranteed), which could leave the live vote count wrong mid-session.
   */
  private pendingVotes = new Map<string, VoteValue | null>();
  /**
   * Handle for the deferred auto-reveal from `checkVotingComplete`. Tracked so
   * `reset()` / vote changes can cancel a pending reveal instead of leaving a
   * stray timer that fires after teardown.
   */
  private revealTimer: ReturnType<typeof setTimeout> | null = null;

  // --- Snapshot -------------------------------------------------------------

  getSnapshot(): StoreSnapshot {
    const players = Array.from(this.players.values());
    return {
      sessionId: this.sessionId,
      phase: this.phase,
      players,
      localPlayer: this.localPeerId ? (this.players.get(this.localPeerId) ?? null) : null,
      votesRevealed: this.votesRevealed,
      selectedVote: this.selectedVote,
      selectedReaction: this.selectedReaction,
    };
  }

  private emitChange(): void {
    this.emit('change', this.getSnapshot());
  }

  // --- Session / phase ------------------------------------------------------

  setSessionId(id: string | null): void {
    this.sessionId = id;
    this.emitChange();
  }

  setPhase(phase: SessionPhase): void {
    this.phase = phase;
    this.emitChange();
  }

  setLocalPeerId(id: string): void {
    this._localPeerId = id;
    if (this._localPeerId && !this.players.has(id)) {
      // Local player row will be populated by `upsertLocalPlayer`.
    }
  }

  get localPeerId(): string | null {
    return this._localPeerId;
  }

  // --- Players --------------------------------------------------------------

  /** Insert or update the local player from their identity. */
  upsertLocalPlayer(identity: {
    name: string;
    email: string | null;
    avatar: string | null;
  }): void {
    if (!this.localPeerId) return;
    const existing = this.players.get(this.localPeerId);
    this.players.set(this.localPeerId, {
      id: this.localPeerId,
      name: identity.name,
      email: identity.email,
      avatar: identity.avatar,
      vote: existing?.vote ?? null,
      reaction: existing?.reaction ?? null,
      isLocal: true,
    });
    this.emitChange();
  }

  /** Upsert a remote player from a wire `player_data` message. */
  upsertRemotePlayer(peerId: string, data: {
    name: string;
    email: string | null;
    avatar: string | null;
  }): void {
    if (peerId === this.localPeerId) return; // never trust wire data about self
    const existing = this.players.get(peerId);
    // Apply any vote that arrived ahead of this player_data.
    const heldVote = this.pendingVotes.has(peerId) ? this.pendingVotes.get(peerId) : existing?.vote;
    if (this.pendingVotes.has(peerId)) this.pendingVotes.delete(peerId);
    this.players.set(peerId, {
      id: peerId,
      name: data.name,
      email: data.email,
      avatar: data.avatar,
      vote: heldVote ?? null,
      reaction: existing?.reaction ?? null,
      isLocal: false,
    });
    this.emitChange();
    // A held vote now belongs to a known player — it counts toward completion.
    if (existing === undefined) this.checkVotingComplete();
  }

  removePlayer(peerId: string): void {
    this.clearReactionTimer(peerId);
    this.pendingVotes.delete(peerId);
    if (!this.players.delete(peerId)) return;
    this.emitChange();
    this.checkVotingComplete();
  }

  // --- Voting ---------------------------------------------------------------

  /** Set the local player's vote. Returns the outbound message, if any. */
  castLocalVote(vote: VoteValue | null): { type: 'vote'; vote: VoteValue | null } | null {
    if (!this.localPeerId) return null;
    const p = this.players.get(this.localPeerId);
    if (!p) return null;
    p.vote = vote;
    this.players.set(this.localPeerId, p);
    this.selectedVote = vote;
    this.emitChange();
    this.checkVotingComplete();
    return { type: 'vote', vote };
  }

  setRemoteVote(peerId: string, vote: VoteValue | null): void {
    const p = this.players.get(peerId);
    if (!p) {
      // Player unknown yet — hold the vote until their player_data arrives.
      this.pendingVotes.set(peerId, vote);
      return;
    }
    p.vote = vote;
    this.players.set(peerId, p);
    this.emitChange();
    this.checkVotingComplete();
  }

  /** Clear everyone's votes. Returns the outbound message, if local-initiated. */
  clearVotes(): { type: 'clear_votes' } {
    this.cancelReveal();
    this.votesRevealed = false;
    this.selectedVote = null;
    for (const p of this.players.values()) p.vote = null;
    this.emitChange();
    return { type: 'clear_votes' };
  }

  applyClearVotes(): void {
    this.cancelReveal();
    this.votesRevealed = false;
    this.selectedVote = null;
    for (const p of this.players.values()) p.vote = null;
    this.emitChange();
  }

  /** Reveal votes (manual). Returns the outbound message. */
  revealVotes(): { type: 'show_votes'; allVotes: Record<string, { name: string; vote: VoteValue | null }> } {
    this.votesRevealed = true;
    const allVotes: Record<string, { name: string; vote: VoteValue | null }> = {};
    for (const [id, p] of this.players) {
      allVotes[id] = { name: p.name, vote: p.vote };
    }
    this.emitChange();
    this.emit('votesRevealed');
    return { type: 'show_votes', allVotes };
  }

  applyRevealVotes(allVotes?: Record<string, { name: string; vote: VoteValue | null }>): void {
    this.votesRevealed = true;
    if (allVotes) {
      for (const [id, v] of Object.entries(allVotes)) {
        const p = this.players.get(id);
        if (p) {
          p.vote = v.vote;
        } else {
          // Late sync: create a stub player so their vote shows in stats.
          this.players.set(id, {
            id,
            name: v.name,
            email: null,
            avatar: null,
            vote: v.vote,
            reaction: null,
            isLocal: false,
          });
        }
      }
    }
    this.emitChange();
    this.emit('votesRevealed');
  }

  /** Auto-reveal when every player has voted. Runs after a short UX delay. */
  private checkVotingComplete(): void {
    if (this.votesRevealed) return;
    if (this.players.size === 0) return;
    const allVoted = Array.from(this.players.values()).every((p) => p.vote !== null);
    if (!allVoted) return;
    this.emit('votingComplete');
    // Cancel any previously-scheduled reveal (e.g. vote flipped back and forth).
    if (this.revealTimer) clearTimeout(this.revealTimer);
    // Slight delay for a beat of suspense before flipping cards.
    this.revealTimer = setTimeout(() => {
      this.revealTimer = null;
      if (!this.votesRevealed && this.allVoted()) {
        this.applyRevealVotes();
      }
    }, TIMING.revealDelay);
  }

  private allVoted(): boolean {
    return this.players.size > 0 && Array.from(this.players.values()).every((p) => p.vote !== null);
  }

  /** Cancel a pending auto-reveal. Safe to call when none is scheduled. */
  private cancelReveal(): void {
    if (this.revealTimer) {
      clearTimeout(this.revealTimer);
      this.revealTimer = null;
    }
  }

  // --- Reactions ------------------------------------------------------------

  /** Toggle the local player's reaction. Returns outbound message + expiry info. */
  toggleLocalReaction(reaction: Reaction): {
    message: { type: 'reaction'; reaction: Reaction | null; ts: number };
  } {
    const p = this.players.get(this.localPeerId ?? '');
    const next: Reaction | null = p?.reaction === reaction ? null : reaction;
    if (p) {
      p.reaction = next;
      this.players.set(this.localPeerId!, p);
    }
    this.selectedReaction = next;
    this.clearReactionTimer(this.localPeerId ?? '');
    if (next) this.setReactionTimer(this.localPeerId!, next, Date.now());
    this.emitChange();
    return { message: { type: 'reaction', reaction: next, ts: Date.now() } };
  }

  applyRemoteReaction(peerId: string, reaction: Reaction | null, ts: number): void {
    const p = this.players.get(peerId);
    if (!p) return;
    this.clearReactionTimer(peerId);
    p.reaction = reaction;
    this.players.set(peerId, p);
    if (reaction) {
      // Align expiry to the original send time so late receivers stay in sync.
      const remaining = Math.max(REACTION_DURATION_MS - (Date.now() - ts), 100);
      this.setReactionTimer(peerId, reaction, ts, remaining);
    }
    this.emitChange();
  }

  private setReactionTimer(
    peerId: string,
    reaction: Reaction,
    _sentAt: number,
    durationMs = REACTION_DURATION_MS,
  ): void {
    const timer = setTimeout(() => this.expireReaction(peerId, reaction), durationMs);
    this.reactionTimers.set(peerId, timer);
  }

  private clearReactionTimer(peerId: string): void {
    const t = this.reactionTimers.get(peerId);
    if (t) {
      clearTimeout(t);
      this.reactionTimers.delete(peerId);
    }
  }

  private expireReaction(peerId: string, expected: Reaction): void {
    const p = this.players.get(peerId);
    this.reactionTimers.delete(peerId);
    if (!p || p.reaction !== expected) return;
    p.reaction = null;
    this.players.set(peerId, p);
    if (peerId === this.localPeerId) {
      this.selectedReaction = null;
      this.emit('reactionExpired');
      // Broadcast the expiry so peers clear it too.
      this.emit('change', this.getSnapshot());
    }
    this.emitChange();
  }

  // --- Snapshot helpers -----------------------------------------------------

  getVotingSummary(): VotingSummary {
    const votes = Array.from(this.players.values())
      .map((p) => p.vote)
      .filter((v): v is VoteValue => v !== null);
    return buildVotingSummary(votes);
  }

  getLocalPlayerVote(): VoteValue | null {
    return this.localPeerId ? (this.players.get(this.localPeerId)?.vote ?? null) : null;
  }

  /** Restore UI selection state after a refresh (does NOT broadcast). */
  restoreSelection(vote: VoteValue | null, reaction: Reaction | null): void {
    this.selectedVote = vote;
    this.selectedReaction = reaction;
    if (this.localPeerId) {
      const p = this.players.get(this.localPeerId);
      if (p) {
        p.vote = vote;
        p.reaction = reaction;
        this.players.set(this.localPeerId, p);
      }
    }
    this.emitChange();
  }

  /** Full reset on teardown / session switch. */
  reset(): void {
    for (const t of this.reactionTimers.values()) clearTimeout(t);
    this.reactionTimers.clear();
    if (this.revealTimer) {
      clearTimeout(this.revealTimer);
      this.revealTimer = null;
    }
    this.players.clear();
    this.pendingVotes.clear();
    this.sessionId = null;
    this._localPeerId = null;
    this.votesRevealed = false;
    this.selectedVote = null;
    this.selectedReaction = null;
    this.phase = 'idle';
    this.emitChange();
  }
}
