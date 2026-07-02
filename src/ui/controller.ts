import { render } from 'lit-html';
import type { Session } from '../app/session';
import type { Route } from '../router';
import type { StoreSnapshot } from '../game/store';
import { theme } from './theme';
import { KeyboardController } from './keyboard';
import { homePageView } from './pages/home';
import { joinPromptView } from './pages/join-prompt';
import { aboutPageView } from './pages/about';
import { gamePageView } from './pages/game';
import {
  showToast,
  showConnecting,
  hideConnecting,
  showConnectionError,
  hideConnectionError,
  showSettings,
} from './components/toast';
import { buildIdentity } from '../services/gravatar';
import { VOTE_CARDS, type VoteValue, type Reaction } from '../constants';
import { querySelectorOrThrow } from '../utils/dom';

/**
 * The UI controller. Subscribes to the Session (router, store, notices) and
 * re-renders the right page via lit-html. Owns the keyboard controller and
 * theme.
 *
 * Replaces the legacy 1,500-line UIManager. The big difference: there is no
 * HTML-in-JS template-literal spaghetti, no inline `style.cssText`, and no
 * state duplication — the store snapshot is the single render input.
 */
export class UIController {
  private currentRoute: Route = { name: 'home' };
  private keyboard: KeyboardController;
  /** Whether the connecting spinner is currently shown. */
  private connecting = false;
  /** Guard against double-init (HMR, re-mount) doubling subscriptions. */
  private initialized = false;
  /** Unsubscribe handles for every subscription made in `init()`. */
  private readonly unsubs: Array<() => void> = [];
  /** Coalesces bursts of store changes into one render per animation frame. */
  private renderScheduled = false;

  constructor(private readonly session: Session) {
    // Keyboard handlers delegate to session intents.
    this.keyboard = new KeyboardController({
      onVote: (v) => session.castVote(v),
      onShowVotes: () => session.showVotes(),
      onClearVotes: () => session.clearVotes(),
      onNavigate: (dir) => this.navigateVote(dir),
    });
  }

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    theme.init();
    this.ensureStatusHost();

    this.unsubs.push(this.session.router.on('route', (route) => this.onRoute(route)));
    // One merged store subscription: update the spinner eagerly, then batch the
    // DOM render into a single frame so a join burst (many player_data updates)
    // doesn't trigger N full re-renders.
    this.unsubs.push(
      this.session.store.on('change', (snap) => {
        this.updateSpinner(snap);
        this.scheduleRender();
      }),
    );
    this.unsubs.push(this.session.on('notice', (n) => showToast(n.message, n.kind)));
    this.unsubs.push(this.session.on('statusMessage', (msg) => this.renderStatusBanner(msg)));
    this.unsubs.push(this.session.on('connectionError', (opts) => showConnectionError(opts)));
    this.unsubs.push(this.session.transport.on('reconnected', () => hideConnectionError()));
  }

  /** Tear down every subscription + injected DOM. Safe to call once. */
  destroy(): void {
    this.keyboard.detach();
    for (const off of this.unsubs) {
      try {
        off();
      } catch {
        // ignore — a transport/session already torn down is fine
      }
    }
    this.unsubs.length = 0;
    if (this.statusEl?.parentElement) {
      this.statusEl.parentElement.removeChild(this.statusEl);
    }
    this.statusEl = null;
  }

  /** Coalesce multiple store changes into a single render per frame. */
  private scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    const run = (): void => {
      this.renderScheduled = false;
      this.render();
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(run);
    } else {
      queueMicrotask(run);
    }
  }

  private updateSpinner(snap: StoreSnapshot): void {
    const connecting = snap.phase === 'connecting' || snap.phase === 'reconnecting';
    if (connecting && !this.connecting) {
      this.connecting = true;
      showConnecting(snap.phase === 'connecting' ? 'Connecting...' : 'Reconnecting...');
    } else if (!connecting && this.connecting) {
      this.connecting = false;
      hideConnecting();
    }
  }

  // --- Routing --------------------------------------------------------------

  private onRoute(route: Route): void {
    this.currentRoute = route;
    // Keyboard only matters on the game page.
    if (route.name === 'session') this.keyboard.attach();
    else this.keyboard.detach();
    this.render();
  }

  // --- Rendering ------------------------------------------------------------

  private render(): void {
    const container = querySelectorOrThrow('#app');
    switch (this.currentRoute.name) {
      case 'home':
        render(this.renderHome(), container);
        break;
      case 'about':
        render(this.renderAbout(), container);
        break;
      case 'session':
        render(this.renderSession(this.currentRoute.sessionId), container);
        break;
    }
  }

  private renderHome(): unknown {
    return homePageView({
      onCreate: (raw) => void this.handleCreate(raw),
      onJoin: (sessionId, raw) => void this.handleJoin(sessionId, raw),
      onNavigateAbout: () => this.session.router.navigate({ name: 'about' }),
    });
  }

  private renderAbout(): unknown {
    return aboutPageView(() => this.session.router.navigate({ name: 'home' }));
  }

  private renderSession(sessionId: string): unknown {
    const snap = this.session.store.getSnapshot();
    // No identity yet → show the join prompt (direct-URL entry point).
    if (!this.session.identity) {
      return joinPromptView(sessionId, (raw) => void this.handleJoin(sessionId, raw));
    }
    const summary = snap.votesRevealed ? this.session.store.getVotingSummary() : null;
    return gamePageView(snap, summary, {
      onVote: (v: VoteValue) => this.session.castVote(v),
      onReaction: (r: Reaction) => this.session.toggleReaction(r),
      onClearVotes: () => this.session.clearVotes(),
      onShowVotes: () => this.session.showVotes(),
      onOpenSettings: () =>
        showSettings({
          currentTheme: theme.get(),
          onThemeChange: (t) => theme.set(t),
        }),
      onNavigateAbout: () => this.session.router.navigate({ name: 'about' }),
    });
  }

  // --- Form handlers --------------------------------------------------------

  private async handleCreate(rawIdentity: string): Promise<void> {
    const identity = await buildIdentity(rawIdentity);
    await this.session.createSession(identity);
  }

  private async handleJoin(sessionId: string, rawIdentity: string): Promise<void> {
    const identity = await buildIdentity(rawIdentity);
    await this.session.joinSession(sessionId, identity);
  }

  // --- Keyboard nav helper --------------------------------------------------

  private navigateVote(direction: 1 | -1): void {
    const current = this.session.store.getSnapshot().selectedVote;
    const idx = current ? VOTE_CARDS.indexOf(current) : -1;
    let nextIdx: number;
    if (idx === -1) {
      nextIdx = direction > 0 ? 0 : VOTE_CARDS.length - 1;
    } else {
      nextIdx = idx + direction;
      if (nextIdx < 0 || nextIdx >= VOTE_CARDS.length) return;
    }
    const next = VOTE_CARDS[nextIdx] as VoteValue | undefined;
    if (next) this.session.castVote(next);
  }

  // --- Status banner --------------------------------------------------------

  private statusEl: HTMLElement | null = null;

  private ensureStatusHost(): void {
    const bar = document.createElement('div');
    bar.id = 'status-bar';
    bar.className = 'status-bar';
    const indicator = document.createElement('div');
    indicator.id = 'connection-status';
    indicator.className = 'connection-status';
    indicator.style.display = 'none';
    bar.appendChild(indicator);
    document.body.appendChild(bar);
    this.statusEl = indicator;
  }

  private renderStatusBanner(msg: { type: 'warning' | 'error'; message: string } | null): void {
    if (!this.statusEl) return;
    // Build via DOM + textContent rather than innerHTML — keeps untrusted text
    // safe without an escape helper and matches the lit-html convention.
    this.statusEl.replaceChildren();
    if (!msg) {
      this.statusEl.style.display = 'none';
      return;
    }
    this.statusEl.style.display = 'block';
    const indicator = document.createElement('div');
    indicator.className = `connection-indicator ${msg.type}`;
    const text = document.createElement('span');
    text.className = 'connection-text';
    text.textContent = msg.message;
    indicator.appendChild(text);
    this.statusEl.appendChild(indicator);
  }
}
