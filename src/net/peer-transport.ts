import { Peer } from 'peerjs';
import type { DataConnection, PeerError } from 'peerjs';
import { Emitter } from '../utils/emitter';
import { ICE_SERVERS, HOST_ID_PREFIX, TIMING } from '../constants';
import { encode, decode, isGameMessage, type GameMessage, type WireMessage, type OutboundMessage, type OutboundGameMessage } from './protocol';
import { sleep } from '../utils/dom';

/**
 * PeerJS-backed transport. Owns one `Peer` instance and its open
 * `DataConnection`s. Responsibilities:
 *
 *   - Host vs. client mode (host registers `host-{sessionId}`).
 *   - Connection lifecycle with duplicate-connection prevention.
 *   - Keepalive (every {@link TIMING.keepaliveInterval}) + stale-connection
 *     health probing.
 *   - Full-mesh formation: the host sends a `peer_list` to each newcomer, who
 *     then dials everyone on the list. Matches the legacy topology.
 *   - Client-side auto-reconnect to the host with exponential backoff.
 *   - Decodes wire messages via `protocol.ts`; control messages are consumed
 *     here, game messages are emitted via the `message` event.
 *
 * Notable fixes vs. the legacy `PeerManager`:
 *   - Connection handlers are attached exactly once (the old code attached
 *     them twice on outgoing connections, double-processing every message).
 *   - The shared `Emitter` gives us real `off()` for cleanup.
 *   - Timing constants come from one place, not scattered magic numbers.
 */

type PeerErrorLike = PeerError<string> | Error;

interface Health {
  healthy: boolean;
  lastSeen: number;
  consecutiveFailures: number;
}

interface PeerTransportEvents {
  connected: [peerId: string];
  peerConnected: [peerId: string];
  peerDisconnected: [peerId: string];
  message: [peerId: string, message: GameMessage];
  reconnected: [peerId: string];
  reconnectionFailed: [peerId: string];
  error: [error: Error];
}

export class PeerTransport extends Emitter<PeerTransportEvents> {
  peer: Peer | null = null;
  private connections = new Map<string, DataConnection>();
  private health = new Map<string, Health>();
  /** Most recent ping/pong round-trip time (ms); null until first pong. */
  private lastRtt: number | null = null;
  private keepalive: ReturnType<typeof setInterval> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  isHost = false;
  /** Set while we're mid-reconnect attempt so `close` doesn't double-fire. */
  private reconnecting = false;
  /** Peers we have an in-flight dial against — prevents duplicate attempts. */
  private pendingDials = new Set<string>();

  // --- Session lifecycle ----------------------------------------------------

  /** Host mode: register a deterministic peer id. */
  async createSession(sessionId: string): Promise<void> {
    if (this.peer?.open) return;
    this.cleanupPeer();
    this.isHost = true;
    return this.openPeer(`${HOST_ID_PREFIX}${sessionId}`);
  }

  /** Client mode: random id, then connect to the host. */
  async joinSession(sessionId: string): Promise<void> {
    if (this.peer?.open) return;
    this.cleanupPeer();
    this.isHost = false;
    await this.openPeer(undefined);
    await this.connectToHost(sessionId);
  }

  private openPeer(id: string | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      // PeerJS has overloaded constructors — pick the right one for host vs client.
      const opts = { debug: 1, config: { iceServers: ICE_SERVERS } };
      const peer = id ? new Peer(id, opts) : new Peer(opts);
      this.peer = peer;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.cleanupPeer();
        reject(
          new Error(
            'Connection timeout - Unable to connect to the peer network. This may be due to firewall restrictions.',
          ),
        );
      }, TIMING.connectionTimeout);

      peer.on('open', (openId: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.startKeepalive();
        const id = openId ?? peer.id ?? '';
        this.emit('connected', id);
        // Accept incoming connections for the lifetime of this peer.
        peer.on('connection', (conn) => this.handleIncoming(conn));
        resolve();
      });

      peer.on('error', (err: PeerErrorLike) => {
        if (settled) {
          // Post-open errors are non-fatal for already-open peers; surface them.
          this.emit('error', this.friendlyError(err));
          return;
        }
        settled = true;
        clearTimeout(timeout);
        this.cleanupPeer();
        reject(this.friendlyError(err));
      });
    });
  }

  private async connectToHost(sessionId: string): Promise<void> {
    if (!this.peer?.open) throw new Error('Peer is not open');
    const hostId = `${HOST_ID_PREFIX}${sessionId}`;
    const conn = this.peer.connect(hostId, { reliable: true });
    // Attach handlers BEFORE waiting for open — fixes the legacy race condition.
    this.attachConnectionHandlers(conn);

    if (conn.open) {
      this.registerConnection(conn);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(
            'Connection timeout - Unable to reach the session host. The host may be offline or the network is blocking WebRTC.',
          ),
        );
      }, TIMING.connectionTimeout);

      conn.on('open', () => {
        clearTimeout(timeout);
        this.registerConnection(conn);
        resolve();
      });
      conn.on('error', (_err: PeerErrorLike) => {
        clearTimeout(timeout);
        reject(
          new Error(
            'Failed to connect to session - The host may be offline, the session ID is invalid, or firewall restrictions are blocking the connection.',
          ),
        );
      });
    });
  }

  // --- Connection handling --------------------------------------------------

  /**
   * Attach data/close/error handlers to a connection. Called exactly once per
   * connection — the legacy code called this twice on outgoing connections,
   * which duplicated every listener.
   */
  private attachConnectionHandlers(conn: DataConnection): void {
    conn.on('data', (raw: unknown) => {
      const msg = decode(raw);
      if (!msg) return;
      this.markSeen(conn.peer, /* healthy */ true);
      this.route(conn.peer, msg);
    });
    conn.on('close', () => this.dropConnection(conn.peer, /* allowReconnect */ true));
    conn.on('error', (err: PeerErrorLike) => {
      console.warn(`[transport] connection error from ${conn.peer}:`, err);
      this.markSeen(conn.peer, /* healthy */ false);
      // Don't drop here — PeerJS usually fires `close` right after `error`.
    });
  }

  /** Register an open connection (incoming or outgoing). */
  private registerConnection(conn: DataConnection): void {
    if (this.connections.has(conn.peer)) {
      // Duplicate — already connected. Close the new one.
      conn.close();
      return;
    }
    this.connections.set(conn.peer, conn);
    this.health.set(conn.peer, { healthy: true, lastSeen: Date.now(), consecutiveFailures: 0 });
    this.emit('peerConnected', conn.peer);

    // Host: tell the newcomer about the rest of the mesh so they can dial in.
    if (this.isHost) {
      const others = Array.from(this.connections.keys()).filter((id) => id !== conn.peer);
      void this.send(conn.peer, { type: 'peer_list', peers: others });
    }
  }

  private handleIncoming(conn: DataConnection): void {
    if (this.connections.has(conn.peer)) {
      conn.close();
      return;
    }
    this.attachConnectionHandlers(conn);
    if (conn.open) {
      this.registerConnection(conn);
      return;
    }
    // Wait for open, with a guard timeout in case it never fires.
    const openTimeout = setTimeout(() => {
      if (!this.connections.has(conn.peer)) conn.close();
    }, TIMING.incomingOpenTimeout);
    conn.on('open', () => {
      clearTimeout(openTimeout);
      this.registerConnection(conn);
    });
  }

  private dropConnection(peerId: string, allowReconnect: boolean): void {
    const existed = this.connections.delete(peerId);
    this.health.delete(peerId);
    if (!existed) return;
    this.emit('peerDisconnected', peerId);
    // Clients may attempt to re-dial the host if it dropped unexpectedly.
    if (allowReconnect && !this.isHost && peerId.startsWith(HOST_ID_PREFIX) && this.peer?.open) {
      void this.reconnectToHost(peerId, 0);
    }
  }

  // --- Message routing ------------------------------------------------------

  private route(peerId: string, msg: WireMessage): void {
    switch (msg.type) {
      case 'keepalive':
        return; // already marked seen above
      case 'ping':
        // Echo the sender's timestamp so they can compute RTT on the pong.
        void this.send(peerId, { type: 'pong', ts: msg.ts });
        return;
      case 'pong': {
        const h = this.health.get(peerId);
        if (h) {
          h.healthy = true;
          h.consecutiveFailures = 0;
        }
        if (typeof msg.ts === 'number') this.lastRtt = Date.now() - msg.ts;
        return;
      }
      case 'peer_list':
        if (!this.isHost) this.dialPeers(msg.peers);
        return;
      default:
        // Game-level message — forward to the session.
        if (isGameMessage(msg)) this.emit('message', peerId, msg);
    }
  }

  /**
   * Client: dial every peer the host told us about. Dials are staggered so the
   * ICE negotiation for many peers doesn't all hit at once, and any dial that
   * fails (or silently never opens) is retried with exponential backoff. The
   * previous implementation fired every dial in a tight loop and just logged +
   * gave up on failure — in larger meshes that left pairs permanently
   * disconnected for the session.
   */
  private dialPeers(peerIds: string[]): void {
    const targets = peerIds.filter(
      (id) => id !== this.peer?.id && !this.connections.has(id) && !this.pendingDials.has(id),
    );
    targets.forEach((id, i) => {
      this.pendingDials.add(id);
      // Stagger initial dials so ICE doesn't pile up for large meshes.
      setTimeout(() => this.dialWithRetry(id, 0), i * TIMING.meshDialStagger);
    });
  }

  /** Dial a single peer, retrying with exponential backoff on failure. */
  private dialWithRetry(peerId: string, attempt: number): void {
    // Bail if we connected via another path, tore down, or exhausted retries.
    if (!this.peer?.open || this.connections.has(peerId)) {
      this.pendingDials.delete(peerId);
      return;
    }
    if (attempt >= TIMING.meshDialMaxAttempts) {
      this.pendingDials.delete(peerId);
      console.warn(`[transport] gave up dialing ${peerId} after ${attempt} attempts`);
      return;
    }

    const conn = this.peer.connect(peerId, { reliable: true });
    if (!conn) {
      this.scheduleRedial(peerId, attempt);
      return;
    }
    this.attachConnectionHandlers(conn);

    // PeerJS occasionally fires neither 'open' nor 'error' — guard against the
    // dial orphaning forever by treating a silent stall as a failure.
    const orphan = setTimeout(() => {
      if (this.connections.has(peerId)) return;
      try {
        conn.close();
      } catch {
        // ignore
      }
      this.scheduleRedial(peerId, attempt);
    }, TIMING.meshDialTimeout);

    conn.on('open', () => {
      clearTimeout(orphan);
      this.pendingDials.delete(peerId);
      this.registerConnection(conn);
    });
    conn.on('error', (err: PeerErrorLike) => {
      clearTimeout(orphan);
      console.warn(
        `[transport] mesh dial to ${peerId} (attempt ${attempt + 1}) failed:`,
        err,
      );
      this.scheduleRedial(peerId, attempt);
    });
  }

  /** Schedule the next retry, respecting backoff + teardown. */
  private scheduleRedial(peerId: string, attempt: number): void {
    if (!this.peer?.open) {
      this.pendingDials.delete(peerId);
      return;
    }
    // Keep peerId in `pendingDials` during the backoff wait so a concurrent
    // `dialPeers` call can't start a duplicate dial.
    setTimeout(
      () => this.dialWithRetry(peerId, attempt + 1),
      TIMING.meshDialRetryBaseDelay * Math.pow(2, attempt),
    );
  }

  // --- Keepalive + health ---------------------------------------------------

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepalive = setInterval(() => this.sendKeepalive(), TIMING.keepaliveInterval);
    this.heartbeat = setInterval(() => this.probeHealth(), TIMING.healthCheckInterval);
  }

  private stopKeepalive(): void {
    if (this.keepalive) {
      clearInterval(this.keepalive);
      this.keepalive = null;
    }
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private sendKeepalive(): void {
    for (const [id, conn] of this.connections) {
      if (!conn.open) continue;
      try {
        conn.send(encode({ type: 'keepalive', ts: Date.now() }));
      } catch (err) {
        console.warn(`[transport] keepalive to ${id} failed:`, err);
        this.markSeen(id, false);
      }
    }
  }

  private probeHealth(): void {
    const now = Date.now();
    for (const [id, h] of this.health) {
      if (!h.healthy) continue;
      if (now - h.lastSeen <= TIMING.staleThreshold) continue;
      const conn = this.connections.get(id);
      if (!conn?.open) {
        this.dropConnection(id, true);
        continue;
      }
      try {
        conn.send(encode({ type: 'ping', ts: now }));
        h.healthy = false; // mark unhealthy until pong arrives
      } catch {
        this.dropConnection(id, true);
      }
    }
  }

  private markSeen(peerId: string, healthy: boolean): void {
    const h = this.health.get(peerId) ?? {
      healthy: true,
      lastSeen: Date.now(),
      consecutiveFailures: 0,
    };
    h.lastSeen = Date.now();
    if (healthy) {
      h.consecutiveFailures = 0;
      h.healthy = true;
    } else {
      h.consecutiveFailures++;
      if (h.consecutiveFailures >= 3) h.healthy = false;
    }
    this.health.set(peerId, h);
  }

  // --- Reconnect (client → host) -------------------------------------------

  private async reconnectToHost(hostPeerId: string, attempt: number): Promise<void> {
    if (attempt >= TIMING.reconnectMaxAttempts) {
      this.emit('reconnectionFailed', hostPeerId);
      return;
    }
    if (this.reconnecting) return;
    this.reconnecting = true;
    const delay = TIMING.reconnectBaseDelay * Math.pow(2, attempt);
    await sleep(delay);
    this.reconnecting = false;

    if (!this.peer?.open || this.connections.has(hostPeerId)) return;
    try {
      const conn = this.peer.connect(hostPeerId, { reliable: true });
      this.attachConnectionHandlers(conn);
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => {
          conn.close();
          reject(new Error('reconnect timeout'));
        }, TIMING.incomingOpenTimeout);
        conn.on('open', () => {
          clearTimeout(t);
          this.registerConnection(conn);
          resolve();
        });
        conn.on('error', (e) => {
          clearTimeout(t);
          reject(e);
        });
      });
      this.emit('reconnected', hostPeerId);
    } catch (err) {
      console.warn(`[transport] reconnect attempt ${attempt + 1} failed:`, err);
      await this.reconnectToHost(hostPeerId, attempt + 1);
    }
  }

  // --- Outbound send --------------------------------------------------------

  broadcast(message: OutboundGameMessage): void {
    const wire = encode(message);
    for (const [id, conn] of this.connections) {
      if (!conn.open) continue;
      try {
        conn.send(wire);
      } catch (err) {
        console.error(`[transport] broadcast to ${id} failed:`, err);
      }
    }
  }

  send(peerId: string, message: OutboundMessage): void {
    const conn = this.connections.get(peerId);
    if (!conn?.open) return;
    try {
      conn.send(encode(message));
    } catch (err) {
      console.error(`[transport] send to ${peerId} failed:`, err);
    }
  }

  // --- Teardown -------------------------------------------------------------

  disconnect(): void {
    this.stopKeepalive();
    for (const conn of this.connections.values()) {
      try {
        conn.close();
      } catch {
        // ignore
      }
    }
    this.connections.clear();
    this.health.clear();
    this.lastRtt = null;
    this.pendingDials.clear();
    this.cleanupPeer();
  }

  private cleanupPeer(): void {
    this.stopKeepalive();
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        // ignore
      }
      this.peer = null;
    }
  }

  // --- Introspection + error mapping ---------------------------------------

  getConnectionStatus(peerId: string): { connected: boolean; healthy: boolean } {
    const conn = this.connections.get(peerId);
    const h = this.health.get(peerId);
    if (!conn) return { connected: false, healthy: false };
    return { connected: conn.open, healthy: h?.healthy ?? true };
  }

  /**
   * Snapshot of mesh health for the connection monitor — replaces the old
   * third-party HTTP probe. Reads local state only, so it's free to call often.
   */
  getHealth(): { connected: number; healthy: number; lastRtt: number | null } {
    let healthy = 0;
    for (const h of this.health.values()) if (h.healthy) healthy++;
    return { connected: this.connections.size, healthy, lastRtt: this.lastRtt };
  }

  get size(): number {
    return this.connections.size;
  }

  /** Map raw PeerJS errors to actionable, user-facing text. */
  private friendlyError(err: PeerErrorLike): Error {
    const code = (err as PeerError<string>).type ?? err.message ?? 'unknown';
    const msg = typeof code === 'string' ? code : 'unknown';
    const map: Record<string, string> = {
      'peer-unavailable':
        'Session not found - The session may have ended, the host went offline, or the ID is incorrect.',
      'unavailable-id': 'Session not found - The host may be offline or the ID is incorrect.',
      network: 'Network error - Your internet connection was interrupted.',
      disconnected: 'Connection lost - The signaling server link dropped. Please refresh.',
      'browser-incompatible':
        'Browser not supported - Please use Chrome 60+, Firefox 55+, or Safari 11+.',
      'invalid-id': 'Invalid session - The session ID appears to be invalid.',
      'invalid-key': 'Invalid session - The session ID appears to be invalid.',
      'ssl-unavailable': 'Secure connection required - WebRTC needs HTTPS.',
      'server-error': 'Server error - The connection service is temporarily unavailable.',
      'socket-error': 'Connection lost - The signaling socket errored. Please refresh.',
      'socket-closed': 'Connection lost - The signaling socket closed. Please refresh.',
    };
    return new Error(map[msg] ?? `Connection failed: ${msg}. Please try refreshing the page.`);
  }
}
