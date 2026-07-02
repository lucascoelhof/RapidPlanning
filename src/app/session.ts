import { Router, type Route } from '../router';
import { PeerTransport } from '../net/peer-transport';
import { GameStore } from '../game/store';
import { ConnectionMonitor } from '../services/connection-monitor';
import { ErrorHandler, type ErrorNotice } from '../services/error-handler';
import { SessionStore } from '../services/session-store';
import { analytics } from '../services/analytics';
import { Emitter } from '../utils/emitter';
import { generateSessionId, sleep } from '../utils/dom';
import { TIMING } from '../constants';
import type { GameMessage } from '../net/protocol';
import type { PlayerIdentity, NoticeKind, GameStateSnapshot } from './types';
import type { Reaction, VoteValue } from '../constants';

/**
 * The application coordinator. Owns every subsystem and wires them together:
 *
 *   UI intents ──► Session ──► Store mutation + Transport broadcast
 *   Transport message ──► Session ──► Store mutation
 *   Store change ──► UI (re-render)
 *
 * Replaces the legacy `app.js`. Key improvements:
 *   - No game logic in the coordinator (it lives in the store).
 *   - No localStorage logic here (delegated to `SessionStore`).
 *   - Rejoin retry uses bounded exponential backoff instead of ad-hoc timeouts.
 *   - Every peer message is validated by `protocol.decode` before it reaches us.
 */

export interface UiNotice {
  kind: NoticeKind;
  title?: string;
  message: string;
}

interface SessionEvents {
  /** A user-facing notice (toast / banner). */
  notice: [notice: UiNotice];
  /** A blocking connection error with recovery options. */
  connectionError: [options: ConnectionErrorOptions];
  /** Connection status message changed (null = hide banner). */
  statusMessage: [msg: { type: 'warning' | 'error'; message: string } | null];
}

export interface ConnectionErrorOptions {
  title: string;
  message: string;
  onRetry: () => void;
  onJoinNew: () => void;
  onGoHome: () => void;
}

export class Session extends Emitter<SessionEvents> {
  readonly router = new Router();
  readonly transport = new PeerTransport();
  readonly store = new GameStore();
  readonly connection = new ConnectionMonitor();
  readonly errors = new ErrorHandler();

  constructor() {
    super();
    this.wireTransport();
    this.wireRouter();
    this.wireConnection();
    this.wireErrors();
  }

  // --- Wiring ---------------------------------------------------------------

  private wireTransport(): void {
    this.transport.on('connected', (peerId: string) => {
      this.store.setLocalPeerId(peerId);
      // Once we know our own id, materialise the local player row.
      if (this.identity) this.store.upsertLocalPlayer(this.identity);
    });

    this.transport.on('peerConnected', (peerId: string) => {
      // Exchange player data with the new peer.
      const local = this.store.getSnapshot().localPlayer;
      if (local) {
        this.transport.send(peerId, {
          type: 'player_data',
          player: { name: local.name, email: local.email, avatar: local.avatar },
        });
      }
      this.transport.send(peerId, { type: 'request_player_data' });
    });

    this.transport.on('peerDisconnected', (peerId: string) => {
      this.store.removePlayer(peerId);
      // Tell everyone else to drop them too (in case of asymmetric mesh breaks).
      this.transport.broadcast({ type: 'player_disconnected', peerId });
    });

    this.transport.on('message', (peerId: string, msg: GameMessage) => this.handleMessage(peerId, msg));

    this.transport.on('reconnected', () => {
      this.emit('notice', { kind: 'success', message: 'Reconnected to session' });
    });

    this.transport.on('reconnectionFailed', () => {
      this.emit('notice', {
        kind: 'warning',
        message: 'Failed to reconnect. You may need to refresh.',
      });
    });

    this.transport.on('error', (err: Error) => {
      this.errors.handle(err, { type: 'network' });
    });
  }

  private wireRouter(): void {
    this.router.on('route', (route) => this.handleRoute(route));
  }

  private wireConnection(): void {
    // Drive connection-quality grading from real mesh health instead of a
    // third-party HTTP probe.
    this.connection.setHealthProvider(() => this.transport.getHealth());
    this.connection.on('statusChange', () => {
      this.emit('statusMessage', this.connection.getStatusMessage());
    });
    this.connection.on('connectionLost', () => {
      this.store.setPhase('offline');
    });
    this.connection.on('connectionRestored', () => {
      if (this.store.getSnapshot().sessionId && this.identity) {
        void this.connection.attemptReconnection(async () => {
          await this.rejoinInBackground(this.store.getSnapshot().sessionId!, this.identity!);
        });
      }
    });
  }

  private wireErrors(): void {
    this.errors.onNotice((notice: ErrorNotice) => {
      this.emit('notice', {
        kind: notice.kind,
        title: notice.title,
        message: notice.message,
      });
    });
  }

  // --- Route handling -------------------------------------------------------

  /** Currently-known identity (from create/join form, or restored from disk). */
  get identity(): PlayerIdentity | null {
    return this._identity;
  }
  private _identity: PlayerIdentity | null = null;

  private async handleRoute(route: Route): Promise<void> {
    if (route.name === 'home') {
      // Don't auto-cleanup — the user might be creating/joining a new session.
      return;
    }
    if (route.name === 'about') {
      return;
    }
    if (route.name === 'session') {
      // Already in this session? UI just needs to re-render.
      if (this.store.getSnapshot().sessionId === route.sessionId) return;

      const stored = SessionStore.get(route.sessionId);
      if (stored?.playerData) {
        // Refresh recovery: restore identity + state, reconnect in background.
        this._identity = stored.playerData;
        this.store.setSessionId(route.sessionId);
        this.store.upsertLocalPlayer(stored.playerData);
        if (stored.gameState) {
          // Defer slightly so the UI is mounted before we poke selection state.
          setTimeout(() => this.restoreGameState(stored.gameState!), TIMING.revealDelay / 5);
        }
        void this.rejoinInBackground(route.sessionId, stored.playerData);
      }
      // else: UI shows the join prompt (handled by the page component).
    }
  }

  // --- Public intents (called by the UI) ------------------------------------

  async createSession(identity: PlayerIdentity): Promise<void> {
    await this.errors.safeAsync(
      async () => {
        if (this.store.getSnapshot().sessionId) this.cleanup();
        const sessionId = generateSessionId();
        this._identity = identity;
        SessionStore.save(sessionId, identity, null);
        this.store.setSessionId(sessionId);
        this.store.setPhase('connecting');
        await this.transport.createSession(sessionId);
        this.store.setPhase('connected');
        this.store.upsertLocalPlayer(identity);
        this.router.navigate({ name: 'session', sessionId });
        analytics.trackRoomCreated();
        analytics.trackUserJoined(true);
      },
      { type: 'network', operation: 'createSession' },
    );
  }

  async joinSession(sessionId: string, identity: PlayerIdentity): Promise<void> {
    await this.errors.safeAsync(
      async () => {
        const current = this.store.getSnapshot().sessionId;
        if (current && current !== sessionId) this.cleanup();
        this._identity = identity;
        SessionStore.save(sessionId, identity, null);
        this.store.setSessionId(sessionId);
        this.store.setPhase('connecting');
        await this.transport.joinSession(sessionId);
        this.store.setPhase('connected');
        this.store.upsertLocalPlayer(identity);
        this.router.navigate({ name: 'session', sessionId });
        analytics.trackUserJoined(false);
      },
      { type: 'network', operation: 'joinSession' },
    );
  }

  /** Background rejoin on refresh — keeps the existing local player row. */
  private async rejoinInBackground(
    sessionId: string,
    identity: PlayerIdentity,
    attempt = 0,
  ): Promise<void> {
    this.store.setPhase(attempt === 0 ? 'connecting' : 'reconnecting');
    try {
      await this.transport.joinSession(sessionId);
      this.store.setPhase('connected');
      analytics.trackUserJoined(false);
    } catch (err) {
      console.error('[session] rejoin failed:', err);
      if (attempt < TIMING.rejoinMaxAttempts) {
        const delay = Math.min(TIMING.rejoinRetryBaseDelay * Math.pow(2, attempt), TIMING.rejoinMaxDelay);
        await sleep(delay);
        return this.rejoinInBackground(sessionId, identity, attempt + 1);
      }
      this.store.setPhase('error');
      this.emit('connectionError', {
        title: 'Unable to Connect',
        message: err instanceof Error ? err.message : 'Failed to connect to the session.',
        onRetry: () => {
          SessionStore.clear(sessionId);
          void this.rejoinInBackground(sessionId, identity, 0);
        },
        onJoinNew: () => {
          SessionStore.clear(sessionId);
          this._identity = null;
          this.store.reset();
          this.router.navigate({ name: 'session', sessionId });
        },
        onGoHome: () => {
          SessionStore.clear(sessionId);
          this._identity = null;
          this.store.reset();
          this.router.navigate({ name: 'home' });
        },
      });
    }
  }

  castVote(vote: VoteValue | null): void {
    const out = this.store.castLocalVote(vote);
    if (out) {
      this.transport.broadcast(out);
      analytics.trackVoteSubmitted();
      this.persist();
    }
  }

  clearVotes(): void {
    const out = this.store.clearVotes();
    this.transport.broadcast(out);
    analytics.trackVotingStarted();
    this.persist();
  }

  showVotes(): void {
    const out = this.store.revealVotes();
    this.transport.broadcast(out);
    analytics.trackVotesRevealed();
    this.persist();
  }

  toggleReaction(reaction: Reaction): void {
    const { message } = this.store.toggleLocalReaction(reaction);
    this.transport.broadcast(message);
    this.persist();
  }

  // --- Peer message dispatch ------------------------------------------------

  private handleMessage(peerId: string, msg: GameMessage): void {
    switch (msg.type) {
      case 'player_data':
        this.store.upsertRemotePlayer(peerId, {
          name: msg.player.name,
          email: msg.player.email,
          avatar: msg.player.avatar,
        });
        break;
      case 'request_player_data': {
        const local = this.store.getSnapshot().localPlayer;
        if (local) {
          this.transport.send(peerId, {
            type: 'player_data',
            player: { name: local.name, email: local.email, avatar: local.avatar },
          });
        }
        break;
      }
      case 'player_disconnected':
        this.store.removePlayer(msg.peerId);
        break;
      case 'vote':
        this.store.setRemoteVote(peerId, msg.vote);
        this.persist();
        break;
      case 'clear_votes':
        this.store.applyClearVotes();
        break;
      case 'show_votes':
        this.store.applyRevealVotes(msg.allVotes);
        break;
      case 'reaction':
        this.store.applyRemoteReaction(peerId, msg.reaction, msg.ts);
        break;
    }
  }

  // --- Persistence ----------------------------------------------------------

  private persist(): void {
    const snap = this.store.getSnapshot();
    if (!snap.sessionId || !this._identity) return;
    const gameState: GameStateSnapshot = {
      selectedVote: snap.selectedVote,
      selectedReaction: snap.selectedReaction,
      votesRevealed: snap.votesRevealed,
      localPlayerVote: snap.localPlayer?.vote ?? null,
      timestamp: Date.now(),
    };
    SessionStore.save(snap.sessionId, this._identity, gameState);
  }

  private restoreGameState(state: GameStateSnapshot): void {
    this.store.setPhase('connecting');
    this.store.restoreSelection(state.selectedVote, state.selectedReaction);
    if (state.votesRevealed) {
      this.store.applyRevealVotes();
    }
  }

  // --- Teardown -------------------------------------------------------------

  cleanup(): void {
    if (this.store.getSnapshot().sessionId) analytics.trackRoomLeft();
    this.transport.disconnect();
    this.store.reset();
  }

  destroy(): void {
    this.cleanup();
    this.connection.destroy();
    this.errors.destroy();
    this.transport.removeAllListeners();
    this.store.removeAllListeners();
    this.router.removeAllListeners();
    this.removeAllListeners();
  }
}
