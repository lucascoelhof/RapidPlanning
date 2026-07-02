import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock PeerJS via the shared fake. The async factory lets us reuse the classes
// in the test without inlining the whole mock.
vi.mock('peerjs', async () => {
  const mod = await import('./helpers/peerjs-mock');
  return mod.createPeerMock();
});

import { Session } from '../../src/app/session';
import { FakePeer } from './helpers/peerjs-mock';
import type { PlayerIdentity } from '../../src/app/types';

const HOST_IDENTITY: PlayerIdentity = { name: 'Host', email: null, avatar: null };
const CLIENT_IDENTITY: PlayerIdentity = { name: 'Client', email: null, avatar: null };

/** Resolve after one microtask flush — keeps `await` tests deterministic. */
const flush = (): Promise<void> => new Promise((r) => queueMicrotask(r));

/** Bring up a host session and resolve once its peer is open + registered. */
async function startHost(): Promise<Session> {
  const host = new Session();
  const p = host.createSession(HOST_IDENTITY);
  FakePeer.created[0]!._open();
  await p;
  return host;
}

/** Join a client to the given session id; opens its peer synchronously. */
async function startClient(sessionId: string): Promise<Session> {
  const client = new Session();
  const p = client.joinSession(sessionId, CLIENT_IDENTITY);
  FakePeer.created.at(-1)!._open();
  await p;
  await flush();
  return client;
}

beforeEach(() => {
  FakePeer.registry.clear();
  FakePeer.created.length = 0;
  // happy-dom doesn't provide localStorage out of the box; give SessionStore a
  // backing store so its fail-open logging doesn't spew through the test output.
  const backing: Record<string, string> = {};
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => backing[k] ?? null,
      setItem: (k: string, v: string) => {
        backing[k] = v;
      },
      removeItem: (k: string) => {
        delete backing[k];
      },
      clear: () => {
        for (const k of Object.keys(backing)) delete backing[k];
      },
    },
    writable: true,
    configurable: true,
  });
});

describe('Session — coordinator wiring', () => {
  it('host and client both end up in each other’s player list', async () => {
    const host = await startHost();
    const sessionId = host.store.getSnapshot().sessionId!;
    const client = await startClient(sessionId);

    const names = (s: Session): string[] =>
      s.store.getSnapshot().players.map((p) => p.name).sort();

    expect(names(host)).toEqual(['Client', 'Host']);
    expect(names(client)).toEqual(['Client', 'Host']);

    host.destroy();
    client.destroy();
  });

  it('a client vote propagates to the host store', async () => {
    const host = await startHost();
    const sessionId = host.store.getSnapshot().sessionId!;
    const client = await startClient(sessionId);

    client.castVote('5');
    await flush();

    const clientPeerId = client.store.getSnapshot().localPlayer!.id;
    const hostEntry = host.store
      .getSnapshot()
      .players.find((p) => p.id === clientPeerId);
    expect(hostEntry?.vote).toBe('5');

    host.destroy();
    client.destroy();
  });

  it('removes a player from the host store when the client disconnects', async () => {
    const host = await startHost();
    const sessionId = host.store.getSnapshot().sessionId!;
    const client = await startClient(sessionId);

    const clientPeerId = client.store.getSnapshot().localPlayer!.id;
    expect(
      host.store.getSnapshot().players.some((p) => p.id === clientPeerId),
    ).toBe(true);

    client.cleanup();
    await flush();

    expect(
      host.store.getSnapshot().players.some((p) => p.id === clientPeerId),
    ).toBe(false);

    host.destroy();
    client.destroy();
  });
});
