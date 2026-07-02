import { Emitter } from '../utils/emitter';
import { TIMING } from '../constants';
import type { ConnectionQuality } from '../app/types';

/**
 * Monitors the browser's network health independently of PeerJS.
 *
 * Three signals are combined:
 *   1. `online` / `offline` browser events   (instant, coarse)
 *   2. `visibilitychange`                    (pause probes when hidden)
 *   3. Periodic HEAD fetch to a 204 endpoint (real connectivity + RTT)
 *
 * Replaces the legacy `ConnectionManager`. Critically fixes the listener-leak
 * bug: bound handlers are stored as instance fields so `destroy()` can remove
 * the *same* function references that were added.
 */

export interface ConnectionStatus {
  isOnline: boolean;
  quality: ConnectionQuality;
}

/**
 * Transport-derived mesh health, used to grade connection quality instead of
 * probing a third-party endpoint. See {@link ConnectionMonitor.setHealthProvider}.
 */
export interface MeshHealth {
  /** Open data connections to other peers. */
  connected: number;
  /** Connections that answered a recent keepalive / ping. */
  healthy: number;
  /** Most recent ping/pong round-trip time (ms), or null if none yet. */
  lastRtt: number | null;
}

interface ConnectionMonitorEvents {
  statusChange: [status: ConnectionStatus];
  connectionLost: [];
  connectionRestored: [];
  offlineModeEnabled: [];
}

export class ConnectionMonitor extends Emitter<ConnectionMonitorEvents> {
  isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  quality: ConnectionQuality = 'good';

  private retryAttempts = 0;
  private readonly maxRetryAttempts = 3;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Transport-derived health source; null until the session wires one in. */
  private healthProvider: (() => MeshHealth | null) | null = null;

  // Bound handlers — stored so removeEventListener gets the same reference.
  private readonly handleOnline = (): void => this.setOnline(true);
  private readonly handleOffline = (): void => this.setOnline(false);
  private readonly handleVisibility = (): void => {
    if (document.visibilityState === 'visible') this.startHeartbeat();
    else this.stopHeartbeat();
  };

  constructor() {
    super();
    if (typeof window === 'undefined') return;
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.startHeartbeat();
  }

  private setOnline(isOnline: boolean): void {
    const wasOnline = this.isOnline;
    this.isOnline = isOnline;
    if (isOnline && !wasOnline) {
      this.quality = 'good';
      this.retryAttempts = 0;
      this.emit('connectionRestored');
    } else if (!isOnline && wasOnline) {
      this.quality = 'offline';
      this.emit('connectionLost');
    }
    this.emit('statusChange', { isOnline: this.isOnline, quality: this.quality });
  }

  private startHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => this.probe(), TIMING.healthCheckInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  /** Inject the transport-derived health source (replaces the HTTP probe). */
  setHealthProvider(fn: (() => MeshHealth | null) | null): void {
    this.healthProvider = fn;
  }

  /** Grade quality from the current mesh health (no network request needed). */
  private probe(): void {
    if (!this.isOnline) return;
    this.recordMeshHealth(this.healthProvider?.() ?? null);
  }

  private recordMeshHealth(mesh: MeshHealth | null): void {
    let next: ConnectionQuality;
    if (!mesh || mesh.connected === 0) {
      // Alone in the room (or still connecting) — don't cry wolf. Hard
      // connection failures are surfaced via the connection-error modal.
      next = 'good';
    } else {
      const allHealthy = mesh.healthy >= mesh.connected;
      const rtt = mesh.lastRtt;
      if (rtt === null) next = allHealthy ? 'good' : 'poor';
      else if (rtt < 250) next = allHealthy ? 'good' : 'poor';
      else if (rtt < 700) next = 'poor';
      else next = 'very-poor';
    }
    if (next === this.quality) return;
    this.quality = next;
    if (next === 'good') this.retryAttempts = 0;
    this.emit('statusChange', { isOnline: this.isOnline, quality: this.quality });
  }

  /** Attempt reconnection with exponential backoff. Resolves true on success. */
  attemptReconnection(action: () => Promise<unknown>): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.reconnectTimer) {
        resolve(false);
        return;
      }
      const delay = 1_000 * Math.pow(2, this.retryAttempts);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (!this.isOnline) {
          resolve(false);
          return;
        }
        action()
          .then(() => {
            this.retryAttempts = 0;
            this.quality = 'good';
            resolve(true);
          })
          .catch(() => {
            this.retryAttempts++;
            if (this.retryAttempts < this.maxRetryAttempts) {
              resolve(this.attemptReconnection(action));
            } else {
              this.emit('offlineModeEnabled');
              resolve(false);
            }
          });
      }, delay);
    });
  }

  /** User-facing status banner; `null` means "everything is fine, show nothing". */
  getStatusMessage(): { type: 'warning' | 'error'; message: string } | null {
    if (!this.isOnline || this.quality === 'offline') {
      return { type: 'error', message: "You're offline. Some features may not work." };
    }
    if (this.quality === 'poor') {
      return { type: 'warning', message: 'Poor connection. Some delays expected.' };
    }
    if (this.quality === 'very-poor') {
      return { type: 'warning', message: 'Very slow connection. Features may be limited.' };
    }
    return null;
  }

  destroy(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
      document.removeEventListener('visibilitychange', this.handleVisibility);
    }
    this.removeAllListeners();
  }
}
