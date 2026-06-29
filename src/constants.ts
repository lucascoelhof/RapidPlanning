/**
 * Application-wide constants. Single source of truth — nothing else in the
 * codebase should hard-code vote cards, reaction emoji, timeouts, etc.
 */

/** Modified Fibonacci vote deck. Order matters for keyboard nav + sorting. */
export const VOTE_CARDS = ['0', '½', '1', '2', '3', '5', '8', '13', '20', '40', '100', '?'] as const;
export type VoteValue = (typeof VOTE_CARDS)[number];

/** Emoji reactions shown in the reactions panel. */
export const REACTIONS = ['👍', '👎', '😄', '😕', '😲', '🤔', '🔥', '❤️'] as const;
export type Reaction = (typeof REACTIONS)[number];

/** How long a reaction stays visible on a player's avatar (ms). */
export const REACTION_DURATION_MS = 5_000;

/** 9-digit numeric session ID. */
export const SESSION_ID_PATTERN = /^\d{9}$/;
export const SESSION_ID_LENGTH = 9;

/** LRU cap for stored sessions in localStorage. */
export const MAX_SESSIONS_STORED = 10;

/** PeerJS host peer ID prefix. Host id = `host-{sessionId}`. */
export const HOST_ID_PREFIX = 'host-';

/**
 * Network timing (ms) — centralised so they can be tuned in one place.
 * Previous implementation scattered these as magic numbers.
 */
export const TIMING = {
  connectionTimeout: 20_000,
  incomingOpenTimeout: 10_000,
  reconnectBaseDelay: 2_000,
  reconnectMaxAttempts: 3,
  rejoinMaxAttempts: 2,
  rejoinMaxDelay: 5_000,
  keepaliveInterval: 15_000,
  healthCheckInterval: 30_000,
  staleThreshold: 60_000,
  revealDelay: 500,
  keyboardBufferMs: 500,
  rejoinRetryBaseDelay: 1_000,
} as const;

/** STUN servers for WebRTC ICE negotiation. */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'stun:stun.synology.com:3478' },
];

/** Protocol version — bumped on breaking wire changes. */
export const PROTOCOL_VERSION = 1;

/** localStorage keys (prefixed to avoid collisions and to make cleanup easy). */
export const STORAGE_KEYS = {
  sessions: 'rapidPlanningSessions',
  theme: 'rapidPlanningTheme',
  errorLog: 'rapidPlanning_errorLog',
} as const;

/** Themes supported by the app. */
export const THEMES = ['dark', 'light'] as const;
export type Theme = (typeof THEMES)[number];

/** Author + repo links rendered in footers. */
export const LINKS = {
  author: 'https://github.com/lucascoelhof',
  repo: 'https://github.com/lucascoelhof/RapidPlanning',
  gravatarAvatar: (hash: string) => `https://www.gravatar.com/avatar/${hash}?d=blank&s=120`,
  gravatarProfile: (hash: string) => `https://gravatar.com/${hash}.json`,
} as const;
