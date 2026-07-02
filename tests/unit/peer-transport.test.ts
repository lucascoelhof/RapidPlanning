import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Controllable PeerJS fakes for testing PeerTransport without a real WebRTC
 * stack. Co-located via `vi.hoisted` so they're available inside the
 * `vi.mock('peerjs')` factory (which is hoisted above regular imports).
 *
 * Design:
 *   - FakePeer instances auto-register in a static registry keyed by id, so
 *     `connect(otherId)` can find the target synchronously.
 *   - Connections open synchronously when both ends are registered — this
 *     keeps tests deterministic without flushing microtasks.
 *   - All events are emitted via `_emit(...)` so tests can drive lifecycle.
 */
const Mock = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;

  class FakeDataConnection {
    peer: string;
    open = false;
    /** Once closed, a connection cannot reopen (mirrors real DataChannel). */
    closed = false;
    private handlers = new Map<string, Set<Handler>>();
    private partner: FakeDataConnection | null = null;
    /** Captures everything `send()` was called with, for assertions. */
    readonly sent: unknown[] = [];

    constructor(peerId: string) {
      this.peer = peerId;
    }

    on(event: string, fn: Handler): void {
      let set = this.handlers.get(event);
      if (!set) {
        set = new Set();
        this.handlers.set(event, set);
      }
      set.add(fn);
    }

    /** Sends `data` to the linked partner (fires their `data` handlers). */
    send(data: unknown): void {
      this.sent.push(data);
      if (this.partner?.open) this.partner._emit('data', data);
    }

    close(): void {
      this.closed = true;
      const wasOpen = this.open;
      this.open = false;
      if (wasOpen) this._emit('close');
      if (this.partner?.open) {
        this.partner.closed = true;
        this.partner.open = false;
        this.partner._emit('close');
      }
    }

    // --- test helpers ---
    _link(other: FakeDataConnection): void {
      this.partner = other;
      other.partner = this;
    }
    _open(): void {
      if (this.closed || this.open) return;
      this.open = true;
      this._emit('open');
    }
    _emit(event: string, ...args: unknown[]): void {
      this.handlers.get(event)?.forEach((fn) => fn(...args));
    }
  }

  class FakePeer {
    id: string;
    open = false;
    destroyed = false;
    private handlers = new Map<string, Set<Handler>>();
    static registry = new Map<string, FakePeer>();
    static created: FakePeer[] = [];

    constructor(idOrOpts?: unknown, _opts?: unknown) {
      this.id =
        typeof idOrOpts === 'string'
          ? idOrOpts
          : `auto-${FakePeer.created.length}-${Math.random().toString(36).slice(2, 8)}`;
      FakePeer.created.push(this);
      FakePeer.registry.set(this.id, this);
    }

    on(event: string, fn: Handler): void {
      let set = this.handlers.get(event);
      if (!set) {
        set = new Set();
        this.handlers.set(event, set);
      }
      set.add(fn);
    }

    /**
     * Dial another peer. If the target is registered, both ends open
     * synchronously and the target receives a `connection` event — mirroring
     * a successful WebRTC handshake.
     */
    connect(peerId: string, _opts?: unknown): FakeDataConnection {
      const outgoing = new FakeDataConnection(peerId);
      const target = FakePeer.registry.get(peerId);
      if (target) {
        const incoming = new FakeDataConnection(this.id);
        outgoing._link(incoming);
        // Target attaches its handlers first, THEN we open so it registers.
        target._emit('connection', incoming);
        outgoing._open();
        incoming._open();
      }
      return outgoing;
    }

    destroy(): void {
      this.destroyed = true;
      this.open = false;
      FakePeer.registry.delete(this.id);
    }

    // --- test helpers ---
    _open(): void {
      if (this.open) return;
      this.open = true;
      this._emit('open', this.id);
    }
    _emit(event: string, ...args: unknown[]): void {
      this.handlers.get(event)?.forEach((fn) => fn(...args));
    }
    _emitError(err: { type: string; message: string }): void {
      this._emit('error', err);
    }
  }

  return { FakePeer, FakeDataConnection };
});

vi.mock('peerjs', () => ({ Peer: Mock.FakePeer as unknown }));

import { PeerTransport } from '../../src/net/peer-transport';
import { HOST_ID_PREFIX, PROTOCOL_VERSION, TIMING } from '../../src/constants';
import type { GameMessage } from '../../src/net/protocol';

/** Resolve after one microtask flush — keeps `await` tests deterministic. */
const flush = () => new Promise<void>((r) => queueMicrotask(r));

beforeEach(() => {
  Mock.FakePeer.registry.clear();
  Mock.FakePeer.created.length = 0;
});

describe('PeerTransport — host creation', () => {
  it('registers as host-{sessionId} and emits "connected"', async () => {
    const t = new PeerTransport();
    const events: string[] = [];
    t.on('connected', (id: string) => events.push(`connected:${id}`));

    const p = t.createSession('123456789');
    // createSession constructs the host peer synchronously; open it.
    const hostPeer = Mock.FakePeer.created[0]!;
    expect(hostPeer.id).toBe(`${HOST_ID_PREFIX}123456789`);
    expect(t.isHost).toBe(true);

    hostPeer._open();
    await p;

    expect(events).toEqual([`connected:${HOST_ID_PREFIX}123456789`]);
    expect(t.peer?.open).toBe(true);
  });

  it('rejects when the peer fails to open within the timeout', async () => {
    vi.useFakeTimers();
    try {
      const t = new PeerTransport();
      const p = expect(t.createSession('111111111')).rejects.toThrow(/timeout/i);
      // Never open the peer — let the timeout fire.
      await vi.advanceTimersByTimeAsync(TIMING.connectionTimeout + 100);
      await p;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('PeerTransport — client join + mesh', () => {
  it('connects a client to a host and both register each other', async () => {
    const host = new PeerTransport();
    const client = new PeerTransport();

    // Bring up the host first.
    const hostP = host.createSession('222222222');
    Mock.FakePeer.created[0]!._open();
    await hostP;

    const hostPeers: string[] = [];
    host.on('peerConnected', (id: string) => hostPeers.push(id));

    // Now join from the client.
    const clientP = client.joinSession('222222222');
    const clientPeer = Mock.FakePeer.created.at(-1)!;
    const clientPeers: string[] = [];
    client.on('peerConnected', (id: string) => clientPeers.push(id));
    clientPeer._open();
    await clientP;
    await flush();

    // The client dialled host-222222222; both should have one connection.
    expect(clientPeers).toContain(`${HOST_ID_PREFIX}222222222`);
    expect(hostPeers).toContain(clientPeer.id);
    expect(host.size).toBe(1);
    expect(client.size).toBe(1);
  });

  it('host sends a peer_list to each newcomer (mesh formation)', async () => {
    const host = new PeerTransport();
    const hostP = host.createSession('333333333');
    Mock.FakePeer.created[0]!._open();
    await hostP;

    // First client joins.
    const c1 = new PeerTransport();
    const c1P = c1.joinSession('333333333');
    const c1Peer = Mock.FakePeer.created.at(-1)!;
    c1Peer._open();
    await c1P;
    await flush();

    // Capture what the host sends to the second client by inspecting its
    // incoming connection on the host side. Easier: capture what client 2
    // receives on the connection it dialled.
    const c2 = new PeerTransport();
    const c2P = c2.joinSession('333333333');
    const c2Peer = Mock.FakePeer.created.at(-1)!;
    c2Peer._open();
    await c2P;
    await flush();

    // Read what the HOST sent to client 2 — from the host's connection map.
    const hostConns = host['connections' as never] as unknown as Map<
      string,
      { sent: unknown[] }
    >;
    const sentToC2 = hostConns.get(c2Peer.id)!.sent;
    const peerList = sentToC2.find(
      (m) => (m as { type?: string }).type === 'peer_list',
    ) as { type: string; peers: string[] } | undefined;

    expect(peerList).toBeDefined();
    // The list should include client 1's id (everyone except the newcomer).
    expect(peerList!.peers).toContain(c1Peer.id);
  });

  it('rejects a duplicate incoming connection from the same peer', async () => {
    const host = new PeerTransport();
    const hostP = host.createSession('444444444');
    const hostPeer = Mock.FakePeer.created[0]!;
    hostPeer._open();
    await hostP;

    let connections = 0;
    host.on('peerConnected', () => connections++);

    // Simulate two incoming connections from the SAME peer id.
    const dupId = 'evil-duplicate';
    const conn1 = new Mock.FakeDataConnection(dupId);
    const conn2 = new Mock.FakeDataConnection(dupId);
    hostPeer._emit('connection', conn1);
    conn1._open();
    hostPeer._emit('connection', conn2);
    conn2._open();

    // Only the first should have been accepted; the second closed.
    expect(connections).toBe(1);
    expect(conn1.open).toBe(true);
    expect(conn2.open).toBe(false);
  });
});

describe('PeerTransport — message routing', () => {
  it('forwards game messages via the "message" event with version stamped', async () => {
    const host = new PeerTransport();
    const client = new PeerTransport();
    const hostP = host.createSession('555555555');
    Mock.FakePeer.created[0]!._open();
    await hostP;
    const clientP = client.joinSession('555555555');
    const clientPeer = Mock.FakePeer.created.at(-1)!;
    clientPeer._open();
    await clientP;
    await flush();

    const received: GameMessage[] = [];
    host.on('message', (_id: string, msg: GameMessage) => received.push(msg));

    // Client broadcasts a vote; host should receive it.
    client.broadcast({ type: 'vote', vote: '5' });
    await flush();

    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe('vote');
    expect((received[0] as { vote?: string }).vote).toBe('5');
  });

  it('keeps control messages (keepalive/ping/pong) internal — never surfaced', async () => {
    const host = new PeerTransport();
    const client = new PeerTransport();
    const hostP = host.createSession('666666666');
    Mock.FakePeer.created[0]!._open();
    await hostP;
    const clientP = client.joinSession('666666666');
    const clientPeer = Mock.FakePeer.created.at(-1)!;
    clientPeer._open();
    await clientP;
    await flush();

    const received: GameMessage[] = [];
    host.on('message', (_id: string, msg: GameMessage) => received.push(msg));

    // Manually push a ping onto the host's incoming connection.
    const hostConns = host['connections' as never] as unknown as Map<
      string,
      { _emit: (e: string, ...a: unknown[]) => void }
    >;
    const incoming = Array.from(hostConns.values())[0]!;
    incoming._emit('data', { v: PROTOCOL_VERSION, type: 'ping', ts: Date.now() });
    incoming._emit('data', { v: PROTOCOL_VERSION, type: 'keepalive', ts: Date.now() });

    expect(received).toHaveLength(0);
  });

  it('broadcast() delivers to every connected peer', async () => {
    const host = new PeerTransport();
    const hostP = host.createSession('777777777');
    Mock.FakePeer.created[0]!._open();
    await hostP;

    // Two clients join.
    const c1 = new PeerTransport();
    const c1P = c1.joinSession('777777777');
    Mock.FakePeer.created.at(-1)!._open();
    await c1P;
    const c2 = new PeerTransport();
    const c2P = c2.joinSession('777777777');
    Mock.FakePeer.created.at(-1)!._open();
    await c2P;
    await flush();

    const c1Seen: GameMessage[] = [];
    const c2Seen: GameMessage[] = [];
    c1.on('message', (_: string, m: GameMessage) => c1Seen.push(m));
    c2.on('message', (_: string, m: GameMessage) => c2Seen.push(m));

    host.broadcast({ type: 'clear_votes' });
    await flush();

    expect(c1Seen).toHaveLength(1);
    expect(c2Seen).toHaveLength(1);
    expect(c1Seen[0]!.type).toBe('clear_votes');
  });
});

describe('PeerTransport — disconnect + teardown', () => {
  it('emits peerDisconnected when a connection drops', async () => {
    const host = new PeerTransport();
    const client = new PeerTransport();
    const hostP = host.createSession('888888888');
    Mock.FakePeer.created[0]!._open();
    await hostP;
    const clientP = client.joinSession('888888888');
    const clientPeer = Mock.FakePeer.created.at(-1)!;
    clientPeer._open();
    await clientP;
    await flush();

    const dropped: string[] = [];
    host.on('peerDisconnected', (id: string) => dropped.push(id));

    // Close the client→host connection from the host side.
    const hostConns = host['connections' as never] as unknown as Map<
      string,
      { close(): void; peer: string }
    >;
    const conn = Array.from(hostConns.values())[0]!;
    conn.close();
    await flush();

    expect(dropped).toHaveLength(1);
    expect(host.size).toBe(0);
  });

  it('disconnect() destroys the peer and clears all connections', async () => {
    const t = new PeerTransport();
    const p = t.createSession('999999999');
    const peer = Mock.FakePeer.created[0]!;
    peer._open();
    await p;

    t.disconnect();
    expect(peer.destroyed).toBe(true);
    expect(t.peer).toBeNull();
    expect(t.size).toBe(0);
  });

  it('maps PeerJS errors to friendly user-facing text', async () => {
    const t = new PeerTransport();
    const p = t.createSession('101010101');
    const peer = Mock.FakePeer.created[0]!;
    const errors: Error[] = [];
    t.on('error', (e: Error) => errors.push(e));

    // Resolve open, then fire a post-open error (non-fatal, surfaced).
    peer._open();
    await p;
    peer._emitError({ type: 'peer-unavailable', message: 'x' });
    peer._emitError({ type: 'network', message: 'x' });

    expect(errors).toHaveLength(2);
    expect(errors[0]!.message).toMatch(/session not found/i);
    expect(errors[1]!.message).toMatch(/network error/i);
  });
});

describe('PeerTransport — mesh dial retry', () => {
  it('retries a dial that never opens, then gives up after max attempts', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const host = new PeerTransport();
      const hostP = host.createSession('121212121');
      Mock.FakePeer.created[0]!._open();
      await hostP;

      const client = new PeerTransport();
      const clientP = client.joinSession('121212121');
      const clientPeer = Mock.FakePeer.created.at(-1)!;
      clientPeer._open();
      await clientP;
      await flush();

      const connectSpy = vi.spyOn(clientPeer, 'connect');
      const pending = client['pendingDials' as never] as unknown as Set<string>;

      // Host hands the client a peer that doesn't exist on the network.
      (client as unknown as { dialPeers: (ids: string[]) => void }).dialPeers([
        'ghost-peer',
      ]);
      expect(pending.has('ghost-peer')).toBe(true);

      // Run the full retry chain to exhaustion (orphan timeouts + backoffs).
      await vi.advanceTimersByTimeAsync(50_000);

      // meshDialMaxAttempts dials, then give up and clear the pending slot.
      expect(connectSpy).toHaveBeenCalledTimes(TIMING.meshDialMaxAttempts);
      expect(pending.has('ghost-peer')).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/gave up dialing ghost-peer/),
      );
    } finally {
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('clears pending dials on disconnect so retries never fire after teardown', async () => {
    const host = new PeerTransport();
    const hostP = host.createSession('131313131');
    Mock.FakePeer.created[0]!._open();
    await hostP;

    const client = new PeerTransport();
    const clientP = client.joinSession('131313131');
    Mock.FakePeer.created.at(-1)!._open();
    await clientP;
    await flush();

    const pending = client['pendingDials' as never] as unknown as Set<string>;
    (client as unknown as { dialPeers: (ids: string[]) => void }).dialPeers([
      'ghost-peer',
    ]);
    expect(pending.has('ghost-peer')).toBe(true);

    client.disconnect();

    expect(pending.has('ghost-peer')).toBe(false);
    expect(client.peer).toBeNull();
  });
});
