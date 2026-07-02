/**
 * Controllable PeerJS fakes shared across transport + session tests. Keeps the
 * `vi.mock('peerjs')` factory in each test tiny via an async dynamic import.
 *
 * Design:
 *   - `FakePeer` instances auto-register in a static registry keyed by id, so
 *     `connect(otherId)` finds the target synchronously.
 *   - Connections open synchronously when both ends are registered — this keeps
 *     tests deterministic without flushing microtasks.
 *   - All events are emitted via `_emit(...)` so tests can drive lifecycle.
 *
 * Reset between tests with `FakePeer.registry.clear()` + `FakePeer.created.length = 0`.
 */
type Handler = (...args: unknown[]) => void;

export class FakeDataConnection {
  peer: string;
  open = false;
  /** Once closed, a connection cannot reopen (mirrors a real DataChannel). */
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
    const wasOpen = this.open;
    this.closed = true;
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

export class FakePeer {
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
   * a successful WebRTC handshake. An unregistered target yields an unopened
   * connection (used to simulate failed / orphaned dials).
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

/** Factory used inside `vi.mock('peerjs', async () => ...)`. */
export function createPeerMock(): { Peer: unknown } {
  return { Peer: FakePeer };
}
