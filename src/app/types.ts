import type { Reaction, VoteValue } from '../constants';

/**
 * A participant in a session. `id` is the PeerJS peer id. Values arriving from
 * the network must be sanitised before being rendered — see `dom.escapeHtml`.
 */
export interface Player {
  id: string;
  name: string;
  email: string | null;
  avatar: string | null;
  vote: VoteValue | null;
  reaction: Reaction | null;
  isLocal: boolean;
}

/** Identity data captured from the create/join form. */
export interface PlayerIdentity {
  name: string;
  email: string | null;
  avatar: string | null;
}

/** Snapshot of game state persisted to localStorage for refresh recovery. */
export interface GameStateSnapshot {
  selectedVote: VoteValue | null;
  selectedReaction: Reaction | null;
  votesRevealed: boolean;
  localPlayerVote: VoteValue | null;
  timestamp: number;
}

/** Full record stored per session in localStorage. */
export interface SessionRecord {
  playerData: PlayerIdentity;
  gameState: GameStateSnapshot | null;
  joinedAt: number;
  lastUpdated: number;
}

/** Lifecycle of a session connection. Drives the UI + reconnect logic. */
export type SessionPhase =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline'
  | 'error'
  | 'destroyed';

/** Result of consensus detection (pure function output). */
export interface ConsensusResult {
  type: 'insufficient' | 'perfect' | 'close' | 'divergent' | 'majority' | 'none';
  message: string;
  highlight: boolean;
}

/** Aggregate voting stats rendered in the stats panel. */
export interface VotingSummary {
  /** vote value → count */
  votes: Record<string, number>;
  total: number;
  average: string | null;
  consensus: ConsensusResult;
}

/** Quality of the browser's network connection. */
export type ConnectionQuality = 'good' | 'poor' | 'very-poor' | 'offline';

/** User-facing toast / banner severity. */
export type NoticeKind = 'success' | 'warning' | 'error' | 'info';
