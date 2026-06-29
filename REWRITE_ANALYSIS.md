# RapidPlanning — Codebase Analysis & Rewrite Plan

> Compiled by opencode to guide a full rewrite. Goal: preserve all working features and UX intent, fix structural problems, and modernize the stack.

---

## 1. Project Summary

**What it is:** A serverless, peer‑to‑peer "planning poker" / story‑point estimation web app for agile teams. No backend — all state syncs directly between browsers via WebRTC (PeerJS).

**Live deployment:** GitHub Pages at `https://lucascoelhof.github.io/RapidPlanning/`.

**Tech stack (current):**
- Vanilla JS (ES modules) — no framework
- Vite (config exists but the actual `build` script just `cp -r src dist/`)
- PeerJS 1.5.x (loaded via CDN script tag in `index.html`, also listed in `package.json`)
- CryptoJS 4.2.0 (CDN) — used only for MD5 hashing of emails for Gravatar
- GoatCounter analytics (CDN)
- Jest + jsdom for unit tests, Puppeteer for live e2e tests against GitHub Pages
- GitHub Actions deploy workflow (uses `peaceiris/actions-gh-pages`)

---

## 2. Functional Requirements (what the rewrite must keep)

### 2.1 Sessions
- **Create session:** host enters name/email → app generates a 9‑digit numeric session ID, registers a PeerJS peer with id `host-{sessionId}`, navigates to `?session={id}`.
- **Join session (two paths):**
  1. Home page form: user enters 9‑digit session ID + identity → connects to `host-{id}`.
  2. Direct URL `?session={id}` with no localStorage for that session → shows a "join prompt" that asks only for identity.
- **Session ID format:** exactly 9 digits (`/^\d{9}$/`), validated in router and join form.
- **Routing:** query‑param based (GitHub Pages can't do path routing). Params used: `?session=`, `?page=about`.

### 2.2 Players & identity
- **Identity input** accepts either a plain name OR an email.
  - If email: MD5‑hash it → build Gravatar avatar URL (`https://www.gravatar.com/avatar/{hash}?d=blank&s=120`), and fetch display name via Gravatar JSONP profile (`https://gravatar.com/{hash}.json?callback=...`).
  - If name only: no avatar, initials shown instead.
- **Initials fallback:** first letters of words, uppercased, max 2 chars.
- **Avatar image** has `onerror` handler that hides the `<img>` and reveals the initials `<span>`.
- Each player object shape: `{ id, name, email, avatar, vote, reaction, isLocal }`.

### 2.3 Voting
- **Vote cards (fixed set):** `['0', '½', '1', '2', '3', '5', '8', '13', '20', '40', '100', '?']` (modified Fibonacci).
- **Voting flow:**
  - Click a card → toggles selection (click same card again to deselect).
  - When a player votes, broadcast to all peers.
  - Other players see a `✓` (voted indicator), not the actual value.
  - **Auto‑reveal:** when every connected player has a non‑null vote, after a 500ms delay votes are shown automatically.
  - **Manual reveal:** "Show Votes" button.
  - **Clear votes:** "Clear Votes" button resets everyone's vote + hides stats.
  - Players can change their vote at any time (before or after reveal); stats recalculate.
- **Vote display states:**
  - Not voted: `-`
  - Voted, hidden: `✓`
  - Voted, revealed: actual value in a highlighted chip.

### 2.4 Statistics (shown after reveal)
- **Average** of numeric votes (½ parsed as 0.5; `?` excluded from average).
- **Vote breakdown** table: each distinct value → count, sorted by numeric value (`?` sorted last).
- **Consensus detection** with these categories (see `detectConsensus`):
  - `insufficient` — fewer than 2 votes.
  - `perfect` — all votes identical (highlight glow animation).
  - `close` — numeric range ≤ 2 (requires ≥80% numeric votes).
  - `divergent` — numeric range ≥ 10.
  - `majority` — >60% voted the same value.
  - `none` — fallback, "discussion needed".

### 2.5 Reactions
- Fixed set: `['👍', '👎', '😄', '😕', '😲', '🤔', '🔥', '❤️']`.
- Click to toggle on/off; only one reaction per player at a time.
- Reactions **auto‑expire after 5 seconds** (timers tracked per peer, synced across clients using the message timestamp so late receivers still expire correctly).
- Rendered as a small badge on the player's avatar.

### 2.6 Keyboard shortcuts (game page)
| Key | Action |
|-----|--------|
| `0‑9`, `½`, `?` | Type a vote; after a 0.5s quiet gap the buffer is resolved (exact match preferred, else nearest numeric option) |
| `+` / `=` | Next vote option |
| `-` / `_` | Previous vote option |
| `Enter` | Show votes |
| `Esc` | Clear votes |
- Disabled while focused in an input/textarea or when a modal backdrop is open.

### 2.7 Persistence (refresh recovery)
- localStorage key `rapidPlanningSessions` holds a map of `{ sessionId: { playerData, gameState, joinedAt, lastUpdated } }`, capped at 10 most recent sessions (LRU eviction).
- `gameState` snapshot: `{ selectedVote, selectedReaction, votesRevealed, localPlayerVote, timestamp }`.
- On reload of a `?session=` URL: if we have stored `playerData` for that session, skip the join prompt, restore UI state, and re‑establish the PeerJS connection in the background (`rejoinSessionBackground` with up to 2 retries, exponential backoff capped at 5s).
- On reload with no stored data: show the join prompt.

### 2.8 Connection resilience
- ICE servers: Google STUN ×3, Twilio STUN, Synology STUN.
- Connection timeout: 20s (raised for poor networks).
- **Keepalive** every 15s (`{type:'keepalive'}`), **health check** every 30s (stale threshold 60s, ping/pong handshake).
- **Reconnection** to host: up to 3 attempts, exponential backoff base 2s.
- Duplicate connection prevention (check `connections.has(peerPeerId)` before accepting).
- Mesh formation: host sends `peer_list` to each newcomer; newcomer then dials every other peer directly (full mesh).
- Browser online/offline events and `visibilitychange` handled by `ConnectionManager` (pauses heartbeat when hidden).
- Friendly error mapping for PeerJS error types (`peer-unavailable`, `network`, `browser-incompatible`, `ssl-unavailable`, `socket-error`, `timeout`, etc.).
- "Retry / Join as new user / Go home" modal when reconnection exhausts retries.

### 2.9 UI / UX
- **Pages:** Home (create + join forms), Join Prompt (identity only), Game (3‑column grid), About (Terms + tech info).
- **Game layout:** Left = players table; Center = voting stats + Clear/Show buttons; Right = vote cards + reactions.
- **Theme:** dark (default) and light, stored in `rapidPlanningTheme`. Settings dialog toggles theme + shows keyboard shortcuts modal.
- **Top‑right connection status indicator** (success/warning/error) shown only when there's an issue.
- **Connecting toast** (fixed top‑center spinner) during session create/join.
- Responsive: collapses to single column under 1024px; mobile tweaks under 768px.
- Footer with author link + Terms link on every page.
- Animated consensus "perfect" state (glow pulse).
- Favicon is an inline SVG lightning emoji ⚡.

### 2.10 Analytics (GoatCounter)
Events tracked: `room-created`, `host-joined`, `participant-joined`, `voting-round-started`, `vote-submitted`, `votes-revealed`, `room-left`. Events sent as synthetic paths `/event/{name}` with `event: true`.

### 2.11 Error handling
- Global `error` and `unhandledrejection` listeners in `ErrorHandler`.
- In‑memory + localStorage error log (`rapidPlanning_errorLog`, last 10).
- `safeAsync` / `safeSync` wrappers.
- Categorizes errors: network, peer, storage, permission, application, generic — each with a user‑friendly message + action (retry / refresh / auto_refresh / clear_data / dismiss).

---

## 3. Current Architecture

```
main.js
  └─ RapidPlanningApp (app.js)  ← coordinator, wires everything together
       ├─ Router (router.js)              — query‑param routing, emits route:* events
       ├─ PeerManager (peer-manager.js)   — PeerJS lifecycle, keepalive, mesh, reconnect
       ├─ GameManager (game-manager.js)   — players map, votes, reactions, consensus math
       ├─ ConnectionManager (services)    — online/offline, fetch‑based health probe
       ├─ UIManager (ui-manager.js)       — all DOM/HTML, modals, keyboard, theme
       ├─ ErrorHandler (services)         — global error boundary
       └─ analytics (services, singleton)
```

**Communication:** every class has its own copy of a tiny `on()/emit()` event emitter. App.js subscribes to all of them and bridges events between managers (e.g. `gameManager.on('broadcast')` → `peerManager.broadcast`).

**Message protocol (PeerJS data):**
- `keepalive`, `ping`, `pong` — connection health (consumed in PeerManager, not forwarded).
- `peer_list` — host → newcomer, list of other peer ids to dial.
- `connection_update` — host broadcasts full connection list.
- `player_data` — full player object (sent on join and on `request_player_data`).
- `request_player_data` — ask a peer for its player object.
- `player_disconnected` — broadcast so all clients drop the leaver.
- `vote` — `{type:'vote', vote}`.
- `clear_votes`.
- `show_votes` — `{type:'show_votes', allVotes: {peerId: {name, vote}}}` (syncs missing vote data).
- `reaction` — `{type:'reaction', reaction, timestamp}` (timestamp used for expiry sync).

---

## 4. Problems with the Current Code (rewrite opportunities)

This is where we beat the previous implementation. Grouped by severity.

### 4.1 Correctness / security bugs (must fix)
1. **XSS via player name.** `renderPlayers()` injects `player.name` directly into `innerHTML` (ui-manager.js:1028). A malicious peer can send `<img src=x onerror=...>` as their name and execute JS in every other client. **Fix:** escape all peer‑supplied strings, or build DOM via `createElement` / `textContent`.
2. **Stale puppeteer selectors.** Tests assert `.player-card` and `.player-vote` but the current HTML uses `.player-row` / `.player-vote-value` / `.player-voted-indicator`. The comprehensive e2e suite is effectively broken. **Fix:** keep selectors and tests in sync; consider data‑attributes.
3. **Shadowed variable.** In `game-manager.js:171` (`for (const [peerId, voteData] ...`) and `app.js` similar loops, `peerId` shadows the outer `peerId` parameter — confusing and bug‑prone.
4. **Double handler registration.** `joinSession` calls `setupConnectionHandlers(hostConnection)` *and* `handleOutgoingConnection` later calls it again → duplicate `data`/`close` listeners → double processing of every message.
5. **Event listener leak.** `ConnectionManager.destroy()` calls `removeEventListener` with newly‑bound functions (`this.handleOnlineStatusChange` is not the same reference that was added) → listeners are never actually removed.
6. **`analytics.trackEvent` infinite queue.** If GoatCounter never loads, it `setTimeout`s itself forever every 500ms per pending event.
7. **Version drift.** `index.html` loads `peerjs@1.5.2` from CDN but `package.json` declares `^1.5.5`. The npm copy is never actually used by the app.
8. **Build inconsistency.** `vite.config.js` exists with `base: '/RapidPlanning/'`, but `npm run build` is `mkdir -p dist && cp -r src dist/ && cp index.html dist/` — Vite is never invoked. Assets aren't fingerprinted, no bundling, no tree‑shaking.
9. **`beforeunload` cleanup** runs but async PeerJS teardown may not complete before the page unloads.

### 4.2 Structural problems
1. **Duplicated event emitter.** Identical `on/emit` block copy‑pasted into 5 classes. Only `ConnectionManager` has `off()` — everywhere else listeners can never be removed (memory growth on re‑join).
2. **God object.** `UIManager` is ~1500 lines mixing: page templates, event binding, keyboard input, theme, modals, error toasts, Gravatar JSONP, stats rendering. Split into view templates, controllers, and small utilities.
3. **HTML‑in‑JS.** All markup lives in template‑literal methods. No escaping, no reuse, hard to diff. Use a real templating approach (lit‑html, htm, or at least `<template>` elements + a tiny render helper).
4. **Inline styles everywhere.** `showConnecting`, `showConnectionError`, `showGameError`, reaction badge, etc. set `style.cssText` directly instead of using CSS classes — bypasses theming.
5. **Magic delays.** `100`, `500`, `1500`, `3000`, `5000` ms timeouts sprinkled around `app.js` and `peer-manager.js` to paper over race conditions. Replace with events / promises.
6. **Storage logic in app.js.** `saveSessionData` / `getSessionData` / `clearSessionData` / `persistCurrentState` / `restoreGameState` all live on the coordinator. Extract a `SessionStore` service.
7. **Tight coupling.** `UIManager` takes `gameManager` in its constructor and calls `gameManager.getVotingSummary()` directly during render. Invert via events or a passed‑in read model.
8. **Vote card list defined in 3 places** (GameManager, UIManager keyboard `voteOptions`, `renderVoteCards`). Single source of truth needed.
9. **No state machine.** Session lifecycle (idle → connecting → connected → reconnecting → error → left) is implicit across many boolean flags (`peer.open`, `connectionsPaused`, `isHost`, `votesRevealed`). Model it explicitly.
10. **Full mesh doesn't scale.** With N clients each peer dials N‑1 others → O(N²) connections. Practical limit ~50. Consider star topology through host with relay, or document the limit clearly.

### 4.3 Testing problems
1. e2e tests run against **live GitHub Pages** — slow (10‑min timeouts), flaky, can't run offline, and require a push to test changes.
2. Puppeteer tests reference selectors that no longer exist → false negatives.
3. Unit coverage is thin (only consensus, keyboard nav, connection manager, error handler). No tests for PeerManager message handling, UIManager rendering, router, or persistence.
4. `jest.config.js` `globals` overrides `window`/`document`/`localStorage` with empty objects, fighting jsdom.
5. No CI for unit tests (only the deploy workflow runs).

### 4.4 Dev experience
1. No linting / formatting config (no ESLint, no Prettier).
2. No type checking (no JSDoc, no TS).
3. `main.js` sets `window.app = app` for debugging — fine, but worth keeping behind a dev flag.
4. README says `npm run dev` starts Vite but `dev` script doesn't exist in `package.json`.

---

## 5. Rewrite Plan

### 5.1 Recommended stack
Pick **one** of the following depending on how ambitious we want to be:

| Option | Stack | Trade‑off |
|--------|-------|-----------|
| **A. Lean (recommended)** | Vanilla JS + Vite (real build) + lit‑html/htm + TypeScript via JSDoc | Stays close to current spirit; small bundle; minimal new concepts |
| **B. Modern** | TypeScript + Vite + Preact (or Solid) + Tailwind | Component model, types, fast; ~same bundle size as current if careful |
| **C. Framework** | TypeScript + Vite + SvelteKit (static adapter) | Best DX; routing/sessions built‑in; slightly more tooling |

All three keep PeerJS as the transport (the P2P architecture is the product's whole point).

### 5.2 Proposed module layout (Option A/B)
```
src/
  main.ts                     — bootstrap
  app/
    session.ts                — Session class: state machine + orchestrator
    types.ts                  — Player, Vote, Reaction, Message, SessionState
  net/
    peer-transport.ts         — wraps PeerJS, pure send/receive, no game logic
    protocol.ts               — message type defs + (de)serialization + versioning
    mesh.ts                   — topology strategy (mesh now; star later)
    reconnect.ts              — backoff policy
  game/
    store.ts                  — single source of truth (observable store)
    voting.ts                 — card set, vote math, average
    consensus.ts              — consensus detection (pure functions, easy to test)
    reactions.ts              — reaction timers
  ui/
    pages/{home,join,game,about}.ts
    components/{players-table,vote-cards,reactions,stats,modal,toast}.ts
    theme.ts
    keyboard.ts
    dom.ts                    — escapeHtml, h(), tiny render helpers
  services/
    session-store.ts          — localStorage wrapper (replaces app.js blob)
    gravatar.ts               — avatar URL + profile fetch
    analytics.ts
    error-boundary.ts
    connection-monitor.ts     — online/offline/health
  router.ts                   — query‑param router
  constants.ts                — VOTE_CARDS, REACTIONS, ICE_SERVERS, timeouts
```

### 5.3 Key design principles for the rewrite
1. **Pure functions first.** Consensus math, vote parsing, initials, hash building — all pure and unit‑tested without DOM.
2. **One observable store.** Game state lives in a single store; UI subscribes and re‑renders. No scattered `selectedVote`/`votesRevealed` flags on the UI layer.
3. **Protocol versioning.** Tag every message with `v: 1` so we can evolve without breaking deployed clients.
4. **Untrusted input.** Every value that came from the network is validated + sanitized before it touches the DOM. Use `textContent` for names.
5. **Explicit state machine** for session: `init → connecting → connected → reconnecting → offline → error → destroyed`.
6. **Event emitter as a real utility** (`tiny-emitter` style) with `off()` and `once()` everywhere; one shared implementation.
7. **No raw timeouts for correctness.** Use promises that resolve on events (connection opened, player joined). Keep delays only where they're a UX choice (500ms reveal suspense, 5s reaction expiry).
8. **Real Vite build.** Bundle + hash assets, single JS output, tree‑shake the CDN deps (import PeerJS from npm, not a global script tag).
9. **Escape hatches for testing.** Inject a fake `Peer` / `Connection` in unit tests; run e2e against a local Vite preview server instead of (or before) live GitHub Pages.

### 5.4 Migration order (suggested)
1. Stand up the new build (Vite + TS or JSDoc + ESLint + Prettier). Get "hello world" deploying to GH Pages.
2. Port constants + pure logic (vote cards, consensus, initials, gravatar hash) with full unit tests.
3. Build the network layer (`peer-transport` + `protocol`) with a fake‑peer test harness.
4. Build the store + session state machine; wire net → store → UI one direction at a time.
5. Port UI pages as components, keeping the exact current look (reuse `style.css`).
6. Add persistence (`session-store`) and the refresh/rejoin flow.
7. Port keyboard shortcuts, theme, settings, modals.
8. Port analytics + error boundary.
9. Replace the broken Puppeteer suite with: (a) Vitest/Jest unit tests, (b) Playwright against local preview for the multiplayer flows.
10. Cut over on `main`; keep the old `src-legacy/` for one release if we want a rollback.

---

## 6. Future feature ideas (out of scope for v1 rewrite, but design for them)
- Spectator/observer role (no vote).
- Per‑round story/task title + description, visible in‑session.
- Round timer (host configurable).
- Session history / export to CSV/JSON.
- QR code for session URL on the game page.
- Host controls: lock voting, kick, force reveal.
- Custom card decks (T‑shirt sizes, hours, etc.).
- Persistent profile (remember name/email across sessions).
- Optional relay/signaling fallback for users behind strict NATs.

---

## 7. Decisions (locked in)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Stack** | **TypeScript + Vite + lit-html** | Closest to the vanilla spirit; adds types and a tiny reactive templating layer; smallest bundle; minimal new concepts. |
| **Topology** | **Keep full mesh** | Matches current behavior and the documented ~50-user limit. Simpler protocol; no host-relay failure modes. |
| **Rollout** | **Clean cutover, no interop** | Old clients do not need to coexist with new ones. Protocol is versioned from v1 with no compatibility shims. |
| Deploy target | GitHub Pages (unchanged) | — |
| Session ID format | 9-digit numeric (unchanged) | Keeps existing share-URL expectations; revisit later. |
| Analytics | GoatCounter (unchanged) | Already wired and privacy-friendly. |

### Build/lint baseline for the rewrite
- Real Vite build (bundle + hash assets, single JS output, tree-shake).
- PeerJS imported from npm (remove CDN `<script>` tag).
- ESLint + Prettier configured from day one.
- TypeScript in strict mode.
- Unit tests: Vitest (jsdom or happy-dom). E2E: Playwright against `vite preview` instead of live GH Pages.

---

## 8. File inventory (current)

| Path | Lines | Role |
|------|-------|------|
| `index.html` | 20 | CDN scripts + `#app` mount |
| `src/main.js` | 7 | Bootstrap |
| `src/app.js` | 527 | Coordinator + localStorage + state restore |
| `src/router.js` | 63 | Query‑param router |
| `src/peer-manager.js` | 808 | PeerJS, mesh, keepalive, reconnect |
| `src/game-manager.js` | 519 | Players, votes, reactions, consensus |
| `src/ui-manager.js` | 1519 | All DOM/templates/keyboard/theme/modals |
| `src/style.css` | 1489 | Dark/light themes, layout, components |
| `src/services/analytics.js` | 93 | GoatCounter wrapper (singleton) |
| `src/services/connection-manager.js` | 251 | Online/offline + fetch health probe |
| `src/services/error-handler.js` | 263 | Global error boundary + safe wrappers |
| `tests/puppeteer-comprehensive.test.js` | 517 | Live e2e (3 browsers) — selectors stale |
| `tests/unit/*` | 4 files | consensus, keyboard, connection, error |
| `.github/workflows/deploy.yml` | 34 | Build + gh‑pages deploy |

**Total source:** ~5,400 lines (incl. CSS); ~3,900 lines of JS.
