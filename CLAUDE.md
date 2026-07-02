# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RapidPlanning is a serverless, peer-to-peer planning estimation web application. No backend — all state syncs directly between browsers via WebRTC (PeerJS) in a full-mesh topology. Built for agile teams running story-point estimation.

**Live deployment:** GitHub Pages at `https://lucascoelhof.github.io/RapidPlanning/`.

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Build:** Vite 7 (real bundled build — tree-shaken, asset-hashed output)
- **Templating:** lit-html (no web components, just render functions)
- **P2P transport:** PeerJS (imported from npm, **not** a CDN script tag)
- **Avatar hashing:** blueimp-md5 (tiny MD5 for Gravatar)
- **Analytics:** GoatCounter (privacy-friendly, loaded async via CDN, fails open)
- **Unit tests:** Vitest + happy-dom
- **E2E tests:** Playwright against local `vite preview`
- **Deploy:** GitHub Pages via `peaceiris/actions-gh-pages@v4`

## Development Commands

```bash
npm run dev              # Vite dev server (HMR)
npm run build            # tsc --noEmit + vite build (outputs dist/)
npm run preview          # Serve the production build locally (used by e2e)
npm run typecheck        # tsc --noEmit (typecheck only)
npm run lint             # ESLint on src + tests + configs
npm run lint:fix         # ESLint with --fix
npm run format           # Prettier write
npm run test             # Vitest unit tests (run once)
npm run test:watch       # Vitest in watch mode
npm run test:coverage    # Vitest with v8 coverage
npm run test:e2e         # Playwright (boots vite preview on :4173)
npm run deploy           # Build + gh-pages publish
```

**Before pushing:** run `npm run typecheck && npm run lint && npm run test`. The GitHub Actions deploy workflow runs all three plus the build, and fails the deploy on any error.

## Architecture

The app is organized as a clean layering: **pure logic → network → store → coordinator → UI**. Each layer depends only on the layer(s) below it.

```
src/
├── main.ts                       # Bootstrap: wires Session ↔ UIController
├── constants.ts                  # Single source of truth (vote cards, reactions, timings, ICE servers)
├── router.ts                     # Query-param router (?session=, ?page=about)
├── style.css                     # Theme variables + all component styles (reused from v1)
├── app/
│   ├── session.ts                # Coordinator: wires transport ↔ store ↔ services, handles intents
│   └── types.ts                  # Player, GameStateSnapshot, SessionPhase, VotingSummary, etc.
├── game/                         # Pure game logic (no DOM, no network — fully unit-testable)
│   ├── store.ts                  # Single source of truth; emits change events
│   ├── consensus.ts              # detectConsensus + buildVotingSummary (pure)
│   └── voting.ts                 # voteToNumber, averageVote, tallyVotes, resolveKeyboardBuffer (pure)
├── net/                          # PeerJS-backed transport layer
│   ├── protocol.ts               # Versioned wire format; encode/decode; control vs game messages
│   └── peer-transport.ts         # Peer lifecycle, mesh formation, keepalive, reconnect
├── services/                     # Side-effectful helpers
│   ├── analytics.ts              # GoatCounter wrapper (bounded polling, never infinite-queues)
│   ├── connection-monitor.ts     # Online/offline + RTT probes; bound handlers (no listener leak)
│   ├── error-handler.ts          # Global error boundary; categorises errors into user notices
│   ├── gravatar.ts               # MD5 hash + JSONP profile fetch with hard timeout
│   └── session-store.ts          # localStorage wrapper (LRU eviction, fails open on quota errors)
├── ui/                           # lit-html rendering
│   ├── controller.ts             # UIController: subscribes to Session, renders the right page
│   ├── keyboard.ts               # KeyboardController (game-page shortcuts)
│   ├── theme.ts                  # ThemeController (dark/light via data-theme attribute)
│   ├── styles-extras.css         # Supplementary styles for new components (toasts, modals)
│   ├── components/               # Reusable presentational pieces
│   │   ├── footer.ts, players-table.ts, stats.ts, toast.ts, vote-cards.ts
│   └── pages/                    # One template per route
│       ├── home.ts, join-prompt.ts, about.ts, game.ts
└── utils/
    ├── emitter.ts                # Shared typed Emitter (on/off/once/once — replaces v1 duplication)
    └── dom.ts                    # escapeHtml, initials, generateSessionId, sleep
```

### Data Flow

```
UI event ─► UIController ─► Session.<intent> ─► GameStore.<mutation> + PeerTransport.broadcast
                                                          │
                                                          └─► emit('change', snapshot) ─► UIController re-renders

PeerTransport message ─► protocol.decode (validated) ─► Session.handleMessage ─► GameStore.<mutation>
```

**Key invariant:** the `GameStore` is the single source of truth. No other module holds `selectedVote`, `votesRevealed`, or the players map. The UI is a pure function of `store.getSnapshot()`.

### Session Lifecycle (`SessionPhase`)

`idle → connecting → connected → reconnecting → offline → error → destroyed`

The phase drives the connecting spinner and status banner. See `src/app/session.ts`.

### Wire Protocol

Every message is tagged with `v: PROTOCOL_VERSION` (currently 1) — see `src/net/protocol.ts`. Two categories:

- **Control** (consumed inside `PeerTransport`, never surfaced): `keepalive`, `ping`, `pong`, `peer_list`
- **Game** (forwarded to the session via `transport.on('message')`): `player_data`, `request_player_data`, `player_disconnected`, `vote`, `clear_votes`, `show_votes`, `reaction`

`protocol.decode()` validates version + type at the boundary; anything malformed is silently dropped. **All peer-supplied strings must be treated as untrusted** — lit-html auto-escapes text interpolations, and `escapeHtml` is available for any other insertion point.

### Mesh Topology

Full mesh (matches v1). The host registers `host-{sessionId}`; each newcomer receives a `peer_list` from the host and dials every listed peer directly. Practical cap ~50 peers. Client→host drops trigger bounded exponential-backoff reconnection (see `TIMING` in `constants.ts`).

## Key Conventions

1. **One source of truth.** Vote cards, reactions, timings, ICE servers, storage keys — all in `src/constants.ts`. Never hard-code these elsewhere.
2. **Pure logic is DOM/network-free.** `game/consensus.ts`, `game/voting.ts` are pure functions — keep them that way for easy unit testing.
3. **Untrusted input stops at the boundary.** `protocol.decode` validates the wire; `escapeHtml` sanitizes for any non-lit-html insertion. Never trust `player.name` / `player.email` / `player.avatar` from the network.
4. **Events use the shared `Emitter`.** `src/utils/emitter.ts` provides `on`/`once`/`off`/`emit` with type-safe payloads. The v1 codebase copy-pasted an event system into every class with no `off()` — that's fixed here. `on()` returns an unsubscribe function; use it for teardown.
5. **Timing constants are centralized.** Use `TIMING.*` from `constants.ts` — no magic `setTimeout(_, 1500)` values scattered in code.
6. **localStorage access goes through `SessionStore`.** It fails open on quota/corruption and enforces the LRU cap.
7. **No inline `style.cssText`.** New components get classes in `ui/styles-extras.css`; reuse the theme variables from `style.css`.

## Testing Strategy

- **Unit tests** (`tests/unit/*.test.ts`, Vitest + happy-dom): cover the pure logic — voting math, consensus detection, the emitter, dom helpers, session-store. Fast (<1s), run in CI.
- **E2E tests** (`tests/e2e/*.spec.ts`, Playwright): boot `vite preview` and drive the real UI. The smoke spec locks in the happy path; multiplayer specs can dial through the PeerJS cloud or a local PeerServer.
- **Type-check + lint gate the build.** `npm run build` runs `tsc --noEmit` first; CI runs `typecheck`, `lint`, `test`, then `build`.

## Deploy Notes

- **GitHub Pages base path:** `vite.config.ts` sets `base: '/RapidPlanning/'`. The dev server ignores `base`, so local dev is unaffected.
- **Routing is query-param based** because GitHub Pages serves a single static `index.html` — paths like `/about` would 404. Use `?page=about` and `?session=123456789`.
- The deploy workflow (`.github/workflows/deploy.yml`) runs the full gate (typecheck + lint + test + build) before publishing to the `gh-pages` branch. It triggers on push to `master` (the repo's default branch). GitHub Pages must be configured to serve from the `gh-pages` branch, **not** the `master` root — otherwise the raw unbuilt source is served and asset paths 404.

## Legacy Reference

The pre-rewrite vanilla-JS source is preserved under `src-legacy/` for reference during the transition. It is not part of the build. The full rationale for the rewrite (bugs fixed, decisions, migration plan) is in `REWRITE_ANALYSIS.md`.

## Critical Files for Debugging

- **`src/net/peer-transport.ts`** — connection establishment, mesh, keepalive, reconnect, friendly error mapping
- **`src/game/store.ts`** — all game state mutations and the auto-reveal/reaction-expiry timers
- **`src/app/session.ts`** — the coordinator wiring transport events to store mutations
- **`src/net/protocol.ts`** — wire format; bump `PROTOCOL_VERSION` on breaking changes
- **`src/constants.ts`** — every tunable (vote cards, reactions, timeouts, ICE servers)
- **`src/ui/controller.ts`** — page routing + render entry point
