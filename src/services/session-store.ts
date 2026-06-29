import { MAX_SESSIONS_STORED, STORAGE_KEYS } from '../constants';
import type { GameStateSnapshot, PlayerIdentity, SessionRecord } from '../app/types';

/**
 * localStorage-backed session persistence. Replaces the blob of session
 * helpers that used to live on the legacy `app.js` coordinator.
 *
 * Stores at most {@link MAX_SESSIONS_STORED} sessions, evicting oldest first
 * (LRU by `joinedAt`). All methods are defensive — a corrupted or quota-full
 * localStorage never throws into the caller; they log and return null/void.
 */
export const SessionStore = {
  /** Read all stored sessions as a raw object. */
  readAll(): Record<string, SessionRecord> {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.sessions) || '{}');
    } catch (err) {
      console.warn('[SessionStore] failed to read sessions:', err);
      return {};
    }
  },

  /** Get the record for a single session, or null. */
  get(sessionId: string): SessionRecord | null {
    return this.readAll()[sessionId] ?? null;
  },

  /**
   * Upsert a session record. Pass `null` for `playerData`/`gameState` to
   * preserve existing values (partial update).
   */
  save(
    sessionId: string,
    playerData: PlayerIdentity | null,
    gameState: GameStateSnapshot | null,
  ): void {
    try {
      const all = this.readAll();
      const existing = all[sessionId] ?? {
        playerData: playerData ?? { name: '', email: null, avatar: null },
        gameState: null,
        joinedAt: Date.now(),
        lastUpdated: Date.now(),
      };
      all[sessionId] = {
        playerData: playerData ?? existing.playerData,
        gameState: gameState ?? existing.gameState,
        joinedAt: existing.joinedAt,
        lastUpdated: Date.now(),
      };

      // LRU eviction — keep only the N most recently joined.
      const keys = Object.keys(all);
      if (keys.length > MAX_SESSIONS_STORED) {
        const sorted = keys.sort((a, b) => all[a]!.joinedAt - all[b]!.joinedAt);
        for (let i = 0; i < keys.length - MAX_SESSIONS_STORED; i++) {
          delete all[sorted[i]!];
        }
      }
      localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(all));
    } catch (err) {
      console.warn('[SessionStore] failed to save session:', err);
    }
  },

  /** Remove a single session record. */
  clear(sessionId: string): void {
    try {
      const all = this.readAll();
      delete all[sessionId];
      localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(all));
    } catch (err) {
      console.warn('[SessionStore] failed to clear session:', err);
    }
  },

  /** Remove every RapidPlanning session record. */
  clearAll(): void {
    try {
      localStorage.removeItem(STORAGE_KEYS.sessions);
    } catch (err) {
      console.warn('[SessionStore] failed to clear all sessions:', err);
    }
  },
};
