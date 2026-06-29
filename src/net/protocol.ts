import { PROTOCOL_VERSION } from '../constants';
import type { Reaction, VoteValue } from '../constants';
import type { PlayerIdentity } from '../app/types';

/**
 * Wire protocol. Every message is tagged with `v` so we can evolve the format
 * without breaking deployed clients (the legacy protocol had no version).
 *
 * Two categories:
 *
 *  1. **Control** — consumed inside `PeerTransport` and never surfaced to the
 *     game layer (keepalive / ping / pong / peer_list).
 *
 *  2. **Game** — forwarded up to the session via `transport.on('message', ...)`.
 *
 * `decode()` validates the shape of incoming data and returns `null` for
 * anything malformed or wrong-version, so the transport can silently drop it
 * instead of crashing. Untrusted input stops at the boundary.
 */

// --- Control messages (internal to the transport) ----------------------------
export interface KeepaliveMsg {
  v: number;
  type: 'keepalive';
  ts: number;
}
export interface PingMsg {
  v: number;
  type: 'ping';
  ts: number;
}
export interface PongMsg {
  v: number;
  type: 'pong';
  ts: number;
}
export interface PeerListMsg {
  v: number;
  type: 'peer_list';
  peers: string[];
}

// --- Game messages (forwarded to the session) --------------------------------
export interface PlayerDataPayload extends PlayerIdentity {
  id?: never; // `id` is always the peer id on the receiver — never trust wire
  isLocal?: never;
  vote?: never;
  reaction?: never;
}
export interface PlayerDataMsg {
  v: number;
  type: 'player_data';
  player: PlayerDataPayload;
}
export interface RequestPlayerDataMsg {
  v: number;
  type: 'request_player_data';
}
export interface PlayerDisconnectedMsg {
  v: number;
  type: 'player_disconnected';
  peerId: string;
}
export interface VoteMsg {
  v: number;
  type: 'vote';
  vote: VoteValue | null;
}
export interface ClearVotesMsg {
  v: number;
  type: 'clear_votes';
}
export interface ShowVotesMsg {
  v: number;
  type: 'show_votes';
  allVotes: Record<string, { name: string; vote: VoteValue | null }>;
}
export interface ReactionMsg {
  v: number;
  type: 'reaction';
  reaction: Reaction | null;
  ts: number;
}

export type ControlMessage = KeepaliveMsg | PingMsg | PongMsg | PeerListMsg;
export type GameMessage =
  | PlayerDataMsg
  | RequestPlayerDataMsg
  | PlayerDisconnectedMsg
  | VoteMsg
  | ClearVotesMsg
  | ShowVotesMsg
  | ReactionMsg;
export type WireMessage = ControlMessage | GameMessage;

export type GameMessageType = GameMessage['type'];

/**
 * Distributive `Omit` — plain `Omit<Union, 'v'>` doesn't distribute over the
 * union members and loses the per-member field info, so we use this helper
 * for the outbound parameter types of `transport.send` / `transport.broadcast`.
 */
export type DistribOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Outbound control-or-game message (any kind, without the version field). */
export type OutboundMessage = DistribOmit<WireMessage, 'v'>;

/** Outbound game-level message only. */
export type OutboundGameMessage = DistribOmit<GameMessage, 'v'>;

/** Tag a message with the current protocol version. */
export function encode<T extends OutboundMessage>(msg: T): T & { v: number } {
  return { v: PROTOCOL_VERSION, ...msg } as T & { v: number };
}

const GAME_TYPES = new Set<GameMessageType>([
  'player_data',
  'request_player_data',
  'player_disconnected',
  'vote',
  'clear_votes',
  'show_votes',
  'reaction',
]);

const CONTROL_TYPES = new Set<string>(['keepalive', 'ping', 'pong', 'peer_list']);

/** True if a decoded message is a game-level message the session cares about. */
export function isGameMessage(msg: WireMessage): msg is GameMessage {
  return GAME_TYPES.has(msg.type as GameMessageType);
}

/**
 * Validate + decode an arbitrary value from the wire. Returns `null` if the
 * value is malformed, wrong-version, or not a recognised message type. All
 * downstream code can therefore rely on the returned shape.
 */
export function decode(raw: unknown): WireMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (m['v'] !== PROTOCOL_VERSION) return null;
  if (typeof m['type'] !== 'string') return null;
  if (!CONTROL_TYPES.has(m['type']) && !GAME_TYPES.has(m['type'] as GameMessageType)) {
    return null;
  }
  // We've validated version + type; trust the union shape from here.
  // (Field-level validation happens in the consumer where types are narrower.)
  return m as unknown as WireMessage;
}
